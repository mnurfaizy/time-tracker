// RFC 4180 CSV with protection against spreadsheet formula injection.
function cell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d+(\.\d+)?$/.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  // BOM so Excel opens UTF-8 (names with accents, emoji, etc.) correctly.
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
