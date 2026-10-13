import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin, requireCreator } from '../auth.js';
import { bad, notFound, reqStr, id } from '../util.js';

const r = Router();
r.use(requireAuth);

const map = (t) => ({ id: t.id, name: t.name, archived: !!t.archived });

const getTag = async (tagId) => {
  const t = await q.get('SELECT * FROM tags WHERE id = ?', tagId);
  if (!t) throw notFound('Tag not found');
  return t;
};

r.get('/', async (req, res) => {
  res.json({ tags: (await q.all('SELECT * FROM tags ORDER BY name COLLATE NOCASE')).map(map) });
});

r.post('/', requireCreator, async (req, res) => {
  const name = reqStr(req.body.name, 'Tag name', 100);
  if (await q.get('SELECT 1 FROM tags WHERE name = ?', name)) throw bad('A tag with this name already exists');
  const { rows } = await q.run('INSERT INTO tags (name, created_at) VALUES (?, ?) RETURNING id', name, Date.now());
  res.json({ tag: map(await getTag(rows[0].id)) });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const t = await getTag(id(req.params.id));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Tag name', 100) : t.name;
  if (await q.get('SELECT 1 FROM tags WHERE name = ? AND id <> ?', name, t.id)) throw bad('A tag with this name already exists');
  const archived = 'archived' in req.body ? (req.body.archived ? 1 : 0) : t.archived;
  await q.run('UPDATE tags SET name = ?, archived = ? WHERE id = ?', name, archived, t.id);
  res.json({ tag: map(await getTag(t.id)) });
});

r.delete('/:id', requireAdmin, async (req, res) => {
  const t = await getTag(id(req.params.id));
  await q.batch([
    ['DELETE FROM entry_tags WHERE tag_id = ?', t.id],
    ['DELETE FROM tags WHERE id = ?', t.id],
  ]);
  res.json({ ok: true });
});

export default r;
