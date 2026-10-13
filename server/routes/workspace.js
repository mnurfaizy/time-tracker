import { Router } from 'express';
import { getSettings, setSettings } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { bad, reqStr } from '../util.js';

const r = Router();
r.use(requireAuth);

r.get('/', async (req, res) => res.json({ settings: await getSettings() }));

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
  await setSettings(next);
  res.json({ settings: await getSettings() });
});

export default r;
