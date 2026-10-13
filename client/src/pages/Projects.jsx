import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, FolderOpen, Lock, Globe } from 'lucide-react';
import { api } from '../api.js';
import { useData, useMoney } from '../store.jsx';
import { ProjectFormModal } from '../components/pickers.jsx';
import { KebabMenu, Confirm, Empty } from '../components/ui.jsx';
import { formatDuration } from '../utils/time.js';

export default function Projects() {
  const { projects, clients, isAdmin, canCreate, upsertProject, reloadProjects, toast } = useData();
  const money = useMoney();
  const navigate = useNavigate();
  const [show, setShow] = useState('active');
  const [clientFilter, setClientFilter] = useState('');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (show === 'all' || (show === 'archived') === p.archived) &&
        (!clientFilter || (clientFilter === 'none' ? !p.clientId : p.clientId === Number(clientFilter))) &&
        (!term || p.name.toLowerCase().includes(term) || (p.clientName ?? '').toLowerCase().includes(term)),
    );
  }, [projects, show, clientFilter, search]);

  const setArchived = async (p, archived) => {
    try {
      const { project } = await api.put(`/projects/${p.id}`, { archived });
      upsertProject(project);
    } catch (err) {
      toast(err.message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        {canCreate && <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>Create new project</button>}
      </div>
      <div className="filter-bar">
        <select className="filter-btn" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="active">Show active</option>
          <option value="archived">Show archived</option>
          <option value="all">Show all</option>
        </select>
        <select className={`filter-btn ${clientFilter ? 'active' : ''}`} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">Client: all</option>
          <option value="none">Without client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="search-box">
          <Search size={16} />
          <input placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <div className="card">
        <div className="card-caption">Projects</div>
        {list.length === 0 ? (
          <Empty icon={<FolderOpen size={44} />} title={projects.length ? 'No matching projects' : 'No projects yet'}>
            {canCreate && !projects.length && 'Create your first project to start organizing your time.'}
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Client</th>
                <th className="num">Tracked</th>
                <th className="num">Amount</th>
                <th>Access</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={isAdmin ? 'clickable' : ''} onClick={() => isAdmin && navigate(`/projects/${p.id}`)}>
                  <td>
                    <span className="project-name" style={{ color: p.color }}>
                      <span className="dot" style={{ background: p.color }} />
                      {isAdmin ? <Link to={`/projects/${p.id}`} style={{ color: 'inherit' }} onClick={(e) => e.stopPropagation()}>{p.name}</Link> : p.name}
                    </span>
                    {p.archived && <span className="badge">Archived</span>}
                  </td>
                  <td>{p.clientName ?? <span className="muted">—</span>}</td>
                  <td className="num">{formatDuration(p.tracked)}</td>
                  <td className="num">{p.billable ? money(p.amount) : <span className="muted">—</span>}</td>
                  <td>
                    {p.isPublic ? (
                      <span className="access"><Globe size={14} /> Public</span>
                    ) : (
                      <span className="access"><Lock size={14} /> Private</span>
                    )}
                  </td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <KebabMenu
                        items={[
                          { label: 'Edit', onClick: () => navigate(`/projects/${p.id}`) },
                          { label: p.archived ? 'Restore' : 'Archive', onClick: () => setArchived(p, !p.archived) },
                          { label: 'Delete', danger: true, hidden: !p.archived, onClick: () => setDeleting(p) },
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && <ProjectFormModal onClose={() => setCreating(false)} onSaved={() => setCreating(false)} />}
      {deleting && (
        <Confirm
          title="Delete project"
          message={`Delete "${deleting.name}"? Its time entries are kept, but they will no longer be assigned to a project. This cannot be undone.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await api.del(`/projects/${deleting.id}`);
              await reloadProjects();
            } catch (err) {
              toast(err.message);
            }
          }}
        />
      )}
    </div>
  );
}
