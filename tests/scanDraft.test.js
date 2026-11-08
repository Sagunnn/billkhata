import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftAge } from '../src/lib/scanDraft.js';
import { isChunkError } from '../src/lib/emergency.js';

test('how long ago a scan was left unfinished', () => {
  const now = Date.parse('2026-11-08T10:00:00Z');
  assert.equal(draftAge('2026-11-08T09:59:40Z', now), 'just now');
  assert.equal(draftAge('2026-11-08T09:58:00Z', now), '2 min ago');
  assert.equal(draftAge('2026-11-08T07:00:00Z', now), '3 hours ago');
  assert.equal(draftAge('2026-11-07T08:00:00Z', now), 'yesterday');
  assert.equal(draftAge('2026-11-05T08:00:00Z', now), '3 days ago');
});

test('a page file missing after an update is told apart from a bug', () => {
  assert.ok(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Settings-abc.js')));
  assert.ok(isChunkError(new TypeError('Importing a module script failed.')));
  assert.ok(!isChunkError(new TypeError("Cannot read properties of undefined (reading 'name')")));
});
