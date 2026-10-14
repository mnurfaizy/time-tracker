import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api.js';
import { useData, useMoney } from '../store.jsx';
import { DateRangePicker } from '../components/DateRangePicker.jsx';
import { BarChart, Donut, toSegments } from '../components/Charts.jsx';
import { Spinner } from '../components/ui.jsx';
import { Avatar } from '../components/Layout.jsx';
import { summarize, totals } from '../../../shared/report.js';
import { presetRange, formatDuration, fmtDayLabel, fmtTime, TZ } from '../utils/time.js';
import { chartBuckets } from './Reports.jsx';

export default function Dashboard() {
  const { settings, isAdmin, user, tagById, toast } = useData();
  const money = useMoney();
  const [range, setRange] = useState(() => presetRange('thisWeek', settings.weekStart));
  const canSeeTeam = isAdmin || settings.membersSeeTeamDashboard;
  const [scope, setScope] = useState(canSeeTeam ? 'team' : 'me');
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    const query = qs({ start: range.start, end: range.end, users: scope === 'me' ? user.id : undefined, view: 'dashboard', tz: TZ });
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
  }, [range, scope, user.id, toast]);

  const data = useMemo(() => {
    if (!entries) return null;
    const ctx = { tz: TZ, defaultRate: settings.defaultRate, tagName: (tid) => tagById.get(tid)?.name };
    const byProject = summarize(entries, 'project', null, ctx);
    const byClient = summarize(entries, 'client', null, ctx);
    const activities = summarize(entries, 'description', 'project', ctx).flatMap((d) =>
      d.children.map((p) => ({ key: d.key + p.key, label: d.label, project: p, duration: p.duration })),
    );
    activities.sort((a, b) => b.duration - a.duration);
    const people = summarize(entries, 'user', null, ctx).map((u) => ({
      ...u,
      latest: entries.find((e) => `u${e.userId}` === u.key),
    }));
    return {
      t: totals(entries, settings.defaultRate),
      byProject,
      topProject: byProject[0],
      topClient: byClient.find((c) => c.key !== 'c0') ?? byClient[0],
      activities: activities.slice(0, 10),
      people,
      buckets: chartBuckets(entries, range, settings.weekStart),
    };
  }, [entries, settings, tagById, range]);

  return (
    <div className="page dashboard-page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <div className="dashboard-controls">
          {canSeeTeam && (
            <div className="segmented">
              <button type="button" className={scope === 'me' ? 'on' : ''} onClick={() => setScope('me')}>Only me</button>
              <button type="button" className={scope === 'team' ? 'on' : ''} onClick={() => setScope('team')}>Team</button>
            </div>
          )}
          <DateRangePicker value={range} onChange={setRange} weekStart={settings.weekStart} />
        </div>
      </div>

      {canSeeTeam && <TeamNow />}

      {!data ? (
        <div className="center-pad"><Spinner /></div>
      ) : (
        <>
          <div className="stat-row">
            <div className="card stat">
              <div className="stat-label">Total time</div>
              <div className="stat-value">{formatDuration(data.t.duration)}</div>
              <div className="stat-sub">Billable {formatDuration(data.t.billableDuration)} · {money(data.t.amount)}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Top project</div>
              <div className="stat-value truncate" style={{ color: data.topProject?.color ?? undefined }}>{data.topProject?.label ?? '—'}</div>
              <div className="stat-sub">{data.topProject ? formatDuration(data.topProject.duration) : 'No time tracked'}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Top client</div>
              <div className="stat-value truncate">{data.topClient?.label ?? '—'}</div>
              <div className="stat-sub">{data.topClient ? formatDuration(data.topClient.duration) : 'No time tracked'}</div>
            </div>
          </div>

          <div className="dash-grid">
            <div className="card chart-card">
              <div className="card-title">Tracked time</div>
              <BarChart data={data.buckets} />
            </div>
            <div className="card">
              <div className="card-title">Projects</div>
              <div className="dash-donut">
                <Donut segments={toSegments(data.byProject)} size={200} />
                <ul className="legend">
                  {toSegments(data.byProject).map((s) => (
                    <li key={s.label}>
                      <span className="dot" style={{ background: s.color }} />
                      <span className="truncate">{s.label}</span>
                      <span className="legend-pct">{formatDuration(s.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="dash-grid">
            <div className="card">
              <div className="card-title">Most tracked activities</div>
              {data.activities.length === 0 ? (
                <p className="muted pad">No activities in this period.</p>
              ) : (
                <ul className="activity-list">
                  {data.activities.map((a) => (
                    <li key={a.key}>
                      <div className="truncate">
                        <div>{a.label}</div>
                        <div className="small" style={{ color: a.project.color ?? '#999' }}>
                          {a.project.color && <span className="dot" style={{ background: a.project.color }} />} {a.project.label}
                        </div>
                      </div>
                      <b>{formatDuration(a.duration)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {scope === 'team' && canSeeTeam && (
              <div className="card">
                <div className="card-title">Team activities</div>
                <ul className="activity-list">
                  {data.people.map((p) => (
                    <li key={p.key}>
                      <div className="team-activity">
                        <Avatar name={p.label} size={30} />
                        <div className="truncate">
                          <div>{p.label}</div>
                          {p.latest && (
                            <div className="small muted truncate">
                              Latest: {p.latest.description || '(no description)'} · {fmtDayLabel(p.latest.start)} {fmtTime(p.latest.start, settings.timeFormat)}
                            </div>
                          )}
                        </div>
                      </div>
                      <b>{formatDuration(p.duration)}</b>
                    </li>
                  ))}
                  {data.people.length === 0 && <p className="muted pad">No team activity in this period.</p>}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function timeAgo(ms, now) {
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function ProjectTag({ entry }) {
  if (!entry.projectName) return <span className="muted">No project</span>;
  return (
    <span className="team-now-project" style={{ color: entry.projectColor ?? undefined }}>
      <span className="dot" style={{ background: entry.projectColor ?? '#999' }} />
      {entry.taskName ? `${entry.projectName}: ${entry.taskName}` : entry.projectName}
    </span>
  );
}

/** Who is tracking what right now, like Clockify's team activity. Refreshes every 30 s and on focus. */
function TeamNow() {
  const { user } = useData();
  const [members, setMembers] = useState(null);
  const [offset, setOffset] = useState(0); // server clock minus ours, so elapsed times line up
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api
      .get('/reports/team-now')
      .then((d) => {
        setMembers(d.members);
        if (d.now) setOffset(d.now - Date.now());
      })
      .catch(() => setMembers((m) => m ?? []));
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30000);
    const onFocus = () => document.visibilityState === 'visible' && load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  const anyRunning = members?.some((m) => m.running);
  useEffect(() => {
    if (!anyRunning) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  if (!members) return null;
  const serverNow = now + offset;
  const sorted = [...members].sort((a, b) => {
    if (!!a.running !== !!b.running) return a.running ? -1 : 1;
    if (a.running) return a.running.start - b.running.start;
    return (b.last?.end ?? 0) - (a.last?.end ?? 0);
  });
  const runningCount = members.filter((m) => m.running).length;

  return (
    <div className="card team-now">
      <div className="team-now-head">
        <div className="card-title">Team right now</div>
        <span className={`team-now-count ${runningCount ? 'on' : ''}`}>
          {runningCount ? `${runningCount} tracking` : 'Nobody tracking'}
        </span>
      </div>
      <ul className="team-now-list">
        {sorted.map(({ user: u, running, last }) => (
          <li key={u.id} className={running ? 'is-running' : ''}>
            <div className="team-now-avatar">
              <Avatar name={u.name} size={34} />
              {running && <span className="team-now-live" title="Tracking now" />}
            </div>
            <div className="team-now-body">
              <div className="team-now-name">
                {u.name}
                {u.id === user.id && <span className="muted"> (you)</span>}
              </div>
              {running ? (
                <div className="team-now-line">
                  <span className="team-now-desc">{running.description || '(no description)'}</span>
                  <ProjectTag entry={running} />
                </div>
              ) : last ? (
                <div className="team-now-line muted">
                  <span className="team-now-desc">Last: {last.description || '(no description)'}</span>
                  <ProjectTag entry={last} />
                </div>
              ) : (
                <div className="team-now-line muted">No time tracked yet</div>
              )}
            </div>
            <div className="team-now-time">
              {running ? (
                <b className="team-now-elapsed">{formatDuration(serverNow - running.start)}</b>
              ) : last ? (
                <span className="muted small">{timeAgo(last.end, serverNow)}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
