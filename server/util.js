export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have permission to do that') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function str(v, max = 255) {
  return String(v ?? '').trim().slice(0, max);
}

export function reqStr(v, field, max = 255) {
  const s = str(v, max);
  if (!s) throw bad(`${field} is required`);
  return s;
}

export function email(v) {
  const s = str(v, 254).toLowerCase();
  if (!EMAIL_RE.test(s)) throw bad('Please enter a valid email address');
  return s;
}

export function password(v) {
  const s = String(v ?? '');
  if (s.length < 8) throw bad('Password must be at least 8 characters');
  if (s.length > 200) throw bad('Password is too long');
  return s;
}

/** Positive integer id or null. */
export function id(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** "1,2,0" -> [1, 2, 0]; 0 means "without". Missing -> null (no filter). */
export function idList(v) {
  if (v == null || v === '') return null;
  return String(v)
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
}

/** Body field `projectIds`: a list of positive ids, deduplicated in input order. null when absent. */
export function normalizeProjectIds(v) {
  if (v == null) return null;
  if (!Array.isArray(v)) throw bad('projectIds must be a list');
  return [...new Set(v.map((x) => (typeof x === 'boolean' ? null : id(x))).filter(Boolean))];
}

export function ms(v, field) {
  const n = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(n)) throw bad(`Invalid ${field}`);
  return Math.round(n);
}

export function color(v, fallback = '#3E8E5E') {
  const s = str(v, 7);
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback;
}
