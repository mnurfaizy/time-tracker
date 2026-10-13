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

function keysFor(e, by, ctx) {
  switch (by) {
    case 'project':
      return [{ key: `p${e.projectId ?? 0}`, label: e.projectName ?? '(Without project)', color: e.projectColor ?? null, sub: e.clientName ?? '' }];
    case 'client':
      return [{ key: `c${e.clientId ?? 0}`, label: e.clientName ?? '(Without client)' }];
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
