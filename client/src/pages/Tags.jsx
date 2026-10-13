import { Tag } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../store.jsx';
import { NamedListPage } from './Clients.jsx';

export default function Tags() {
  const { tags, canCreate, isAdmin, upsertTag, reloadTags, toast } = useData();
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
      title="Tags"
      noun="tag"
      icon={<Tag size={44} />}
      items={tags}
      canCreate={canCreate}
      isAdmin={isAdmin}
      onCreate={(name) => guard(async () => upsertTag((await api.post('/tags', { name })).tag))}
      onRename={(t, name) => guard(async () => upsertTag((await api.put(`/tags/${t.id}`, { name })).tag))}
      onArchive={(t, archived) => guard(async () => upsertTag((await api.put(`/tags/${t.id}`, { archived })).tag))}
      onDelete={(t) => guard(async () => {
        await api.del(`/tags/${t.id}`);
        await reloadTags();
      })}
    />
  );
}
