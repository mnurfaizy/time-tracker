// Self sign-up: new accounts wait for an admin to approve them.
import { q, getSettings } from '../db.js';
import { HttpError } from '../util.js';

export const PENDING_MESSAGE = 'Your account is waiting for approval from a workspace admin. You can log in once it is approved.';

/** Throws when self sign-up is off or the email domain is not allowed. */
export async function assertSignupAllowed(email) {
  const settings = await getSettings();
  if (!settings.allowSignup) throw new HttpError(403, 'Sign-up is closed. Ask your workspace admin to add you.');
  if (settings.signupDomain && !email.endsWith(`@${settings.signupDomain}`)) {
    throw new HttpError(403, `Only @${settings.signupDomain} email addresses can sign up.`);
  }
}

export async function createPendingUser({ name, email, passwordHash = null, googleEmail = null }) {
  await q.run(
    `INSERT INTO users (name, email, password_hash, role, active, pending, google_email, created_at)
     VALUES (?, ?, ?, 'member', 0, 1, ?, ?)`,
    name, email, passwordHash, googleEmail, Date.now(),
  );
}
