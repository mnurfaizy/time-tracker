import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api.js';
import { DataProvider, useData } from './store.jsx';
import { Layout } from './components/Layout.jsx';
import { Login, Setup } from './pages/Auth.jsx';
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

function AdminOnly({ children }) {
  const { isAdmin } = useData();
  return isAdmin ? children : <Navigate to="/tracker" replace />;
}

export default function App() {
  const [boot, setBoot] = useState(null);
  const [session, setSession] = useState(undefined);

  const loadSession = useCallback(async () => {
    try {
      setSession(await api.get('/auth/me'));
    } catch {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    api
      .get('/auth/state')
      .then((state) => {
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
          <Route path="*" element={<Login boot={boot} onDone={loadSession} />} />
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
