import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, CircleCheck, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { Field, Toggle } from '../components/ui.jsx';

const GOOGLE_MESSAGES = {
  connected: ['success', 'Google Calendar connected.'],
  cancelled: ['error', 'Google Calendar connection was cancelled.'],
  failed: ['error', 'Could not connect Google Calendar. Please try again.'],
  scope: ['error', 'Please allow access to your calendar events when connecting.'],
  no_refresh: ['error', 'Google did not grant offline access. Remove this app from your Google account permissions and connect again.'],
};

export default function Profile() {
  const { user, setUser, toast, googleConfigured, isAdmin } = useData();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState({ name: user.name, email: user.email });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const g = params.get('google');
    if (g && GOOGLE_MESSAGES[g]) {
      const [type, msg] = GOOGLE_MESSAGES[g];
      toast(msg, type);
      setParams({}, { replace: true });
    }
    // Refresh connection status (the OAuth redirect may have changed it).
    api.get('/google/status').then((d) => {
      setStatus(d);
      setUser(d.user);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const d = await api.put('/auth/me', profile);
      setUser(d.user);
      toast('Profile saved', 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast('New passwords do not match');
    try {
      await api.put('/auth/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast('Password changed', 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  const setSync = async (enabled) => {
    try {
      const d = await api.put('/google/sync', { enabled });
      setUser(d.user);
    } catch (err) {
      toast(err.message);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Calendar?')) return;
    try {
      const d = await api.post('/google/disconnect');
      setUser(d.user);
      toast('Google Calendar disconnected', 'success');
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Profile settings</h1></div>

      <div className="card pad-lg">
        <h3 className="section-title first"><CalendarDays size={18} /> Google Calendar</h3>
        {!googleConfigured ? (
          <div className="notice">
            <TriangleAlert size={18} />
            <div>
              Google Calendar is not set up on this server yet.
              {isAdmin
                ? ' Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server .env file (see README), then restart the server.'
                : ' Ask your workspace admin to enable it.'}
              {isAdmin && status?.redirectUri && <div className="small mt-sm">Authorized redirect URI: <code>{status.redirectUri}</code></div>}
            </div>
          </div>
        ) : user.googleConnected ? (
          <>
            <div className="google-connected">
              <CircleCheck size={18} /> Connected{user.googleEmail ? ` as ${user.googleEmail}` : ''}
              <button type="button" className="btn-link danger" onClick={disconnect}>Disconnect</button>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-title">Add my time entries to Google Calendar</div>
                <div className="setting-desc">Every finished time entry is created (and kept up to date) as an event in your primary calendar.</div>
              </div>
              <Toggle checked={user.gcalSync} onChange={setSync} />
            </div>
            <p className="setting-desc">Your Google Calendar events are shown in the <b>Calendar</b> page, where you can turn any event into a time entry with one click.</p>
          </>
        ) : (
          <>
            <p className="setting-desc">
              Connect your Google account to see your meetings in the Calendar page, turn them into time entries, and optionally
              copy your time entries into Google Calendar.
            </p>
            <a className="btn btn-outline" href="/api/google/connect"><CalendarDays size={16} /> Connect Google Calendar</a>
          </>
        )}
      </div>

      <form className="card pad-lg settings-form" onSubmit={saveProfile}>
        <h3 className="section-title first">Profile</h3>
        <div className="grid-2">
          <Field label="Name"><input className="input" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required /></Field>
          <Field label="Email"><input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} required /></Field>
        </div>
        <div className="small muted">Role: <b>{user.role === 'admin' ? 'Admin' : 'Member'}</b></div>
        <button type="submit" className="btn btn-primary">Save profile</button>
      </form>

      <form className="card pad-lg settings-form" onSubmit={savePassword}>
        <h3 className="section-title first">Change password</h3>
        <div className="grid-3">
          <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
          <Field label="New password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></Field>
          <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
        </div>
        <button type="submit" className="btn btn-primary">Change password</button>
      </form>
    </div>
  );
}
