import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer, CircleDollarSign, CalendarDays, ChevronLeft, ChevronRight, Check, UserPlus, Copy } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { addDays, startOfDay, startOfWeek, dayKeyLocal, WEEKDAYS, DAY, pad } from '../utils/time.js';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 18900000 -> "5h 15m" */
export function fmtHours(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

function StatCard({ icon: Icon, title, value, badge, badgeTone = 'success', note }) {
  return (
    <div className="stat-card">
      <div className="stat-card-head">
        <span className="stat-card-icon"><Icon size={16} /></span>
        <span className="stat-card-title">{title}</span>
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-foot">
        {badge != null && <span className={`badge badge-${badgeTone}`}>{badge}</span>}
        {note && <span className="stat-card-note">{note}</span>}
      </div>
    </div>
  );
}

/** Stats, month timesheet and (for admins) an invite card, shown above the entry list. */
export function TrackerOverview({ entriesVersion, running }) {
  const { settings, isAdmin, toast } = useData();
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const [data, setData] = useState([]);
  const [now, setNow] = useState(Date.now());

  const today = startOfDay(new Date()).getTime();
  const weekStart = startOfWeek(today, settings.weekStart).getTime();
  const weekEnd = addDays(weekStart, 7).getTime();
  const lastWeekStart = addDays(weekStart, -7).getTime();
  const gridStart = startOfWeek(month, settings.weekStart).getTime();
  const monthEnd = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 1).getTime();
  const gridEnd = addDays(startOfWeek(monthEnd - 1, settings.weekStart), 7).getTime();
  const fetchStart = Math.min(gridStart, lastWeekStart);
  const fetchEnd = Math.max(gridEnd, weekEnd);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Refetch (debounced) whenever the entry list or the running timer changes.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .get(`/entries/range?start=${fetchStart}&end=${fetchEnd}`)
        .then((d) => !cancelled && setData(d.entries))
        .catch((err) => !cancelled && toast(err.message));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fetchStart, fetchEnd, entriesVersion, running?.id, toast]);

  const stats = useMemo(() => {
    const byDay = new Map();
    let todayMs = 0;
    let todayCount = 0;
    let week = 0;
    let lastWeek = 0;
    let billableWeek = 0;
    for (const e of data) {
      const dur = Math.max(0, (e.end ?? now) - e.start);
      const key = dayKeyLocal(e.start);
      byDay.set(key, (byDay.get(key) ?? 0) + dur);
      if (e.start >= today && e.start < today + DAY) {
        todayMs += dur;
        todayCount++;
      }
      if (e.start >= weekStart && e.start < weekEnd) {
        week += dur;
        if (e.billable) billableWeek += dur;
      }
      if (e.start >= lastWeekStart && e.start < weekStart) lastWeek += dur;
    }
    const delta = lastWeek > 0 ? Math.round(((week - lastWeek) / lastWeek) * 100) : null;
    return { byDay, todayMs, todayCount, week, lastWeek, billableWeek, delta };
  }, [data, now, today, weekStart, weekEnd, lastWeekStart]);

  const weeks = useMemo(() => {
    const rows = [];
    for (let w = gridStart; w < gridEnd; w = addDays(w, 7).getTime()) {
      rows.push(Array.from({ length: 7 }, (_, i) => addDays(w, i).getTime()));
    }
    return rows;
  }, [gridStart, gridEnd]);

  const shiftMonth = (dir) => {
    const d = new Date(month);
    setMonth(new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime());
  };

  const signupLink = `${window.location.origin}/signup`;
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(signupLink);
      toast('Sign-up link copied', 'success');
    } catch {
      toast(signupLink, 'success');
    }
  };

  const monthDate = new Date(month);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(settings.weekStart + i) % 7]);

  return (
    <>
      <div className="stat-row">
        <StatCard
          icon={Timer}
          title="Tracked today"
          value={fmtHours(stats.todayMs)}
          badge={`${stats.todayCount} ${stats.todayCount === 1 ? 'entry' : 'entries'}`}
          badgeTone="neutral"
          note={running ? 'timer running' : 'so far today'}
        />
        <StatCard
          icon={CalendarDays}
          title="Tracked this week"
          value={fmtHours(stats.week)}
          badge={stats.delta == null ? null : `${stats.delta >= 0 ? '+' : ''}${stats.delta}%`}
          badgeTone={stats.delta != null && stats.delta < 0 ? 'warning' : 'success'}
          note={stats.delta == null ? 'no time last week' : 'vs last week'}
        />
        <StatCard
          icon={CircleDollarSign}
          title="Billable this week"
          value={fmtHours(stats.billableWeek)}
          badge={stats.week ? `${Math.round((stats.billableWeek / stats.week) * 100)}%` : null}
          note={stats.week ? 'of tracked time' : 'nothing tracked yet'}
        />
      </div>

      <div className={`overview-body ${isAdmin ? 'with-aside' : ''}`}>
        <section className="timesheet">
          <div className="section-head">
            <h2 className="section-head-title">Timesheet</h2>
            <div className="pager">
              <button type="button" className="pager-btn" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <span className="pager-label">{MONTHS_LONG[monthDate.getMonth()]} {monthDate.getFullYear()}</span>
              <button type="button" className="pager-btn" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
          </div>
          <div className="timesheet-card">
            <div className="timesheet-row timesheet-weekdays">
              {weekdayLabels.map((d) => <div key={d}>{d}</div>)}
            </div>
            {weeks.map((row) => (
              <div key={row[0]} className="timesheet-row">
                {row.map((day) => {
                  const date = new Date(day);
                  const ms = stats.byDay.get(dayKeyLocal(day)) ?? 0;
                  const outside = date.getMonth() !== monthDate.getMonth();
                  const isToday = day === today;
                  const weekend = date.getDay() === 0 || date.getDay() === 6;
                  let state = 'future';
                  let label = '';
                  if (outside) state = 'outside';
                  else if (isToday) {
                    state = 'today';
                    label = ms ? fmtHours(ms) : running ? 'Tracking' : 'Today';
                  } else if (ms) {
                    state = 'logged';
                    label = fmtHours(ms);
                  } else if (weekend) {
                    state = 'off';
                    label = '—';
                  } else if (day < today) {
                    state = 'missing';
                    label = 'Log time';
                  }
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`day-cell ${state}`}
                      onClick={() => navigate(`/calendar?date=${dayKeyLocal(day)}`)}
                      title={`${date.toDateString()}${ms ? ` · ${fmtHours(ms)}` : ''}`}
                    >
                      {(state === 'logged' || (state === 'today' && ms > 0)) && <Check size={11} strokeWidth={3} className="day-cell-check" />}
                      <span className="day-cell-num">{date.getDate()}</span>
                      <span className="day-cell-hours">{label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        {isAdmin && (
          <aside className="overview-aside">
            <div className="promo-card blue">
              <UserPlus size={20} className="promo-icon" />
              <div>
                <div className="promo-title">Invite your team</div>
                <div className="promo-desc">
                  {settings.allowSignup
                    ? 'Share the sign-up link. New people appear under Members for your approval.'
                    : 'Add people from Members, or turn on sign-up in Settings to share a link.'}
                </div>
              </div>
              {settings.allowSignup ? (
                <button type="button" className="promo-cta light" onClick={copyInvite}>
                  <Copy size={14} /> <span className="truncate">{signupLink.replace(/^https?:\/\//, '')}</span>
                </button>
              ) : (
                <button type="button" className="promo-cta light" onClick={() => navigate('/team')}>
                  <UserPlus size={14} /> Add member
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
