import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useParams, Navigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import { api, apiLink, qs } from '../api.js';
import { useData, useMoney } from '../store.jsx';
import { DateRangePicker } from '../components/DateRangePicker.jsx';
import { FilterDropdown } from '../components/pickers.jsx';
import { BarChart, Donut, toSegments } from '../components/Charts.jsx';
import { EntryModal } from '../components/EntryModal.jsx';
import { Popover, useToggle, Spinner, Empty } from '../components/ui.jsx';
import { summarize, weekly, totals, GROUP_OPTIONS, entryDuration, entryAmount } from '../../../shared/report.js';
import {
  presetRange, startOfWeek, addDays, startOfDay, dayKeyLocal, formatDuration, fmtTime, fmtDate, MONTHS, WEEKDAYS, TZ, DAY,
} from '../utils/time.js';

const TABS = ['summary', 'detailed', 'weekly'];
const emptyFilters = { users: [], clients: [], projects: [], tags: [], billable: '', description: '' };

/** Builds chart buckets (days, weeks or months depending on the range length). */
export function chartBuckets(entries, range, weekStart) {
  const days = Math.round((range.end - range.start) / DAY);
  let unit = 'day';
  if (days > 366) unit = 'month';
  else if (days > 31) unit = 'week';
  const buckets = [];
  const index = new Map();
  let cur = new Date(range.start);
  if (unit === 'week') cur = startOfWeek(cur, weekStart);
  if (unit === 'month') cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  while (cur.getTime() < range.end) {
    const next = unit === 'day' ? addDays(cur, 1) : unit === 'week' ? addDays(cur, 7) : new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const b = {
      start: cur.getTime(),
      value: 0,
      label: unit === 'day' ? WEEKDAYS[cur.getDay()] : unit === 'week' ? fmtDate(cur.getTime()) : MONTHS[cur.getMonth()],
      sub: unit === 'day' ? `${MONTHS[cur.getMonth()]} ${cur.getDate()}` : unit === 'month' ? String(cur.getFullYear()) : '',
    };
    if (unit === 'day' && days > 14) {
      b.label = `${cur.getDate()}`;
      b.sub = cur.getDate() === 1 || buckets.length === 0 ? MONTHS[cur.getMonth()] : '';
    }
    buckets.push(b);
    index.set(unit === 'day' ? dayKeyLocal(cur) : cur.getTime(), b);
    cur = next;
  }
  for (const e of entries) {
    let key;
    if (unit === 'day') key = dayKeyLocal(e.start);
    else if (unit === 'week') key = startOfWeek(e.start, weekStart).getTime();
    else {
      const d = new Date(e.start);
      key = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    }
    const b = index.get(key);
    if (b) b.value += entryDuration(e);
  }
  return buckets;
}

