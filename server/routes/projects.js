import { Router } from 'express';
import { q, getSettings } from '../db.js';
import { requireAuth, requireAdmin, requireCreator } from '../auth.js';
import { bad, forbidden, notFound, reqStr, str, id, color } from '../util.js';
import { detachProject } from '../lib/entries.js';

const r = Router();
r.use(requireAuth);

const VISIBLE = '(p.is_public = 1 OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))';

/** `user` is req.user: its role and wsId are those of the current workspace. */
export async function canUseProject(user, projectId) {
  if (user.role === 'admin') return !!(await q.get('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?', projectId, user.wsId));
  return !!(await q.get(`SELECT 1 FROM projects p WHERE p.id = ? AND p.workspace_id = ? AND ${VISIBLE}`, projectId, user.wsId, user.id));
}

const getProject = async (req, projectId) => {
  const p = await q.get('SELECT * FROM projects WHERE id = ? AND workspace_id = ?', projectId, req.ws.id);
  if (!p) throw notFound('Project not found');
  return p;
};

export async function listProjects(user, onlyId = null) {
  const isAdmin = user.role === 'admin';
  const where = ['p.workspace_id = ?', ...(isAdmin ? [] : [VISIBLE])];
  const params = isAdmin ? [user.wsId] : [user.wsId, user.id];
  if (onlyId) {
    where.push('p.id = ?');
    params.push(onlyId);
  }
  const scope = `JOIN projects sp ON sp.id = x.project_id WHERE sp.workspace_id = ?${onlyId ? ' AND x.project_id = ?' : ''}`;
  const scopeArgs = onlyId ? [user.wsId, onlyId] : [user.wsId];

  const [projects, tasks, members, stats, settings] = await Promise.all([
    q.all(
      `SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id
       WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE`,
      ...params,
    ),
    q.all(`SELECT x.* FROM tasks x ${scope} ORDER BY x.done, x.name COLLATE NOCASE`, ...scopeArgs),
    isAdmin ? q.all(`SELECT x.* FROM project_members x ${scope}`, ...scopeArgs) : [],
    q.all(
      `SELECT project_id, SUM(dur) AS tracked,
         SUM(CASE WHEN billable = 1 THEN dur ELSE 0 END) AS billable_tracked
       FROM (
         SELECT ep.project_id, e.end_at - e.start_at AS dur, e.billable
           FROM entry_projects ep JOIN time_entries e ON e.id = ep.entry_id
           WHERE e.workspace_id = ? AND e.end_at IS NOT NULL
         UNION ALL
         SELECT e.project_id, e.end_at - e.start_at AS dur, e.billable
           FROM time_entries e
           WHERE e.workspace_id = ? AND e.end_at IS NOT NULL AND e.project_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM entry_projects x WHERE x.entry_id = e.id)
       )
       ${onlyId ? 'WHERE project_id = ?' : ''}
       GROUP BY project_id`,
      user.wsId, user.wsId, ...(onlyId ? [onlyId] : []),
    ),
    getSettings(user.wsId),
  ]);
  const statById = new Map(stats.map((s) => [s.project_id, s]));

  return projects.map((p) => {
    const s = statById.get(p.id);
    return {
      id: p.id,
      name: p.name,
      clientId: p.client_id,
      clientName: p.client_name ?? null,
      color: p.color,
      billable: !!p.billable,
      hourlyRate: p.hourly_rate,
      isPublic: !!p.is_public,
      archived: !!p.archived,
      note: p.note,
      tracked: s?.tracked ?? 0,
      amount: ((s?.billable_tracked ?? 0) / 3600000) * (p.hourly_rate ?? settings.defaultRate),
      tasks: tasks.filter((t) => t.project_id === p.id).map((t) => ({ id: t.id, projectId: t.project_id, name: t.name, done: !!t.done })),
      memberIds: members.filter((m) => m.project_id === p.id).map((m) => m.user_id),
    };
  });
}

const oneProject = async (user, projectId) => (await listProjects(user, projectId))[0];

async function readProjectInput(wsId, body, current) {
  const name = 'name' in body ? reqStr(body.name, 'Project name', 150) : current.name;
  const clientId = 'clientId' in body ? id(body.clientId) : current.client_id;
  if (clientId && !(await q.get('SELECT 1 FROM clients WHERE id = ? AND workspace_id = ?', clientId, wsId))) throw bad('Client not found');
  let hourlyRate = current.hourly_rate;
  if ('hourlyRate' in body) {
    hourlyRate = body.hourlyRate === '' || body.hourlyRate == null ? null : Number(body.hourlyRate);
    if (hourlyRate != null && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) throw bad('Hourly rate must be a positive number');
  }
  const dup = await q.get(
    'SELECT 1 FROM projects WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND IFNULL(client_id, 0) = ? AND id <> ?',
    wsId, name, clientId ?? 0, current.id ?? 0,
  );
  if (dup) throw bad('A project with this name already exists for this client');
  return {
    name,
    client_id: clientId,
    color: 'color' in body ? color(body.color) : current.color,
    billable: 'billable' in body ? (body.billable ? 1 : 0) : current.billable,
    hourly_rate: hourlyRate,
    is_public: 'isPublic' in body ? (body.isPublic ? 1 : 0) : current.is_public,
    archived: 'archived' in body ? (body.archived ? 1 : 0) : current.archived,
    note: 'note' in body ? str(body.note, 5000) : current.note,
  };
}

