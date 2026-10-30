import { useState } from 'react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { Field, Toggle } from '../components/ui.jsx';
import { ClockifyImport } from '../components/ClockifyImport.jsx';
import { workspaceUrl } from '../components/Workspaces.jsx';
import { basePath, slugProblem } from '../../../shared/workspace.js';

export default function WorkspaceSettings() {
  const { settings, setSettings, workspace, toast } = useData();
  const [form, setForm] = useState({ ...settings, slug: workspace.slug });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.put('/workspace', workspace.primary ? { ...form, slug: undefined } : form);
      // A new link name moves this workspace to a new URL.
      if (d.workspace.slug !== workspace.slug) return window.location.replace(`${basePath(d.workspace)}/settings`);
      setSettings(d.settings);
      setForm({ ...d.settings, slug: d.workspace.slug });
      toast('Workspace settings saved', 'success');
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Workspace settings</h1></div>
      <form className="card pad-lg settings-form" onSubmit={save}>
        <h3 className="section-title">General</h3>
        <Field label="Workspace name">
          <input className="input" value={form.workspaceName} onChange={(e) => set('workspaceName', e.target.value)} required />
        </Field>
        {workspace.primary ? (
          <Field label="Link" hint="This is the main workspace, so it keeps the original links. Other workspaces open under their own name.">
            <input className="input" value={workspaceUrl(workspace, '')} readOnly />
          </Field>
        ) : (
          <Field label="Link" hint={(form.slug && slugProblem(form.slug)) || `Everyone opens this workspace at ${workspaceUrl({ ...workspace, slug: form.slug })}. Changing it breaks old bookmarks.`}>
            <div className="input-prefixed">
              <span className="input-prefix">{window.location.host}/</span>
              <input className="input" value={form.slug} maxLength={40} required onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
            </div>
          </Field>
        )}

        <h3 className="section-title">Billing</h3>
        <div className="grid-2">
          <Field label="Currency" hint="3-letter code, e.g. IDR, USD, SGD">
            <input className="input" value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value.toUpperCase())} required />
          </Field>
          <Field label="Default hourly billable rate" hint="Used when a project has no rate of its own">
            <input className="input" type="number" min="0" step="any" value={form.defaultRate} onChange={(e) => set('defaultRate', e.target.value)} />
          </Field>
        </div>

        <h3 className="section-title">Time & date</h3>
        <div className="grid-2">
          <Field label="Week starts on">
            <select className="input" value={form.weekStart} onChange={(e) => set('weekStart', Number(e.target.value))}>
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </Field>
          <Field label="Time format">
            <select className="input" value={form.timeFormat} onChange={(e) => set('timeFormat', e.target.value)}>
              <option value="24">24-hour (13:30)</option>
              <option value="12">12-hour (1:30 PM)</option>
            </select>
          </Field>
        </div>

        <h3 className="section-title">Permissions</h3>
        <div className="setting-row">
          <div>
            <div className="setting-title">Members can create projects, clients, tasks and tags</div>
            <div className="setting-desc">When off, only admins can create them. Editing, archiving and deleting is always admin-only.</div>
          </div>
          <Toggle checked={form.membersCanCreate} onChange={(v) => set('membersCanCreate', v)} />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-title">Members can see the team Dashboard</div>
            <div className="setting-desc">Shows the Only me / Team switch and Team activities on the Dashboard for everyone. Reports and editing other people's time stay admin-only.</div>
          </div>
          <Toggle checked={form.membersSeeTeamDashboard} onChange={(v) => set('membersSeeTeamDashboard', v)} />
        </div>

        <h3 className="section-title">Sign-up</h3>
        <div className="setting-row">
          <div>
            <div className="setting-title">Allow people to sign up (admin approval required)</div>
            <div className="setting-desc">Shows a Sign up link on the login page and lets new Google accounts request access. New accounts appear under <b>Team → Pending sign-up requests</b> and cannot log in until an admin approves them.</div>
          </div>
          <Toggle checked={form.allowSignup} onChange={(v) => set('allowSignup', v)} />
        </div>
        <Field label="Only allow emails from this domain (optional)" hint="For example rakamin.com. Leave empty to allow any email address.">
          <input className="input" placeholder="yourcompany.com" value={form.signupDomain} onChange={(e) => set('signupDomain', e.target.value)} disabled={!form.allowSignup} />
        </Field>
        <div className="setting-row">
          <div>
            <div className="setting-title">Auto-approve Google sign-ups from {form.signupDomain ? `@${form.signupDomain.replace(/^@/, '')}` : 'this domain'}</div>
            <div className="setting-desc">People who sign in with a Google account on this domain join instantly as Members, no approval needed. Email + password sign-ups still wait for approval, because their email address is not verified.</div>
          </div>
          <Toggle checked={form.autoApproveDomain} onChange={(v) => set('autoApproveDomain', v)} disabled={!form.allowSignup || !form.signupDomain} />
        </div>

        <button type="submit" className="btn btn-primary" disabled={busy}>Save settings</button>
      </form>
      <ClockifyImport />
    </div>
  );
}
