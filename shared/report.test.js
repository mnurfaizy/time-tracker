// Unit tests for report aggregation with multi-project time entries.
// Run: npm test  (uses the built-in Node test runner)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, weekly, totals, entryProjects } from './report.js';

const HOUR = 3600000;
const ctx = { tz: 'UTC', defaultRate: 100, tagName: () => '' };

const BSI = { id: 1, name: 'BSI BI Series', color: '#4F68D8', clientId: 10, clientName: 'BSI' };
const DD = { id: 2, name: 'Dompet Dhuafa SOSMED', color: '#3E8E5E', clientId: 20, clientName: 'Dompet Dhuafa' };

const entry = (over = {}) => ({
  id: 1,
  userId: 7,
  userName: 'Ann',
  description: 'koordinasi dengan LQ',
  billable: true,
  rate: null,
  start: 0,
  end: HOUR,
  tagIds: [],
  projects: [BSI, DD],
  ...over,
});

test('totals counts a multi-project entry once', () => {
  const t = totals([entry(), entry({ start: 2 * HOUR, end: 3 * HOUR })], ctx.defaultRate);
  assert.equal(t.duration, 2 * HOUR);
  assert.equal(t.billableDuration, 2 * HOUR);
  assert.equal(t.amount, 200); // 2h * 100/h, not 4h
});

test('summarize by project attributes the entry to every selected project', () => {
  const nodes = summarize([entry()], 'project', null, ctx);
  assert.deepEqual(nodes.map((n) => n.key), ['p1', 'p2']);
  for (const n of nodes) {
    assert.equal(n.duration, HOUR, `project ${n.label} gets the full duration`);
    assert.equal(n.amount, 100);
    assert.equal(n.color, n.key === 'p1' ? BSI.color : DD.color);
    assert.equal(n.sub, n.key === 'p1' ? 'BSI' : 'Dompet Dhuafa');
  }
});

test('summarize by project with two levels still attributes per project', () => {
  const nodes = summarize([entry()], 'project', 'description', ctx);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0].children.map((c) => c.label), ['koordinasi dengan LQ']);
  assert.equal(nodes[0].children[0].duration, HOUR);
});

test('summarize by client merges projects that share a client', () => {
  const sameClient = entry({ projects: [BSI, { ...DD, clientId: 10, clientName: 'BSI' }] });
  const nodes = summarize([sameClient], 'client', null, ctx);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].duration, HOUR); // once, not twice
});

test('summarize by client with distinct clients lists each once', () => {
  const nodes = summarize([entry()], 'client', null, ctx);
  assert.deepEqual(nodes.map((n) => n.label).sort(), ['BSI', 'Dompet Dhuafa']);
  for (const n of nodes) assert.equal(n.duration, HOUR);
});

test('summarize by project groups an entry without projects under "(Without project)"', () => {
  const nodes = summarize([entry({ projects: [] })], 'project', null, ctx);
  assert.deepEqual(nodes.map((n) => n.label), ['(Without project)']);
  assert.equal(nodes[0].duration, HOUR);
});

test('summarize still supports legacy entries that only carry single-project fields', () => {
  const legacy = {
    id: 2, userId: 7, userName: 'Ann', description: 'old data', billable: false, rate: null,
    start: 0, end: HOUR, tagIds: [],
    projectId: 5, projectName: 'Legacy', projectColor: '#111', clientId: 9, clientName: 'Old client',
  };
  const byProject = summarize([legacy], 'project', null, ctx);
  assert.deepEqual(byProject.map((n) => n.key), ['p5']);
  assert.equal(byProject[0].duration, HOUR);
  const byClient = summarize([legacy], 'client', null, ctx);
  assert.deepEqual(byClient.map((n) => n.label), ['Old client']);
});

test('weekly attributes the entry to each project row without inflating days', () => {
  const days = ['1970-01-01', '1970-01-02'];
  const rows = weekly([entry()], 'project', days, ctx);
  assert.deepEqual(rows.map((r) => r.key), ['p1', 'p2']);
  for (const r of rows) {
    assert.equal(r.days['1970-01-01'], HOUR);
    assert.equal(r.days['1970-01-02'], 0);
    assert.equal(r.total, HOUR);
  }
});

test('entryProjects returns the meta list, deduplicated, with a legacy fallback', () => {
  assert.deepEqual(entryProjects(entry()), [BSI, DD]);
  assert.deepEqual(entryProjects(entry({ projects: [BSI, BSI] })), [BSI]);
  const none = entryProjects(entry({ projects: [] }));
  assert.equal(none.length, 0);
  const legacy = entryProjects({ projectId: 5, projectName: 'Legacy', projectColor: '#111', clientId: 9, clientName: 'Old client' });
  assert.deepEqual(legacy, [{ id: 5, name: 'Legacy', color: '#111', clientId: 9, clientName: 'Old client' }]);
});
