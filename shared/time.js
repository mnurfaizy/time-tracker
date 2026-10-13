// Time helpers shared by the server (CSV export) and the browser (reports).

export const pad = (n) => String(n).padStart(2, '0');

const formatters = new Map();
function partsFormatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(ms, tz) {
  const o = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

/** "YYYY-MM-DD" of the instant in the given time zone. */
export function dayKey(ms, tz) {
  const p = zonedParts(ms, tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

export function clockTime(ms, tz, timeFormat = '24', withSeconds = false) {
  const p = zonedParts(ms, tz);
  const sec = withSeconds ? `:${pad(p.s)}` : '';
  if (timeFormat === '12') {
    const h = p.h % 12 || 12;
    return `${h}:${pad(p.mi)}${sec} ${p.h < 12 ? 'AM' : 'PM'}`;
  }
  return `${pad(p.h)}:${pad(p.mi)}${sec}`;
}

/** All distinct day keys touched by [start, end) in the given zone. */
export function dayKeysInRange(start, end, tz) {
  const keys = [];
  let last = null;
  for (let t = start; t < end; t += 3600000) {
    const k = dayKey(t, tz);
    if (k !== last) {
      keys.push(k);
      last = k;
    }
  }
  return keys;
}

/** 3725000 -> "1:02:05" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

export const hoursDecimal = (ms) => (ms / 3600000).toFixed(2);