r.get('/', async (req, res) => res.json({ projects: await listProjects(req.user) }));

r.post('/', requireCreator, async (req, res) => {
  const v = await readProjectInput(req.ws.id, req.body, { color: '#3E8E5E', billable: 1, is_public: 1, archived: 0, note: '', hourly_rate: null });
  const { rows } = await q.run(
    `INSERT INTO projects (workspace_id, name, client_id, color, billable, hourly_rate, is_public, archived, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?) RETURNING id`,
    req.ws.id, v.name, v.client_id, v.color, v.billable, v.hourly_rate, v.is_public, v.note, Date.now(),
  );
  // The creator always keeps access to a private project they made.
  await q.run('INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', rows[0].id, req.user.id);
  res.json({ project: await oneProject(req.user, rows[0].id) });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const p = await getProject(req, id(req.params.id));
  const v = await readProjectInput(req.ws.id, req.body, p);
  await q.run(
    'UPDATE projects SET name = ?, client_id = ?, color = ?, billable = ?, hourly_rate = ?, is_public = ?, archived = ?, note = ? WHERE id = ?',
    v.name, v.client_id, v.color, v.billable, v.hourly_rate, v.is_public, v.archived, v.note, p.id,
  );
  res.json({ project: await oneProject(req.user, p.id) });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const p = await getProject(req, id(req.params.id));
  // Time entries are kept, just detached from the project (repointed to another linked one).
  await detachProject(p.id);
  await q.batch([
    ['DELETE FROM project_members WHERE project_id = ?', p.id],
    ['DELETE FROM projects WHERE id = ?', p.id],
  ]);
  res.json({ ok: true });
});

r.put('/:id/members', requireAdmin, async (req, res) => {
  const p = await getProject(req, id(req.params.id));
  const wanted = Array.isArray(req.body.userIds) ? [...new Set(req.body.userIds.map(id).filter(Boolean))] : [];
  const existing = wanted.length
    ? (await q.all(
      `SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id IN (${wanted.map(() => '?').join(',')})`,
      req.ws.id, ...wanted,
    )).map((m) => m.user_id)
    : [];
  await q.batch([
    ['DELETE FROM project_members WHERE project_id = ?', p.id],
    ...existing.map((uid) => ['INSERT INTO project_members (project_id, user_id) VALUES (?, ?)', p.id, uid]),
  ]);
  res.json({ project: await oneProject(req.user, p.id) });
});

// ---- Tasks ----

r.post('/:id/tasks', requireCreator, async (req, res) => {
  const p = await getProject(req, id(req.params.id));
  if (!(await canUseProject(req.user, p.id))) throw forbidden();
  const name = reqStr(req.body.name, 'Task name', 150);
  if (await q.get('SELECT 1 FROM tasks WHERE project_id = ? AND name = ? COLLATE NOCASE', p.id, name)) throw bad('This task already exists');
  await q.run('INSERT INTO tasks (project_id, name, created_at) VALUES (?, ?, ?)', p.id, name, Date.now());
  res.json({ project: await oneProject(req.user, p.id) });
});

const getTask = async (req, taskId) => {
  const t = await q.get('SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.workspace_id = ?', taskId, req.ws.id);
  if (!t) throw notFound('Task not found');
  return t;
};

r.put('/tasks/:taskId', requireAdmin, async (req, res) => {
  const t = await getTask(req, id(req.params.taskId));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Task name', 150) : t.name;
  const done = 'done' in req.body ? (req.body.done ? 1 : 0) : t.done;
  await q.run('UPDATE tasks SET name = ?, done = ? WHERE id = ?', name, done, t.id);
  res.json({ project: await oneProject(req.user, t.project_id) });
});

r.delete('/tasks/:taskId', requireAdmin, async (req, res) => {
  const t = await getTask(req, id(req.params.taskId));
  await q.batch([
    ['UPDATE time_entries SET task_id = NULL WHERE task_id = ?', t.id],
    ['DELETE FROM tasks WHERE id = ?', t.id],
  ]);
  res.json({ project: await oneProject(req.user, t.project_id) });
});

export default r;
