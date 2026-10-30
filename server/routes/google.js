import { Router } from 'express';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { requireAuth, currentUser, createSession, publicUser } from '../auth.js';
import { HttpError, ms, str } from '../util.js';
import { assertSignupAllowed, createPendingUser, createActiveMember, isAutoApproved } from '../lib/signup.js';
import { addMember, loginState, mainWorkspaceId, publicWorkspace } from '../lib/workspaces.js';
import {
  googleConfigured, buildAuthUrl, exchangeCode, listEvents, revokeToken, cacheAccessToken, forgetUser, appUrl, CALENDAR_SCOPE,
} from '../lib/google.js';

const r = Router();

async function newState(userId, mode, workspaceId) {
  const state = crypto.randomBytes(24).toString('base64url');
  await q.run(
    'INSERT INTO oauth_states (state, user_id, mode, workspace_id, created_at) VALUES (?, ?, ?, ?, ?)',
    state, userId, mode, workspaceId ?? null, Date.now(),
  );
  return state;
}

/** URL prefix of the workspace the flow started in ('' for the main workspace). */
async function prefixFor(workspaceId) {
  const ws = workspaceId ? await q.get('SELECT id, slug FROM workspaces WHERE id = ?', workspaceId) : null;
  return ws && ws.id !== (await mainWorkspaceId()) ? `/${ws.slug}` : '';
}

function requireConfigured() {
  if (!googleConfigured()) throw new HttpError(400, 'Google integration is not configured on this server yet');
}

r.get('/status', requireAuth, (req, res) => {
  res.json({
    configured: googleConfigured(),
    redirectUri: `${appUrl(req)}/api/google/callback`,
    user: publicUser(req.user),
  });
});

// "Continue with Google" on the login page of a workspace (?ws=slug, else the main one).
r.get('/login', async (req, res) => {
  const ws = await publicWorkspace(req);
  if (!googleConfigured()) return res.redirect(`${await prefixFor(ws?.id)}/login?error=google_not_configured`);
  res.redirect(buildAuthUrl(req, { state: await newState(null, 'login', ws?.id), scope: 'openid email profile' }));
});

// Connect the logged-in user's Google Calendar.
r.get('/connect', requireAuth, async (req, res) => {
  requireConfigured();
  res.redirect(buildAuthUrl(req, { state: await newState(req.user.id, 'calendar', req.ws.id), scope: `openid email ${CALENDAR_SCOPE}`, offline: true }));
});

r.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const st = state ? await q.get('SELECT * FROM oauth_states WHERE state = ?', String(state)) : null;
  if (st) await q.run('DELETE FROM oauth_states WHERE state = ?', st.state);
  if (!st || st.created_at < Date.now() - 10 * 60 * 1000) return res.redirect('/login?error=google_state');

  const prefix = await prefixFor(st.workspace_id);
  const fail = (reason) => res.redirect(st.mode === 'login' ? `${prefix}/login?error=${reason}` : `${prefix}/profile?google=${reason}`);
  if (error || !code) return fail('cancelled');

  let tokens;
  try {
    tokens = await exchangeCode(req, String(code));
  } catch (err) {
    console.warn('[google] code exchange failed:', err.message);
    return fail('failed');
  }
  const email = String(tokens.claims.email || '').toLowerCase();

  if (st.mode === 'login') {
    if (!email || tokens.claims.email_verified === false) return fail('google_email');
    const wsId = st.workspace_id ?? (await mainWorkspaceId());
    const home = `${prefix}/`;
    const user = await q.get('SELECT * FROM users WHERE email = ? OR google_email = ? ORDER BY id LIMIT 1', email, email);
    // Google has verified this address, so the workspace's trusted domain can join without approval.
    const autoApprove = await isAutoApproved(wsId, email, tokens.claims.email_verified);
    if (user) {
      const member = await q.get('SELECT active, pending FROM workspace_members WHERE workspace_id = ? AND user_id = ?', wsId, user.id);
      if (autoApprove && (!member || member.pending)) {
        await addMember(wsId, user.id);
        await q.run('UPDATE users SET google_email = COALESCE(google_email, ?) WHERE id = ?', email, user.id);
      }
      const state = await loginState(user.id);
      if (state === 'pending') return fail('pending');
      if (state !== 'ok') return fail('google_inactive');
      await createSession(req, res, user.id);
      return res.redirect(home);
    }
    try {
      await assertSignupAllowed(wsId, email);
    } catch {
      return fail('google_no_account');
    }
    const name = str(tokens.claims.name, 100) || email.split('@')[0];
    if (autoApprove) {
      await createSession(req, res, await createActiveMember(wsId, { name, email, googleEmail: email }));
      return res.redirect(home);
    }
    // Otherwise request access: an admin must approve it.
    await createPendingUser(wsId, { name, email, googleEmail: email });
    return fail('pending');
  }

  const user = await currentUser(req);
  if (!user || user.id !== st.user_id) return res.redirect(`${prefix}/login`);
  if (!String(tokens.scope || '').includes(CALENDAR_SCOPE)) return fail('scope');
  if (!tokens.refresh_token) return fail('no_refresh');
  await q.run('UPDATE users SET google_refresh_token = ?, google_email = ? WHERE id = ?', tokens.refresh_token, email || null, user.id);
  cacheAccessToken(user.id, tokens.access_token, tokens.expires_in);
  res.redirect(`${prefix}/profile?google=connected`);
});

r.post('/disconnect', requireAuth, async (req, res) => {
  if (req.user.google_refresh_token) await revokeToken(req.user.google_refresh_token);
  await q.run('UPDATE users SET google_refresh_token = NULL, gcal_sync = 0 WHERE id = ?', req.user.id);
  forgetUser(req.user.id);
  res.json({ user: publicUser(await q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

r.put('/sync', requireAuth, async (req, res) => {
  if (req.body.enabled && !req.user.google_refresh_token) throw new HttpError(400, 'Connect Google Calendar first');
  await q.run('UPDATE users SET gcal_sync = ? WHERE id = ?', req.body.enabled ? 1 : 0, req.user.id);
  res.json({ user: publicUser(await q.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
});

r.get('/events', requireAuth, async (req, res) => {
  requireConfigured();
  if (!req.user.google_refresh_token) return res.json({ events: [], connected: false });
  const start = ms(Number(req.query.start), 'start');
  const end = ms(Number(req.query.end), 'end');
  try {
    res.json({ events: await listEvents(req.user, start, end), connected: true });
  } catch (err) {
    throw new HttpError(err.status === 401 ? 401 : 502, err.message);
  }
});

export default r;
