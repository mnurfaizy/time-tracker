import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin, requireCreator } from '../auth.js';
import { bad, notFound, reqStr, id } from '../util.js';

const r = Router();
r.use(requireAuth);

const map = (t) => ({ id: t.id, name: t.name, archived: !!t.archived });

const getTag = async (req, tagId) => {
  const t = await q.get('SELECT * FROM tags WHERE id = ? AND workspace_id = ?', tagId, req.ws.id);
  if (!t) throw notFound('Tag not found');
  return t;
};

r.get('/', async (req, res) => {
  res.json({ tags: (await q.all('SELECT * FROM tags WHERE workspace_id = ? ORDER BY name COLLATE NOCASE', req.ws.id)).map(map) });
});

r.post('/', requireCreator, async (req, res) => {
  const name = reqStr(req.body.name, 'Tag name', 100);
  if (await q.get('SELECT 1 FROM tags WHERE workspace_id = ? AND name = ?', req.ws.id, name)) throw bad('A tag with this name already exists');
  const { rows } = await q.run('INSERT INTO tags (workspace_id, name, created_at) VALUES (?, ?, ?) RETURNING id', req.ws.id, name, Date.now());
  res.json({ tag: map(await getTag(req, rows[0].id)) });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const t = await getTag(req, id(req.params.id));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Tag name', 100) : t.name;
  if (await q.get('SELECT 1 FROM tags WHERE workspace_id = ? AND name = ? AND id <> ?', req.ws.id, name, t.id)) throw bad('A tag with this name already exists');
  const archived = 'archived' in req.body ? (req.body.archived ? 1 : 0) : t.archived;
  await q.run('UPDATE tags SET name = ?, archived = ? WHERE id = ?', name, archived, t.id);
  res.json({ tag: map(await getTag(req, t.id)) });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const t = await getTag(req, id(req.params.id));
  await q.batch([
    ['DELETE FROM entry_tags WHERE tag_id = ?', t.id],
    ['DELETE FROM tags WHERE id = ?', t.id],
  ]);
  res.json({ ok: true });
});

export default r;
