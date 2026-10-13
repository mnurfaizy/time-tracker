import { useState } from 'react';
import { Modal, Field } from './ui.jsx';
import { ProjectPicker, TagPicker, BillableButton } from './pickers.jsx';
import { useData } from '../store.jsx';
import { api } from '../api.js';
import { formatDuration, toDateInput, fromDateInput, toTimeInput, parseTimeStr, atMinutes, DAY, startOfDay } from '../utils/time.js';

/**
 * Create or edit a time entry in a dialog (Calendar, Detailed report).
 * Pass `entry` to edit, or `draft` ({ start, end, description? }) to create.
 */
export function EntryModal({ entry, draft, userId, onClose, onSaved, onDeleted }) {
  const { toast, user, isAdmin } = useData();
  const init = entry ?? { description: '', projectId: null, taskId: null, tagIds: [], billable: false, ...draft };
  const running = entry && entry.end == null;
  const [description, setDescription] = useState(init.description ?? '');
  const [project, setProject] = useState({ projectId: init.projectId ?? null, taskId: init.taskId ?? null });
  const [tagIds, setTagIds] = useState(init.tagIds ?? []);
  const [billable, setBillable] = useState(!!init.billable);
  const [date, setDate] = useState(toDateInput(init.start));
  const [startStr, setStartStr] = useState(toTimeInput(init.start));
  const [endStr, setEndStr] = useState(toTimeInput(init.end ?? Date.now()));
  const [busy, setBusy] = useState(false);

  const day = fromDateInput(date) ?? startOfDay(init.start).getTime();
  const sMin = parseTimeStr(startStr);
  const eMin = parseTimeStr(endStr);
  const start = sMin != null ? atMinutes(day, sMin) : null;
  let end = eMin != null ? atMinutes(day, eMin) : null;
  if (start != null && end != null && end < start) end += DAY; // ends the next day
  const valid = start != null && (running || end != null);
  const canEdit = !entry || isAdmin || entry.userId === user.id;

  const save = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const body = { description, projectId: project.projectId, taskId: project.taskId, tagIds, billable, start };
    if (!running) body.end = end;
    try {
      const { entry: saved } = entry
        ? await api.put(`/entries/${entry.id}`, body)
        : await api.post('/entries', { ...body, userId: userId ?? user.id });
      onSaved(saved);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this time entry?')) return;
    setBusy(true);
    try {
      await api.del(`/entries/${entry.id}`);
      onDeleted?.(entry);
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={entry ? 'Edit time entry' : 'Add time entry'}
      onClose={onClose}
      width={560}
      footer={
        <>
          {entry && canEdit && (
            <button type="button" className="btn-link danger mr-auto" onClick={remove} disabled={busy}>Delete</button>
          )}
          <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
          {canEdit && (
            <button type="submit" form="entry-form" className="btn btn-primary" disabled={busy || !valid}>
              {entry ? 'Save' : 'Add'}
            </button>
          )}
        </>
      }
    >
      <form id="entry-form" className="entry-form" onSubmit={save}>
        {entry && entry.userId !== user.id && <div className="entry-form-user">Time entry of <b>{entry.userName}</b></div>}
        <input
          className="input"
          autoFocus
          placeholder="What have you worked on?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="entry-form-row">
          <ProjectPicker
            projectId={project.projectId}
            taskId={project.taskId}
            fallback={entry}
            className="bordered"
            onChange={({ projectId, taskId, project: p }) => {
              setProject({ projectId, taskId });
              if (p && projectId !== project.projectId) setBillable(p.billable);
            }}
          />
          <div className="entry-form-icons">
            <TagPicker tagIds={tagIds} onChange={setTagIds} />
            <BillableButton billable={billable} onChange={setBillable} />
          </div>
        </div>
        <div className="entry-form-times">
          <Field label="Start">
            <input type="time" className="input" value={startStr} onChange={(e) => setStartStr(e.target.value)} required />
          </Field>
          <Field label="End">
            {running ? (
              <input className="input" value="Running…" disabled />
            ) : (
              <input type="time" className="input" value={endStr} onChange={(e) => setEndStr(e.target.value)} required />
            )}
          </Field>
          <Field label="Date">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Duration">
            <div className="entry-form-duration">
              {running ? formatDuration(Date.now() - (start ?? init.start)) : valid ? formatDuration(end - start) : '—'}
              {!running && end != null && start != null && startOfDay(end).getTime() !== startOfDay(start).getTime() && (
                <sup className="next-day">+1</sup>
              )}
            </div>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
