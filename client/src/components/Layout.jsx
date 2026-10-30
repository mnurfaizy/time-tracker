import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Timer, CalendarDays, LayoutDashboard, ChartPie, FolderKanban, Briefcase, Tag, Users, Settings, Menu, LogOut, UserRound, ChevronsUpDown,
} from 'lucide-react';
import { useData } from '../store.jsx';
import { Popover, useToggle } from './ui.jsx';
import { WorkspaceSwitcher } from './Workspaces.jsx';

export function Logo() {
  return (
    <span className="logo">
      <Timer size={20} strokeWidth={2.25} className="logo-icon" aria-hidden="true" />
      <span className="logo-text">timetracker.</span>
    </span>
  );
}

export function Avatar({ name, size = 36 }) {
  const initials = String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>{initials}</span>
  );
}

function UserCard() {
  const { user, logout } = useData();
  const ref = useRef(null);
  const [open, , toggle, close] = useToggle();
  return (
    <>
      <button ref={ref} type="button" className="user-card" onClick={toggle} aria-label="Account menu">
        <Avatar name={user.name} />
        <span className="user-card-text">
          <span className="user-card-name truncate">{user.name}</span>
          <span className="user-card-meta truncate">{user.role === 'admin' ? 'Admin' : 'Member'} · {user.email}</span>
        </span>
        <ChevronsUpDown size={14} className="user-card-chevron" />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} className="menu user-menu">
        <NavLink to="/profile" className="menu-item" onClick={close}><UserRound size={16} /> Profile settings</NavLink>
        <button type="button" className="menu-item" onClick={logout}><LogOut size={16} /> Log out</button>
      </Popover>
    </>
  );
}

export function Layout() {
  const { settings, isAdmin, users, reloadUsers, workspaces, canCreateWorkspace } = useData();
  const hasSwitcher = workspaces.length > 1 || canCreateWorkspace;
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pendingCount = isAdmin ? users.filter((u) => u.pending).length : 0;

  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Admins: refresh the team list so new sign-up requests show up without reloading.
  useEffect(() => {
    if (!isAdmin) return undefined;
    reloadUsers().catch(() => {});
    const t = setInterval(() => document.visibilityState === 'visible' && reloadUsers().catch(() => {}), 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [isAdmin, reloadUsers, location.pathname]);

  const sections = [
    {
      // With the switcher on top the workspace name is already shown there.
      label: hasSwitcher ? 'Track' : settings.workspaceName,
      items: [
        { to: '/tracker', label: 'Time Tracker', icon: Timer },
        { to: '/calendar', label: 'Calendar', icon: CalendarDays },
        { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { to: '/reports', label: 'Reports', icon: ChartPie },
      ],
    },
    {
      label: 'Manage',
      items: [
        { to: '/projects', label: 'Projects', icon: FolderKanban },
        { to: '/clients', label: 'Clients', icon: Briefcase },
        { to: '/tags', label: 'Tags', icon: Tag },
      ],
    },
    isAdmin && {
      label: 'Team',
      items: [
        { to: '/team', label: 'Members', icon: Users, badge: pendingCount, badgeTitle: 'Pending sign-up requests' },
        { to: '/settings', label: 'Settings', icon: Settings },
      ],
    },
  ].filter(Boolean);

  return (
    <div className={`app ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
      <header className="mobile-bar">
        <button type="button" className="icon-btn" onClick={() => setMobileOpen((o) => !o)} aria-label="Toggle menu">
          <Menu size={22} />
        </button>
        <NavLink to="/tracker" className="sidebar-brand-link"><Logo /></NavLink>
      </header>
      <aside className="sidebar">
        <NavLink to="/tracker" className="sidebar-brand"><Logo /></NavLink>
        <WorkspaceSwitcher />
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.label} className="sidebar-group">
              <div className="sidebar-section truncate">{section.label}</div>
              {section.items.map((n) => (
                <NavLink key={n.to} to={n.to} className="sidebar-link">
                  <n.icon size={18} />
                  <span className="sidebar-link-label">{n.label}</span>
                  {n.badge > 0 && <em className="nav-badge" title={n.badgeTitle}>{n.badge}</em>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <UserCard />
      </aside>
      <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />
      <main className="main">
        <div className="main-panel">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
