import { api, getToken, updateBadge } from './api.js';

const SYNC_EVERY_MS = 3 * 60 * 1000;

/** Fetches the running timer from the server (or reuses the cached one between syncs). */
async function refresh(force = false) {
  if (!(await getToken())) return updateBadge(null);
  const { running, lastSync = 0 } = await chrome.storage.local.get(['running', 'lastSync']);
  if (!force && Date.now() - lastSync < SYNC_EVERY_MS) return updateBadge(running);
  try {
    const { entry } = await api('GET', '/entries/running');
    await chrome.storage.local.set({ lastSync: Date.now() });
    await updateBadge(entry);
  } catch {
    await updateBadge(null);
  }
}

function schedule() {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  refresh(true);
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => a.name === 'tick' && refresh());

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'refresh') refresh(true);
});

// Keyboard shortcut: start a new timer or stop the running one.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-timer' || !(await getToken())) return;
  try {
    const { entry } = await api('GET', '/entries/running');
    if (entry) await api('POST', '/entries/stop', {});
    else await api('POST', '/entries/start', {});
  } finally {
    refresh(true);
  }
});
