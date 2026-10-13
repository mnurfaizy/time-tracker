import { useEffect, useRef, useState } from 'react';
import { formatDuration, fmtHM, HOUR } from '../utils/time.js';

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(maxMs) {
  const hours = maxMs / HOUR;
  if (hours <= 0) return 4 * HOUR;
  const steps = [1, 2, 4, 5, 8, 10, 20, 40, 50, 80, 100, 200, 400, 500, 1000, 2000, 5000];
  const step = steps.find((s) => hours <= s * 4) ?? Math.ceil(hours / 4);
  return step * 4 * HOUR;
}

/** Vertical bar chart of durations. data: [{ label, sub, value }] */
export function BarChart({ data, height = 240, color = '#3E8E5E' }) {
  const [ref, width] = useWidth();
  const left = 48;
  const bottom = data.length > 0 && data[0].sub ? 40 : 26;
  const top = 18;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotH = height - top - bottom;
  const plotW = width - left - 8;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(56, slot * 0.6));
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56)));
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label="Tracked time chart">
        {ticks.map((t) => {
          const y = top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={left} x2={width - 8} y1={y} y2={y} className="chart-grid" />
              <text x={left - 8} y={y + 4} textAnchor="end" className="chart-axis">{Math.round(t / HOUR)}h</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * plotH;
          const x = left + slot * i + (slot - barW) / 2;
          const y = top + plotH - h;
          return (
            <g key={i}>
              <title>{`${d.label}${d.sub ? ` ${d.sub}` : ''}: ${formatDuration(d.value)}`}</title>
              <rect x={left + slot * i} y={top} width={slot} height={plotH} fill="transparent" />
              {d.value > 0 && <rect x={x} y={y} width={barW} height={Math.max(h, 1)} fill={color} rx={Math.min(6, barW / 2)} />}
              {d.value > 0 && barW >= 24 && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="chart-value">{fmtHM(d.value)}</text>
              )}
              {i % labelEvery === 0 && (
                <>
                  <text x={x + barW / 2} y={height - bottom + 16} textAnchor="middle" className="chart-label">{d.label}</text>
                  {d.sub && <text x={x + barW / 2} y={height - bottom + 31} textAnchor="middle" className="chart-axis">{d.sub}</text>}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Donut chart. segments: [{ label, value, color }] */
export function Donut({ segments, size = 220, centerLabel }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = size / 2 - 18;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut" role="img" aria-label="Distribution chart">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDF1EC" strokeWidth="28" />
      {total > 0 &&
        segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth="28"
              strokeDasharray={`${Math.max(0, len - (segments.length > 1 ? 1 : 0))} ${c}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${s.label}: ${formatDuration(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      <text x="50%" y="48%" textAnchor="middle" className="donut-total">{formatDuration(total)}</text>
      {centerLabel && <text x="50%" y="58%" textAnchor="middle" className="chart-axis">{centerLabel}</text>}
    </svg>
  );
}

export const CHART_COLORS = [
  '#3E8E5E', '#4F68D8', '#E0A23A', '#E06A5A', '#8C63D2', '#2A9D8F', '#D4618C', '#7E9A3C',
  '#C2861A', '#5B7FD6', '#B5563B', '#3B7A8C', '#9C6B3F', '#6D7A70', '#A8486A', '#4E9F6E', '#7A5CC0',
];

/** Turns grouped report nodes into donut segments (top 9 + "Other"). */
export function toSegments(nodes) {
  const top = nodes.slice(0, 9).map((n, i) => ({ label: n.label, value: n.duration, color: n.color || CHART_COLORS[i % CHART_COLORS.length] }));
  const rest = nodes.slice(9).reduce((s, n) => s + n.duration, 0);
  if (rest > 0) top.push({ label: 'Other', value: rest, color: '#D3DBD2' });
  return top;
}
