import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, validateBackup } from '../src/lib/backup.js';

test('statements, screenshots and link choices survive a backup', () => {
  const st = { id: 's1', bank: 'Nabil Bank', rows: [{ key: 'k1', date: '2026-10-29', debit: 630, description: 'FONEPAY' }, { date: 'bad' }] };
  const pay = { id: 'p1', amount: 630, dateAD: '2026-10-29', image: 'data:image/jpeg;base64,AAAA' };
  const backup = JSON.parse(JSON.stringify(buildBackup({}, [], [], { statements: [st], payments: [pay, { id: 'p2', image: 'https://x' }], reconOverrides: { links: [['b:k1', 'p:p1']], unlinks: [] } })));
  const v = validateBackup(backup);
  assert.equal(v.ok, true);
  assert.equal(v.statements[0].rows.length, 1, 'the row with a bad date is dropped');
  assert.deepEqual(v.payments.map((p) => p.id), ['p1']);
  assert.deepEqual(v.reconOverrides.links, [['b:k1', 'p:p1']]);
  assert.ok(v.skipped.some((s) => s.includes('Payment screenshot #2')));
});

test('older backups without bank data still restore', () => {
  const v = validateBackup({ version: 1, expenses: [] });
  assert.equal(v.ok, true);
  assert.deepEqual([v.statements, v.payments, v.reconOverrides], [[], [], null]);
});
