import { SERVER } from './config.js';

export class AuthError extends Error {}

export async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token || null;
}

export async function setToken(token) {
  if (token) await chrome.storage.local.set({ token });
  else await chrome.storage.local.remove(['token', 'running']);
}

/** Calls the Time Tracker API with the stored token. */
export async function api(method, path, body, tokenOverride) {
  const token = tokenOverride ?? (await getToken());
  const headers = { 'X-Requested-With': 'fetch' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${SERVER}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach Time Tracker. Check your internet connection.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/auth/token')) {
    await setToken(null);
    throw new AuthError('Please sign in again');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const pad = (n) => String(n).padStart(2, '0');

export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Updates the toolbar icon and badge for the running timer (or idle). */
export async function updateBadge(running) {
  await chrome.storage.local.set({ running: running ?? null });
  const icon = (kind) => Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/icon-${kind}${s}.png`]));
  if (running) {
    const mins = Math.max(0, Math.floor((Date.now() - running.start) / 60000));
    const text = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}:${pad(mins % 60)}`;
    await chrome.action.setIcon({ path: icon('') });
    await chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({ title: `Running: ${running.description || '(no description)'}` });
  } else {
    await chrome.action.setIcon({ path: icon('idle-') });
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Time Tracker — not tracking' });
  }
}
