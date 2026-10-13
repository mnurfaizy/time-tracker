import { useEffect, useMemo, useState } from 'react';
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
  const [scope, setScope] = useState(isAdmin ? 'team' : 'me');
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    const query = qs({ start: range.start, end: range.end, users: scope === 'me' ? user.id : undefined, tz: TZ });
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
          {isAdmin && (
            <div className="segmented">
              <button type="button" className={scope === 'me' ? 'on' : ''} onClick={() => setScope('me')}>Only me</button>
              <button type="button" className={scope === 'team' ? 'on' : ''} onClick={() => setScope('team')}>Team</button>
            </div>
          )}
          <DateRangePicker value={range} onChange={setRange} weekStart={settings.weekStart} />
        </div>
      </div>

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
            {scope === 'team' && isAdmin && (
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
