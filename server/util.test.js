// Unit tests for request-input helpers (multi-project ids).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectIds, id, HttpError } from './util.js';

test('normalizeProjectIds returns null when the field is absent', () => {
  assert.equal(normalizeProjectIds(undefined), null);
  assert.equal(normalizeProjectIds(null), null);
});

test('normalizeProjectIds keeps valid ids, dedupes and drops junk', () => {
  assert.deepEqual(normalizeProjectIds([]), []);
  assert.deepEqual(normalizeProjectIds([1, '2', 2]), [1, 2]);
  assert.deepEqual(normalizeProjectIds([0, -1, 'x', null, 3.5, true]), []);
});

test('normalizeProjectIds rejects non-list values like tagIds does', () => {
  assert.throws(() => normalizeProjectIds(5), (e) => e instanceof HttpError && e.status === 400);
  assert.throws(() => normalizeProjectIds('1,2'), (e) => e instanceof HttpError && e.status === 400);
});

test('id still accepts positive integers only', () => {
  assert.equal(id(7), 7);
  assert.equal(id('7'), 7);
  assert.equal(id(0), null);
  assert.equal(id('x'), null);
});
