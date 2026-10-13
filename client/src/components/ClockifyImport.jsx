import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { Checkbox } from './ui.jsx';

/** Settings card: import clients, projects and tasks from a Clockify Projects CSV export. */
export function ClockifyImport() {
  const { toast, reloadProjects, reloadClients } = useData();
  const fileRef = useRef(null);
  const [csv, setCsv] = useState(null);
  const [fileName, setFileName] = useState('');
  const [billable, setBillable] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun, text = csv) => {
    setBusy(true);
    try {
      const result = await api.post('/import/clockify-projects', { csv: text, dryRun, billable });
      if (dryRun) {
        setPreview(result);
      } else {
        await Promise.all([reloadProjects(), reloadClients()]);
        toast(`Imported ${result.projects} projects, ${result.clients} clients and ${result.tasks} tasks`, 'success');
        setPreview(null);
        setCsv(null);
        setFileName('');
      }
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    run(true, text);
  };

  return (
    <div className="card pad-lg settings-form">
      <h3 className="section-title first"><Upload size={18} /> Import from Clockify</h3>
      <p className="setting-desc">
        In Clockify open <b>Projects</b>, click <b>Export → Save as CSV</b>, then upload the file here. Clients, projects
        (with status, visibility and notes) and tasks are created. Anything that already exists with the same name is skipped,
        so importing the same file twice is safe.
      </p>
      <div className="import-row">
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
        <button type="button" className="btn btn-outline" onClick={() => fileRef.current.click()} disabled={busy}>
          <Upload size={16} /> {fileName ? 'Choose another file' : 'Choose CSV file'}
        </button>
        {fileName && <span className="muted">{fileName}</span>}
      </div>
      <Checkbox
        checked={billable}
        onChange={setBillable}
        label="Mark imported projects as billable"
      />

      {preview && (
        <div className="import-preview">
          <div className="import-stats">
            <div><b>{preview.clients}</b> new clients</div>
            <div><b>{preview.projects}</b> new projects</div>
            <div><b>{preview.tasks}</b> new tasks</div>
            <div className="muted"><b>{preview.skippedProjects}</b> projects already exist</div>
          </div>
          {preview.preview.length > 0 && (
            <div className="import-list">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Client</th>
                    <th className="num">Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((p) => (
                    <tr key={`${p.name}|${p.client}`}>
                      <td>{p.name}{p.archived && <span className="badge">Archived</span>}</td>
                      <td>{p.client ?? <span className="muted">—</span>}</td>
                      <td className="num">{p.tasks || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="import-actions">
            <button type="button" className="btn btn-primary" disabled={busy || (!preview.projects && !preview.clients && !preview.tasks)} onClick={() => run(false)}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <button type="button" className="btn-link" onClick={() => { setPreview(null); setCsv(null); setFileName(''); }}>Cancel</button>
          </div>
        </div>
      )}
      <p className="setting-desc small">
        Clockify's project export only contains total hours, not the individual time entries, so past tracked time is not
        imported from this file.
      </p>
    </div>
  );
}
