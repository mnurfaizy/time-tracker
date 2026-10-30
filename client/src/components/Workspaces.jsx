import { useRef, useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { Modal, Field, Popover, useToggle } from './ui.jsx';
import { basePath, slugify, slugProblem } from '../../../shared/workspace.js';

/** Full link of a workspace page, e.g. https://host/multipolar/tracker (main workspace: https://host/tracker). */
export const workspaceUrl = (ws, page = '/tracker') => `${window.location.origin}${basePath(ws)}${page}`;

// Each workspace is its own page load, so its data, timers and settings never mix.
const go = (ws) => window.location.assign(`${basePath(ws)}/tracker`);

function WsMark({ name }) {
  return <span className="ws-mark">{String(name || '?').trim()[0]?.toUpperCase() ?? '?'}</span>;
}

/** Sidebar switcher. Hidden for people in a single workspace who cannot create one. */
export function WorkspaceSwitcher() {
  const { workspace, workspaces, settings, canCreateWorkspace } = useData();
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  const [creating, setCreating] = useState(false);
  if (workspaces.length < 2 && !canCreateWorkspace) return null;
  return (
    <>
      <button ref={ref} type="button" className="ws-switch" onClick={toggle} aria-label="Switch workspace">
        <WsMark name={settings.workspaceName} />
        <span className="ws-switch-text">
          <span className="ws-switch-label">Workspace</span>
          <span className="ws-switch-name truncate">{settings.workspaceName}</span>
        </span>
        <ChevronsUpDown size={14} className="user-card-chevron" />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} className="menu ws-menu">
        {workspaces.map((w) => (
          <button
            key={w.id}
            type="button"
            className="menu-item"
            onClick={() => (w.id === workspace.id ? close() : go(w))}
          >
            <WsMark name={w.id === workspace.id ? settings.workspaceName : w.name} />
            <span className="ws-menu-name truncate">{w.id === workspace.id ? settings.workspaceName : w.name}</span>
            {w.id === workspace.id && <Check size={16} className="ws-menu-check" />}
          </button>
        ))}
        {canCreateWorkspace && (
          <>
            <div className="menu-sep" />
            <button type="button" className="menu-item" onClick={() => { close(); setCreating(true); }}>
              <Plus size={16} /> Create workspace
            </button>
          </>
        )}
      </Popover>
      {creating && <CreateWorkspaceModal onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateWorkspaceModal({ onClose }) {
  const { toast } = useData();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const finalSlug = slugEdited ? slug : slugify(name);
  const problem = finalSlug ? slugProblem(finalSlug) : null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.post('/workspace/new', { name, slug: finalSlug });
      go(d.workspace);
    } catch (err) {
      toast(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Create workspace"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-link" onClick={onClose}>Cancel</button>
          <button type="submit" form="ws-form" className="btn btn-primary" disabled={busy || !name.trim() || !!problem}>Create workspace</button>
        </>
      }
    >
      <form id="ws-form" className="stack" onSubmit={submit}>
        <p className="muted small">
          A separate space with its own projects, clients, tags, team and reports. You become its admin; add people from
          Team → Members. People who already have an account keep the same login.
        </p>
        <Field label="Workspace name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Multipolar" required autoFocus maxLength={100} />
        </Field>
        <Field label="Link" hint={problem || 'Lowercase letters, numbers and dashes. You can change it later in Settings.'}>
          <div className="input-prefixed">
            <span className="input-prefix">{window.location.host}/</span>
            <input
              className="input"
              value={finalSlug}
              onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
              placeholder="multipolar"
              maxLength={40}
            />
          </div>
        </Field>
      </form>
    </Modal>
  );
}
