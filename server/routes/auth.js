import { Router } from 'express';
import { q, getSettings, setSettings } from '../db.js';
import { createSession, destroySession, hashPassword, verifyPassword, requireAuth, publicUser } from '../auth.js';
import { googleConfigured } from '../lib/google.js';
import { HttpError, bad, reqStr, email, password, str } from '../util.js';

const r = Router();

const attempts = new Map();
function rateLimit(req) {
  const now = Date.now();
  let a = attempts.get(req.ip);
  if (!a || a.reset < now) attempts.set(req.ip, (a = { count: 0, reset: now + 15 * 60 * 1000 }));
  if (++a.count > 20) throw new HttpError(429, 'Too many login attempts. Please wait a few minutes and try again.');
}

const userCount = async () => (await q.get('SELECT COUNT(*) AS n FROM users')).n;

r.get('/state', async (req, res) => {
  res.json({ needsSetup: (await userCount()) === 0, googleLogin: googleConfigured(), workspaceName: (await getSettings()).workspaceName });
});

r.post('/setup', async (req, res) => {
  const workspaceName = reqStr(req.body.workspaceName, 'Workspace name', 100);
  const name = reqStr(req.body.name, 'Name', 100);
  const mail = email(req.body.email);
  const pw = password(req.body.password);
  // Only succeeds while there are no users yet (atomic check-and-insert).
  const { rows } = await q.run(
    `INSERT INTO users (name, email, password_hash, role, created_at)
     SELECT ?, ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id`,
    name, mail, hashPassword(pw), Date.now(),
  );
  if (!rows.length) throw new HttpError(409, 'This workspace is already set up. Please log in.');
  await setSettings({ workspaceName });
  await createSession(req, res, rows[0].id);
  res.json({ ok: true });
});

r.post('/login', async (req, res) => {
  rateLimit(req);
  const mail = str(req.body.email, 254).toLowerCase();
  const user = await q.get('SELECT * FROM users WHERE email = ?', mail);
  if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!user.active) throw new HttpError(403, 'Your account has been deactivated. Please contact your workspace admin.');
  attempts.delete(req.ip);
  await createSession(req, res, user.id);
  res.json({ ok: true });
});

r.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user), settings: await getSettings(), googleConfigured: googleConfigured() });
});

r.put('/me', requireAuth, async (req, res) => {
  const name = reqStr(req.body.name, 'Name', 100);
  const mail = email(req.body.email);
  if (await q.get('SELECT 1 FROM users WHERE email = ? AND id <> ?', mail, req.user.id)) throw bad('That email is already used by another account');
  await q.run('UPDATE users SET name = ?, email = ? WHERE id = ?', name, mail, req.user.id);
  res.json({ user: publicUser(await q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

r.put('/password', requireAuth, async (req, res) => {
  if (req.user.password_hash && !verifyPassword(String(req.body.current ?? ''), req.user.password_hash)) {
    throw bad('Current password is incorrect');
  }
  const next = password(req.body.next);
  await q.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
});

export default r;
