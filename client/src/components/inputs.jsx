import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { fmtTime, parseTimeStr, parseDurationStr, formatDuration, toDateInput, fromDateInput } from '../utils/time.js';

/** Text input that shows a formatted value and commits a parsed value on blur/Enter. */
function CommitInput({ display, parse, onCommit, className, disabled, title }) {
  const [text, setText] = useState(display);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(display);
  }, [display, editing]);
  const commit = () => {
    setEditing(false);
    if (text === display) return;
    const v = parse(text);
    if (v == null) setText(display);
    else onCommit(v);
  };
  return (
    <input
      className={className}
      value={text}
      disabled={disabled}
      title={title}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(display);
          setEditing(false);
          requestAnimationFrame(() => e.target.blur());
        }
      }}
    />
  );
}

/** Commits minutes since midnight. */
export function TimeInput({ value, timeFormat, onCommit, disabled }) {
  return (
    <CommitInput className="time-input" display={fmtTime(value, timeFormat)} parse={parseTimeStr} onCommit={onCommit} disabled={disabled} />
  );
}

export function DurationInput({ value, onCommit, disabled, className = '' }) {
  return (
    <CommitInput
      className={`duration-input ${className}`}
      display={formatDuration(value)}
      parse={parseDurationStr}
      onCommit={onCommit}
      disabled={disabled}
      title="Duration (e.g. 1:30, 1.5, 90m)"
    />
  );
}

/** Calendar icon that opens the native date picker; commits local midnight ms. */
export function DateButton({ value, onChange, disabled }) {
  const ref = useRef(null);
  return (
    <span className="date-btn">
      <button
        type="button"
        className="icon-btn"
        disabled={disabled}
        title="Change date"
        onClick={() => {
          try {
            ref.current.showPicker();
          } catch {
            ref.current.focus();
          }
        }}
      >
        <CalendarDays size={18} />
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        className="date-btn-native"
        value={toDateInput(value)}
        onChange={(e) => {
          const ms = fromDateInput(e.target.value);
          if (ms != null) onChange(ms);
        }}
      />
    </span>
  );
}
