import { useState } from 'react';
import { Search, Contact } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { KebabMenu, Confirm, Empty } from '../components/ui.jsx';

/** Shared layout for the Clients and Tags pages. */
export function NamedListPage({ title, noun, icon, items, extraColumn, canCreate, isAdmin, onCreate, onRename, onArchive, onDelete }) {
  const [show, setShow] = useState('active');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(null);
  const term = search.trim().toLowerCase();
  const list = items.filter(
    (i) => (show === 'all' || (show === 'archived') === i.archived) && (!term || i.name.toLowerCase().includes(term)),
  );

  return (
    <div className="page">
      <div className="page-head"><h1>{title}</h1></div>
      <div className="filter-bar">
        <select className="filter-btn" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="active">Show active</option>
          <option value="archived">Show archived</option>
          <option value="all">Show all</option>
        </select>
        <label className="search-box">
          <Search size={16} />
          <input placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        {canCreate && (
          <form
            className="inline-add right"
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim() && (await onCreate(name.trim()))) setName('');
            }}
          >
            <input className="input" placeholder={`Add new ${noun}`} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Add</button>
          </form>
        )}
      </div>
      <div className="card">
        <div className="card-caption">{title}</div>
        {list.length === 0 ? (
          <Empty icon={icon} title={items.length ? `No matching ${title.toLowerCase()}` : `No ${title.toLowerCase()} yet`} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                {extraColumn && <th>{extraColumn.label}</th>}
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    {i.archived && <span className="badge">Archived</span>}
                  </td>
                  {extraColumn && <td>{extraColumn.render(i)}</td>}
                  <td className="col-actions">
                    {isAdmin && (
                      <KebabMenu
                        items={[
                          {
                            label: 'Edit',
                            onClick: () => {
                              const n = window.prompt(`${noun[0].toUpperCase()}${noun.slice(1)} name`, i.name);
                              if (n && n.trim() && n.trim() !== i.name) onRename(i, n.trim());
                            },
                          },
                          { label: i.archived ? 'Restore' : 'Archive', onClick: () => onArchive(i, !i.archived) },
                          { label: 'Delete', danger: true, hidden: !i.archived, onClick: () => setDeleting(i) },
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
      {deleting && (
        <Confirm
          title={`Delete ${noun}`}
          message={`Delete "${deleting.name}"? This cannot be undone.`}
          onClose={() => setDeleting(null)}
          onConfirm={() => onDelete(deleting)}
        />
      )}
    </div>
  );
}

export default function Clients() {
  const { clients, canCreate, isAdmin, upsertClient, reloadClients, reloadProjects, toast } = useData();
  const guard = async (fn) => {
    try {
      await fn();
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  };
  return (
    <NamedListPage
      title="Clients"
      noun="client"
      icon={<Contact size={44} />}
      items={clients}
      canCreate={canCreate}
      isAdmin={isAdmin}
      extraColumn={{ label: 'Projects', render: (c) => c.projectCount }}
      onCreate={(name) => guard(async () => upsertClient((await api.post('/clients', { name })).client))}
      onRename={(c, name) => guard(async () => {
        upsertClient((await api.put(`/clients/${c.id}`, { name })).client);
        reloadProjects();
      })}
      onArchive={(c, archived) => guard(async () => upsertClient((await api.put(`/clients/${c.id}`, { archived })).client))}
      onDelete={(c) => guard(async () => {
        await api.del(`/clients/${c.id}`);
        await Promise.all([reloadClients(), reloadProjects()]);
      })}
    />
  );
}
