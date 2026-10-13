import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Logo } from '../components/Layout.jsx';

const GOOGLE_ERRORS = {
  google_no_account: 'There is no active account for that Google email. Ask your workspace admin to add you first.',
  google_not_configured: 'Google sign-in is not configured on this server.',
  google_email: 'Your Google account email could not be verified.',
  google_state: 'The Google sign-in session expired. Please try again.',
  cancelled: 'Google sign-in was cancelled.',
  failed: 'Google sign-in failed. Please try again.',
};

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Login({ boot, onDone }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(GOOGLE_ERRORS[params.get('error')] ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      navigate('/tracker', { replace: true });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-logo"><Logo /></div>
      <div className="auth-card">
        <h1>Log in</h1>
        {boot.workspaceName && <p className="auth-sub">to <b>{boot.workspaceName}</b></p>}
        {boot.googleLogin && (
          <>
            <a className="btn btn-google" href="/api/google/login"><GoogleIcon /> Continue with Google</a>
            <div className="auth-divider"><span>OR</span></div>
          </>
        )}
        <form onSubmit={submit}>
          <input className="input" type="email" placeholder="Enter email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <input className="input" type="password" placeholder="Enter password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
        </form>
        <p className="auth-foot">Forgot your password? Ask your workspace admin to reset it.</p>
      </div>
    </div>
  );
}

export function Setup({ onDone }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/setup', form);
      navigate('/tracker', { replace: true });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-logo"><Logo /></div>
      <div className="auth-card">
        <h1>Create your workspace</h1>
        <p className="auth-sub">You will be the workspace admin. You can add your team afterwards.</p>
        <form onSubmit={submit}>
          <input className="input" placeholder="Workspace name (e.g. your company)" value={form.workspaceName} onChange={set('workspaceName')} required autoFocus />
          <input className="input" placeholder="Your full name" value={form.name} onChange={set('name')} required />
          <input className="input" type="email" placeholder="Email" autoComplete="email" value={form.email} onChange={set('email')} required />
          <input className="input" type="password" placeholder="Password (min. 8 characters)" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} />
          {error && <div className="form-error">{error}</div>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </form>
      </div>
    </div>
  );
}
