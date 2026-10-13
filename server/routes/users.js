import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin, hashPassword, publicUser, deleteUserSessions } from '../auth.js';
import { bad, notFound, reqStr, email, password, id } from '../util.js';

const r = Router();
r.use(requireAuth);

const getUser = async (userId) => {
  const u = await q.get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw notFound('User not found');
  return u;
};

// Members only ever see themselves; admins see the whole team.
r.get('/', async (req, res) => {
  const rows = req.user.role === 'admin'
    ? await q.all('SELECT * FROM users ORDER BY active DESC, name COLLATE NOCASE')
    : [req.user];
  res.json({ users: rows.map(publicUser) });
});

r.post('/', requireAdmin, async (req, res) => {
  const name = reqStr(req.body.name, 'Name', 100);
  const mail = email(req.body.email);
  const pw = password(req.body.password);
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  if (await q.get('SELECT 1 FROM users WHERE email = ?', mail)) throw bad('A user with this email already exists');
  const { rows } = await q.run(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    name, mail, hashPassword(pw), role, Date.now(),
  );
  res.json({ user: publicUser(await getUser(rows[0].id)) });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const user = await getUser(id(req.params.id));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Name', 100) : user.name;
  const mail = 'email' in req.body ? email(req.body.email) : user.email;
  const role = 'role' in req.body ? (req.body.role === 'admin' ? 'admin' : 'member') : user.role;
  const active = 'active' in req.body ? (req.body.active ? 1 : 0) : user.active;

  if (await q.get('SELECT 1 FROM users WHERE email = ? AND id <> ?', mail, user.id)) throw bad('A user with this email already exists');
  if (user.id === req.user.id && (role !== 'admin' || !active)) throw bad('You cannot demote or deactivate yourself');
  if (user.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = (await q.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", user.id)).n;
    if (admins === 0) throw bad('The workspace needs at least one active admin');
  }

  await q.run('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?', name, mail, role, active, user.id);
  if (!active) await deleteUserSessions(user.id);
  res.json({ user: publicUser(await getUser(user.id)) });
});

r.put('/:id/password', requireAdmin, async (req, res) => {
  const user = await getUser(id(req.params.id));
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password(req.body.password)), user.id);
  if (user.id !== req.user.id) await deleteUserSessions(user.id);
  res.json({ ok: true });
});

export default r;
