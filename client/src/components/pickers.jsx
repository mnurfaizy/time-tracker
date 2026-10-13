import { useMemo, useRef, useState } from 'react';
import { CirclePlus, Search, Tag, CircleDollarSign, ChevronDown, ChevronUp } from 'lucide-react';
import { Popover, useToggle, Modal, Checkbox, ColorPicker, Field, PROJECT_COLORS } from './ui.jsx';
import { useData } from '../store.jsx';
import { api } from '../api.js';

const norm = (s) => String(s ?? '').toLowerCase();

/** Project label: "● Project: Task - Client" */
export function ProjectLabel({ project, task, clientName, fallback }) {
  const name = project?.name ?? fallback?.projectName;
  if (!name) return null;
  const color = project?.color ?? fallback?.projectColor ?? '#999';
  const client = clientName ?? fallback?.clientName;
  const taskName = task?.name ?? fallback?.taskName;
  return (
    <span className="project-label">
      <span className="dot" style={{ background: color }} />
      <span className="project-label-text">
        {name}
        {taskName && `: ${taskName}`}
        {client && <span className="project-label-client"> - {client}</span>}
      </span>
    </span>
  );
}

export function ProjectPicker({ projectId, taskId, onChange, fallback, emptyLabel = 'Project', className = '' }) {
  const { projects, projectById, clientById, canCreate } = useData();
  const ref = useRef(null);
  const [open, setOpen, toggle, close] = useToggle();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [creating, setCreating] = useState(false);

  const project = projectId ? projectById.get(projectId) : null;
  const task = project && taskId ? project.tasks.find((t) => t.id === taskId) : null;
  const hasValue = !!(project || (projectId && fallback?.projectName));

  const groups = useMemo(() => {
    const term = norm(search);
    const byClient = new Map();
    for (const p of projects) {
      if (p.archived) continue;
      const clientName = p.clientId ? clientById.get(p.clientId)?.name ?? p.clientName : null;
      const activeTasks = p.tasks.filter((t) => !t.done);
      const matchingTasks = term ? activeTasks.filter((t) => norm(t.name).includes(term)) : activeTasks;
      const matches = !term || norm(p.name).includes(term) || norm(clientName).includes(term) || matchingTasks.length;
      if (!matches) continue;
      const key = clientName ?? '';
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push({ project: p, tasks: term && !norm(p.name).includes(term) ? matchingTasks : activeTasks, forceOpen: !!term && matchingTasks.length > 0 });
    }
    return [...byClient.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [projects, clientById, search]);

  const choose = (p, t) => {
    onChange({ projectId: p?.id ?? null, taskId: t?.id ?? null, project: p ?? null });
    close();
    setSearch('');
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`project-picker-btn ${hasValue ? 'has-value' : ''} ${className}`}
        onClick={() => {
          toggle();
          setSearch('');
        }}
      >
        {hasValue ? (
          <ProjectLabel project={project} task={task} clientName={project?.clientId ? clientById.get(project.clientId)?.name : null} fallback={project ? null : fallback} />
        ) : (
          <span className="project-empty"><CirclePlus size={18} /> {emptyLabel}</span>
        )}
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} width={380} className="picker">
        <div className="picker-search">
          <Search size={16} />
          <input autoFocus placeholder="Search project or client" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="picker-list">
          {!search && (
            <button type="button" className={`picker-item ${!projectId ? 'selected' : ''}`} onClick={() => choose(null, null)}>
              <span className="dot" style={{ background: '#C6D2D9' }} /> No project
            </button>
          )}
          {groups.map(([clientName, items]) => (
            <div key={clientName || '__none'}>
              <div className="picker-group">{clientName || 'No client'}</div>
              {items.map(({ project: p, tasks, forceOpen }) => {
                const isOpen = forceOpen || expanded[p.id];
                return (
                  <div key={p.id}>
                    <div className={`picker-item ${p.id === projectId && !taskId ? 'selected' : ''}`}>
                      <button type="button" className="picker-item-main" onClick={() => choose(p, null)} style={{ color: p.color }}>
                        <span className="dot" style={{ background: p.color }} />
                        <span className="truncate">{p.name}</span>
                      </button>
                      {tasks.length > 0 && (
                        <button type="button" className="picker-tasks-toggle" onClick={() => setExpanded((x) => ({ ...x, [p.id]: !x[p.id] }))}>
                          {tasks.length} {tasks.length === 1 ? 'Task' : 'Tasks'} {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                    {isOpen &&
                      tasks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className={`picker-item picker-task ${t.id === taskId ? 'selected' : ''}`}
                          onClick={() => choose(p, t)}
                        >
                          {t.name}
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <div className="picker-empty">No matching projects</div>}
        </div>
        {canCreate && (
          <button
            type="button"
            className="picker-footer"
            onClick={() => {
              setCreating(true);
              setOpen(false);
            }}
          >
            <CirclePlus size={16} /> Create new project
          </button>
        )}
      </Popover>
      {creating && (
        <ProjectFormModal
          initialName={search}
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false);
            choose(p, null);
          }}
        />
      )}
    </>
  );
}

export function ProjectFormModal({ project, initialName = '', onClose, onSaved }) {
  const { clients, upsertProject, upsertClient, reloadClients, toast, canCreate } = useData();
  const [name, setName] = useState(project?.name ?? initialName);
  const [clientId, setClientId] = useState(project?.clientId ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
  const [isPublic, setIsPublic] = useState(project?.isPublic ?? true);
  const [newClient, setNewClient] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let cid = clientId || null;
      if (newClient != null && newClient.trim()) {
        const { client } = await api.post('/clients', { name: newClient.trim() });
        upsertClient(client);
        cid = client.id;
      }
      const body = { name, clientId: cid, color, isPublic };
      const { project: saved } = project ? await api.put(`/projects/${project.id}`, body) : await api.post('/projects', body);
      upsertProject(saved);
      reloadClients();
      onSaved(saved);
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={project ? 'Edit project' : 'Create new project'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy || !name.trim()}>
            {project ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={save} className="project-form">
        <div className="project-form-row">
          <input className="input" autoFocus placeholder="Enter project name" value={name} onChange={(e) => setName(e.target.value)} />
          {newClient == null ? (
            <select
              className="input"
              value={clientId}
              onChange={(e) => (e.target.value === '__new' ? setNewClient('') : setClientId(e.target.value ? Number(e.target.value) : ''))}
            >
              <option value="">Select client</option>
              {clients.filter((c) => !c.archived || c.id === clientId).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {canCreate && <option value="__new">+ Create new client…</option>}
            </select>
          ) : (
            <input className="input" autoFocus placeholder="New client name" value={newClient} onChange={(e) => setNewClient(e.target.value)} />
          )}
        </div>
        <div className="project-form-row">
          <Field label="Color"><ColorPicker value={color} onChange={setColor} /></Field>
          <div className="project-form-public">
            <Checkbox checked={isPublic} onChange={setIsPublic} label="Public (everyone in the workspace can track time on it)" />
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function TagPicker({ tagIds, onChange, showNames = true }) {
  const { tags, tagById, canCreate, upsertTag, toast } = useData();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(tagIds);

  const openPicker = () => {
    setDraft(tagIds);
    setSearch('');
    setOpen(true);
  };
  const closePicker = () => {
    setOpen(false);
    const a = [...draft].sort().join(',');
    const b = [...tagIds].sort().join(',');
    if (a !== b) onChange(draft);
  };

  const term = norm(search);
  const visible = tags.filter((t) => (!t.archived || draft.includes(t.id)) && norm(t.name).includes(term));
  const exact = tags.some((t) => norm(t.name) === term);
  const names = tagIds.map((tid) => tagById.get(tid)?.name).filter(Boolean);

  const create = async () => {
    try {
      const { tag } = await api.post('/tags', { name: search.trim() });
      upsertTag(tag);
      setDraft((d) => [...d, tag.id]);
      setSearch('');
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`tag-btn ${names.length ? 'active' : ''}`}
        onClick={() => (open ? closePicker() : openPicker())}
        title={names.join(', ') || 'Add tags'}
      >
        {names.length && showNames ? <span className="tag-names truncate">{names.join(', ')}</span> : <Tag size={18} />}
      </button>
      <Popover anchorRef={ref} open={open} onClose={closePicker} width={260} align="right" className="picker">
        <div className="picker-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Add/Search tags"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim() && !exact && canCreate) create();
            }}
          />
        </div>
        <div className="picker-list">
          {visible.map((t) => (
            <div key={t.id} className="picker-item">
              <Checkbox
                checked={draft.includes(t.id)}
                onChange={(on) => setDraft((d) => (on ? [...d, t.id] : d.filter((x) => x !== t.id)))}
                label={t.name}
              />
            </div>
          ))}
          {visible.length === 0 && !search && <div className="picker-empty">No tags yet</div>}
        </div>
        {canCreate && search.trim() && !exact && (
          <button type="button" className="picker-footer" onClick={create}>
            <CirclePlus size={16} /> Create new tag "{search.trim()}"
          </button>
        )}
      </Popover>
    </>
  );
}

/** Billable toggle: a $ icon (timer bar, dialogs) or a Billable / Non-billable badge (entry rows). */
export function BillableButton({ billable, onChange, variant = 'icon' }) {
  if (variant === 'badge') {
    return (
      <button
        type="button"
        className={`badge badge-btn ${billable ? 'badge-success' : 'badge-neutral'}`}
        onClick={() => onChange(!billable)}
        title="Click to toggle billable"
        aria-pressed={billable}
      >
        {billable ? 'Billable' : 'Non-billable'}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`billable-btn ${billable ? 'active' : ''}`}
      onClick={() => onChange(!billable)}
      title={billable ? 'Billable' : 'Non-billable'}
      aria-pressed={billable}
    >
      <CircleDollarSign size={18} />
    </button>
  );
}

/** Multi-select filter dropdown used in Reports. */
export function FilterDropdown({ label, options, value, onChange, withNone }) {
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  const [search, setSearch] = useState('');
  const all = withNone ? [{ id: 0, name: withNone }, ...options] : options;
  const visible = all.filter((o) => norm(o.name).includes(norm(search)));
  const selected = value ?? [];
  return (
    <>
      <button ref={ref} type="button" className={`filter-btn ${selected.length ? 'active' : ''}`} onClick={toggle}>
        {label}
        {selected.length > 0 && <span className="filter-count">{selected.length}</span>}
        <ChevronDown size={14} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} width={260} className="picker">
        <div className="picker-search">
          <Search size={16} />
          <input autoFocus placeholder={`Search ${label}`} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="picker-list">
          <div className="picker-item">
            <Checkbox
              checked={selected.length > 0 && selected.length === all.length}
              indeterminate={selected.length > 0}
              onChange={(on) => onChange(on ? all.map((o) => o.id) : [])}
              label="Select all"
            />
          </div>
          {visible.map((o) => (
            <div key={o.id} className="picker-item">
              <Checkbox
                checked={selected.includes(o.id)}
                onChange={(on) => onChange(on ? [...selected, o.id] : selected.filter((x) => x !== o.id))}
                label={
                  o.color ? (
                    <span style={{ color: o.color }}><span className="dot" style={{ background: o.color }} /> {o.name}</span>
                  ) : (
                    o.name
                  )
                }
              />
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