export default function Reports() {
  const { tab } = useParams();
  const { settings, isAdmin, users, clients, projects, tags, toast } = useData();
  const money = useMoney();
  const [range, setRange] = useState(() => presetRange('thisWeek', settings.weekStart));
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [entries, setEntries] = useState(null);
  const [version, setVersion] = useState(0);

  // The weekly report always covers exactly one week.
  const effectiveRange = useMemo(() => {
    if (tab !== 'weekly') return range;
    const s = startOfWeek(range.start, settings.weekStart).getTime();
    const e = addDays(s, 7).getTime();
    return s === range.start && e === range.end ? range : { start: s, end: e, preset: range.preset === 'lastWeek' ? 'lastWeek' : range.preset === 'thisWeek' ? 'thisWeek' : undefined };
  }, [tab, range, settings.weekStart]);

  const query = useMemo(
    () =>
      qs({
        start: effectiveRange.start,
        end: effectiveRange.end,
        users: isAdmin && applied.users.length ? applied.users.join(',') : undefined,
        clients: applied.clients.length ? applied.clients.join(',') : undefined,
        projects: applied.projects.length ? applied.projects.join(',') : undefined,
        tags: applied.tags.length ? applied.tags.join(',') : undefined,
        billable: applied.billable,
        description: applied.description,
        tz: TZ,
      }),
    [effectiveRange, applied, isAdmin],
  );

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    api
      .get(`/reports/entries?${query}`)
      .then((d) => !cancelled && setEntries(d.entries))
      .catch((err) => {
        if (!cancelled) {
          setEntries([]);
          toast(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query, version, toast]);

  if (!TABS.includes(tab)) return <Navigate to="/reports/summary" replace />;

  const t = entries ? totals(entries, settings.defaultRate) : null;
  const dirty = JSON.stringify(filters) !== JSON.stringify(applied);

  return (
    <div className="page reports-page">
      <div className="page-head">
        <div className="report-tabs">
          {TABS.map((k) => (
            <NavLink key={k} to={`/reports/${k}`} className="report-tab">{k}</NavLink>
          ))}
        </div>
        <DateRangePicker value={effectiveRange} onChange={setRange} weekStart={settings.weekStart} weekOnly={tab === 'weekly'} />
      </div>

      <div className="filter-bar">
        <span className="filter-bar-label">Filter</span>
        {isAdmin && (
          <FilterDropdown label="Team" options={users.map((u) => ({ id: u.id, name: u.name }))} value={filters.users} onChange={(v) => setFilters({ ...filters, users: v })} />
        )}
        <FilterDropdown label="Client" options={clients} withNone="(Without client)" value={filters.clients} onChange={(v) => setFilters({ ...filters, clients: v })} />
        <FilterDropdown
          label="Project"
          options={projects.map((p) => ({ id: p.id, name: p.clientName ? `${p.name} - ${p.clientName}` : p.name, color: p.color }))}
          withNone="(Without project)"
          value={filters.projects}
          onChange={(v) => setFilters({ ...filters, projects: v })}
        />
        <FilterDropdown label="Tag" options={tags} withNone="(Without tag)" value={filters.tags} onChange={(v) => setFilters({ ...filters, tags: v })} />
        <select className={`filter-btn ${filters.billable ? 'active' : ''}`} value={filters.billable} onChange={(e) => setFilters({ ...filters, billable: e.target.value })}>
          <option value="">Billable: all</option>
          <option value="1">Billable</option>
          <option value="0">Non-billable</option>
        </select>
        <input
          className="filter-desc"
          placeholder="Description"
          value={filters.description}
          onChange={(e) => setFilters({ ...filters, description: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && setApplied(filters)}
        />
        <button type="button" className={`btn btn-primary btn-sm ${dirty ? '' : 'muted'}`} onClick={() => setApplied(filters)}>Apply filter</button>
        {JSON.stringify(applied) !== JSON.stringify(emptyFilters) && (
          <button type="button" className="btn-link btn-sm" onClick={() => { setFilters(emptyFilters); setApplied(emptyFilters); }}>Clear</button>
        )}
      </div>

      <div className="report-totals">
        <div className="report-totals-left">
          <span>Total: <b>{t ? formatDuration(t.duration) : '—'}</b></span>
          <span>Billable: <b>{t ? formatDuration(t.billableDuration) : '—'}</b></span>
          <span>Amount: <b>{t ? money(t.amount) : '—'}</b></span>
        </div>
        <ExportMenu tab={tab} query={query} />
      </div>

      {entries == null ? (
        <div className="center-pad"><Spinner /></div>
      ) : entries.length === 0 ? (
        <div className="card"><Empty icon={<FileText size={44} />} title="No data for this period">Try another date range or clear the filters.</Empty></div>
      ) : tab === 'summary' ? (
        <SummaryReport entries={entries} range={effectiveRange} />
      ) : tab === 'detailed' ? (
        <DetailedReport entries={entries} onChanged={() => setVersion((v) => v + 1)} />
      ) : (
        <WeeklyReport entries={entries} range={effectiveRange} />
      )}
    </div>
  );
}

function ExportMenu({ tab, query }) {
  const ref = useRef(null);
  const { isAdmin } = useData();
  const [open, , toggle, close] = useToggle();
  const exportCsv = () => {
    const g1 = localStorage.getItem(`tt.${tab}.g1`) || (tab === 'weekly' ? (isAdmin ? 'user' : 'project') : 'project');
    const g2 = localStorage.getItem(`tt.${tab}.g2`) || 'description';
    const extra = qs({ type: tab, group1: g1, group2: g2 });
    window.location.href = apiLink(`/api/reports/export?${query}&${extra}`);
    close();
  };
  return (
    <>
      <button ref={ref} type="button" className="btn btn-outline btn-sm" onClick={toggle}>
        <Download size={16} /> Export <ChevronDown size={14} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} align="right" className="menu">
        <button type="button" className="menu-item" onClick={exportCsv}>Save as CSV</button>
      </Popover>
    </>
  );
}

function useStoredGroup(key, fallback) {
  const [v, setV] = useState(() => localStorage.getItem(key) || fallback);
  const set = (val) => {
    setV(val);
    try {
      localStorage.setItem(key, val);
    } catch {
      // ignore
    }
  };
  return [v, set];
}

function SummaryReport({ entries, range }) {
  const { settings, tagById } = useData();
  const money = useMoney();
  const [g1, setG1] = useStoredGroup('tt.summary.g1', 'project');
  const [g2, setG2] = useStoredGroup('tt.summary.g2', 'description');
  const [open, setOpen] = useState({});
  const ctx = { tz: TZ, defaultRate: settings.defaultRate, tagName: (tid) => tagById.get(tid)?.name };
  const groups = useMemo(() => summarize(entries, g1, g2 === 'none' ? null : g2, ctx), [entries, g1, g2, settings.defaultRate, tagById]); // eslint-disable-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => chartBuckets(entries, range, settings.weekStart), [entries, range, settings.weekStart]);
  const total = groups.reduce((s, n) => s + n.duration, 0);
  const allOpen = groups.length > 0 && groups.every((n) => open[n.key]);

  return (
    <>
      <div className="card chart-card"><BarChart data={buckets} /></div>
      <div className="card">
        <div className="summary-groupbar">
          <span>Group by</span>
          <select className="input select-sm" value={g1} onChange={(e) => setG1(e.target.value)}>
            {GROUP_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="input select-sm" value={g2} onChange={(e) => setG2(e.target.value)}>
            <option value="none">(None)</option>
            {GROUP_OPTIONS.filter(([k]) => k !== g1).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {g2 !== 'none' && (
            <button type="button" className="btn-link btn-sm" onClick={() => setOpen(allOpen ? {} : Object.fromEntries(groups.map((n) => [n.key, true])))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
        <div className="summary-body">
          <table className="table summary-table">
            <thead>
              <tr>
                <th>Title</th>
                <th className="num">Duration</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((n) => (
                <SummaryRows key={n.key} node={n} open={!!open[n.key]} toggle={() => setOpen((o) => ({ ...o, [n.key]: !o[n.key] }))} money={money} total={total} />
              ))}
            </tbody>
          </table>
          <div className="summary-donut">
            <Donut segments={toSegments(groups)} />
            <ul className="legend">
              {toSegments(groups).map((s) => (
                <li key={s.label}>
                  <span className="dot" style={{ background: s.color }} />
                  <span className="truncate">{s.label}</span>
                  <span className="legend-pct">{total ? ((s.value / total) * 100).toFixed(1) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryRows({ node, open, toggle, money, total }) {
  const expandable = node.children.length > 0;
  return (
    <>
      <tr className={`summary-row ${expandable ? 'expandable' : ''}`} onClick={expandable ? toggle : undefined}>
        <td>
          <span className="summary-title">
            {expandable ? open ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span className="chev-space" />}
            {node.color && <span className="dot" style={{ background: node.color }} />}
            <span style={node.color ? { color: node.color } : undefined}>{node.label}</span>
            {node.sub && <span className="muted"> - {node.sub}</span>}
          </span>
          <span className="summary-bar"><span style={{ width: `${total ? (node.duration / total) * 100 : 0}%`, background: node.color || '#03A9F4' }} /></span>
        </td>
        <td className="num">{formatDuration(node.duration)}</td>
        <td className="num">{money(node.amount)}</td>
      </tr>
      {open &&
        node.children.map((c) => (
          <tr key={c.key} className="summary-child">
            <td><span className="summary-title child">{c.color && <span className="dot" style={{ background: c.color }} />}{c.label}{c.sub && <span className="muted"> - {c.sub}</span>}</span></td>
            <td className="num">{formatDuration(c.duration)}</td>
            <td className="num">{money(c.amount)}</td>
          </tr>
        ))}
    </>
  );
}

const PAGE_SIZE = 50;

function DetailedReport({ entries, onChanged }) {
  const { settings, tagById, isAdmin, user } = useData();
  const money = useMoney();
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(null);
  const pages = Math.ceil(entries.length / PAGE_SIZE);
  useEffect(() => setPage(0), [entries]);
  const rows = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="card">
      <table className="table detailed-table">
        <thead>
          <tr>
            <th>Time entry</th>
            <th className="num">Amount</th>
            <th>User</th>
            <th>Time</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const eps = e.projects?.length ? e.projects : e.projectId != null ? [{ id: e.projectId, name: e.projectName, color: e.projectColor, clientId: e.clientId, clientName: e.clientName }] : [];
            const p = eps[0] ?? null;
            const color = p?.color;
            const editable = isAdmin || e.userId === user.id;
            const crosses = startOfDay(e.end).getTime() !== startOfDay(e.start).getTime();
            return (
              <tr key={e.id} className={editable ? 'clickable' : ''} onClick={() => editable && setEditing(e)}>
                <td>
                  <div className="detailed-desc">{e.description || <span className="muted">(no description)</span>}</div>
                  <div className="detailed-meta">
                    {p ? (
                      <span style={{ color }} title={eps.length > 1 ? eps.map((x) => x.name).join(', ') : undefined}>
                        <span className="dot" style={{ background: color }} /> {p.name}
                        {eps.length > 1 && <span className="project-label-extra">+{eps.length - 1}</span>}
                        {e.taskName && `: ${e.taskName}`}
                        {p.clientName && <span className="muted"> - {p.clientName}</span>}
                      </span>
                    ) : (
                      <span className="muted">No project</span>
                    )}
                    {e.tagIds.length > 0 && (
                      <span className="detailed-tags">{e.tagIds.map((tid) => tagById.get(tid)?.name).filter(Boolean).join(', ')}</span>
                    )}
                  </div>
                </td>
                <td className="num">
                  {e.billable ? money(entryAmount(e, settings.defaultRate)) : <span className="muted">—</span>}
                  {e.billable && <span className="billable-mark">$</span>}
                </td>
                <td>{e.userName}</td>
                <td className="nowrap">
                  <div>{fmtTime(e.start, settings.timeFormat)} - {fmtTime(e.end, settings.timeFormat)}{crosses && <sup className="next-day">+1</sup>}</div>
                  <div className="muted small">{fmtDate(e.start, { year: true })}</div>
                </td>
                <td className="num"><b>{formatDuration(e.end - e.start)}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pagination">
          <button type="button" className="btn btn-outline btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page + 1} of {pages} · {entries.length} entries</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {editing && (
        <EntryModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
          onDeleted={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function WeeklyReport({ entries, range }) {
  const { settings, tagById, isAdmin } = useData();
  const [by, setBy] = useStoredGroup('tt.weekly.g1', isAdmin ? 'user' : 'project');
  const dayStarts = Array.from({ length: 7 }, (_, i) => addDays(range.start, i).getTime());
  const dayKeys = dayStarts.map(dayKeyLocal);
  const ctx = { tz: TZ, defaultRate: settings.defaultRate, tagName: (tid) => tagById.get(tid)?.name };
  const rows = useMemo(() => weekly(entries, by, dayKeys, ctx), [entries, by, dayKeys.join(), tagById]); // eslint-disable-line react-hooks/exhaustive-deps
  const colTotals = dayKeys.map((k) => rows.reduce((s, r) => s + r.days[k], 0));
  const grand = rows.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div className="card chart-card">
        <BarChart data={dayStarts.map((d, i) => ({ label: WEEKDAYS[new Date(d).getDay()], sub: fmtDate(d), value: colTotals[i] }))} />
      </div>
      <div className="card">
        <div className="summary-groupbar">
          <span>Group by</span>
          <select className="input select-sm" value={by} onChange={(e) => setBy(e.target.value)}>
            {GROUP_OPTIONS.filter(([k]) => k !== 'date').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="table-scroll">
          <table className="table weekly-table">
            <thead>
              <tr>
                <th>{GROUP_OPTIONS.find(([k]) => k === by)?.[1]}</th>
                {dayStarts.map((d) => (
                  <th key={d} className="num">{WEEKDAYS[new Date(d).getDay()]}<div className="muted small">{fmtDate(d)}</div></th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>
                    {r.color && <span className="dot" style={{ background: r.color }} />}
                    <span style={r.color ? { color: r.color } : undefined}>{r.label}</span>
                  </td>
                  {dayKeys.map((k) => <td key={k} className={`num ${r.days[k] ? '' : 'muted'}`}>{r.days[k] ? formatDuration(r.days[k]) : '—'}</td>)}
                  <td className="num"><b>{formatDuration(r.total)}</b></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><b>Total</b></td>
                {colTotals.map((v, i) => <td key={i} className="num"><b>{formatDuration(v)}</b></td>)}
                <td className="num"><b>{formatDuration(grand)}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
