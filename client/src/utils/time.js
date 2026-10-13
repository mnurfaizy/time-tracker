import { pad, formatDuration } from '../../../shared/time.js';

export { pad, formatDuration };

export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export const HOUR = 3600000;
export const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export { MONTHS, WEEKDAYS };

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d, weekStart = 1) {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() - weekStart + 7) % 7));
}

export const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

export function dayKeyLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtTime(ms, timeFormat = '24') {
  const d = new Date(ms);
  if (timeFormat === '12') {
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  }
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(ms, { year = 'auto', weekday = false } = {}) {
  const d = new Date(ms);
  const showYear = year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  return `${weekday ? `${WEEKDAYS[d.getDay()]}, ` : ''}${MONTHS[d.getMonth()]} ${d.getDate()}${showYear ? `, ${d.getFullYear()}` : ''}`;
}

export function fmtDayLabel(ms) {
  const today = startOfDay(new Date());
  if (sameDay(ms, today)) return 'Today';
  if (sameDay(ms, addDays(today, -1))) return 'Yesterday';
  return fmtDate(ms, { weekday: true });
}

export function fmtRange(start, endExclusive) {
  const last = endExclusive - 1;
  if (sameDay(start, last)) return fmtDate(start, { year: true });
  const sy = new Date(start).getFullYear();
  const ey = new Date(last).getFullYear();
  return `${fmtDate(start, { year: sy !== ey })} – ${fmtDate(last, { year: true })}`;
}

/** Short duration for charts: 5400000 -> "1:30" */
export function fmtHM(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}:${pad(m % 60)}`;
}

/** Parses "9", "930", "09:30", "9.30", "9:30pm", "21:05" into minutes since midnight. */
export function parseTimeStr(input) {
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3];
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap.startsWith('p') ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Parses "1:30", "1:30:15", "1.5" (hours), "90m", "2h 15m" into milliseconds. */
export function parseDurationStr(input) {
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +(m[3] ?? 0)) * 1000;
  m = s.match(/^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  if (m && (m[1] || m[2])) return Math.round((parseFloat((m[1] ?? '0').replace(',', '.')) * 60 + +(m[2] ?? 0)) * 60000);
  m = s.match(/^\d+(?:[.,]\d+)?$/);
  if (m) return Math.round(parseFloat(s.replace(',', '.')) * HOUR);
  return null;
}

export function atMinutes(dayMs, minutes) {
  const d = startOfDay(dayMs);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

export const minutesOf = (ms) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

export function toDateInput(ms) {
  return dayKeyLocal(ms);
}

export function fromDateInput(str) {
  const [y, m, d] = String(str).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}

export const toTimeInput = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Moves an instant to another calendar day, keeping its local time of day. */
export function moveToDay(ms, dayMs) {
  const src = new Date(ms);
  const d = startOfDay(dayMs);
  d.setHours(src.getHours(), src.getMinutes(), src.getSeconds(), src.getMilliseconds());
  return d.getTime();
}

// ---- Date range presets (Reports, Dashboard) ----

export const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['thisWeek', 'This week'],
  ['lastWeek', 'Last week'],
  ['last7', 'Past 7 days'],
  ['last30', 'Past 30 days'],
  ['thisMonth', 'This month'],
  ['lastMonth', 'Last month'],
  ['thisYear', 'This year'],
  ['lastYear', 'Last year'],
];

export function presetRange(key, weekStart = 1, now = new Date()) {
  const today = startOfDay(now);
  const y = today.getFullYear();
  const mo = today.getMonth();
  const r = (s, e) => ({ start: s.getTime(), end: e.getTime(), preset: key });
  switch (key) {
    case 'today': return r(today, addDays(today, 1));
    case 'yesterday': return r(addDays(today, -1), today);
    case 'thisWeek': { const s = startOfWeek(today, weekStart); return r(s, addDays(s, 7)); }
    case 'lastWeek': { const s = addDays(startOfWeek(today, weekStart), -7); return r(s, addDays(s, 7)); }
    case 'last7': return r(addDays(today, -6), addDays(today, 1));
    case 'last30': return r(addDays(today, -29), addDays(today, 1));
    case 'thisMonth': return r(new Date(y, mo, 1), new Date(y, mo + 1, 1));
    case 'lastMonth': return r(new Date(y, mo - 1, 1), new Date(y, mo, 1));
    case 'thisYear': return r(new Date(y, 0, 1), new Date(y + 1, 0, 1));
    case 'lastYear': return r(new Date(y - 1, 0, 1), new Date(y, 0, 1));
    default: return presetRange('thisWeek', weekStart, now);
  }
}

export function rangeLabel(range) {
  return PRESETS.find(([k]) => k === range.preset)?.[1] ?? fmtRange(range.start, range.end);
}

/** Moves a range one step back/forward, keeping month and year ranges aligned. */
export function shiftRange(range, dir) {
  const s = new Date(range.start);
  const e = new Date(range.end);
  const isMonth = s.getDate() === 1 && e.getDate() === 1 && (e.getFullYear() * 12 + e.getMonth()) - (s.getFullYear() * 12 + s.getMonth()) >= 1;
  if (isMonth) {
    const months = (e.getFullYear() * 12 + e.getMonth()) - (s.getFullYear() * 12 + s.getMonth());
    return {
      start: new Date(s.getFullYear(), s.getMonth() + dir * months, 1).getTime(),
      end: new Date(e.getFullYear(), e.getMonth() + dir * months, 1).getTime(),
    };
  }
  const days = Math.round((startOfDay(e) - startOfDay(s)) / DAY);
  return { start: addDays(s, dir * days).getTime(), end: addDays(e, dir * days).getTime() };
}
