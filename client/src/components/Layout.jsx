import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Clock, CalendarDays, LayoutDashboard, ChartColumn, FolderOpen, Users, Contact, Tag, Settings, Menu, LogOut, UserRound,
} from 'lucide-react';
import { useData } from '../store.jsx';
import { Popover, useToggle } from './ui.jsx';

export function Logo() {
  return (
    <span className="logo">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="#03A9F4" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="#fff" strokeWidth="2.5" />
        <path d="M16 10v6l4 3" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="logo-text">time<b>tracker</b></span>
    </span>
  );
}

export function Avatar({ name, size = 32 }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</span>
  );
}

function UserMenu() {
  const { user, logout } = useData();
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  return (
    <>
      <button ref={ref} type="button" className="avatar-btn" onClick={toggle} aria-label="Account menu">
        <Avatar name={user.name} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} align="right" className="menu user-menu">
        <div className="user-menu-head">
          <Avatar name={user.name} size={40} />
          <div>
            <div className="user-menu-name">{user.name}</div>
            <div className="user-menu-email">{user.email}</div>
          </div>
        </div>
        <NavLink to="/profile" className="menu-item" onClick={close}><UserRound size={16} /> Profile settings</NavLink>
        <button type="button" className="menu-item" onClick={logout}><LogOut size={16} /> Log out</button>
      </Popover>
    </>
  );
}

const NAV = [
  { to: '/tracker', label: 'Time Tracker', icon: Clock },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { section: 'Analyze' },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Reports', icon: ChartColumn },
  { section: 'Manage' },
  { to: '/projects', label: 'Projects', icon: FolderOpen },
  { to: '/team', label: 'Team', icon: Users, admin: true },
  { to: '/clients', label: 'Clients', icon: Contact },
  { to: '/tags', label: 'Tags', icon: Tag },
  { to: '/settings', label: 'Settings', icon: Settings, admin: true },
];

export function Layout() {
  const { settings, isAdmin, users } = useData();
  const pendingCount = isAdmin ? users.filter((u) => u.pending).length : 0;
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('tt.sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Admins: refresh the team list so new sign-up requests show up without reloading.
  const { reloadUsers } = useData();
  useEffect(() => {
    if (!isAdmin) return undefined;
    reloadUsers().catch(() => {});
    const t = setInterval(() => reloadUsers().catch(() => {}), 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [isAdmin, reloadUsers, location.pathname]);

  const toggleSidebar = () => {
    if (window.innerWidth < 900) {
      setMobileOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem('tt.sidebar', c ? 'open' : 'collapsed');
      } catch {
        // ignore
      }
      return !c;
    });
  };

  return (
    <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
      <header className="topbar">
        <button type="button" className="icon-btn hamburger" onClick={toggleSidebar} aria-label="Toggle menu">
          <Menu size={22} />
        </button>
        <NavLink to="/tracker" className="topbar-logo"><Logo /></NavLink>
        <div className="topbar-workspace">{settings.workspaceName}</div>
        <div className="topbar-right">
          <UserMenu />
        </div>
      </header>
      <nav className="sidebar">
        {NAV.filter((n) => !n.admin || isAdmin).map((n) =>
          n.section ? (
            <div key={n.section} className="sidebar-section">{n.section}</div>
          ) : (
            <NavLink key={n.to} to={n.to} className="sidebar-link" title={n.label}>
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.to === '/team' && pendingCount > 0 && <em className="nav-badge" title="Pending sign-up requests">{pendingCount}</em>}
            </NavLink>
          ),
        )}
      </nav>
      <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
