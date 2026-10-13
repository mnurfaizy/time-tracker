import { useEffect, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { useData, useMoney } from '../store.jsx';
import { KebabMenu, Checkbox, ColorPicker, Field, Toggle } from '../components/ui.jsx';
import { formatDuration } from '../utils/time.js';

export default function ProjectDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const tab = params.get('tab') || 'tasks';
  const { projectById, isAdmin } = useData();
  const money = useMoney();
  const project = projectById.get(Number(id));

  if (!isAdmin) return <Navigate to="/projects" replace />;
  if (!project) {
    return (
      <div className="page">
        <Link to="/projects" className="back-link"><ArrowLeft size={16} /> Projects</Link>
        <p className="muted">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/projects" className="back-link"><ArrowLeft size={16} /> Projects</Link>
      <div className="page-head">
        <h1 className="project-title">
          <span className="dot lg" style={{ background: project.color }} /> {project.name}
          {project.clientName && <span className="muted"> · {project.clientName}</span>}
          {project.archived && <span className="badge">Archived</span>}
        </h1>
        <div className="project-stats">
          <span>Tracked <b>{formatDuration(project.tracked)}</b></span>
          {project.billable && <span>Amount <b>{money(project.amount)}</b></span>}
        </div>
      </div>
      <div className="tabs">
        {['tasks', 'access', 'note', 'settings'].map((t) => (
          <NavLink key={t} to={`?tab=${t}`} className={() => `tab ${tab === t ? 'active' : ''}`}>{t}</NavLink>
        ))}
      </div>
      <div className="card pad-lg">
        {tab === 'tasks' && <TasksTab project={project} />}
        {tab === 'access' && <AccessTab project={project} />}
        {tab === 'note' && <NoteTab project={project} />}
        {tab === 'settings' && <SettingsTab project={project} />}
      </div>
    </div>
  );
}

function TasksTab({ project }) {
  const { upsertProject, toast } = useData();
  const [name, setName] = useState('');
  const [showDone, setShowDone] = useState(false);
  const run = async (fn) => {
    try {
      const { project: p } = await fn();
      upsertProject(p);
    } catch (err) {
      toast(err.message);
    }
  };
  const tasks = project.tasks.filter((t) => showDone || !t.done);

  return (
    <>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => api.post(`/projects/${project.id}/tasks`, { name })).then(() => setName(''));
        }}
      >
        <input className="input" placeholder="Add new task" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Add</button>
        <span className="spacer" />
        <Checkbox checked={showDone} onChange={setShowDone} label="Show done tasks" />
      </form>
      {tasks.length === 0 ? (
        <p className="muted">No tasks yet. Tasks let your team track time on specific parts of this project.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className={t.done ? 'muted strike' : ''}>{t.name}</td>
                <td>{t.done ? <span className="badge">Done</span> : <span className="badge badge-blue">Active</span>}</td>
                <td className="col-actions">
                  <KebabMenu
                    items={[
                      {
                        label: 'Rename',
                        onClick: () => {
                          const n = window.prompt('Task name', t.name);
                          if (n && n.trim()) run(() => api.put(`/projects/tasks/${t.id}`, { name: n }));
                        },
                      },
                      { label: t.done ? 'Mark as active' : 'Mark as done', onClick: () => run(() => api.put(`/projects/tasks/${t.id}`, { done: !t.done })) },
                      {
                        label: 'Delete',
                        danger: true,
                        onClick: () => window.confirm(`Delete task "${t.name}"?`) && run(() => api.del(`/projects/tasks/${t.id}`)),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AccessTab({ project }) {
  const { users, upsertProject, toast } = useData();
  const [members, setMembers] = useState(project.memberIds);
  useEffect(() => setMembers(project.memberIds), [project.memberIds]);
  const saveVisibility = async (isPublic) => {
    try {
      const { project: p } = await api.put(`/projects/${project.id}`, { isPublic });
      upsertProject(p);
    } catch (err) {
      toast(err.message);
    }
  };
  const saveMembers = async () => {
    try {
      const { project: p } = await api.put(`/projects/${project.id}/members`, { userIds: members });
      upsertProject(p);
      toast('Access updated', 'success');
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <>
      <div className="setting-row">
        <div>
          <div className="setting-title">Visibility</div>
          <div className="setting-desc">Public projects are available to everyone in the workspace. Private projects are only visible to admins and the members you choose.</div>
        </div>
        <select className="input select-sm" value={project.isPublic ? 'public' : 'private'} onChange={(e) => saveVisibility(e.target.value === 'public')}>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      {!project.isPublic && (
        <>
          <div className="setting-title mt">Members with access</div>
          <div className="member-grid">
            {users.filter((u) => u.active).map((u) => (
              <Checkbox
                key={u.id}
                checked={u.role === 'admin' || members.includes(u.id)}
                disabled={u.role === 'admin'}
                onChange={(on) => setMembers((m) => (on ? [...m, u.id] : m.filter((x) => x !== u.id)))}
                label={`${u.name}${u.role === 'admin' ? ' (admin)' : ''}`}
              />
            ))}
          </div>
          <button type="button" className="btn btn-primary mt" onClick={saveMembers}>Save access</button>
        </>
      )}
    </>
  );
}

function NoteTab({ project }) {
  const { upsertProject, toast } = useData();
  const [note, setNote] = useState(project.note);
  return (
    <>
      <textarea className="input textarea" rows={8} placeholder="Write a note about this project…" value={note} onChange={(e) => setNote(e.target.value)} />
      <button
        type="button"
        className="btn btn-primary mt"
        disabled={note === project.note}
        onClick={async () => {
          try {
            const { project: p } = await api.put(`/projects/${project.id}`, { note });
            upsertProject(p);
            toast('Note saved', 'success');
          } catch (err) {
            toast(err.message);
          }
        }}
      >
        Save note
      </button>
    </>
  );
}

function SettingsTab({ project }) {
  const { clients, settings, upsertProject, reloadClients, toast } = useData();
  const [form, setForm] = useState({
    name: project.name,
    clientId: project.clientId ?? '',
    color: project.color,
    billable: project.billable,
    hourlyRate: project.hourlyRate ?? '',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    try {
      const { project: p } = await api.put(`/projects/${project.id}`, { ...form, clientId: form.clientId || null });
      upsertProject(p);
      reloadClients();
      toast('Project saved', 'success');
    } catch (err) {
      toast(err.message);
    }
  };
  return (
    <form onSubmit={save} className="settings-form">
      <Field label="Project name">
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </Field>
      <Field label="Client">
        <select className="input" value={form.clientId} onChange={(e) => set('clientId', e.target.value ? Number(e.target.value) : '')}>
          <option value="">No client</option>
          {clients.filter((c) => !c.archived || c.id === form.clientId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="Color"><ColorPicker value={form.color} onChange={(c) => set('color', c)} /></Field>
      <div className="setting-row">
        <div>
          <div className="setting-title">Billable by default</div>
          <div className="setting-desc">New time entries on this project are marked billable.</div>
        </div>
        <Toggle checked={form.billable} onChange={(v) => set('billable', v)} />
      </div>
      <Field label={`Hourly billable rate (${settings.currency})`} hint={`Leave empty to use the workspace default (${settings.defaultRate}).`}>
        <input className="input" type="number" min="0" step="any" value={form.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary">Save changes</button>
    </form>
  );
}
