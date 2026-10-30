import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin, requireCreator } from '../auth.js';
import { bad, notFound, reqStr, str, id } from '../util.js';

const r = Router();
r.use(requireAuth);

const SELECT = `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count FROM clients c`;
const map = (c) => ({ id: c.id, name: c.name, note: c.note, archived: !!c.archived, projectCount: c.project_count ?? 0 });

const getClient = async (req, clientId) => {
  const c = await q.get(`${SELECT} WHERE c.id = ? AND c.workspace_id = ?`, clientId, req.ws.id);
  if (!c) throw notFound('Client not found');
  return c;
};

async function assertUnique(req, name, exceptId = 0) {
  if (await q.get('SELECT 1 FROM clients WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id <> ?', req.ws.id, name, exceptId)) {
    throw bad('A client with this name already exists');
  }
}

r.get('/', async (req, res) => {
  res.json({ clients: (await q.all(`${SELECT} WHERE c.workspace_id = ? ORDER BY c.name COLLATE NOCASE`, req.ws.id)).map(map) });
});

r.post('/', requireCreator, async (req, res) => {
  const name = reqStr(req.body.name, 'Client name', 100);
  await assertUnique(req, name);
  const { rows } = await q.run(
    'INSERT INTO clients (workspace_id, name, note, created_at) VALUES (?, ?, ?, ?) RETURNING id',
    req.ws.id, name, str(req.body.note, 2000), Date.now(),
  );
  res.json({ client: map(await getClient(req, rows[0].id)) });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const c = await getClient(req, id(req.params.id));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Client name', 100) : c.name;
  await assertUnique(req, name, c.id);
  const note = 'note' in req.body ? str(req.body.note, 2000) : c.note;
  const archived = 'archived' in req.body ? (req.body.archived ? 1 : 0) : c.archived;
  await q.run('UPDATE clients SET name = ?, note = ?, archived = ? WHERE id = ?', name, note, archived, c.id);
  res.json({ client: map(await getClient(req, c.id)) });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const c = await getClient(req, id(req.params.id));
  await q.batch([
    ['UPDATE projects SET client_id = NULL WHERE client_id = ?', c.id],
    ['DELETE FROM clients WHERE id = ?', c.id],
  ]);
  res.json({ ok: true });
});

export default r;
