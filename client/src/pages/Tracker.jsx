import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, List, Play, X, Square, Plus, Coffee, Timer } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { ProjectPicker, TagPicker, BillableButton } from '../components/pickers.jsx';
import { TimeInput, DurationInput, DateButton } from '../components/inputs.jsx';
import { KebabMenu, Popover, Spinner } from '../components/ui.jsx';
import { EntryModal } from '../components/EntryModal.jsx';
import { TrackerOverview, fmtHours } from '../components/TrackerOverview.jsx';
import {
  formatDuration, fmtDayLabel, fmtDate, fmtTime, startOfDay, startOfWeek, addDays, atMinutes, moveToDay, DAY,
} from '../utils/time.js';

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const emptyDraft = { description: '', projectId: null, taskId: null, tagIds: [], billable: false };

const sortEntries = (list) => [...list].sort((a, b) => b.start - a.start || b.id - a.id);
const upsert = (list, e) => sortEntries([...list.filter((x) => x.id !== e.id), e]);

function storedMode() {
  try {
    return localStorage.getItem('tt.mode') === 'manual' ? 'manual' : 'timer';
  } catch {
    return 'timer';
  }
}

export default function Tracker() {
  const { toast, settings } = useData();
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [running, setRunning] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [list, run] = await Promise.all([api.get('/entries?limit=100'), api.get('/entries/running')]);
      setEntries(list.entries);
      setHasMore(list.hasMore);
      setRunning(run.entry);
    } catch (err) {
      toast(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const last = entries[entries.length - 1];
      const d = await api.get(`/entries?limit=100&before=${last.start}`);
      setEntries((list) => sortEntries([...list, ...d.entries.filter((e) => !list.some((x) => x.id === e.id))]));
      setHasMore(d.hasMore);
    } catch (err) {
      toast(err.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const start = async (fields) => {
    try {
      const d = await api.post('/entries/start', fields);
      setRunning(d.entry);
      if (d.stopped) setEntries((list) => upsert(list, d.stopped));
    } catch (err) {
      toast(err.message);
    }
  };

  const stop = async () => {
    const prev = running;
    setRunning(null);
    try {
      const d = await api.post('/entries/stop');
      if (d.entry) setEntries((list) => upsert(list, d.entry));
    } catch (err) {
      setRunning(prev);
      toast(err.message);
    }
  };

  const updateRunning = async (patch) => {
    if (!running) return;
    const prev = running;
    setRunning({ ...running, ...patch });
    try {
      const d = await api.put(`/entries/${running.id}`, patch);
      setRunning((r) => (r && r.id === d.entry.id ? d.entry : r));
    } catch (err) {
      setRunning(prev);
      toast(err.message);
    }
  };

  const discardRunning = async () => {
    if (!running || !window.confirm('Discard the running timer? This time entry will be deleted.')) return;
    const prev = running;
    setRunning(null);
    try {
      await api.del(`/entries/${prev.id}`);
    } catch (err) {
      setRunning(prev);
      toast(err.message);
    }
  };

  const addManual = async (fields) => {
    try {
      const d = await api.post('/entries', fields);
      setEntries((list) => upsert(list, d.entry));
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  };

  const updateEntry = async (entry, patch) => {
    setEntries((list) => upsert(list, { ...entry, ...patch }));
    try {
      const d = await api.put(`/entries/${entry.id}`, patch);
      setEntries((list) => upsert(list, d.entry));
    } catch (err) {
      setEntries((list) => upsert(list, entry));
      toast(err.message);
    }
  };

  const deleteEntries = async (targets) => {
    const ids = new Set(targets.map((t) => t.id));
    setEntries((list) => list.filter((x) => !ids.has(x.id)));
    const failed = [];
    await Promise.all(targets.map((t) => api.del(`/entries/${t.id}`).catch(() => failed.push(t))));
    if (failed.length) {
      setEntries((list) => sortEntries([...list, ...failed]));
      toast('Some time entries could not be deleted');
    }
  };

  const duplicate = (e) =>
    addManual({ description: e.description, projectId: e.projectId, taskId: e.taskId, tagIds: e.tagIds, billable: e.billable, start: e.start, end: e.end });

  const continueEntry = (e) =>
    start({ description: e.description, projectId: e.projectId, taskId: e.taskId, tagIds: e.tagIds, billable: e.billable });

  const weeks = useMemo(() => groupIntoWeeks(entries, settings.weekStart), [entries, settings.weekStart]);
  const actions = { updateEntry, deleteEntries, duplicate, continueEntry };
  const [newEntry, setNewEntry] = useState(null);
  const todayDate = new Date();

  return (
    <div className="page tracker-page">
      <div className="page-head">
        <div className="page-title-group">
          <h1>Time Tracker</h1>
          <div className="page-subtitle">{WEEKDAYS_LONG[todayDate.getDay()]}, {MONTHS_LONG[todayDate.getMonth()]} {todayDate.getDate()}</div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            const end = Date.now();
            setNewEntry({ start: end - 3600000, end });
          }}
        >
          <Plus size={16} /> New Entry
        </button>
      </div>
      <TimerBar
        running={running}
        onStart={start}
        onStop={stop}
        onUpdateRunning={updateRunning}
        onDiscard={discardRunning}
        onAddManual={addManual}
      />
      {!loading && <TrackerOverview entriesVersion={entries} running={running} />}
      {loading ? (
        <div className="center-pad"><Spinner /></div>
      ) : weeks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><Coffee size={20} /></span>
          <div className="empty-state-title">No time tracked yet</div>
          <div className="empty-state-desc">Type what you are working on above and hit play to start your first timer.</div>
          <button type="button" className="btn btn-primary" onClick={() => document.querySelector('.timer-desc')?.focus()}>
            <Play size={16} /> Start timer
          </button>
        </div>
      ) : (
        weeks.map((w) => <WeekGroup key={w.start} week={w} actions={actions} timeFormat={settings.timeFormat} />)
      )}
      {hasMore && !loading && (
        <div className="load-more">
          <button type="button" className="btn btn-outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      {newEntry && (
        <EntryModal
          draft={newEntry}
          onClose={() => setNewEntry(null)}
          onSaved={(e) => {
            setNewEntry(null);
            setEntries((list) => upsert(list, e));
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Timer bar

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function TimerBar({ running, onStart, onStop, onUpdateRunning, onDiscard, onAddManual }) {
  const { settings, projectById } = useData();
  const [mode, setMode] = useState(storedMode);
  const [draft, setDraft] = useState(emptyDraft);
  const [desc, setDesc] = useState('');
  const [manual, setManual] = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return { start: now.getTime(), end: now.getTime() };
  });
  const [busy, setBusy] = useState(false);
  const now = useNow(!!running);
  const effectiveMode = running ? 'timer' : mode;
  const current = running ?? draft;

  useEffect(() => {
    setDesc(current.description ?? '');
  }, [running?.id, current.description]);

  useEffect(() => {
    if (!running) return undefined;
    const title = document.title;
    document.title = `${formatDuration(now - running.start)} · ${running.description || 'Time Tracker'}`;
    return () => {
      document.title = title;
    };
  }, [running, now]);

  const setFields = (patch) => (running ? onUpdateRunning(patch) : setDraft((d) => ({ ...d, ...patch })));

  const commitDesc = () => {
    if (desc !== (current.description ?? '')) setFields({ description: desc });
  };

  const switchMode = (m) => {
    setMode(m);
    try {
      localStorage.setItem('tt.mode', m);
    } catch {
      // ignore
    }
  };

  const startTimer = async () => {
    setBusy(true);
    await onStart({ ...draft, description: desc });
    setDraft(emptyDraft);
    setBusy(false);
  };

  const add = async () => {
    setBusy(true);
    const ok = await onAddManual({ ...draft, description: desc, start: manual.start, end: manual.end });
    if (ok) {
      setDraft(emptyDraft);
      setDesc('');
      setManual((m) => ({ start: m.end, end: m.end }));
    }
    setBusy(false);
  };

  const applySuggestion = (s) => {
    setDesc(s.description);
    const p = s.projectId ? projectById.get(s.projectId) : null;
    setFields({
      description: s.description,
      projectId: p ? s.projectId : null,
      taskId: p ? s.taskId : null,
      tagIds: s.tagIds,
      billable: s.billable,
    });
  };

  return (
    <div className={`timer-bar ${running ? 'is-running' : ''}`}>
      <DescriptionInput
        value={desc}
        onChange={setDesc}
        onCommit={commitDesc}
        onEnter={() => {
          if (!running && effectiveMode === 'timer') startTimer();
          else commitDesc();
        }}
        onSuggestion={applySuggestion}
      />
      <div className="timer-bar-tools">
        <ProjectPicker
          projectId={current.projectId}
          taskId={current.taskId}
          fallback={running}
          onChange={({ projectId, taskId, project }) => {
            const patch = { projectId, taskId };
            if (project && projectId !== current.projectId) patch.billable = project.billable;
            setFields(patch);
          }}
        />
        <span className="vsep" />
        <TagPicker tagIds={current.tagIds ?? []} onChange={(tagIds) => setFields({ tagIds })} showNames={false} />
        <BillableButton billable={!!current.billable} onChange={(billable) => setFields({ billable })} />
        <span className="vsep" />
        {effectiveMode === 'timer' ? (
          <>
            {running ? (
              <RunningClock running={running} now={now} onChangeStart={(s) => onUpdateRunning({ start: s })} timeFormat={settings.timeFormat} />
            ) : (
              <span className="timer-display">0:00:00</span>
            )}
            {running ? (
              <button type="button" className="play-btn stop" onClick={onStop} title="Stop timer" aria-label="Stop timer">
                <Square size={18} />
              </button>
            ) : (
              <button type="button" className="play-btn" onClick={startTimer} disabled={busy} title="Start timer" aria-label="Start timer">
                <Play size={20} />
              </button>
            )}
          </>
        ) : (
          <>
            <ManualTimes value={manual} onChange={setManual} timeFormat={settings.timeFormat} />
            <button type="button" className="btn btn-primary" onClick={add} disabled={busy}><Plus size={16} /> Add</button>
          </>
        )}
        <div className="mode-switch">
          {running ? (
            <button type="button" className="icon-btn" onClick={onDiscard} title="Discard timer"><X size={18} /></button>
          ) : (
            <>
              <button type="button" className={`icon-btn ${mode === 'timer' ? 'on' : ''}`} onClick={() => switchMode('timer')} title="Timer mode">
                <Clock size={16} />
              </button>
              <button type="button" className={`icon-btn ${mode === 'manual' ? 'on' : ''}`} onClick={() => switchMode('manual')} title="Manual mode">
                <List size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DescriptionInput({ value, onChange, onCommit, onEnter, onSuggestion }) {
  const { projectById } = useData();
  const ref = useRef(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);

  useEffect(() => {
    if (!focused) return undefined;
    const t = setTimeout(() => {
      api.get(`/entries/suggestions?q=${encodeURIComponent(value)}`)
        .then((d) => {
          setSuggestions(d.suggestions.filter((s) => s.description !== value || s.projectId));
          setHighlight(-1);
        })
        .catch(() => setSuggestions([]));
    }, 150);
    return () => clearTimeout(t);
  }, [value, focused]);

  const pick = (s) => {
    onSuggestion(s);
    setFocused(false);
  };

  return (
    <>
      <input
        ref={ref}
        className="timer-desc"
        placeholder="What are you working on?"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setTimeout(() => setFocused(false), 150);
          onCommit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length) {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp' && suggestions.length) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, -1));
          } else if (e.key === 'Enter') {
            if (highlight >= 0 && suggestions[highlight]) pick(suggestions[highlight]);
            else {
              setFocused(false);
              onEnter();
            }
          } else if (e.key === 'Escape') {
            setFocused(false);
          }
        }}
      />
      <Popover anchorRef={ref} open={focused && suggestions.length > 0} onClose={() => setFocused(false)} width={ref.current?.offsetWidth} className="picker suggestions">
        <div className="picker-group">Recent activities</div>
        {suggestions.map((s, i) => {
          const p = s.projectId ? projectById.get(s.projectId) : null;
          const t = p && s.taskId ? p.tasks.find((x) => x.id === s.taskId) : null;
          return (
            <button
              key={`${s.description}-${s.projectId}-${s.taskId}`}
              type="button"
              className={`picker-item suggestion ${i === highlight ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
            >
              <span className="truncate">{s.description}</span>
              {p && (
                <span className="suggestion-project" style={{ color: p.color }}>
                  <span className="dot" style={{ background: p.color }} /> {p.name}{t ? `: ${t.name}` : ''}
                </span>
              )}
            </button>
          );
        })}
      </Popover>
    </>
  );
}

function RunningClock({ running, now, onChangeStart, timeFormat }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className="timer-display clickable" onClick={() => setOpen((o) => !o)} title="Edit start time">
        {formatDuration(now - running.start)}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="right" className="start-pop">
        <div className="start-pop-row">
          <span>Start</span>
          <TimeInput
            value={running.start}
            timeFormat={timeFormat}
            onCommit={(min) => {
              let s = atMinutes(running.start, min);
              if (s > Date.now()) s -= DAY;
              onChangeStart(s);
            }}
          />
          <DateButton value={running.start} onChange={(day) => onChangeStart(Math.min(moveToDay(running.start, day), Date.now()))} />
        </div>
      </Popover>
    </>
  );
}

function ManualTimes({ value, onChange, timeFormat }) {
  const { start, end } = value;
  return (
    <div className="manual-times">
      <TimeInput
        value={start}
        timeFormat={timeFormat}
        onCommit={(min) => {
          const s = atMinutes(start, min);
          onChange({ start: s, end: end < s ? end + DAY * Math.ceil((s - end) / DAY) : end });
        }}
      />
      <span className="dash">-</span>
      <TimeInput
        value={end}
        timeFormat={timeFormat}
        onCommit={(min) => {
          let e = atMinutes(start, min);
          if (e < start) e += DAY;
          onChange({ start, end: e });
        }}
      />
      {startOfDay(end).getTime() !== startOfDay(start).getTime() && <sup className="next-day">+1</sup>}
      <DateButton value={start} onChange={(day) => onChange({ start: moveToDay(start, day), end: moveToDay(start, day) + (end - start) })} />
      <DurationInput value={end - start} onCommit={(d) => onChange({ start, end: start + d })} className="manual-duration" />
    </div>
  );
}

// ---------------------------------------------------------------- Entry list

function groupIntoWeeks(entries, weekStart) {
  const weeks = [];
  let week = null;
  let day = null;
  for (const e of entries) {
    const ws = startOfWeek(e.start, weekStart).getTime();
    const ds = startOfDay(e.start).getTime();
    if (!week || week.start !== ws) {
      week = { start: ws, days: [], total: 0 };
      weeks.push(week);
      day = null;
    }
    if (!day || day.start !== ds) {
      day = { start: ds, entries: [], total: 0 };
      week.days.push(day);
    }
    const dur = e.end - e.start;
    day.entries.push(e);
    day.total += dur;
    week.total += dur;
  }
  return weeks;
}

/** Bundles identical activities of a day (same description, project, task, tags, billable). */
function groupSimilar(entries) {
  const map = new Map();
  const out = [];
  for (const e of entries) {
    const key = [e.description, e.projectId, e.taskId, e.billable, [...e.tagIds].sort((a, b) => a - b).join('.')].join('|');
    let g = map.get(key);
    if (!g) {
      g = { key, entries: [] };
      map.set(key, g);
      out.push(g);
    }
    g.entries.push(e);
  }
  return out;
}

function weekLabel(start, weekStart) {
  const thisWeek = startOfWeek(new Date(), weekStart).getTime();
  if (start === thisWeek) return 'This week';
  if (start === addDays(thisWeek, -7).getTime()) return 'Last week';
  return `${fmtDate(start)} - ${fmtDate(addDays(start, 6).getTime(), { year: 'auto' })}`;
}

function WeekGroup({ week, actions, timeFormat }) {
  const { settings } = useData();
  return (
    <section className="week">
      <div className="week-header">
        <span className="week-title">{weekLabel(week.start, settings.weekStart)}</span>
        <span className="week-total">Week total <b>{formatDuration(week.total)}</b></span>
      </div>
      {week.days.map((d) => (
        <div key={d.start} className="day-group">
          <div className="day-header">
            <h3 className="day-title">{fmtDayLabel(d.start)}</h3>
            <span className="badge badge-solid"><Timer size={12} /> {fmtHours(d.total)}</span>
          </div>
          <div className="day-card">
            {groupSimilar(d.entries).map((g) => (
              <EntryGroup key={g.key + g.entries[0].id} group={g} actions={actions} timeFormat={timeFormat} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function EntryGroup({ group, actions, timeFormat }) {
  const [expanded, setExpanded] = useState(false);
  if (group.entries.length === 1) return <EntryRow entry={group.entries[0]} actions={actions} timeFormat={timeFormat} />;
  const list = group.entries;
  const first = list[0];
  const combined = {
    ...first,
    start: Math.min(...list.map((e) => e.start)),
    end: Math.max(...list.map((e) => e.end)),
    duration: list.reduce((s, e) => s + (e.end - e.start), 0),
  };
  const groupActions = {
    ...actions,
    updateEntry: (_, patch) => list.forEach((e) => actions.updateEntry(e, patch)),
  };
  return (
    <>
      <EntryRow
        entry={combined}
        actions={groupActions}
        timeFormat={timeFormat}
        group={{ count: list.length, expanded, toggle: () => setExpanded((x) => !x), entries: list }}
      />
      {expanded && list.map((e) => <EntryRow key={e.id} entry={e} actions={actions} timeFormat={timeFormat} child />)}
    </>
  );
}

function EntryRow({ entry, actions, timeFormat, group, child }) {
  const [desc, setDesc] = useState(entry.description);
  useEffect(() => setDesc(entry.description), [entry.description]);
  const duration = group ? entry.duration : entry.end - entry.start;
  const update = (patch) => actions.updateEntry(entry, patch);
  const crossesDay = startOfDay(entry.end).getTime() !== startOfDay(entry.start).getTime();

  return (
    <div className={`entry-row ${child ? 'child' : ''} ${group ? 'grouped' : ''}`}>
      <div className="entry-info">
        <div className="entry-desc-row">
          {group && (
            <button type="button" className={`group-count ${group.expanded ? 'on' : ''}`} onClick={group.toggle} title="Show grouped entries">
              {group.count}
            </button>
          )}
          <input
            className="entry-desc"
            placeholder="Add description"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => desc !== entry.description && update({ description: desc })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
        <div className="entry-meta">
          <ProjectPicker
            projectId={entry.projectId}
            taskId={entry.taskId}
            fallback={entry}
            onChange={({ projectId, taskId, project }) => {
              const patch = { projectId, taskId };
              if (project && projectId !== entry.projectId) patch.billable = project.billable;
              update(patch);
            }}
          />
          <BillableButton variant="badge" billable={entry.billable} onChange={(billable) => update({ billable })} />
          <TagPicker tagIds={entry.tagIds} onChange={(tagIds) => update({ tagIds })} />
        </div>
      </div>
      <div className="entry-tools">
        {group ? (
          <span className="time-range static">
            {fmtTime(entry.start, timeFormat)} – {fmtTime(entry.end, timeFormat)}
          </span>
        ) : (
          <span className="time-range">
            <TimeInput
              value={entry.start}
              timeFormat={timeFormat}
              onCommit={(min) => {
                const st = atMinutes(entry.start, min);
                let en = entry.end;
                if (en < st) en += DAY * Math.ceil((st - en) / DAY);
                update({ start: st, end: en });
              }}
            />
            <span className="dash">–</span>
            <TimeInput
              value={entry.end}
              timeFormat={timeFormat}
              onCommit={(min) => {
                let en = atMinutes(entry.start, min);
                if (en < entry.start) en += DAY;
                update({ end: en });
              }}
            />
            {crossesDay && <sup className="next-day">+1</sup>}
          </span>
        )}
        {!group && (
          <DateButton
            value={entry.start}
            onChange={(day) => {
              const st = moveToDay(entry.start, day);
              update({ start: st, end: st + (entry.end - entry.start) });
            }}
          />
        )}
        {group ? (
          <span className="duration-input static">{formatDuration(duration)}</span>
        ) : (
          <DurationInput value={duration} onCommit={(d) => update({ end: entry.start + d })} />
        )}
        <button type="button" className="icon-btn play" onClick={() => actions.continueEntry(entry)} title="Continue this activity">
          <Play size={16} />
        </button>
        <KebabMenu
          items={
            group
              ? [{ label: `Delete all (${group.count})`, danger: true, onClick: () => window.confirm(`Delete ${group.count} time entries?`) && actions.deleteEntries(group.entries) }]
              : [
                  { label: 'Duplicate', onClick: () => actions.duplicate(entry) },
                  { label: 'Delete', danger: true, onClick: () => actions.deleteEntries([entry]) },
                ]
          }
        />
      </div>
    </div>
  );
}
