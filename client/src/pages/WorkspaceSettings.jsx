import { useState } from 'react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { Field, Toggle } from '../components/ui.jsx';
import { ClockifyImport } from '../components/ClockifyImport.jsx';

export default function WorkspaceSettings() {
  const { settings, setSettings, toast } = useData();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await api.put('/workspace', form);
      setSettings(d.settings);
      setForm(d.settings);
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

        <button type="submit" className="btn btn-primary" disabled={busy}>Save settings</button>
      </form>
      <ClockifyImport />
    </div>
  );
}
