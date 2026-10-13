// Mirrors finished time entries into the owner's Google Calendar when they enabled sync.
import { q } from '../db.js';
import { getEntry } from './entries.js';
import { googleConfigured, insertEvent, patchEvent, deleteEvent } from './google.js';

const chains = new Map(); // entryId -> Promise, so edits to one entry never race

function enqueue(key, job) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev
    .then(job)
    .catch((err) => console.warn(`[gcal] sync failed (${key}):`, err.message))
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
  chains.set(key, next);
}

async function syncUser(userId) {
  if (!googleConfigured()) return null;
  const user = await q.get('SELECT * FROM users WHERE id = ?', userId);
  return user?.gcal_sync && user.google_refresh_token ? user : null;
}

async function eventBody(entry) {
  const tagNames = entry.tagIds.length
    ? (await q.all(`SELECT name FROM tags WHERE id IN (${entry.tagIds.map(() => '?').join(',')})`, ...entry.tagIds)).map((t) => t.name)
    : [];
  const title = [entry.description || '(no description)', entry.projectName].filter(Boolean).join(' · ');
  const lines = [
    entry.projectName && `Project: ${entry.projectName}${entry.taskName ? ` / ${entry.taskName}` : ''}`,
    entry.clientName && `Client: ${entry.clientName}`,
    tagNames.length && `Tags: ${tagNames.join(', ')}`,
    `Billable: ${entry.billable ? 'Yes' : 'No'}`,
    '',
    'Added automatically by Time Tracker.',
  ].filter((l) => l !== false && l != null);
  return {
    summary: title,
    description: lines.join('\n'),
    start: { dateTime: new Date(entry.start).toISOString() },
    end: { dateTime: new Date(entry.end).toISOString() },
    transparency: 'transparent',
    extendedProperties: { private: { ttEntryId: String(entry.id) } },
  };
}

export function scheduleSync(entryId) {
  enqueue(`entry:${entryId}`, async () => {
    const row = await q.get('SELECT user_id, end_at, gcal_event_id FROM time_entries WHERE id = ?', entryId);
    if (!row || row.end_at == null) return;
    const user = await syncUser(row.user_id);
    if (!user) return;
    const body = await eventBody(await getEntry(entryId));
    if (row.gcal_event_id) {
      try {
        await patchEvent(user, row.gcal_event_id, body);
        return;
      } catch (err) {
        if (err.status !== 404 && err.status !== 410) throw err;
      }
    }
    const ev = await insertEvent(user, body);
    await q.run('UPDATE time_entries SET gcal_event_id = ? WHERE id = ?', ev.id, entryId);
  });
}

export function scheduleRemove(userId, eventId, entryId) {
  if (!eventId) return;
  enqueue(`entry:${entryId}`, async () => {
    const user = await syncUser(userId);
    if (!user) return;
    try {
      await deleteEvent(user, eventId);
    } catch (err) {
      if (err.status !== 404 && err.status !== 410) throw err;
    }
  });
}
