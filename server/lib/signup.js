// Self sign-up: new members wait for an admin of that workspace to approve them.
import { q, getSettings } from '../db.js';
import { HttpError } from '../util.js';

export const PENDING_MESSAGE = 'Your account is waiting for approval from a workspace admin. You can log in once it is approved.';

/** Throws when self sign-up is off in the workspace or the email domain is not allowed. */
export async function assertSignupAllowed(workspaceId, email) {
  const settings = await getSettings(workspaceId);
  if (!settings.allowSignup) throw new HttpError(403, 'Sign-up is closed. Ask your workspace admin to add you.');
  if (settings.signupDomain && !email.endsWith(`@${settings.signupDomain}`)) {
    throw new HttpError(403, `Only @${settings.signupDomain} email addresses can sign up.`);
  }
}

/** New account with a pending membership; returns its id. */
export async function createPendingUser(workspaceId, { name, email, passwordHash = null, googleEmail = null }) {
  return createUserIn(workspaceId, { name, email, passwordHash, googleEmail, pending: true });
}

/**
 * True when a Google-verified email belongs to the workspace's trusted domain and the admin
 * enabled auto-approval. Only used for Google sign-in, where Google has proven email ownership.
 */
export async function isAutoApproved(workspaceId, email, emailVerified) {
  const s = await getSettings(workspaceId);
  return !!(emailVerified === true && s.allowSignup && s.autoApproveDomain && s.signupDomain && email.endsWith(`@${s.signupDomain}`));
}

/** Creates an active member straight away and returns its id. */
export async function createActiveMember(workspaceId, { name, email, googleEmail = null }) {
  return createUserIn(workspaceId, { name, email, passwordHash: null, googleEmail, pending: false });
}

async function createUserIn(workspaceId, { name, email, passwordHash, googleEmail, pending, role = 'member' }) {
  const now = Date.now();
  // One transaction, so there is never an account without its membership.
  const [inserted] = await q.batch([
    [
      `INSERT INTO users (name, email, password_hash, role, active, pending, google_email, created_at)
       VALUES (?, ?, ?, 'member', 1, 0, ?, ?) RETURNING id`,
      name, email, passwordHash, googleEmail, now,
    ],
    [
      'INSERT INTO workspace_members (workspace_id, user_id, role, active, pending, created_at) VALUES (?, last_insert_rowid(), ?, ?, ?, ?)',
      workspaceId, role, pending ? 0 : 1, pending ? 1 : 0, now,
    ],
  ]);
  return inserted.rows[0].id;
}

/** Account plus active membership, used when an admin adds a new person. */
export const createMemberAccount = (workspaceId, { name, email, passwordHash, role }) =>
  createUserIn(workspaceId, { name, email, passwordHash, googleEmail: null, pending: false, role });
