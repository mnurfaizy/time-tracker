import { Router } from 'express';
import { q } from '../db.js';
import { requireAuth, requireAdmin, hashPassword, publicUser, deleteUserSessions } from '../auth.js';
import { bad, notFound, reqStr, email, password, id } from '../util.js';
import { createMemberAccount } from '../lib/signup.js';
import { addMember, assertCanManageAccount, loginState } from '../lib/workspaces.js';

const r = Router();
r.use(requireAuth);

// Account columns plus this workspace's membership (role, active, pending, joined at).
const MEMBER_SELECT = `
SELECT u.id, u.name, u.email, u.password_hash, u.google_email, u.google_refresh_token, u.gcal_sync,
  m.role, m.active, m.pending, m.created_at
FROM workspace_members m JOIN users u ON u.id = m.user_id`;

const getMember = async (req, userId) => {
  const u = await q.get(`${MEMBER_SELECT} WHERE m.workspace_id = ? AND u.id = ?`, req.ws.id, userId);
  if (!u) throw notFound('User not found');
  return u;
};

/** Signs the user out everywhere once they cannot work in any workspace any more. */
async function signOutIfLockedOut(userId) {
  if ((await loginState(userId)) !== 'ok') await deleteUserSessions(userId);
}

// Members only ever see themselves; admins see the whole team of this workspace.
r.get('/', async (req, res) => {
  const rows = req.user.role === 'admin'
    ? await q.all(`${MEMBER_SELECT} WHERE m.workspace_id = ? ORDER BY m.active DESC, u.name COLLATE NOCASE`, req.ws.id)
    : [req.user];
  res.json({ users: rows.map(publicUser) });
});

// Adds a person. Someone who already has an account (e.g. from another workspace) just joins this
// workspace and keeps their own password; `existing` tells the UI so.
r.post('/', requireAdmin, async (req, res) => {
  const name = reqStr(req.body.name, 'Name', 100);
  const mail = email(req.body.email);
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  const account = await q.get('SELECT id FROM users WHERE email = ?', mail);
  if (account) {
    const member = await q.get('SELECT active, pending FROM workspace_members WHERE workspace_id = ? AND user_id = ?', req.ws.id, account.id);
    if (member && !member.pending) throw bad('This person is already a member of this workspace');
    await addMember(req.ws.id, account.id, { role });
    return res.json({ user: publicUser(await getMember(req, account.id)), existing: true });
  }
  const pw = password(req.body.password);
  const userId = await createMemberAccount(req.ws.id, { name, email: mail, passwordHash: hashPassword(pw), role });
  res.json({ user: publicUser(await getMember(req, userId)), existing: false });
});

r.put('/:id', requireAdmin, async (req, res) => {
  const user = await getMember(req, id(req.params.id));
  const name = 'name' in req.body ? reqStr(req.body.name, 'Name', 100) : user.name;
  const mail = 'email' in req.body ? email(req.body.email) : user.email;
  const role = 'role' in req.body ? (req.body.role === 'admin' ? 'admin' : 'member') : user.role;
  const active = 'active' in req.body ? (req.body.active ? 1 : 0) : user.active;

  const accountChanged = name !== user.name || mail.toLowerCase() !== user.email.toLowerCase();
  if (accountChanged) await assertCanManageAccount(req.user.id, user.id);
  if (await q.get('SELECT 1 FROM users WHERE email = ? AND id <> ?', mail, user.id)) throw bad('A user with this email already exists');
  if (user.id === req.user.id && (role !== 'admin' || !active)) throw bad('You cannot demote or deactivate yourself');
  if (user.role === 'admin' && (role !== 'admin' || !active)) {
    const admins = (await q.get(
      "SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND role = 'admin' AND active = 1 AND pending = 0 AND user_id <> ?",
      req.ws.id, user.id,
    )).n;
    if (admins === 0) throw bad('The workspace needs at least one active admin');
  }

  // Activating a membership also approves it if it was a pending sign-up.
  await q.batch([
    ...(accountChanged ? [['UPDATE users SET name = ?, email = ? WHERE id = ?', name, mail, user.id]] : []),
    [
      'UPDATE workspace_members SET role = ?, active = ?, pending = CASE WHEN ? = 1 THEN 0 ELSE pending END WHERE workspace_id = ? AND user_id = ?',
      role, active, active, req.ws.id, user.id,
    ],
  ]);
  if (!active) await signOutIfLockedOut(user.id);
  res.json({ user: publicUser(await getMember(req, user.id)) });
});

// Approve a self sign-up request.
r.post('/:id/approve', requireAdmin, async (req, res) => {
  const user = await getMember(req, id(req.params.id));
  if (!user.pending) throw bad('This account is not waiting for approval');
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  await q.run('UPDATE workspace_members SET pending = 0, active = 1, role = ? WHERE workspace_id = ? AND user_id = ?', role, req.ws.id, user.id);
  res.json({ user: publicUser(await getMember(req, user.id)) });
});

// Reject a self sign-up request (only pending memberships can be removed). The account itself goes
// too, unless the person belongs to another workspace.
r.delete('/:id', requireAdmin, async (req, res) => {
  const user = await getMember(req, id(req.params.id));
  if (!user.pending) throw bad('Only pending sign-up requests can be rejected. Deactivate active members instead.');
  await q.batch([
    ['DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND pending = 1', req.ws.id, user.id],
    ['DELETE FROM sessions WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = ?)', user.id, user.id],
    ['DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE user_id = ?)', user.id, user.id],
  ]);
  res.json({ ok: true });
});

r.put('/:id/password', requireAdmin, async (req, res) => {
  const user = await getMember(req, id(req.params.id));
  await assertCanManageAccount(req.user.id, user.id);
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password(req.body.password)), user.id);
  if (user.id !== req.user.id) await deleteUserSessions(user.id);
  res.json({ ok: true });
});

export default r;
