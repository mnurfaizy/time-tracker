import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, forbidden, notFound, id, ms } from '../util.js';
import { ENTRY_SELECT, mapEntry, getEntry } from '../lib/entries.js';
import { scheduleSync, scheduleRemove } from '../lib/gcalSync.js';
import { canUseProject } from './projects.js';

const r = Router();
r.use(requireAuth);

const MAX_TS = 8.64e15;
const marks = (list) => list.map(() => '?').join(',');

/** Admins may act on another user's time; everyone else only on their own. */
async function targetUserId(req, raw) {
  const uid = id(raw);
  if (!uid || uid === req.user.id) return req.user.id;
  if (req.user.role !== 'admin') throw forbidden();
  if (!(await q.get('SELECT 1 FROM users WHERE id = ?', uid))) throw notFound('User not found');
  return uid;
}

async function loadEditable(req, entryId) {
  const row = await q.get('SELECT * FROM time_entries WHERE id = ?', entryId);
  if (!row) throw notFound('Time entry not found');
  if (row.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  return row;
}

/** Validates the editable fields present in `body`; `current` is the stored row (or null). */
async function readInput(req, body, current) {
  const out = {};
  if ('description' in body) out.description = String(body.description ?? '').slice(0, 3000);
  if ('billable' in body) out.billable = body.billable ? 1 : 0;

  let projectId = current?.project_id ?? null;
  if ('projectId' in body) {
    projectId = id(body.projectId);
    if (projectId && projectId !== current?.project_id && !(await canUseProject(req.user, projectId))) {
      throw bad('Project not found or you do not have access to it');
    }
    out.project_id = projectId;
  }
  if ('taskId' in body || 'projectId' in body) {
    let taskId = 'taskId' in body ? id(body.taskId) : current?.task_id ?? null;
    if (taskId) {
      const task = await q.get('SELECT project_id FROM tasks WHERE id = ?', taskId);
      if (!task || task.project_id !== projectId) {
        if ('taskId' in body) throw bad('Task does not belong to the selected project');
        taskId = null;
      }
    }
    out.task_id = taskId;
  }

  if ('start' in body) out.start_at = ms(body.start, 'start time');
  if ('end' in body) out.end_at = body.end == null ? null : ms(body.end, 'end time');

  if ('tagIds' in body) {
    if (!Array.isArray(body.tagIds)) throw bad('tagIds must be a list');
    const tagIds = [...new Set(body.tagIds.map(id).filter(Boolean))];
    if (tagIds.length) {
      const found = await q.all(`SELECT id FROM tags WHERE id IN (${marks(tagIds)})`, ...tagIds);
      if (found.length !== tagIds.length) throw bad('Tag not found');
    }
    out.tagIds = tagIds;
  }

  const start = out.start_at ?? current?.start_at;
  const end = 'end_at' in out ? out.end_at : current?.end_at;
  if (start != null && end != null && end < start) throw bad('End time must be after start time');
  if (start != null && (start < 0 || start > MAX_TS)) throw bad('Invalid start time');
  return out;
}

const tagStatements = (entryId, tagIds) => [
  ['DELETE FROM entry_tags WHERE entry_id = ?', entryId],
  ...tagIds.map((t) => ['INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', entryId, t]),
];

const INSERT_ENTRY = `INSERT INTO time_entries (user_id, description, project_id, task_id, billable, start_at, end_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`;
const insertArgs = (userId, f, now) => [
  userId, f.description ?? '', f.project_id ?? null, f.task_id ?? null, f.billable ?? 0, f.start_at, f.end_at ?? null, now, now,
];

async function insertEntry(userId, f) {
  const { rows } = await q.run(INSERT_ENTRY, ...insertArgs(userId, f, Date.now()));
  const entryId = rows[0].id;
  if (f.tagIds?.length) await q.batch(tagStatements(entryId, f.tagIds));
  return entryId;
}

async function updateEntry(entryId, fields) {
  const { tagIds, ...cols } = fields;
  const keys = Object.keys(cols);
  await q.batch([
    [`UPDATE time_entries SET ${[...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ')} WHERE id = ?`, ...keys.map((k) => cols[k]), Date.now(), entryId],
    ...(tagIds ? tagStatements(entryId, tagIds) : []),
  ]);
}

// Finished entries, newest first, for the Time Tracker list (always the caller's own).
r.get('/', async (req, res) => {
  const userId = req.user.id;
  const before = Number(req.query.before) || MAX_TS;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = await q.all(
    `${ENTRY_SELECT} WHERE e.user_id = ? AND e.end_at IS NOT NULL AND e.start_at < ? ORDER BY e.start_at DESC, e.id DESC LIMIT ?`,
    userId, before, limit + 1,
  );
  res.json({ entries: rows.slice(0, limit).map(mapEntry), hasMore: rows.length > limit });
});

r.get('/running', async (req, res) => {
  const row = await q.get(`${ENTRY_SELECT} WHERE e.user_id = ? AND e.end_at IS NULL`, req.user.id);
  res.json({ entry: row ? mapEntry(row) : null });
});

// Entries overlapping [start, end) — used by the personal Calendar (always the caller's own).
r.get('/range', async (req, res) => {
  const userId = req.user.id;
  const start = ms(Number(req.query.start), 'start');
  const end = ms(Number(req.query.end), 'end');
  const rows = await q.all(
    `${ENTRY_SELECT} WHERE e.user_id = ? AND e.start_at < ? AND COALESCE(e.end_at, ?) > ? ORDER BY e.start_at`,
    userId, end, Date.now(), start,
  );
  res.json({ entries: rows.map(mapEntry) });
});

// Recent distinct activities matching the typed description.
r.get('/suggestions', async (req, res) => {
  const term = String(req.query.q ?? '').slice(0, 200).replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await q.all(
    `SELECT e.description, e.project_id, e.task_id, e.billable, MAX(e.start_at) AS last,
       (SELECT group_concat(et.tag_id) FROM entry_tags et WHERE et.entry_id = e.id) AS tag_ids
     FROM time_entries e
     WHERE e.user_id = ? AND e.description <> '' AND e.description LIKE ? ESCAPE '\\'
     GROUP BY e.description, e.project_id, e.task_id
     ORDER BY last DESC LIMIT 8`,
    req.user.id, `%${term}%`,
  );
  res.json({
    suggestions: rows.map((s) => ({
      description: s.description,
      projectId: s.project_id,
      taskId: s.task_id,
      billable: !!s.billable,
      tagIds: s.tag_ids ? String(s.tag_ids).split(',').map(Number) : [],
    })),
  });
});

r.post('/start', async (req, res) => {
  const fields = await readInput(req, { ...req.body, end: undefined }, null);
  delete fields.end_at;
  const now = Date.now();
  const start = Math.min(fields.start_at ?? now, now);
  // Stop whatever is running and start the new timer atomically.
  const [running, , inserted] = await q.batch([
    ['SELECT id FROM time_entries WHERE user_id = ? AND end_at IS NULL', req.user.id],
    ['UPDATE time_entries SET end_at = MAX(?, start_at), updated_at = ? WHERE user_id = ? AND end_at IS NULL', now, now, req.user.id],
    [INSERT_ENTRY, ...insertArgs(req.user.id, { ...fields, start_at: start, end_at: null }, now)],
  ]);
  const newId = inserted.rows[0].id;
  const stoppedId = running.rows[0]?.id;
  if (fields.tagIds?.length) await q.batch(tagStatements(newId, fields.tagIds));
  if (stoppedId) scheduleSync(stoppedId);
  const [entry, stopped] = await Promise.all([getEntry(newId), stoppedId ? getEntry(stoppedId) : null]);
  res.json({ entry, stopped });
});

r.post('/stop', async (req, res) => {
  const end = req.body.end != null ? ms(req.body.end, 'end time') : Date.now();
  const { rows } = await q.run(
    'UPDATE time_entries SET end_at = MAX(?, start_at), updated_at = ? WHERE user_id = ? AND end_at IS NULL RETURNING id',
    end, Date.now(), req.user.id,
  );
  if (!rows.length) return res.json({ entry: null });
  scheduleSync(rows[0].id);
  res.json({ entry: await getEntry(rows[0].id) });
});

// Manual entry (also used by the Calendar and by admins adding time for others).
r.post('/', async (req, res) => {
  const userId = await targetUserId(req, req.body.userId);
  if (req.body.start == null || req.body.end == null) throw bad('Start and end time are required');
  const fields = await readInput(req, req.body, null);
  const entryId = await insertEntry(userId, fields);
  scheduleSync(entryId);
  res.json({ entry: await getEntry(entryId) });
});

r.put('/:id', async (req, res) => {
  const current = await loadEditable(req, id(req.params.id));
  if ('end' in req.body && req.body.end == null && current.end_at != null) throw bad('A finished entry needs an end time');
  const fields = await readInput(req, req.body, current);
  if (Object.keys(fields).length) await updateEntry(current.id, fields);
  const entry = await getEntry(current.id);
  if (entry.end != null) scheduleSync(current.id);
  res.json({ entry });
});

r.delete('/:id', async (req, res) => {
  const current = await loadEditable(req, id(req.params.id));
  await q.batch([
    ['DELETE FROM entry_tags WHERE entry_id = ?', current.id],
    ['DELETE FROM time_entries WHERE id = ?', current.id],
  ]);
  scheduleRemove(current.user_id, current.gcal_event_id, current.id);
  res.json({ ok: true });
});

export default r;
