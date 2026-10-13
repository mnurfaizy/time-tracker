import { useState } from 'react';
import { Search, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { KebabMenu, Modal, Field } from '../components/ui.jsx';
import { Avatar } from '../components/Layout.jsx';

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export default function Team() {
  const { users, user: me, reloadUsers, toast } = useData();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState('active');
  const [modal, setModal] = useState(null); // { mode: 'add' | 'edit' | 'password', user }

  const term = search.trim().toLowerCase();
  const pending = users.filter((u) => u.pending);
  const list = users.filter(
    (u) =>
      !u.pending &&
      (show === 'all' || (show === 'active') === u.active) &&
      (!term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)),
  );

  const setActive = async (u, active) => {
    try {
      await api.put(`/users/${u.id}`, { active });
      await reloadUsers();
    } catch (err) {
      toast(err.message);
    }
  };

  const approve = async (u, role) => {
    try {
      await api.post(`/users/${u.id}/approve`, { role });
      await reloadUsers();
      toast(`${u.name} can now log in`, 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  const reject = async (u) => {
    if (!window.confirm(`Reject the sign-up request from ${u.name} (${u.email})?`)) return;
    try {
      await api.del(`/users/${u.id}`);
      await reloadUsers();
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Team</h1>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ mode: 'add' })}>Add new member</button>
      </div>
      <div className="filter-bar">
        <select className="filter-btn" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="active">Show active</option>
          <option value="inactive">Show inactive</option>
          <option value="all">Show all</option>
        </select>
        <label className="search-box">
          <Search size={16} />
          <input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      {pending.length > 0 && (
        <div className="card pending-card">
          <div className="card-caption">Pending sign-up requests ({pending.length})</div>
          <table className="table">
            <tbody>
              {pending.map((u) => (
                <PendingRow key={u.id} user={u} onApprove={approve} onReject={reject} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="card">
        <div className="card-caption">Members</div>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Google Calendar</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>
                  <span className="team-name"><Avatar name={u.name} size={28} /> {u.name}{u.id === me.id && <span className="muted"> (you)</span>}</span>
                </td>
                <td>{u.email}</td>
                <td>
                  {u.role === 'admin' ? <span className="badge badge-blue">Admin</span> : <span className="badge">Member</span>}
                  {!u.active && <span className="badge">Inactive</span>}
                </td>
                <td>{u.googleConnected ? <span className="ok">Connected{u.gcalSync ? ' · syncing' : ''}</span> : <span className="muted">—</span>}</td>
                <td className="col-actions">
                  <KebabMenu
                    items={[
                      { label: 'Edit', onClick: () => setModal({ mode: 'edit', user: u }) },
                      { label: 'Reset password', onClick: () => setModal({ mode: 'password', user: u }) },
                      { label: u.active ? 'Deactivate' : 'Activate', danger: u.active, hidden: u.id === me.id, onClick: () => setActive(u, !u.active) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && <MemberModal modal={modal} onClose={() => setModal(null)} onSaved={async () => { setModal(null); await reloadUsers(); }} />}
    </div>
  );
}

function PendingRow({ user, onApprove, onReject }) {
  const [role, setRole] = useState('member');
  return (
    <tr>
      <td><span className="team-name"><Avatar name={user.name} size={28} /> {user.name}</span></td>
      <td>{user.email}{user.googleEmail && <span className="muted small"> · via Google</span>}</td>
      <td className="muted small">Requested {new Date(user.createdAt).toLocaleString()}</td>
      <td className="pending-actions">
        <select className="input select-sm" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onApprove(user, role)}>Approve</button>
        <button type="button" className="btn-link danger" onClick={() => onReject(user)}>Reject</button>
      </td>
    </tr>
  );
}

function MemberModal({ modal, onClose, onSaved }) {
  const { toast, user: me } = useData();
  const u = modal.user;
  const [form, setForm] = useState({
    name: u?.name ?? '',
    email: u?.email ?? '',
    role: u?.role ?? 'member',
    password: modal.mode === 'edit' ? '' : randomPassword(),
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (modal.mode === 'add') await api.post('/users', form);
      else if (modal.mode === 'edit') await api.put(`/users/${u.id}`, { name: form.name, email: form.email, role: form.role });
      else await api.put(`/users/${u.id}/password`, { password: form.password });
      if (modal.mode !== 'edit') {
        try {
          await navigator.clipboard.writeText(`Email: ${form.email || u.email}\nPassword: ${form.password}\nLogin: ${window.location.origin}`);
          toast('Saved. Login details copied to clipboard — share them with the member.', 'success');
        } catch {
          toast('Saved. Remember to share the password with the member.', 'success');
        }
      }
      await onSaved();
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  };

  const title = modal.mode === 'add' ? 'Add new member' : modal.mode === 'edit' ? 'Edit member' : `Reset password for ${u.name}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
          <button type="submit" form="member-form" className="btn btn-primary" disabled={busy}>{modal.mode === 'add' ? 'Add member' : 'Save'}</button>
        </>
      }
    >
      <form id="member-form" className="stack" onSubmit={submit}>
        {modal.mode !== 'password' && (
          <>
            <Field label="Full name"><input className="input" value={form.name} onChange={set('name')} required autoFocus /></Field>
            <Field label="Email"><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label="Role">
              <select className="input" value={form.role} onChange={set('role')} disabled={u?.id === me.id}>
                <option value="member">Member — tracks own time, sees own reports</option>
                <option value="admin">Admin — manages team, projects and sees all reports</option>
              </select>
            </Field>
          </>
        )}
        {modal.mode !== 'edit' && (
          <Field label={modal.mode === 'add' ? 'Temporary password' : 'New password'} hint="At least 8 characters. The member can change it later in Profile settings.">
            <div className="input-with-btn">
              <input className="input mono" value={form.password} onChange={set('password')} required minLength={8} />
              <button type="button" className="icon-btn" title="Generate" onClick={() => setForm((f) => ({ ...f, password: randomPassword() }))}><RefreshCw size={16} /></button>
            </div>
          </Field>
        )}
      </form>
    </Modal>
  );
}
