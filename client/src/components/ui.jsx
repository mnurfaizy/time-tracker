import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, EllipsisVertical, Check } from 'lucide-react';

/** Floating panel anchored to an element, rendered in a portal so it never gets clipped. */
export function Popover({ anchorRef, open, onClose, children, align = 'left', width, className = '' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
      top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
      let left = align === 'right' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      setPos({ top, left });
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  // The popover mounts hidden while it is positioned, which makes the browser ignore autoFocus.
  // Once it is visible, put the cursor in its search field ([data-autofocus]) so the user can type right away.
  const visible = !!pos;
  useEffect(() => {
    if (!visible || ref.current?.contains(document.activeElement)) return;
    ref.current?.querySelector('[data-autofocus]')?.focus();
  }, [visible]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className}`}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, width, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function useToggle(initial = false) {
  const [open, setOpen] = useState(initial);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return [open, setOpen, toggle, close];
}

export function Modal({ title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Confirm({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      footer={
        <>
          <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-text">{message}</p>
    </Modal>
  );
}

/** Kebab (⋮) menu. items: [{ label, onClick, danger, hidden }] */
export function KebabMenu({ items, label = 'More actions' }) {
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return <span className="kebab-placeholder" />;
  return (
    <>
      <button ref={ref} type="button" className="icon-btn kebab" onClick={toggle} aria-label={label}>
        <EllipsisVertical size={18} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} align="right" className="menu">
        {visible.map((item) => (
          <button
            key={item.label}
            type="button"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            onClick={() => {
              close();
              item.onClick();
            }}
          >
            {item.label}
          </button>
        ))}
      </Popover>
    </>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate = false, disabled }) {
  return (
    <label className={`checkbox ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`checkbox-box ${checked ? 'on' : ''} ${indeterminate && !checked ? 'partial' : ''}`}>
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      {label != null && <span className="checkbox-label">{label}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export const PROJECT_COLORS = [
  '#3E8E5E', '#4F68D8', '#E0A23A', '#E06A5A', '#8C63D2', '#2A9D8F', '#D4618C', '#7E9A3C',
  '#C2861A', '#5B7FD6', '#B5563B', '#3B7A8C', '#9C6B3F', '#6D7A70', '#A8486A', '#4E9F6E', '#7A5CC0',
];

export function ColorPicker({ value, onChange }) {
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  return (
    <>
      <button ref={ref} type="button" className="color-btn" onClick={toggle} aria-label="Project color">
        <span className="color-dot lg" style={{ background: value }} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} className="color-pop">
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${c === value ? 'on' : ''}`}
            style={{ background: c }}
            onClick={() => {
              onChange(c);
              close();
            }}
            aria-label={c}
          />
        ))}
      </Popover>
    </>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
