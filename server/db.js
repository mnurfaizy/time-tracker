import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { slugify, slugProblem } from '../shared/workspace.js';

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
-- Single-workspace settings from older versions; only read once to seed the main workspace.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- The lowest id is the main workspace: it keeps the root links (/tracker), the others live at /slug/...
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (workspace_id, key)
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

-- Role, active and pending live per workspace here; the same columns on users only hold the
-- pre-workspace values the migration copied from.
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
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
  workspace_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

-- An entry can carry several projects; time_entries.project_id stays denormalized as the
-- first (primary) one so older clients keep working.
CREATE TABLE IF NOT EXISTS entry_projects (
  entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, project_id)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER,
  mode TEXT NOT NULL,
  workspace_id INTEGER,
  created_at INTEGER NOT NULL
);
`;

// Created after the migrations, because older databases only get workspace_id columns there.
const WORKSPACE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_clients_ws ON clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_projects_ws ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_entries_ws_user_start ON time_entries(workspace_id, user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_entries_ws_start ON time_entries(workspace_id, start_at);
DROP INDEX IF EXISTS idx_entries_running;
-- At most one running timer per user in each workspace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_running_ws ON time_entries(workspace_id, user_id) WHERE end_at IS NULL;
`;

const columns = async (table) => (await db.execute(`PRAGMA table_info(${table})`)).rows.map((c) => c.name);

/**
 * Upgrades a single-workspace database: the existing team, settings and data become the main
 * workspace (id 1), so nothing moves for people already using it. Every step is idempotent.
 */
async function migrateToWorkspaces() {
  if (!(await q.get('SELECT 1 FROM workspaces LIMIT 1')) && (await q.get('SELECT 1 FROM users LIMIT 1'))) {
    const legacy = Object.fromEntries((await q.all('SELECT key, value FROM settings')).map((r) => [r.key, r.value]));
    const name = legacy.workspaceName || DEFAULT_SETTINGS.workspaceName;
    const slug = slugProblem(slugify(name)) ? 'main' : slugify(name);
    await q.batch([
      ['INSERT INTO workspaces (id, name, slug, created_at) VALUES (1, ?, ?, ?)', name, slug, Date.now()],
      ['INSERT INTO workspace_members (workspace_id, user_id, role, active, pending, created_at) SELECT 1, id, role, active, pending, created_at FROM users'],
      ["INSERT INTO workspace_settings (workspace_id, key, value) SELECT 1, key, value FROM settings WHERE key <> 'workspaceName'"],
    ]);
  }
  const main = (await q.get('SELECT MIN(id) AS id FROM workspaces')).id ?? 1;

  for (const table of ['clients', 'projects', 'time_entries']) {
    if ((await columns(table)).includes('workspace_id')) continue;
    await q.batch([
      [`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 0`],
      [`UPDATE ${table} SET workspace_id = ?`, main],
    ]);
  }

  // Tag names were unique across the whole server, now per workspace, which needs a rebuilt table.
  // Dropping the old table can cascade into entry_tags, so those links are kept aside and restored.
  if (!(await columns('tags')).includes('workspace_id')) {
    await q.batch([
      ['DROP TABLE IF EXISTS entry_tags_keep'],
      ['CREATE TABLE entry_tags_keep AS SELECT entry_id, tag_id FROM entry_tags'],
      ['DROP TABLE IF EXISTS tags_new'],
      [`CREATE TABLE tags_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          name TEXT NOT NULL COLLATE NOCASE,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          UNIQUE (workspace_id, name)
        )`],
      ['INSERT INTO tags_new (id, workspace_id, name, archived, created_at) SELECT id, ?, name, archived, created_at FROM tags', main],
      ['DROP TABLE tags'],
      ['ALTER TABLE tags_new RENAME TO tags'],
      ['INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT entry_id, tag_id FROM entry_tags_keep'],
      ['DROP TABLE entry_tags_keep'],
    ]);
  }

  if (!(await columns('oauth_states')).includes('workspace_id')) await db.execute('ALTER TABLE oauth_states ADD COLUMN workspace_id INTEGER');
}

export async function initDb() {
  if (!isRemote) await db.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  await db.executeMultiple(SCHEMA);
  // Migrations for databases created by older versions.
  const userCols = (await db.execute('PRAGMA table_info(users)')).rows.map((c) => c.name);
  if (!userCols.includes('pending')) await db.execute('ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0');
  await migrateToWorkspaces();
  await db.executeMultiple(WORKSPACE_INDEXES);
  // Entries created before multi-project support get their primary project into the junction.
  await db.execute(`
    INSERT INTO entry_projects (entry_id, project_id)
    SELECT id, project_id FROM time_entries
    WHERE project_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM entry_projects ep WHERE ep.entry_id = time_entries.id)
  `);
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

export const DEFAULT_SETTINGS = {
  workspaceName: 'My Workspace',
  currency: 'IDR',
  defaultRate: '0',
  weekStart: '1',
  timeFormat: '24',
  membersCanCreate: '1',
  membersSeeTeamDashboard: '1',
  allowSignup: '1',
  signupDomain: '',
  autoApproveDomain: '1',
};

// Settings only change through setSettings in this process, so they are cached in memory per workspace.
const settingsCache = new Map();

export async function getSettings(workspaceId) {
  const cached = settingsCache.get(workspaceId);
  if (cached) return cached;
  const [ws, rows] = await Promise.all([
    q.get('SELECT name FROM workspaces WHERE id = ?', workspaceId),
    q.all('SELECT key, value FROM workspace_settings WHERE workspace_id = ?', workspaceId),
  ]);
  const raw = { ...DEFAULT_SETTINGS };
  for (const row of rows) if (row.key in raw) raw[row.key] = row.value;
  const settings = {
    workspaceName: ws?.name ?? raw.workspaceName,
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
  settingsCache.set(workspaceId, settings);
  return settings;
}

/** Statements that write `values` as a workspace's settings (the name goes to workspaces.name). */
export function settingsStatements(workspaceId, values) {
  const stmts = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    if (key === 'workspaceName') {
      stmts.push(['UPDATE workspaces SET name = ? WHERE id = ?', String(value), workspaceId]);
      continue;
    }
    const v = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
    stmts.push([
      'INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value',
      workspaceId, key, v,
    ]);
  }
  return stmts;
}

export async function setSettings(workspaceId, values) {
  const stmts = settingsStatements(workspaceId, values);
  if (stmts.length) await q.batch(stmts);
  settingsCache.delete(workspaceId);
}
