// Report aggregation shared by the browser (on-screen reports) and the server (CSV export).
import { dayKey } from './time.js';

export const GROUP_OPTIONS = [
  ['project', 'Project'],
  ['client', 'Client'],
  ['user', 'User'],
  ['task', 'Task'],
  ['tag', 'Tag'],
  ['description', 'Description'],
  ['billable', 'Billability'],
  ['date', 'Date'],
];

export const groupLabel = (by) => GROUP_OPTIONS.find(([k]) => k === by)?.[1] ?? by;

export function entryDuration(e, now = Date.now()) {
  return Math.max(0, (e.end ?? now) - e.start);
}

export function entryRate(e, defaultRate = 0) {
  return e.rate ?? defaultRate ?? 0;
}

export function entryAmount(e, defaultRate = 0) {
  if (!e.billable) return 0;
  return (entryDuration(e) / 3600000) * entryRate(e, defaultRate);
}

export function totals(entries, defaultRate = 0) {
  let duration = 0;
  let billableDuration = 0;
  let amount = 0;
  for (const e of entries) {
    const d = entryDuration(e);
    duration += d;
    if (e.billable) billableDuration += d;
    amount += entryAmount(e, defaultRate);
  }
  return { duration, billableDuration, amount };
}

/**
 * Every project of an entry as { id, name, color, clientId, clientName }, deduplicated.
 * New entries carry `projects`; older data only has the single-project fields.
 */
export function entryProjects(e) {
  if (Array.isArray(e.projects)) {
    const seen = new Set();
    const out = [];
    for (const p of e.projects) {
      if (!p || p.id == null || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }
  return e.projectId != null
    ? [{ id: e.projectId, name: e.projectName, color: e.projectColor, clientId: e.clientId, clientName: e.clientName }]
    : [];
}

function keysFor(e, by, ctx) {
  switch (by) {
    // An entry with several projects counts fully towards each of them (like tags),
    // while grand totals always count it once.
    case 'project': {
      const ps = entryProjects(e);
      if (!ps.length) return [{ key: 'p0', label: '(Without project)', color: null, sub: '' }];
      return ps.map((p) => ({ key: `p${p.id}`, label: p.name ?? '(Without project)', color: p.color ?? null, sub: p.clientName ?? '' }));
    }
    case 'client': {
      const ps = entryProjects(e);
      const clientIds = [...new Set(ps.map((p) => p.clientId).filter((cid) => cid != null))];
      if (!clientIds.length) return [{ key: 'c0', label: '(Without client)' }];
      // Projects sharing a client collapse into one key, so nothing is counted twice.
      return clientIds.map((cid) => {
        const p = ps.find((x) => x.clientId === cid);
        return { key: `c${cid}`, label: p.clientName ?? '(Without client)' };
      });
    }
    case 'user':
      return [{ key: `u${e.userId}`, label: e.userName }];
    case 'task':
      return [{ key: `t${e.taskId ?? 0}`, label: e.taskName ?? '(Without task)' }];
    case 'description':
      return [{ key: `d${e.description}`, label: e.description || '(Without description)' }];
    case 'billable':
      return [{ key: e.billable ? 'b1' : 'b0', label: e.billable ? 'Billable' : 'Non-billable' }];
    case 'date': {
      const k = dayKey(e.start, ctx.tz);
      return [{ key: k, label: k }];
    }
    case 'tag':
      if (!e.tagIds?.length) return [{ key: 'g0', label: '(Without tag)' }];
      return e.tagIds.map((id) => ({ key: `g${id}`, label: ctx.tagName(id) || '(Deleted tag)' }));
    default:
      return [{ key: 'all', label: 'All' }];
  }
}

function sortNodes(nodes, by) {
  if (by === 'date') return nodes.sort((a, b) => a.key.localeCompare(b.key));
  return nodes.sort((a, b) => b.duration - a.duration || a.label.localeCompare(b.label));
}

/** Two-level grouping: [{ key, label, color, duration, amount, children: [...] }] */
export function summarize(entries, g1, g2, ctx) {
  const top = new Map();
  for (const e of entries) {
    const dur = entryDuration(e);
    const amt = entryAmount(e, ctx.defaultRate);
    for (const k1 of keysFor(e, g1, ctx)) {
      let n1 = top.get(k1.key);
      if (!n1) top.set(k1.key, (n1 = { ...k1, duration: 0, amount: 0, children: new Map() }));
      n1.duration += dur;
      n1.amount += amt;
      if (!g2) continue;
      for (const k2 of keysFor(e, g2, ctx)) {
        let n2 = n1.children.get(k2.key);
        if (!n2) n1.children.set(k2.key, (n2 = { ...k2, duration: 0, amount: 0 }));
        n2.duration += dur;
        n2.amount += amt;
      }
    }
  }
  return sortNodes(
    [...top.values()].map((n) => ({ ...n, children: sortNodes([...n.children.values()], g2) })),
    g1,
  );
}

/** Rows grouped by `by`, with per-day durations for each key in dayKeys. */
export function weekly(entries, by, dayKeys, ctx) {
  const rows = new Map();
  for (const e of entries) {
    const dk = dayKey(e.start, ctx.tz);
    const dur = entryDuration(e);
    for (const k of keysFor(e, by, ctx)) {
      let r = rows.get(k.key);
      if (!r) rows.set(k.key, (r = { ...k, days: Object.fromEntries(dayKeys.map((d) => [d, 0])), total: 0 }));
      if (dk in r.days) r.days[dk] += dur;
      r.total += dur;
    }
  }
  return sortNodes([...rows.values()].map((r) => ({ ...r, duration: r.total })), by);
}
