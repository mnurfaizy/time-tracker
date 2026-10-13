import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Popover, useToggle } from './ui.jsx';
import { PRESETS, presetRange, rangeLabel, shiftRange, toDateInput, fromDateInput, addDays, startOfWeek } from '../utils/time.js';

/** Clockify-style range picker: presets + custom dates, with previous/next arrows. */
export function DateRangePicker({ value, onChange, weekStart, weekOnly = false }) {
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const presets = weekOnly ? PRESETS.filter(([k]) => k === 'thisWeek' || k === 'lastWeek') : PRESETS;

  const apply = () => {
    const s = fromDateInput(from);
    const e = weekOnly ? s : fromDateInput(to);
    if (s == null || e == null) return;
    const [a, b] = s <= e ? [s, e] : [e, s];
    if (weekOnly) {
      const ws = startOfWeek(a, weekStart).getTime();
      onChange({ start: ws, end: addDays(ws, 7).getTime() });
    } else {
      onChange({ start: a, end: addDays(b, 1).getTime() });
    }
    close();
  };

  return (
    <div className="range-picker">
      <button
        ref={ref}
        type="button"
        className="range-picker-btn"
        onClick={() => {
          setFrom(toDateInput(value.start));
          setTo(toDateInput(value.end - 1));
          toggle();
        }}
      >
        <CalendarDays size={18} />
        <span>{rangeLabel(value)}</span>
      </button>
      <button type="button" className="range-arrow" onClick={() => onChange(shiftRange(value, -1))} aria-label="Previous period">
        <ChevronLeft size={18} />
      </button>
      <button type="button" className="range-arrow" onClick={() => onChange(shiftRange(value, 1))} aria-label="Next period">
        <ChevronRight size={18} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} align="right" className="range-pop">
        <div className="range-presets">
          {presets.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={value.preset === k ? 'selected' : ''}
              onClick={() => {
                onChange(presetRange(k, weekStart));
                close();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="range-custom">
          <div className="range-custom-title">{weekOnly ? 'Pick any day of the week' : 'Custom range'}</div>
          <label>
            <span>{weekOnly ? 'Day' : 'Start date'}</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          {!weekOnly && (
            <label>
              <span>End date</span>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </Popover>
    </div>
  );
}
