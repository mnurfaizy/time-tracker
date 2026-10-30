import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api, basename } from './api.js';
import { basePath } from '../../shared/workspace.js';
import { DataProvider, useData } from './store.jsx';
import { Layout } from './components/Layout.jsx';
import { Login, Setup, Signup } from './pages/Auth.jsx';
import Tracker from './pages/Tracker.jsx';
import CalendarPage from './pages/Calendar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Reports from './pages/Reports.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Clients from './pages/Clients.jsx';
import Tags from './pages/Tags.jsx';
import Team from './pages/Team.jsx';
import WorkspaceSettings from './pages/WorkspaceSettings.jsx';
import Profile from './pages/Profile.jsx';

/**
 * When the URL names a different workspace than the one we are really in (e.g. /rakamin/tracker for the
 * main workspace, or a workspace the user is not a member of), reload at the right link. True if it did.
 */
function fixWorkspaceUrl(ws) {
  const want = basePath(ws);
  if (want === basename) return false;
  const rest = window.location.pathname.slice(basename.length) || '/';
  window.location.replace(`${want}${rest}${window.location.search}`);
  return true;
}

function AdminOnly({ children }) {
  const { isAdmin } = useData();
  return isAdmin ? children : <Navigate to="/tracker" replace />;
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [session, setSession] = useState(undefined);

  const loadSession = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      if (fixWorkspaceUrl(me.workspace)) return; // keeps the spinner while the page reloads
      setSession(me);
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    api
      .get('/auth/state')
      .then((state) => {
        if (state.workspace && fixWorkspaceUrl(state.workspace)) return;
        setBoot(state);
        if (state.needsSetup) setSession(null);
        else loadSession();
      })
      .catch(() => setBoot({ error: true }));
  }, [loadSession]);

  useEffect(() => {
    const onUnauthorized = () => setSession(null);
    window.addEventListener('tt:unauthorized', onUnauthorized);
    return () => window.removeEventListener('tt:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (session?.settings?.workspaceName) document.title = `Time Tracker · ${session.settings.workspaceName}`;
  }, [session?.settings?.workspaceName]);

  if (boot?.error) {
    return <div className="page-loading">Cannot reach the server. Please refresh the page.</div>;
  }
  if (!boot || session === undefined) {
    return <div className="page-loading"><div className="spinner" /></div>;
  }

  if (!session) {
    return (
      <Routes>
        {boot.needsSetup ? (
          <Route path="*" element={<Setup onDone={() => { setBoot({ ...boot, needsSetup: false }); loadSession(); }} />} />
        ) : (
          <>
            <Route path="/signup" element={<Signup boot={boot} />} />
            <Route path="*" element={<Login boot={boot} onDone={loadSession} />} />
          </>
        )}
      </Routes>
    );
  }

  return (
    <DataProvider session={session} setSession={setSession}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/tracker" element={<Tracker />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/reports" element={<Navigate to="/reports/summary" replace />} />
          <Route path="/reports/:tab" element={<Reports />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/team" element={<AdminOnly><Team /></AdminOnly>} />
          <Route path="/settings" element={<AdminOnly><WorkspaceSettings /></AdminOnly>} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/tracker" replace />} />
        </Route>
      </Routes>
    </DataProvider>
  );
}
