// Google OAuth + Calendar REST calls, using plain fetch (no SDK needed).
import { q } from '../db.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

const tokenCache = new Map(); // userId -> { token, exp }

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function appUrl(req) {
  return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

const redirectUri = (req) => `${appUrl(req)}/api/google/callback`;

export function buildAuthUrl(req, { state, scope, offline }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope,
    state,
    include_granted_scopes: 'true',
  });
  if (offline) {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  } else {
    params.set('prompt', 'select_account');
  }
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...body,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `Google token request failed (${res.status})`);
    err.code = data.error;
    throw err;
  }
  return data;
}

export async function exchangeCode(req, code) {
  const data = await tokenRequest({ code, redirect_uri: redirectUri(req), grant_type: 'authorization_code' });
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be read directly.
  let claims = {};
  if (data.id_token) {
    try {
      claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8'));
    } catch {
      claims = {};
    }
  }
  return { ...data, claims };
}

export function cacheAccessToken(userId, token, expiresIn) {
  tokenCache.set(userId, { token, exp: Date.now() + (expiresIn || 3600) * 1000 });
}

export function forgetUser(userId) {
  tokenCache.delete(userId);
}

async function accessToken(user) {
  const cached = tokenCache.get(user.id);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  if (!user.google_refresh_token) throw Object.assign(new Error('Google Calendar is not connected'), { status: 400 });
  try {
    const data = await tokenRequest({ refresh_token: user.google_refresh_token, grant_type: 'refresh_token' });
    cacheAccessToken(user.id, data.access_token, data.expires_in);
    return data.access_token;
  } catch (err) {
    if (err.code === 'invalid_grant') {
      // Access was revoked or expired: disconnect so the user can reconnect.
      await q.run('UPDATE users SET google_refresh_token = NULL, gcal_sync = 0 WHERE id = ?', user.id);
      forgetUser(user.id);
      throw Object.assign(new Error('Google access expired. Please reconnect Google Calendar in your profile.'), { status: 401 });
    }
    throw err;
  }
}

async function calendarFetch(user, path, options = {}) {
  const token = await accessToken(user);
  const res = await fetch(CAL_API + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(data?.error?.message || `Google Calendar error (${res.status})`), { status: res.status });
  }
  return data;
}

export async function listEvents(user, timeMin, timeMax) {
  const items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await calendarFetch(user, `/calendars/primary/events?${params}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken && items.length < 2500);

  return items
    .filter((ev) => ev.status !== 'cancelled' && !ev.extendedProperties?.private?.ttEntryId)
    .filter((ev) => !(ev.attendees || []).some((a) => a.self && a.responseStatus === 'declined'))
    .map((ev) => {
      const allDay = !!ev.start?.date;
      return {
        id: ev.id,
        summary: ev.summary || '(No title)',
        allDay,
        start: allDay ? ev.start.date : Date.parse(ev.start?.dateTime),
        end: allDay ? ev.end?.date : Date.parse(ev.end?.dateTime),
        htmlLink: ev.htmlLink || null,
      };
    });
}

export const insertEvent = (user, body) =>
  calendarFetch(user, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });

export const patchEvent = (user, eventId, body) =>
  calendarFetch(user, `/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteEvent = (user, eventId) =>
  calendarFetch(user, `/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });

export async function revokeToken(token) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch {
    // Best effort.
  }
}
