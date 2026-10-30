// Workspaces and memberships. Each request runs inside one workspace, picked by the X-Workspace
// header (or ?ws= for plain links such as CSV downloads); without one it is the main workspace.
import { q, settingsStatements } from '../db.js';
import { slugify, slugProblem } from '../../shared/workspace.js';
import { HttpError, bad } from '../util.js';

/** Extra columns for the session query: every membership of the user, plus the main workspace id. */
export const MEMBERSHIP_COLUMNS = `
  (SELECT MIN(id) FROM workspaces) AS main_ws_id,
  (SELECT json_group_array(json_object('id', w.id, 'name', w.name, 'slug', w.slug,
     'role', m.role, 'active', m.active, 'pending', m.pending))
   FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
   WHERE m.user_id = u.id) AS memberships_json`;

/** Memberships the user can work in (active and approved), main workspace first. */
export function usableWorkspaces(row) {
  let list = [];
  try {
    list = JSON.parse(row.memberships_json || '[]');
  } catch {
    list = [];
  }
  return list
    .filter((m) => m && m.active && !m.pending)
    .map((m) => ({ id: m.id, name: m.name, slug: m.slug, role: m.role, primary: m.id === row.main_ws_id }))
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.id - b.id);
}

export function wantedSlug(req) {
  const v = req.get('X-Workspace') || req.query?.ws;
  return typeof v === 'string' && v ? v.trim().toLowerCase().slice(0, 64) : null;
}

/** The requested workspace, or the user's default one (main workspace when they belong to it). */
export function pickWorkspace(workspaces, slug) {
  if (slug) return workspaces.find((w) => w.slug.toLowerCase() === slug) ?? null;
  return workspaces[0] ?? null;
}

/** 'ok' when the account can log in somewhere, otherwise why not ('pending' or 'inactive'). */
export async function loginState(userId) {
  const r = await q.get(
    'SELECT MAX(active = 1 AND pending = 0) AS ok, MAX(pending) AS pending FROM workspace_members WHERE user_id = ?',
    userId,
  );
  if (r?.ok) return 'ok';
  return r?.pending ? 'pending' : 'inactive';
}

export async function mainWorkspaceId() {
  return (await q.get('SELECT MIN(id) AS id FROM workspaces')).id ?? null;
}

export async function workspaceBySlug(slug) {
  return slug ? q.get('SELECT * FROM workspaces WHERE slug = ?', slug) : null;
}

/** Public sign-up and login pages: the workspace named in the link, else the main one. */
export async function publicWorkspace(req) {
  const slug = wantedSlug(req);
  const ws = slug ? await workspaceBySlug(slug) : null;
  if (ws) return ws;
  return q.get('SELECT * FROM workspaces ORDER BY id LIMIT 1');
}

export async function assertSlugFree(slug, exceptId = 0) {
  const problem = slugProblem(slug);
  if (problem) throw bad(problem);
  if (await q.get('SELECT 1 FROM workspaces WHERE slug = ? AND id <> ?', slug, exceptId)) {
    throw bad('Another workspace already uses this link name');
  }
}

/**
 * Creates a workspace with `userId` as its admin. Display settings (currency, week start, time
 * format) are copied from `copyFrom` so a new workspace looks familiar.
 */
export async function createWorkspace({ name, slug, userId, copyFrom = null }) {
  const finalSlug = slug || slugify(name);
  await assertSlugFree(finalSlug);
  const { rows } = await q.run('INSERT INTO workspaces (name, slug, created_at) VALUES (?, ?, ?) RETURNING id', name, finalSlug, Date.now());
  const wsId = rows[0].id;
  const inherited = copyFrom
    ? { currency: copyFrom.currency, weekStart: copyFrom.weekStart, timeFormat: copyFrom.timeFormat }
    : {};
  await q.batch([
    ["INSERT INTO workspace_members (workspace_id, user_id, role, active, pending, created_at) VALUES (?, ?, 'admin', 1, 0, ?)", wsId, userId, Date.now()],
    // Sign-up starts closed: the admin adds people or opens it in Settings.
    ...settingsStatements(wsId, { ...inherited, allowSignup: false }),
  ]);
  return { id: wsId, name, slug: finalSlug };
}

/** Adds (or re-activates) a user in a workspace. */
export async function addMember(workspaceId, userId, { role = 'member', pending = false } = {}) {
  await q.run(
    `INSERT INTO workspace_members (workspace_id, user_id, role, active, pending, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role, active = excluded.active, pending = excluded.pending`,
    workspaceId, userId, role, pending ? 0 : 1, pending ? 1 : 0, Date.now(),
  );
}

/**
 * Account-wide changes (name, email, password) touch every workspace the user is in, so a
 * workspace admin may only make them when they are also an admin of all of those workspaces.
 */
export async function assertCanManageAccount(adminId, userId) {
  if (adminId === userId) return;
  const outside = await q.get(
    `SELECT 1 FROM workspace_members m
     WHERE m.user_id = ? AND NOT EXISTS (
       SELECT 1 FROM workspace_members a
       WHERE a.workspace_id = m.workspace_id AND a.user_id = ? AND a.role = 'admin' AND a.active = 1 AND a.pending = 0)`,
    userId, adminId,
  );
  if (outside) throw new HttpError(403, 'This person is also in a workspace you do not manage, so only they can change their name, email or password');
}
