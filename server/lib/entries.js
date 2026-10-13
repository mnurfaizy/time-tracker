import { q } from '../db.js';

export const ENTRY_SELECT = `
SELECT e.*,
  p.name AS project_name, p.color AS project_color, p.hourly_rate AS project_rate,
  c.id AS client_id, c.name AS client_name,
  t.name AS task_name,
  u.name AS user_name, u.email AS user_email,
  (SELECT group_concat(et.tag_id) FROM entry_tags et WHERE et.entry_id = e.id) AS tag_ids
FROM time_entries e
LEFT JOIN projects p ON p.id = e.project_id
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN tasks t ON t.id = e.task_id
JOIN users u ON u.id = e.user_id`;

export function mapEntry(r) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    description: r.description,
    projectId: r.project_id,
    projectName: r.project_name ?? null,
    projectColor: r.project_color ?? null,
    clientId: r.client_id ?? null,
    clientName: r.client_name ?? null,
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
