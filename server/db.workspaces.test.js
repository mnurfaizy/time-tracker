// Upgrade from the single-workspace version: the existing team and data must become the main
// workspace untouched. Uses a throwaway SQLite file — never touches the real data/ folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ws-test-'));
const { db, initDb, q, getSettings } = await import('./db.js');

// Schema of the version before workspaces (only what the migration reads or changes).
const LEGACY = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1, google_email TEXT COLLATE NOCASE, google_refresh_token TEXT,
  gcal_sync INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#03A9F4', billable INTEGER NOT NULL DEFAULT 1, hourly_rate REAL, is_public INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '', project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id INTEGER, billable INTEGER NOT NULL DEFAULT 0, start_at INTEGER NOT NULL, end_at INTEGER,
  gcal_event_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_entries_running ON time_entries(user_id) WHERE end_at IS NULL;
CREATE TABLE entry_tags (
  entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE TABLE oauth_states (state TEXT PRIMARY KEY, user_id INTEGER, mode TEXT NOT NULL, created_at INTEGER NOT NULL);
`;

const NOW = Date.now();
const count = async (sql, ...p) => (await q.get(sql, ...p)).n;

test('a single-workspace database becomes the main workspace with everything in it', async () => {
  await db.executeMultiple(`PRAGMA foreign_keys = ON; ${LEGACY}`);
  await q.batch([
    ["INSERT INTO settings (key, value) VALUES ('workspaceName', 'Rakamin'), ('currency', 'USD'), ('signupDomain', 'rakamin.com')"],
    ["INSERT INTO users (id, name, email, role, active, pending, created_at) VALUES (1, 'Ana', 'ana@rakamin.com', 'admin', 1, 0, ?)", NOW],
    ["INSERT INTO users (id, name, email, role, active, pending, created_at) VALUES (2, 'Budi', 'budi@rakamin.com', 'member', 0, 0, ?)", NOW],
    ["INSERT INTO users (id, name, email, role, active, pending, created_at) VALUES (3, 'Cici', 'cici@rakamin.com', 'member', 0, 1, ?)", NOW],
    ["INSERT INTO clients (id, name, created_at) VALUES (1, 'Acme', ?)", NOW],
    ["INSERT INTO projects (id, name, client_id, created_at) VALUES (1, 'Website', 1, ?)", NOW],
    ["INSERT INTO tags (id, name, created_at) VALUES (1, 'urgent', ?), (2, 'meeting', ?)", NOW, NOW],
    ['INSERT INTO time_entries (id, user_id, project_id, start_at, end_at, created_at, updated_at) VALUES (1, 1, 1, ?, ?, ?, ?)', NOW - 1000, NOW, NOW, NOW],
    ['INSERT INTO time_entries (id, user_id, project_id, start_at, end_at, created_at, updated_at) VALUES (2, 1, NULL, ?, NULL, ?, ?)', NOW, NOW, NOW],
    ['INSERT INTO entry_tags (entry_id, tag_id) VALUES (1, 1), (1, 2), (2, 2)'],
  ]);

  await initDb();
  await initDb(); // running again on every boot must change nothing

  assert.deepEqual(
    (await q.all('SELECT id, name, slug FROM workspaces')).map((w) => ({ ...w })),
    [{ id: 1, name: 'Rakamin', slug: 'rakamin' }],
  );
  // Each user keeps their role, active and pending state, now as a membership.
  assert.deepEqual(
    (await q.all('SELECT user_id, role, active, pending FROM workspace_members ORDER BY user_id')).map((m) => ({ ...m })),
    [
      { user_id: 1, role: 'admin', active: 1, pending: 0 },
      { user_id: 2, role: 'member', active: 0, pending: 0 },
      { user_id: 3, role: 'member', active: 0, pending: 1 },
    ],
  );
  const s = await getSettings(1);
  assert.equal(s.workspaceName, 'Rakamin');
  assert.equal(s.currency, 'USD');
  assert.equal(s.signupDomain, 'rakamin.com');

  for (const table of ['clients', 'projects', 'tags', 'time_entries']) {
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id <> 1`), 0, `${table} rows outside workspace 1`);
  }
  assert.equal(await count('SELECT COUNT(*) AS n FROM tags'), 2);
  // Tag links survive the tags table rebuild.
  assert.equal(await count('SELECT COUNT(*) AS n FROM entry_tags'), 3);
  assert.equal(await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'entry_tags_keep'"), 0);
});

test('a second workspace can reuse tag names and run its own timer', async () => {
  await q.run("INSERT INTO workspaces (id, name, slug, created_at) VALUES (2, 'Multipolar', 'multipolar', ?)", NOW);
  await q.run("INSERT INTO tags (workspace_id, name, created_at) VALUES (2, 'urgent', ?)", NOW);
  await assert.rejects(q.run("INSERT INTO tags (workspace_id, name, created_at) VALUES (2, 'URGENT', ?)", NOW));

  // User 1 already has a running timer in workspace 1.
  await q.run('INSERT INTO time_entries (workspace_id, user_id, start_at, created_at, updated_at) VALUES (2, 1, ?, ?, ?)', NOW, NOW, NOW);
  await assert.rejects(q.run('INSERT INTO time_entries (workspace_id, user_id, start_at, created_at, updated_at) VALUES (2, 1, ?, ?, ?)', NOW, NOW, NOW));
});
