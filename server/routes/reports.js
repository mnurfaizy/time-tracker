import { Router } from 'express';
import { q, getSettings } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, idList, str } from '../util.js';
import { ENTRY_SELECT, mapEntry } from '../lib/entries.js';
import { toCsv } from '../lib/csv.js';
import { dayKey, dayKeysInRange, clockTime, formatDuration, hoursDecimal, validTimeZone } from '../../shared/time.js';
import { summarize, weekly, entryDuration, entryAmount, entryRate, totals, groupLabel, GROUP_OPTIONS } from '../../shared/report.js';

const r = Router();
r.use(requireAuth);

function readFilters(query) {
  const start = Number(query.start);
  const end = Number(query.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw bad('Please choose a valid date range');
  return {
    start,
    end,
    users: idList(query.users),
    clients: idList(query.clients),
    projects: idList(query.projects),
    tags: idList(query.tags),
    billable: query.billable === '1' || query.billable === '0' ? Number(query.billable) : null,
    description: str(query.description, 200),
  };
}

/**
 * Finished entries matching the filters. Members are limited to their own time, except for the
 * team Dashboard when the workspace allows it (`teamView`).
 */
export async function reportEntries(user, f, { teamView = false } = {}) {
  const where = ['e.end_at IS NOT NULL', 'e.start_at >= ?', 'e.start_at < ?'];
  const params = [f.start, f.end];
  const marks = (list) => list.map(() => '?').join(',');

  const seesTeam = user.role === 'admin' || (teamView && (await getSettings()).membersSeeTeamDashboard);
  if (!seesTeam) {
    where.push('e.user_id = ?');
    params.push(user.id);
  } else if (f.users) {
    where.push(f.users.length ? `e.user_id IN (${marks(f.users)})` : '0');
    params.push(...f.users);
  }

  // id 0 in a filter list means "without client / project / tag".
  const inOrNull = (col, ids) => {
    const real = ids.filter(Boolean);
    const parts = [];
    if (real.length) {
      parts.push(`${col} IN (${marks(real)})`);
      params.push(...real);
    }
    if (ids.includes(0)) parts.push(`${col} IS NULL`);
    where.push(parts.length ? `(${parts.join(' OR ')})` : '0');
  };
  if (f.clients) inOrNull('c.id', f.clients);
  if (f.projects) inOrNull('e.project_id', f.projects);
  if (f.tags) {
    const real = f.tags.filter(Boolean);
    const parts = [];
    if (real.length) {
      parts.push(`EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (${marks(real)}))`);
      params.push(...real);
    }
    if (f.tags.includes(0)) parts.push('NOT EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id)');
    where.push(parts.length ? `(${parts.join(' OR ')})` : '0');
  }
  if (f.billable != null) {
    where.push('e.billable = ?');
    params.push(f.billable);
  }
  if (f.description) {
    where.push("e.description LIKE ? ESCAPE '\\'");
    params.push(`%${f.description.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  return (await q.all(`${ENTRY_SELECT} WHERE ${where.join(' AND ')} ORDER BY e.start_at DESC, e.id DESC`, ...params)).map(mapEntry);
}

r.get('/entries', async (req, res) => {
  res.json({ entries: await reportEntries(req.user, readFilters(req.query), { teamView: req.query.view === 'dashboard' }) });
});

/**
 * "Team right now" on the Dashboard: every active member with their running timer (if any) and their
 * last finished entry. Same visibility as the team Dashboard.
 */
r.get('/team-now', async (req, res) => {
  const seesTeam = req.user.role === 'admin' || (await getSettings()).membersSeeTeamDashboard;
  if (!seesTeam) return res.json({ members: [] });
  const [users, running, last] = await Promise.all([
    q.all('SELECT id, name, email FROM users WHERE active = 1 AND pending = 0 ORDER BY name COLLATE NOCASE'),
    q.all(`${ENTRY_SELECT} WHERE e.end_at IS NULL`),
    q.all(
      `${ENTRY_SELECT} WHERE e.id IN (
         SELECT (SELECT t.id FROM time_entries t WHERE t.user_id = x.id AND t.end_at IS NOT NULL ORDER BY t.end_at DESC, t.id DESC LIMIT 1)
         FROM users x WHERE x.active = 1 AND x.pending = 0)`,
    ),
  ]);
  const runningBy = new Map(running.map((row) => [row.user_id, mapEntry(row)]));
  const lastBy = new Map(last.map((row) => [row.user_id, mapEntry(row)]));
  res.json({
    now: Date.now(),
    members: users.map((u) => ({
      user: { id: u.id, name: u.name, email: u.email },
      running: runningBy.get(u.id) ?? null,
      last: lastBy.get(u.id) ?? null,
    })),
  });
});

const groupParam = (v, fallback) => (GROUP_OPTIONS.some(([k]) => k === v) ? v : fallback);
const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

// Unlimited CSV export of any date range.
r.get('/export', async (req, res) => {
  const f = readFilters(req.query);
  const tz = validTimeZone(req.query.tz) ? req.query.tz : 'UTC';
  const type = ['detailed', 'summary', 'weekly'].includes(req.query.type) ? req.query.type : 'detailed';
  const settings = await getSettings();
  const cur = settings.currency;
  const entries = (await reportEntries(req.user, f)).reverse(); // chronological
  const tagNames = new Map((await q.all('SELECT id, name FROM tags')).map((t) => [t.id, t.name]));
  const ctx = { tz, defaultRate: settings.defaultRate, tagName: (tagId) => tagNames.get(tagId) ?? '' };
  const rows = [];

  if (type === 'detailed') {
    rows.push([
      'Project', 'Client', 'Description', 'Task', 'User', 'Email', 'Tags', 'Billable',
      'Start Date', 'Start Time', 'End Date', 'End Time', 'Duration (h)', 'Duration (decimal)',
      `Billable Rate (${cur})`, `Billable Amount (${cur})`,
    ]);
    for (const e of entries) {
      const dur = entryDuration(e);
      rows.push([
        e.projectName ?? '', e.clientName ?? '', e.description, e.taskName ?? '', e.userName, e.userEmail,
        e.tagIds.map(ctx.tagName).filter(Boolean).join(', '), e.billable ? 'Yes' : 'No',
        dayKey(e.start, tz), clockTime(e.start, tz, '24', true), dayKey(e.end, tz), clockTime(e.end, tz, '24', true),
        formatDuration(dur), hoursDecimal(dur),
        money(e.billable ? entryRate(e, ctx.defaultRate) : 0), money(entryAmount(e, ctx.defaultRate)),
      ]);
    }
  } else if (type === 'summary') {
    const g1 = groupParam(req.query.group1, 'project');
    const g2 = req.query.group2 === 'none' ? null : groupParam(req.query.group2, 'description');
    const withClient = g1 === 'project';
    rows.push([groupLabel(g1), ...(withClient ? ['Client'] : []), ...(g2 ? [groupLabel(g2)] : []), 'Time (h)', 'Time (decimal)', `Amount (${cur})`]);
    for (const n of summarize(entries, g1, g2, ctx)) {
      const lead = [n.label, ...(withClient ? [n.sub ?? ''] : [])];
      rows.push([...lead, ...(g2 ? [''] : []), formatDuration(n.duration), hoursDecimal(n.duration), money(n.amount)]);
      for (const c of n.children) {
        rows.push([...lead.map(() => ''), c.label, formatDuration(c.duration), hoursDecimal(c.duration), money(c.amount)]);
      }
    }
    const t = totals(entries, ctx.defaultRate);
    rows.push(['Total', ...(withClient ? [''] : []), ...(g2 ? [''] : []), formatDuration(t.duration), hoursDecimal(t.duration), money(t.amount)]);
  } else {
    const by = groupParam(req.query.group1, 'user');
    const days = dayKeysInRange(f.start, f.end, tz);
    const data = weekly(entries, by, days, ctx);
    rows.push([groupLabel(by), ...days, 'Total']);
    for (const row of data) rows.push([row.label, ...days.map((d) => formatDuration(row.days[d])), formatDuration(row.total)]);
    rows.push([
      'Total',
      ...days.map((d) => formatDuration(data.reduce((s, row) => s + row.days[d], 0))),
      formatDuration(data.reduce((s, row) => s + row.total, 0)),
    ]);
  }

  const filename = `time-report-${type}_${dayKey(f.start, tz)}_${dayKey(f.end - 1, tz)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(toCsv(rows));
});

export default r;
