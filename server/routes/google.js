import { Router } from 'express';
import crypto from 'node:crypto';
import { q } from '../db.js';
import { requireAuth, currentUser, createSession, publicUser } from '../auth.js';
import { HttpError, ms } from '../util.js';
import {
  googleConfigured, buildAuthUrl, exchangeCode, listEvents, revokeToken, cacheAccessToken, forgetUser, appUrl, CALENDAR_SCOPE,
} from '../lib/google.js';

const r = Router();

async function newState(userId, mode) {
  const state = crypto.randomBytes(24).toString('base64url');
  await q.run('INSERT INTO oauth_states (state, user_id, mode, created_at) VALUES (?, ?, ?, ?)', state, userId, mode, Date.now());
  return state;
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

// "Continue with Google" on the login page. Only existing, active accounts may sign in.
r.get('/login', async (req, res) => {
  if (!googleConfigured()) return res.redirect('/login?error=google_not_configured');
  res.redirect(buildAuthUrl(req, { state: await newState(null, 'login'), scope: 'openid email profile' }));
});

// Connect the logged-in user's Google Calendar.
r.get('/connect', requireAuth, async (req, res) => {
  requireConfigured();
  res.redirect(buildAuthUrl(req, { state: await newState(req.user.id, 'calendar'), scope: `openid email ${CALENDAR_SCOPE}`, offline: true }));
});

r.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const st = state ? await q.get('SELECT * FROM oauth_states WHERE state = ?', String(state)) : null;
  if (st) await q.run('DELETE FROM oauth_states WHERE state = ?', st.state);
  if (!st || st.created_at < Date.now() - 10 * 60 * 1000) return res.redirect('/login?error=google_state');

  const fail = (reason) => res.redirect(st.mode === 'login' ? `/login?error=${reason}` : `/profile?google=${reason}`);
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
    const user = await q.get('SELECT * FROM users WHERE (email = ? OR google_email = ?) AND active = 1', email, email);
    if (!user) return fail('google_no_account');
    await createSession(req, res, user.id);
    return res.redirect('/');
  }

  const user = await currentUser(req);
  if (!user || user.id !== st.user_id) return res.redirect('/login');
  if (!String(tokens.scope || '').includes(CALENDAR_SCOPE)) return fail('scope');
  if (!tokens.refresh_token) return fail('no_refresh');
  await q.run('UPDATE users SET google_refresh_token = ?, google_email = ? WHERE id = ?', tokens.refresh_token, email || null, user.id);
  cacheAccessToken(user.id, tokens.access_token, tokens.expires_in);
  res.redirect('/profile?google=connected');
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
