import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { bad } from '../util.js';
import { parseCsv } from '../lib/csv.js';

const r = Router();
r.use(requireAuth, requireAdmin);

const COLORS = [
  '#3E8E5E', '#4F68D8', '#E0A23A', '#E06A5A', '#8C63D2', '#2A9D8F', '#D4618C', '#7E9A3C',
  '#C2861A', '#5B7FD6', '#B5563B', '#3B7A8C', '#9C6B3F', '#6D7A70', '#A8486A', '#4E9F6E', '#7A5CC0',
];
const colorFor = (name) => COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
const key = (s) => s.trim().toLowerCase();

/** Reads a CSV into objects keyed by lower-case header names. */
function readTable(csv, required) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw bad('The file is empty or is not a CSV export');
  const header = rows[0].map(key);
  for (const col of required) {
    if (!header.includes(col)) throw bad(`This does not look like a Clockify export: column "${col}" is missing`);
  }
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()])));
}

async function runChunks(stmts, size = 80) {
  const results = [];
  for (let i = 0; i < stmts.length; i += size) results.push(...(await q.batch(stmts.slice(i, i + size))));
  return results;
}

/**
 * Imports clients, projects and tasks from Clockify's Projects export (Projects → Export → CSV).
 * Existing clients/projects/tasks with the same name are kept as they are.
 */
r.post('/clockify-projects', async (req, res) => {
  const rows = readTable(String(req.body.csv ?? ''), ['project']);
  const dryRun = !!req.body.dryRun;
  const billable = req.body.billable ? 1 : 0;
  const now = Date.now();

  const [clients, projects, tasks] = await Promise.all([
    q.all('SELECT id, name FROM clients WHERE workspace_id = ?', req.ws.id),
    q.all('SELECT id, name, client_id FROM projects WHERE workspace_id = ?', req.ws.id),
    q.all('SELECT t.id, t.name, t.project_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ?', req.ws.id),
  ]);
  const clientIds = new Map(clients.map((c) => [key(c.name), c.id]));
  const projectIds = new Map(projects.map((p) => [`${key(p.name)}|${p.client_id ?? 0}`, p.id]));
  const taskKeys = new Set(tasks.map((t) => `${t.project_id}|${key(t.name)}`));

  // 1. Clients
  const newClients = [];
  for (const row of rows) {
    const name = row.client;
    if (name && !clientIds.has(key(name)) && !newClients.some((n) => key(n) === key(name))) newClients.push(name);
  }
  if (!dryRun && newClients.length) {
    const results = await runChunks(newClients.map((name) => ['INSERT INTO clients (workspace_id, name, created_at) VALUES (?, ?, ?) RETURNING id', req.ws.id, name, now]));
    newClients.forEach((name, i) => clientIds.set(key(name), results[i].rows[0].id));
  }

  // 2. Projects
  const plan = { projects: [], skippedProjects: [], tasks: 0 };
  const newProjects = [];
  for (const row of rows) {
    const name = row.project;
    if (!name) continue;
    const clientKey = row.client ? key(row.client) : null;
    const clientId = clientKey ? clientIds.get(clientKey) ?? `new:${clientKey}` : null;
    const projectKey = `${key(name)}|${clientId ?? 0}`;
    const taskNames = [...new Set((row.tasks || '').split(/,\s+/).map((t) => t.trim()).filter(Boolean))];
    const entry = {
      name,
      client: row.client || null,
      clientId,
      archived: /archiv/i.test(row.status || '') ? 1 : 0,
      isPublic: /private/i.test(row.visibility || '') ? 0 : 1,
      note: (row.note || '').slice(0, 5000),
      taskNames,
    };
    if (projectIds.has(projectKey) || newProjects.some((p) => `${key(p.name)}|${p.clientId ?? 0}` === projectKey)) {
      plan.skippedProjects.push({ name, client: entry.client });
      entry.existingId = projectIds.get(projectKey);
      if (!entry.existingId) entry.taskNames = []; // duplicate row within the same file
    } else {
      newProjects.push(entry);
      plan.projects.push({ name, client: entry.client, tasks: taskNames.length, archived: !!entry.archived });
    }
    entry.taskNames = taskNames.filter((t) => !(entry.existingId && taskKeys.has(`${entry.existingId}|${key(t)}`)));
    plan.tasks += entry.taskNames.length;
    if (entry.existingId && entry.taskNames.length) newProjects.push({ ...entry, onlyTasks: true });
  }

  const summary = {
    clients: newClients.length,
    projects: plan.projects.length,
    tasks: plan.tasks,
    skippedProjects: plan.skippedProjects.length,
    preview: plan.projects.slice(0, 200),
    skipped: plan.skippedProjects.slice(0, 200),
  };
  if (dryRun) return res.json({ dryRun: true, ...summary });

  const toCreate = newProjects.filter((p) => !p.onlyTasks);
  const created = await runChunks(
    toCreate.map((p) => [
      `INSERT INTO projects (workspace_id, name, client_id, color, billable, hourly_rate, is_public, archived, note, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?) RETURNING id`,
      req.ws.id, p.name, p.clientId, colorFor(p.name), billable, p.isPublic, p.archived, p.note, now,
    ]),
  );
  toCreate.forEach((p, i) => {
    p.existingId = created[i].rows[0].id;
  });

  // 3. Tasks
  const taskStmts = [];
  for (const p of newProjects) {
    for (const t of p.taskNames) taskStmts.push(['INSERT INTO tasks (project_id, name, created_at) VALUES (?, ?, ?)', p.existingId, t.slice(0, 150), now]);
  }
  await runChunks(taskStmts);

  res.json({ dryRun: false, ...summary });
});

export default r;
