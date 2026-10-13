import crypto from 'node:crypto';
import { q, getSettings } from './db.js';
import { HttpError } from './util.js';

const COOKIE = 'tt_session';
const TTL = 30 * 24 * 3600 * 1000;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isSecure = (req) => req.secure || (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '').startsWith('https://');

function setCookie(req, res, token) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isSecure(req), maxAge: TTL, path: '/' });
}
export async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + TTL);
  setCookie(req, res, token);
}

export async function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export async function deleteUserSessions(userId) {
  await q.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

/** Returns the logged-in user row (or null). Extends the session when it is past half-life. */
export async function currentUser(req, res) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const hash = sha256(token);
  const row = await q.get(
    'SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    hash,
  );
  if (!row || row.session_expires < Date.now() || !row.active) return null;
  if (res && row.session_expires - Date.now() < TTL / 2) {
    await q.run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() + TTL, hash);
    setCookie(req, res, token);
  }
  return row;
}

export async function requireAuth(req, res, next) {
  const user = await currentUser(req, res);
  if (!user) throw new HttpError(401, 'Please log in');
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Only workspace admins can do that');
  next();
}

/** Admins always; members only when the workspace allows it. */
export async function requireCreator(req, res, next) {
  if (req.user?.role !== 'admin' && !(await getSettings()).membersCanCreate) {
    throw new HttpError(403, 'Only workspace admins can create this');
  }
  next();
}

export function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: !!u.active,
    googleEmail: u.google_email || null,
    googleConnected: !!u.google_refresh_token,
    gcalSync: !!u.gcal_sync,
    createdAt: u.created_at,
  };
}

export async function cleanupExpired() {
  await q.batch([
    ['DELETE FROM sessions WHERE expires_at < ?', Date.now()],
    ['DELETE FROM oauth_states WHERE created_at < ?', Date.now() - 15 * 60 * 1000],
  ]);
}
