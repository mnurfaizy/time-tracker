import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { EntryModal } from '../components/EntryModal.jsx';
import { Checkbox } from '../components/ui.jsx';
import {
  addDays, startOfWeek, startOfDay, formatDuration, fmtTime, fmtRange, WEEKDAYS, HOUR, fromDateInput,
} from '../utils/time.js';

const HOUR_H = 48;
const SNAP = 15 * 60000;

/** Assigns overlapping items to side-by-side columns. */
function layoutDay(items) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [];
  let columns = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    for (const it of cluster) it.cols = columns.length;
    cluster = [];
    columns = [];
  };
  for (const it of sorted) {
    const visualEnd = Math.max(it.e, it.s + 20 * 60000);
    if (it.s >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let col = columns.findIndex((end) => end <= it.s);
    if (col === -1) {
      col = columns.length;
      columns.push(visualEnd);
    } else {
      columns[col] = visualEnd;
    }
    it.col = col;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return sorted;
}

export default function CalendarPage() {
  const { settings, user, isAdmin, users, projectById, toast, googleConfigured } = useData();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), settings.weekStart).getTime());
  const [viewUserId, setViewUserId] = useState(user.id);
  const [entries, setEntries] = useState([]);
  const [events, setEvents] = useState([]);
  const [showEvents, setShowEvents] = useState(() => localStorage.getItem('tt.calEvents') !== 'off');
  const [modal, setModal] = useState(null);
  const [drag, setDrag] = useState(null);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  dragRef.current = drag;

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i).getTime()), [weekStart]);
  const weekEnd = addDays(weekStart, 7).getTime();
  const ownCalendar = viewUserId === user.id;
  const canShowEvents = googleConfigured && user.googleConnected && ownCalendar;

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/entries/range?start=${weekStart}&end=${weekEnd}&userId=${viewUserId}`);
      setEntries(d.entries);
    } catch (err) {
      toast(err.message);
    }
  }, [weekStart, weekEnd, viewUserId, toast]);

  const loadEvents = useCallback(async () => {
    if (!canShowEvents || !showEvents) {
      setEvents([]);
      return;
    }
    try {
      const d = await api.get(`/google/events?start=${weekStart}&end=${weekEnd}`);
      setEvents(d.events);
    } catch (err) {
      setEvents([]);
      toast(`Google Calendar: ${err.message}`);
    }
  }, [canShowEvents, showEvents, weekStart, weekEnd, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H;
  }, []);

  // Per-day positioned items.
  const columns = useMemo(() => {
    return days.map((ds) => {
      const de = addDays(ds, 1).getTime();
      const items = [];
      let total = 0;
      for (const e of entries) {
        const end = e.end ?? now;
        if (e.start >= de || end <= ds) continue;
        const s = Math.max(e.start, ds);
        const en = Math.min(end, de);
        total += en - s;
        items.push({ kind: 'entry', key: `e${e.id}`, s, e: en, entry: e });
      }
      const allDay = [];
      for (const ev of events) {
        if (ev.allDay) {
          const evStart = fromDateInput(ev.start);
          const evEnd = fromDateInput(ev.end);
          if (evStart < de && evEnd > ds) allDay.push(ev);
          continue;
        }
        if (ev.start >= de || ev.end <= ds) continue;
        items.push({ kind: 'event', key: `g${ev.id}`, s: Math.max(ev.start, ds), e: Math.min(ev.end, de), event: ev });
      }
      return { ds, total, allDay, items: layoutDay(items) };
    });
  }, [days, entries, events, now]);

  const weekTotal = columns.reduce((s, c) => s + c.total, 0);

  // ---- drag to create
  const pointerTime = (e, ds) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
    return ds + Math.floor((y / HOUR_H) * HOUR / SNAP) * SNAP;
  };

  const onColumnDown = (e, ds) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const t = pointerTime(e, ds);
    setDrag({ ds, anchor: t, s: t, e: t + SNAP, moved: false, el: e.currentTarget });
  };

  useEffect(() => {
    if (!drag) return undefined;
    const onMove = (e) => {
      const rect = drag.el.getBoundingClientRect();
      const y = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
      const t = drag.ds + Math.round((y / HOUR_H) * HOUR / SNAP) * SNAP;
      setDrag((d) => d && { ...d, moved: true, s: Math.min(d.anchor, t), e: Math.max(d.anchor + SNAP, t) });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (d) setModal({ draft: d.moved && d.e - d.s >= SNAP ? { start: d.s, end: d.e } : { start: d.anchor, end: d.anchor + HOUR } });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag]);

  const toggleEvents = (on) => {
    setShowEvents(on);
    try {
      localStorage.setItem('tt.calEvents', on ? 'on' : 'off');
    } catch {
      // ignore
    }
  };

  const today = startOfDay(new Date()).getTime();

  return (
    <div className="page calendar-page">
      <div className="page-head">
        <h1>Calendar</h1>
        <div className="calendar-toolbar">
          {isAdmin && users.length > 1 && (
            <select className="input select-sm" value={viewUserId} onChange={(e) => setViewUserId(Number(e.target.value))}>
              {users.filter((u) => u.active || u.id === viewUserId).map((u) => (
                <option key={u.id} value={u.id}>{u.id === user.id ? `${u.name} (me)` : u.name}</option>
              ))}
            </select>
          )}
          {canShowEvents ? (
            <Checkbox checked={showEvents} onChange={toggleEvents} label="Google Calendar events" />
          ) : (
            googleConfigured && ownCalendar && (
              <Link to="/profile" className="link-sm"><CalendarDays size={14} /> Connect Google Calendar</Link>
            )
          )}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setWeekStart(startOfWeek(new Date(), settings.weekStart).getTime())}>
            Today
          </button>
          <div className="range-picker">
            <span className="range-picker-btn static"><CalendarDays size={18} /> {fmtRange(weekStart, weekEnd)}</span>
            <button type="button" className="range-arrow" onClick={() => setWeekStart(addDays(weekStart, -7).getTime())} aria-label="Previous week">
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="range-arrow" onClick={() => setWeekStart(addDays(weekStart, 7).getTime())} aria-label="Next week">
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="cal">
        <div className="cal-head">
          <div className="cal-gutter cal-week-total" title="Week total">{formatDuration(weekTotal)}</div>
          {columns.map((c) => {
            const d = new Date(c.ds);
            return (
              <div key={c.ds} className={`cal-day-head ${c.ds === today ? 'today' : ''}`}>
                <div className="cal-day-name">
                  <span className="cal-day-num">{d.getDate()}</span>
                  <span>{WEEKDAYS[d.getDay()]}</span>
                </div>
                <div className="cal-day-total">{formatDuration(c.total)}</div>
                {c.allDay.map((ev) => (
                  <div key={ev.id} className="cal-allday" title={ev.summary}>{ev.summary}</div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="cal-body" ref={scrollRef}>
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour-label" style={{ height: HOUR_H }}>
                {h > 0 && fmtTime(today + h * HOUR, settings.timeFormat)}
              </div>
            ))}
          </div>
          {columns.map((c) => (
            <div
              key={c.ds}
              className={`cal-col ${c.ds === today ? 'today' : ''}`}
              style={{ height: 24 * HOUR_H }}
              onMouseDown={(e) => onColumnDown(e, c.ds)}
            >
              {c.items.map((it) => {
                const top = ((it.s - c.ds) / HOUR) * HOUR_H;
                const height = Math.max(((it.e - it.s) / HOUR) * HOUR_H, 18);
                const style = {
                  top,
                  height,
                  left: `calc(${(it.col / it.cols) * 100}% + 2px)`,
                  width: `calc(${100 / it.cols}% - 4px)`,
                };
                if (it.kind === 'event') {
                  const ev = it.event;
                  return (
                    <button
                      key={it.key}
                      type="button"
                      className="cal-event"
                      style={style}
                      title={`${ev.summary} (${fmtTime(ev.start, settings.timeFormat)} - ${fmtTime(ev.end, settings.timeFormat)})\nClick to add as time entry`}
                      onClick={() => setModal({ draft: { start: ev.start, end: ev.end, description: ev.summary } })}
                    >
                      <span className="cal-event-title"><Plus size={12} /> {ev.summary}</span>
                      {height > 34 && <span className="cal-item-time">{fmtTime(ev.start, settings.timeFormat)} - {fmtTime(ev.end, settings.timeFormat)}</span>}
                    </button>
                  );
                }
                const e = it.entry;
                const p = e.projectId ? projectById.get(e.projectId) : null;
                const color = p?.color ?? e.projectColor ?? '#9E9E9E';
                return (
                  <button
                    key={it.key}
                    type="button"
                    className={`cal-entry ${e.end == null ? 'running' : ''}`}
                    style={{ ...style, '--c': color }}
                    title={`${e.description || '(no description)'}\n${p?.name ?? e.projectName ?? 'No project'}\n${formatDuration((e.end ?? now) - e.start)}`}
                    onClick={() => setModal({ entry: e })}
                  >
                    <span className="cal-entry-desc">{e.description || '(no description)'}</span>
                    {height > 34 && (p || e.projectName) && <span className="cal-entry-project">{p?.name ?? e.projectName}</span>}
                    {height > 52 && (
                      <span className="cal-item-time">
                        {fmtTime(e.start, settings.timeFormat)} - {e.end == null ? 'now' : fmtTime(e.end, settings.timeFormat)}
                      </span>
                    )}
                  </button>
                );
              })}
              {drag && drag.ds === c.ds && (
                <div className="cal-ghost" style={{ top: ((drag.s - c.ds) / HOUR) * HOUR_H, height: ((drag.e - drag.s) / HOUR) * HOUR_H }}>
                  {fmtTime(drag.s, settings.timeFormat)} - {fmtTime(drag.e, settings.timeFormat)}
                </div>
              )}
              {c.ds === today && <div className="cal-now" style={{ top: ((now - c.ds) / HOUR) * HOUR_H }} />}
            </div>
          ))}
        </div>
      </div>

      {modal && (
        <EntryModal
          entry={modal.entry}
          draft={modal.draft}
          userId={viewUserId}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
          onDeleted={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

