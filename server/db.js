import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Turso (cloud) when TURSO_DATABASE_URL is set, otherwise a local SQLite file.
const remoteUrl = process.env.TURSO_DATABASE_URL;
let url = remoteUrl;
if (!url) {
  if (process.env.RENDER) {
    console.error('TURSO_DATABASE_URL is not set. On Render the disk is wiped on every restart, so a Turso database is required.');
    process.exit(1);
  }
  const dataDir = path.resolve(process.env.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  url = pathToFileURL(path.join(dataDir, 'timetracker.db')).href;
}

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
export const isRemote = !!remoteUrl;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  google_email TEXT COLLATE NOCASE,
  google_refresh_token TEXT,
  gcal_sync INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  color TEXT NOT NULL DEFAULT '#03A9F4',
  billable INTEGER NOT NULL DEFAULT 1,
  hourly_rate REAL,
  is_public INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  billable INTEGER NOT NULL DEFAULT 0,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  gcal_event_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_user_start ON time_entries(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_entries_start ON time_entries(start_at);
CREATE INDEX IF NOT EXISTS idx_entries_project ON time_entries(project_id);
-- At most one running timer per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_running ON time_entries(user_id) WHERE end_at IS NULL;

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER,
  mode TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export async function initDb() {
  if (!isRemote) await db.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  await db.executeMultiple(SCHEMA);
  // Migrations for databases created by older versions.
  const userCols = (await db.execute('PRAGMA table_info(users)')).rows.map((c) => c.name);
  if (!userCols.includes('pending')) await db.execute('ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0');
}

// libSQL only binds null/number/string/bigint/buffer.
const bind = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? Number(p) : p));

export const q = {
  all: async (sql, ...params) => (await db.execute({ sql, args: bind(params) })).rows,
  get: async (sql, ...params) => (await db.execute({ sql, args: bind(params) })).rows[0] ?? null,
  run: async (sql, ...params) => {
    const r = await db.execute({ sql, args: bind(params) });
    return { changes: r.rowsAffected, rows: r.rows };
  },
  /** Runs statements atomically in one round trip. stmts: [[sql, ...params], ...] */
  batch: (stmts) => db.batch(stmts.map(([sql, ...params]) => ({ sql, args: bind(params) })), 'write'),
};

const DEFAULT_SETTINGS = {
  workspaceName: 'My Workspace',
  currency: 'IDR',
  defaultRate: '0',
  weekStart: '1',
  timeFormat: '24',
  membersCanCreate: '1',
  membersSeeTeamDashboard: '0',
  allowSignup: '1',
  signupDomain: '',
  autoApproveDomain: '1',
};

// Settings only change through setSettings in this process, so they are cached in memory.
let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const raw = { ...DEFAULT_SETTINGS };
  for (const row of await q.all('SELECT key, value FROM settings')) if (row.key in raw) raw[row.key] = row.value;
  settingsCache = {
    workspaceName: raw.workspaceName,
    currency: raw.currency,
    defaultRate: Number(raw.defaultRate) || 0,
    weekStart: Number(raw.weekStart) === 0 ? 0 : 1,
    timeFormat: raw.timeFormat === '12' ? '12' : '24',
    membersCanCreate: raw.membersCanCreate === '1',
    membersSeeTeamDashboard: raw.membersSeeTeamDashboard === '1',
    allowSignup: raw.allowSignup === '1',
    signupDomain: raw.signupDomain || '',
    autoApproveDomain: raw.autoApproveDomain === '1',
  };
  return settingsCache;
}

export async function setSettings(values) {
  const stmts = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    stmts.push(['INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, v]);
  }
  if (stmts.length) await q.batch(stmts);
  settingsCache = null;
}
