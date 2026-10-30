import { Router } from 'express';
import { q, getSettings, setSettings } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { HttpError, bad, reqStr, str } from '../util.js';
import { assertSlugFree, createWorkspace } from '../lib/workspaces.js';

const r = Router();
r.use(requireAuth);

const current = async (req) => {
  const w = await q.get('SELECT id, name, slug FROM workspaces WHERE id = ?', req.ws.id);
  return { ...req.ws, name: w.name, slug: w.slug };
};

r.get('/', async (req, res) => res.json({ settings: await getSettings(req.ws.id), workspace: await current(req) }));

r.put('/', requireAdmin, async (req, res) => {
  const b = req.body;
  const next = {};
  if ('workspaceName' in b) next.workspaceName = reqStr(b.workspaceName, 'Workspace name', 100);
  if ('currency' in b) {
    const c = String(b.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw bad('Currency must be a 3-letter code such as IDR or USD');
    next.currency = c;
  }
  if ('defaultRate' in b) {
    const rate = Number(b.defaultRate);
    if (!Number.isFinite(rate) || rate < 0) throw bad('Billable rate must be a positive number');
    next.defaultRate = rate;
  }
  if ('weekStart' in b) next.weekStart = Number(b.weekStart) === 0 ? 0 : 1;
  if ('timeFormat' in b) next.timeFormat = b.timeFormat === '12' ? '12' : '24';
  if ('membersCanCreate' in b) next.membersCanCreate = !!b.membersCanCreate;
  if ('membersSeeTeamDashboard' in b) next.membersSeeTeamDashboard = !!b.membersSeeTeamDashboard;
  if ('allowSignup' in b) next.allowSignup = !!b.allowSignup;
  if ('autoApproveDomain' in b) next.autoApproveDomain = !!b.autoApproveDomain;
  if ('signupDomain' in b) {
    const d = String(b.signupDomain ?? '').trim().toLowerCase().replace(/^@/, '');
    if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw bad('Enter a domain like yourcompany.com, or leave it empty');
    next.signupDomain = d;
  }
  // The link name only shows in URLs of non-main workspaces (/slug/tracker).
  if ('slug' in b) {
    const slug = str(b.slug, 64).toLowerCase();
    await assertSlugFree(slug, req.ws.id);
    await q.run('UPDATE workspaces SET slug = ? WHERE id = ?', slug, req.ws.id);
  }
  await setSettings(req.ws.id, next);
  res.json({ settings: await getSettings(req.ws.id), workspace: await current(req) });
});

// New workspace; the creator becomes its admin. Open to anyone who is an admin somewhere.
r.post('/new', async (req, res) => {
  if (!req.user.workspaces.some((w) => w.role === 'admin')) throw new HttpError(403, 'Only workspace admins can create a new workspace');
  const name = reqStr(req.body.name, 'Workspace name', 100);
  const slug = str(req.body.slug, 64).toLowerCase() || undefined;
  const ws = await createWorkspace({ name, slug, userId: req.user.id, copyFrom: await getSettings(req.ws.id) });
  res.json({ workspace: { ...ws, role: 'admin', primary: false } });
});

export default r;
