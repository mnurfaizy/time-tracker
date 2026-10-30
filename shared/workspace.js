// Workspace links. The main (first) workspace lives at the root paths (/tracker, /reports, ...),
// every other workspace under its own slug (/multipolar/tracker). Shared by server and client.

// Top-level app pages. A slug can never take one of these names, so /tracker is always a page.
export const APP_PAGES = ['tracker', 'calendar', 'dashboard', 'reports', 'projects', 'clients', 'tags', 'team', 'settings', 'profile', 'login', 'signup'];

const RESERVED = new Set([...APP_PAGES, 'api', 'assets', 'w', 'workspace', 'workspaces', 'admin', 'new', 'extension', 'privacy', 'static', 'public', 'help']);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** "PT Multipolar Tbk." -> "pt-multipolar-tbk" */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Error message for an unusable slug, or null when it is fine. */
export function slugProblem(slug) {
  if (!slug) return 'Link name is required';
  if (!SLUG_RE.test(slug)) return 'Link name can only use lowercase letters, numbers and dashes (max 40)';
  if (RESERVED.has(slug) || /\./.test(slug)) return `"${slug}" is reserved. Please choose another link name`;
  return null;
}

/** First path segment when it can be a workspace slug ("/multipolar/tracker" -> "multipolar"). */
export function slugFromPath(pathname) {
  const first = String(pathname ?? '').split('/')[1] ?? '';
  return first && !RESERVED.has(first) && SLUG_RE.test(first) ? first : null;
}

/** URL path prefix of a workspace: '' for the main workspace, '/slug' otherwise. */
export const basePath = (ws) => (!ws || ws.primary ? '' : `/${ws.slug}`);
