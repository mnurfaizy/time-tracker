// Unit tests for entry mapping and suggestion grouping with multi-project entries.
// db.js creates a local SQLite file at import time, so point DATA_DIR at a temp dir first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-entries-test-'));
const { mapEntry, groupSuggestions } = await import('./entries.js');

// A row shaped like ENTRY_SELECT output.
const row = (over = {}) => ({
  id: 42,
  user_id: 7,
  description: 'koordinasi dengan LQ',
  project_id: 2,
  task_id: null,
  billable: 1,
  start_at: 1000,
  end_at: 2000,
  project_name: 'Dompet Dhuifa SOSMED',
  project_color: '#3E8E5E',
  project_rate: 250000,
  client_id: 20,
  client_name: 'Dompet Dhuafa',
  task_name: null,
  user_name: 'Ann',
  user_email: 'ann@example.com',
  tag_ids: '3,4',
  project_json: JSON.stringify([
    { id: 2, name: 'Dompet Dhuifa SOSMED', color: '#3E8E5E', clientId: 20, clientName: 'Dompet Dhuafa' },
    { id: 1, name: 'BSI BI Series', color: '#4F68D8', clientId: 10, clientName: 'BSI' },
  ]),
  ...over,
});

test('mapEntry exposes the full project list with the primary project first', () => {
  const e = mapEntry(row());
  assert.deepEqual(e.projectIds, [2, 1]); // primary (time_entries.project_id) first, rest by id
  assert.equal(e.projects.length, 2);
  assert.equal(e.projects[0].id, 2);
  assert.equal(e.projects[0].clientName, 'Dompet Dhuafa');
  // Legacy single-project fields still describe the primary project.
  assert.equal(e.projectId, 2);
  assert.equal(e.projectName, 'Dompet Dhuifa SOSMED');
  assert.equal(e.projectColor, '#3E8E5E');
  assert.equal(e.clientId, 20);
  assert.equal(e.rate, 250000);
  assert.deepEqual(e.tagIds, [3, 4]);
});

test('mapEntry keeps the primary first even when it has the higher id', () => {
  const e = mapEntry(row({ project_id: 9, project_json: JSON.stringify([{ id: 2, name: 'A', color: '#111', clientId: null, clientName: null }]) }));
  assert.deepEqual(e.projectIds, [9, 2]);
  assert.equal(e.projects[0].id, 9);
});

test('mapEntry falls back to the joined columns when a primary project has no junction row', () => {
  const e = mapEntry(row({ project_json: null }));
  assert.deepEqual(e.projectIds, [2]);
  assert.equal(e.projects[0].name, 'Dompet Dhuifa SOSMED');
  assert.equal(e.projects[0].clientName, 'Dompet Dhuafa');
});

test('mapEntry tolerates broken project_json and empty selections', () => {
  const broken = mapEntry(row({ project_json: 'not json', project_id: null, project_name: null, project_color: null, client_id: null, client_name: null }));
  assert.deepEqual(broken.projectIds, []);
  assert.deepEqual(broken.projects, []);
  const empty = mapEntry(row({ project_json: '[]', project_id: null, project_name: null, project_color: null, client_id: null, client_name: null }));
  assert.deepEqual(empty.projects, []);
});

const sugRow = (over = {}) => ({
  description: 'koordinasi dengan LQ',
  project_id: 2,
  task_id: null,
  billable: 1,
  tag_ids: '3',
  project_ids: '2,1',
  start_at: 5000,
  ...over,
});

test('groupSuggestions dedupes by description + project set + task, keeping the newest', () => {
  const out = groupSuggestions([
    sugRow({ start_at: 1000, billable: 0, tag_ids: null }),
    sugRow({ start_at: 9000, billable: 1, tag_ids: '3,8' }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].projectIds, [2, 1]);
  assert.equal(out[0].last, 9000);
  assert.equal(out[0].billable, true);
  assert.deepEqual(out[0].tagIds, [3, 8]);
});

test('groupSuggestions treats different project sets as distinct activities', () => {
  const out = groupSuggestions([
    sugRow({ start_at: 1000, project_ids: '2,1' }),
    sugRow({ start_at: 2000, project_ids: '1,2' }), // same set, different order -> same activity
    sugRow({ start_at: 3000, project_ids: '2' }),
  ]);
  assert.equal(out.length, 2);
  // Newest activity first; ids keep the primary (time_entries.project_id) first.
  assert.deepEqual(out.map((s) => s.projectIds), [[2], [2, 1]]);
  assert.deepEqual(out.map((s) => s.last), [3000, 2000]);
  assert.ok(out.every((s) => s.projectId === 2));
});

test('groupSuggestions caps the list at 8 and handles missing projects/tags', () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    sugRow({ description: `task ${i}`, project_ids: null, tag_ids: null, project_id: null, start_at: i * 1000 }));
  const out = groupSuggestions(rows);
  assert.equal(out.length, 8);
  assert.deepEqual(out[0].projectIds, []);
  assert.deepEqual(out[0].tagIds, []);
  // Most recent first.
  assert.equal(out[0].description, 'task 11');
});
