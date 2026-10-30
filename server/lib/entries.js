import { q } from '../db.js';

// project_json packs every linked project (primary first) into one column, so list
// endpoints stay a single query. time_entries.project_id stays the primary project.
export const ENTRY_SELECT = `
SELECT e.*,
  p.name AS project_name, p.color AS project_color, p.hourly_rate AS project_rate,
  c.id AS client_id, c.name AS client_name,
  t.name AS task_name,
  u.name AS user_name, u.email AS user_email,
  (SELECT group_concat(et.tag_id) FROM entry_tags et WHERE et.entry_id = e.id) AS tag_ids,
  (SELECT json_group_array(json_object('id', ep.project_id, 'name', pr.name, 'color', pr.color,
     'clientId', pr.client_id, 'clientName', cl.name))
   FROM entry_projects ep
   JOIN projects pr ON pr.id = ep.project_id
   LEFT JOIN clients cl ON cl.id = pr.client_id
   WHERE ep.entry_id = e.id) AS project_json
FROM time_entries e
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN tasks t ON t.id = e.task_id
JOIN users u ON u.id = e.user_id`;

function parseProjectJson(v) {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.filter((p) => p && p.id != null && p.name) : [];
  } catch {
    return [];
  }
}

export function mapEntry(r) {
  let projects = parseProjectJson(r.project_json);
  if (r.project_id != null && !projects.some((p) => p.id === r.project_id)) {
    // Primary project missing from the junction (e.g. a row written before the upgrade):
    // rebuild it from the join, which is exactly the primary's columns.
    if (r.project_name) {
      projects = [{ id: r.project_id, name: r.project_name, color: r.project_color, clientId: r.client_id, clientName: r.client_name }, ...projects];
    }
  }
  const primary = projects.find((p) => p.id === r.project_id) ?? projects[0] ?? null;
  const rest = projects.filter((p) => p !== primary).sort((a, b) => a.id - b.id);
  const ordered = primary ? [primary, ...rest] : [];
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    description: r.description,
    projectId: primary?.id ?? null,
    projectName: primary?.name ?? null,
    projectColor: primary?.color ?? null,
    clientId: primary?.clientId ?? null,
    clientName: primary?.clientName ?? null,
    projectIds: ordered.map((p) => p.id),
    projects: ordered,
    taskId: r.task_id,
    taskName: r.task_name ?? null,
    billable: !!r.billable,
    rate: r.project_rate ?? null,
    start: r.start_at,
    end: r.end_at,
    tagIds: r.tag_ids ? String(r.tag_ids).split(',').map(Number) : [],
  };
}

export async function getEntry(entryId) {
  const row = await q.get(`${ENTRY_SELECT} WHERE e.id = ?`, entryId);
  return row ? mapEntry(row) : null;
}

/** Recent-activity suggestions: collapse (description, project set, task) to the newest row. */
export function groupSuggestions(rows) {
  const byKey = new Map();
  for (const s of rows) {
    const ids = s.project_ids ? String(s.project_ids).split(',').map(Number).filter(Number.isInteger) : [];
    const key = [s.description, [...ids].sort((a, b) => a - b).join('.'), s.task_id ?? ''].join('|');
    const prev = byKey.get(key);
    if (!prev || s.start_at > prev.start_at) byKey.set(key, { ...s, project_ids: ids });
  }
  return [...byKey.values()]
    .sort((a, b) => b.start_at - a.start_at)
    .slice(0, 8)
    .map((s) => {
      const rest = s.project_ids.filter((pid) => pid !== s.project_id).sort((a, b) => a - b);
      return {
        description: s.description,
        projectId: s.project_id,
        projectIds: s.project_id != null ? [s.project_id, ...rest] : [...rest],
        taskId: s.task_id,
        billable: !!s.billable,
        tagIds: s.tag_ids ? String(s.tag_ids).split(',').map(Number) : [],
        last: s.start_at,
      };
    });
}

/**
 * A project is being deleted: repoint affected entries to another linked project (or none),
 * clear tasks that belonged to it, and drop those tasks. Runs before the project row itself
 * is deleted, so the junction still knows the alternatives.
 */
export async function detachProject(projectId) {
  const affected = await q.all('SELECT id FROM time_entries WHERE project_id = ?', projectId);
  if (affected.length) {
    const marks = affected.map(() => '?').join(',');
    await q.run(
      `UPDATE time_entries SET
         project_id = COALESCE((
           SELECT ep.project_id FROM entry_projects ep
           WHERE ep.entry_id = time_entries.id AND ep.project_id <> ?
           ORDER BY ep.project_id LIMIT 1
         ), NULL),
         task_id = CASE WHEN EXISTS (SELECT 1 FROM tasks t WHERE t.id = time_entries.task_id AND t.project_id = ?)
                        THEN NULL ELSE task_id END,
         updated_at = ?
       WHERE id IN (${marks})`,
      projectId, projectId, Date.now(), ...affected.map((r) => r.id),
    );
  }
  await q.run('DELETE FROM tasks WHERE project_id = ?', projectId);
}
