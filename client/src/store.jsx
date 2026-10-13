import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const DataContext = createContext(null);
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const toast = useCallback((message, type = 'error') => {
    const toastId = nextId.current++;
    setToasts((t) => [...t, { id: toastId, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toastId)), type === 'error' ? 5000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function DataProvider({ session, setSession, children }) {
  const toast = useToast();
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [tags, setTags] = useState([]);
  const [users, setUsers] = useState([]);
  const [ready, setReady] = useState(false);

  const reloadProjects = useCallback(() => api.get('/projects').then((d) => setProjects(d.projects)), []);
  const reloadClients = useCallback(() => api.get('/clients').then((d) => setClients(d.clients)), []);
  const reloadTags = useCallback(() => api.get('/tags').then((d) => setTags(d.tags)), []);
  const reloadUsers = useCallback(() => api.get('/users').then((d) => setUsers(d.users)), []);

  useEffect(() => {
    Promise.all([reloadProjects(), reloadClients(), reloadTags(), reloadUsers()])
      .catch((e) => toast(e.message))
      .finally(() => setReady(true));
  }, [reloadProjects, reloadClients, reloadTags, reloadUsers, toast]);

  // Keep shared lists fresh when teammates change them: refresh when the tab regains focus
  // (at most every 30 s) and every 3 minutes while the tab is visible.
  useEffect(() => {
    let last = Date.now();
    const refresh = (force = false) => {
      if (document.visibilityState !== 'visible') return;
      if (!force && Date.now() - last < 30 * 1000) return;
      last = Date.now();
      Promise.all([reloadProjects(), reloadClients(), reloadTags()]).catch(() => {});
    };
    const onFocus = () => refresh();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const t = setInterval(() => refresh(true), 3 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [reloadProjects, reloadClients, reloadTags]);

  const value = useMemo(() => {
    const { user, settings } = session;
    const isAdmin = user.role === 'admin';
    return {
      user,
      settings,
      googleConfigured: session.googleConfigured,
      isAdmin,
      canCreate: isAdmin || settings.membersCanCreate,
      projects,
      clients,
      tags,
      users,
      projectById: new Map(projects.map((p) => [p.id, p])),
      clientById: new Map(clients.map((c) => [c.id, c])),
      tagById: new Map(tags.map((t) => [t.id, t])),
      userById: new Map(users.map((u) => [u.id, u])),
      reloadProjects,
      reloadClients,
      reloadTags,
      reloadUsers,
      setUser: (u) => setSession((s) => ({ ...s, user: u })),
      setSettings: (st) => setSession((s) => ({ ...s, settings: st })),
      upsertProject: (p) => setProjects((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p].sort(byName))),
      upsertTag: (t) => setTags((list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t].sort(byName))),
      upsertClient: (c) => setClients((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c].sort(byName))),
      logout: async () => {
        await api.post('/auth/logout').catch(() => {});
        setSession(null);
      },
      toast,
    };
  }, [session, setSession, projects, clients, tags, users, reloadProjects, reloadClients, reloadTags, reloadUsers, toast]);

  if (!ready) return <div className="page-loading"><div className="spinner" /></div>;
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export const useData = () => useContext(DataContext);

export function useMoney() {
  const { settings } = useData();
  return useMemo(() => {
    let f;
    try {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: settings.currency });
    } catch {
      f = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return (n) => f.format(n || 0);
  }, [settings.currency]);
}
