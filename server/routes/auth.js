import { Router } from 'express';
import { q, getSettings } from '../db.js';
import { createSession, createToken, destroySession, hashPassword, verifyPassword, requireAuth, requireAuthAnyWorkspace, publicUser } from '../auth.js';
import { googleConfigured } from '../lib/google.js';
import { transcribeConfigured } from './transcribe.js';
import { assertSignupAllowed, createPendingUser, PENDING_MESSAGE } from '../lib/signup.js';
import { createWorkspace, loginState, publicWorkspace, addMember } from '../lib/workspaces.js';
import { slugify, slugProblem } from '../../shared/workspace.js';
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

const INACTIVE_MESSAGE = 'Your account has been deactivated. Please contact your workspace admin.';

/** Login is account-wide: it works when the account is active in at least one workspace. */
async function assertCanLogIn(user) {
  const state = await loginState(user.id);
  if (state === 'pending') throw new HttpError(403, PENDING_MESSAGE);
  if (state !== 'ok') throw new HttpError(403, INACTIVE_MESSAGE);
}

// Login / sign-up page info for the workspace in the link (?ws= / X-Workspace), else the main one.
r.get('/state', async (req, res) => {
  const ws = await publicWorkspace(req);
  if (!ws) return res.json({ needsSetup: (await userCount()) === 0, googleLogin: googleConfigured() });
  const settings = await getSettings(ws.id);
  const mainId = (await q.get('SELECT MIN(id) AS id FROM workspaces')).id;
  res.json({
    needsSetup: false,
    googleLogin: googleConfigured(),
    workspace: { name: ws.name, slug: ws.slug, primary: ws.id === mainId },
    workspaceName: settings.workspaceName,
    allowSignup: settings.allowSignup,
    signupDomain: settings.signupDomain,
    autoApproveDomain: settings.autoApproveDomain,
  });
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
  const slug = slugProblem(slugify(workspaceName)) ? 'main' : slugify(workspaceName);
  await createWorkspace({ name: workspaceName, slug, userId: rows[0].id });
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
  await assertCanLogIn(user);
  attempts.delete(req.ip);
  await createSession(req, res, user.id);
  res.json({ ok: true });
});

// Browser extension sign-in with email + password: returns a token instead of setting a cookie.
r.post('/token', async (req, res) => {
  rateLimit(req);
  const mail = str(req.body.email, 254).toLowerCase();
  const user = await q.get('SELECT * FROM users WHERE email = ?', mail);
  if (!user || !verifyPassword(String(req.body.password ?? ''), user.password_hash)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  await assertCanLogIn(user);
  attempts.delete(req.ip);
  res.json({ token: await createToken(user.id), user: publicUser(user) });
});

// One-time sign-in code for the browser extension, for people who log in with Google.
r.post('/extension-code', requireAuth, async (req, res) => {
  res.json({ code: await createToken(req.user.id) });
});

// Self sign-up to the workspace in the link: the membership stays pending until an admin approves it.
r.post('/signup', async (req, res) => {
  rateLimit(req);
  const ws = await publicWorkspace(req);
  if (!ws) throw new HttpError(409, 'This server is not set up yet');
  const name = reqStr(req.body.name, 'Name', 100);
  const mail = email(req.body.email);
  const pw = password(req.body.password);
  await assertSignupAllowed(ws.id, mail);
  const existing = await q.get('SELECT * FROM users WHERE email = ?', mail);
  if (existing) {
    const member = await q.get('SELECT pending FROM workspace_members WHERE workspace_id = ? AND user_id = ?', ws.id, existing.id);
    if (member?.pending) throw new HttpError(409, PENDING_MESSAGE);
    // Someone with an account in another workspace asks to join this one: their password proves it is them.
    if (member || !verifyPassword(pw, existing.password_hash)) {
      throw new HttpError(409, 'An account with this email already exists. Please log in.');
    }
    await addMember(ws.id, existing.id, { pending: true });
    return res.json({ pending: true });
  }
  await createPendingUser(ws.id, { name, email: mail, passwordHash: hashPassword(pw) });
  res.json({ pending: true });
});

r.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

// The session for the workspace in the link; `workspace` says which one it really is, so the app can
// fix its URL when the link points to a workspace the user is not in.
r.get('/me', requireAuthAnyWorkspace, async (req, res) => {
  res.json({
    user: publicUser(req.user),
    settings: await getSettings(req.ws.id),
    workspace: req.ws,
    workspaces: req.user.workspaces,
    canCreateWorkspace: req.user.workspaces.some((w) => w.role === 'admin'),
    googleConfigured: googleConfigured(),
    transcribeConfigured: transcribeConfigured(),
  });
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
