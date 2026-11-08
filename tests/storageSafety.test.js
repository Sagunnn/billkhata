import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advice, isIos } from '../src/lib/storageSafety.js';
import { backupSize, backupStatus, buildBackup, changedSince, validateBackup } from '../src/lib/backup.js';

test('how safe the bills are, in plain words', () => {
  assert.equal(advice({ supported: true, persisted: true }).level, 'safe');
  assert.equal(advice({ supported: true, persisted: false, ios: true, installed: true }).level, 'safe');
  const safari = advice({ supported: true, persisted: false, ios: true, installed: false });
  assert.deepEqual([safari.level, safari.action], ['risk', 'install']);
  assert.match(safari.text, /7 days/);
  assert.deepEqual([advice({ supported: true, persisted: false }).action], ['keep']);
  assert.equal(advice({ supported: false, persisted: false }).level, 'unknown');
  assert.ok(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'));
  assert.ok(!isIos('Mozilla/5.0 (Linux; Android 14)'));
});

test('bills since the last backup, and when to remind', () => {
  const at = '2026-11-01T08:00:00.000Z';
  const now = Date.parse('2026-11-08T10:00:00Z');
  const bill = (i, t, extra = {}) => ({ id: `b${i}`, updatedAt: t, ...extra });
  const list = [bill(1, '2026-10-30T00:00:00Z'), bill(2, '2026-11-02T00:00:00Z'), bill(3, '2026-11-03T00:00:00Z'), bill(4, '2026-11-05T00:00:00Z', { isSample: true })];
  assert.equal(changedSince(list, at), 2);
  assert.equal(changedSince(list, ''), 3);
  const st = backupStatus(at, 3, now, 2);
  assert.equal(st.text, 'Backed up 7 days ago · 2 bills since');
  assert.deepEqual([st.stale, st.nudge], [false, false]);
  assert.equal(backupStatus(at, 30, now, 12).nudge, true);
  assert.equal(backupStatus('2026-10-20T08:00:00Z', 3, now, 1).nudge, true); // 19 days, something new
  assert.equal(backupStatus('2026-10-20T08:00:00Z', 3, now, 0).nudge, false); // old, but nothing new
  assert.equal(backupStatus('', 4, now, 4).nudge, false); // a few bills, never backed up: just the dot
  assert.equal(backupStatus('', 5, now, 5).nudge, true);
});

test('a backup without photos is small, says so, and still restores everything else', () => {
  const photo = `data:image/jpeg;base64,${'A'.repeat(300000)}`;
  const expenses = [{ id: 'e1', merchantName: 'Shop', totalAmount: 100, billDateAD: '2026-11-01', receiptImage: photo, imageHash: 'abc' }];
  const trips = [{ id: 't1', name: 'Trek', members: [{ id: 'me', name: 'Me', isMe: true }], entries: [{ id: 'x', title: 'Taxi', totalAmount: 900, items: [], receiptImage: photo }] }];
  const full = buildBackup({ fullName: 'Ram' }, expenses, trips);
  const small = buildBackup({ fullName: 'Ram' }, expenses, trips, {}, null, { photos: false });
  assert.ok(JSON.stringify(small).length < 5000 && JSON.stringify(full).length > 600000);
  assert.equal(small.expenses[0].receiptImage, undefined);
  assert.equal(small.expenses[0].imageHash, 'abc');
  assert.equal(small.trips[0].entries[0].receiptImage, undefined);
  const back = validateBackup(JSON.parse(JSON.stringify(small)));
  assert.equal(back.ok, true);
  assert.equal(back.photos, false);
  assert.equal(back.expenses.length, 1);
  assert.equal(validateBackup(JSON.parse(JSON.stringify(full))).photos, true);
  assert.ok(backupSize(expenses, trips) > 600000 && backupSize(expenses, trips, [], { photos: false }) < 5000);
});
