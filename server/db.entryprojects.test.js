// Database-level tests for the entry_projects junction: schema, backfill migration and
// what happens to entries when a project is deleted.
// Uses a throwaway SQLite file — never touches the real data/ folder.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-db-test-'));
const { initDb, q } = await import('./db.js');
const { detachProject } = await import('./lib/entries.js');

const NOW = Date.now();

async function insertUser(name) {
  const { rows } = await q.run('INSERT INTO users (name, email, created_at) VALUES (?, ?, ?) RETURNING id', name, `${name}@example.com`, NOW);
  return rows[0].id;
}

async function insertProject(name) {
  const { rows } = await q.run('INSERT INTO projects (workspace_id, name, created_at) VALUES (1, ?, ?) RETURNING id', name, NOW);
  return rows[0].id;
}

async function insertEntry(userId, projectId, taskId = null) {
  const { rows } = await q.run(
    'INSERT INTO time_entries (workspace_id, user_id, description, project_id, task_id, start_at, end_at, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    userId, '', projectId, taskId, NOW, NOW + 1000, NOW, NOW,
  );
  return rows[0].id;
}

async function insertTask(projectId, name) {
  const { rows } = await q.run('INSERT INTO tasks (project_id, name, created_at) VALUES (?, ?, ?) RETURNING id', projectId, name, NOW);
  return rows[0].id;
}

const link = (entryId, projectId) => q.run('INSERT INTO entry_projects (entry_id, project_id) VALUES (?, ?)', entryId, projectId);
const linkedIds = async (entryId) => (await q.all('SELECT project_id FROM entry_projects WHERE entry_id = ? ORDER BY project_id', entryId)).map((r) => r.project_id);

before(async () => {
  await initDb();
  await q.run("INSERT INTO workspaces (id, name, slug, created_at) VALUES (1, 'Test', 'test', ?)", NOW);
});

test('initDb creates the entry_projects table and backfills existing entries', async () => {
  // Simulate a database from the single-project version: junction table missing.
  await q.run('DROP TABLE entry_projects');
  const userId = await insertUser('legacy');
  const projectId = await insertProject('Legacy project');
  const entryId = await insertEntry(userId, projectId);

  await initDb(); // upgrade path

  assert.deepEqual(await linkedIds(entryId), [projectId]);
  const row = await q.get('SELECT project_id FROM time_entries WHERE id = ?', entryId);
  assert.equal(row.project_id, projectId);
});

test('deleting a project repoints the primary project and keeps the rest', async () => {
  const userId = await insertUser('multi');
  const a = await insertProject('BSI BI Series');
  const b = await insertProject('Dompet Dhuafa SOSMED');
  const taskB = await insertTask(b, 'Content plan');
  const entryId = await insertEntry(userId, a, taskB); // primary A, task of B
  await link(entryId, a);
  await link(entryId, b);
  const otherId = await insertEntry(userId, b);
  await link(otherId, b);

  // Mirror the delete route: detach first (junction still knows the alternatives), then drop the project.
  await detachProject(a);
  await q.run('DELETE FROM projects WHERE id = ?', a);

  // Entry keeps B as its primary, task of B survives.
  let row = await q.get('SELECT project_id, task_id FROM time_entries WHERE id = ?', entryId);
  assert.equal(row.project_id, b);
  assert.equal(row.task_id, taskB);
  assert.deepEqual(await linkedIds(entryId), [b]);
  // Untouched entry is unchanged.
  row = await q.get('SELECT project_id FROM time_entries WHERE id = ?', otherId);
  assert.equal(row.project_id, b);

  // Deleting the last project detaches the entry completely.
  await detachProject(b);
  await q.run('DELETE FROM projects WHERE id = ?', b);
  row = await q.get('SELECT project_id, task_id FROM time_entries WHERE id = ?', entryId);
  assert.equal(row.project_id, null);
  assert.equal(row.task_id, null);
  assert.deepEqual(await linkedIds(entryId), []);
  assert.equal(await q.get('SELECT 1 FROM tasks WHERE id = ?', taskB), null);
});

test('deleting a project clears task references from entries that had it as a secondary project', async () => {
  const userId = await insertUser('taskref');
  const a = await insertProject('Primary');
  const b = await insertProject('Secondary');
  const taskB = await insertTask(b, 'Secondary task');
  const entryId = await insertEntry(userId, a, taskB); // task belongs to secondary B
  await link(entryId, a);
  await link(entryId, b);

  await detachProject(b);

  const row = await q.get('SELECT project_id, task_id FROM time_entries WHERE id = ?', entryId);
  assert.equal(row.project_id, a);
  assert.equal(row.task_id, null, 'task of the deleted project must be cleared');
});
