import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateRows, overlapWith, sameAccount, withoutOverlaps } from '../src/lib/bank/overlap.js';

const r = (date, debit, balance = null, description = '', extra = {}) => ({ date, debit, credit: null, balance, description, refs: [], ...extra });
const c = (date, credit, balance = null, description = '') => ({ date, debit: null, credit, balance, description, refs: [] });

test('the same statement twice: every row is a duplicate', () => {
  const rows = [r('2026-10-25', 1250, 30750, 'FONEPAY/603118274/BHATBHATENI'), r('2026-10-26', 5000, 25750, 'ATM WDL')];
  assert.deepEqual([...duplicateRows(rows, rows)].sort(), [0, 1]);
});

test('overlapping dates: only the days already covered are duplicates', () => {
  const old = [r('2026-10-24', 100, 900), r('2026-10-25', 200, 700), r('2026-10-26', 50, 650)];
  const next = [r('2026-10-25', 200, 700), r('2026-10-26', 50, 650), r('2026-10-27', 80, 570), r('2026-10-28', 20, 550)];
  assert.deepEqual([...duplicateRows(next, old)].sort(), [0, 1]);
});

test('two real रु 100 payments on one day stay two (balances differ); a third new one is new', () => {
  const old = [r('2026-10-29', 100, 900), r('2026-10-29', 100, 800)];
  const next = [r('2026-10-29', 100, 900), r('2026-10-29', 100, 800), r('2026-10-29', 100, 700)];
  assert.deepEqual([...duplicateRows(next, old)].sort(), [0, 1]);
});

test('a screenshot with cut-off descriptions and no balances still matches the PDF rows', () => {
  const pdf = [r('2026-11-01', 135, 305.21, 'Paid for Bagmati Khaja Ghar'), r('2026-10-31', 650, 440.21, 'Fund Transfer to Bank')];
  const shot = [r('2026-10-31', 650, null, 'Fund Trans'), r('2026-11-01', 135, null, 'Paid for Bag')];
  assert.deepEqual([...duplicateRows(shot, pdf)].sort(), [0, 1]);
  // Without balances on either side, each saved row still matches only once.
  assert.deepEqual([...duplicateRows([r('2026-11-01', 135), r('2026-11-01', 135)], [r('2026-11-01', 135)])], [0]);
});

test('transaction date vs value date: a day apart with the same balance is the same row', () => {
  assert.equal(duplicateRows([r('2026-10-30', 630, 25120)], [r('2026-10-29', 630, 25120)]).size, 1);
  assert.equal(duplicateRows([r('2026-10-30', 630, 24490)], [r('2026-10-29', 630, 25120)]).size, 0); // a second payment
  assert.equal(duplicateRows([r('2026-10-30', 630)], [r('2026-10-29', 630)]).size, 0); // no balance: different days stay apart
});

test('the same transaction ID matches across formats; money in and out never match each other', () => {
  assert.equal(duplicateRows([r('2026-10-29', 630, null, 'x', { ref: 'FP712345678' })], [r('2026-10-30', 630, 9000, 'y', { refs: ['FP712345678'] })]).size, 1);
  assert.equal(duplicateRows([c('2026-10-29', 630, 9000)], [r('2026-10-29', 630, 9000)]).size, 0);
});

test('sameAccount: last 4 digits and names', () => {
  assert.ok(sameAccount({ bank: 'Global IME Bank', account: '0123' }, { bank: 'Global IME', account: '0123' }));
  assert.ok(sameAccount({ bank: 'eSewa' }, { bank: 'esewa' }));
  assert.ok(!sameAccount({ bank: 'eSewa' }, { bank: 'Khalti' }));
  assert.ok(!sameAccount({ bank: 'Nabil Bank', account: '4321' }, { bank: 'Nabil Bank', account: '9999' }));
  assert.ok(sameAccount({ bank: 'Nabil Bank', account: '4321' }, { bank: 'Nabil Bank' }));
});

test('withoutOverlaps removes rows saved twice before, keeping the earlier statement; other accounts untouched', () => {
  const a = { id: 'a', bank: 'eSewa', importedAt: '2026-11-01T10:00:00Z', rows: [r('2026-10-31', 650, 440.21), r('2026-11-01', 135, 305.21)] };
  const b = { id: 'b', bank: 'eSewa', importedAt: '2026-11-02T10:00:00Z', rows: [r('2026-11-01', 135, 305.21), r('2026-11-02', 50, 255.21)] };
  const k = { id: 'k', bank: 'Khalti', importedAt: '2026-11-02T11:00:00Z', rows: [r('2026-11-01', 135, 1000)] };
  const out = withoutOverlaps([b, k, a]);
  const byId = Object.fromEntries(out.map((s) => [s.id, s]));
  assert.equal(byId.a.rows.length, 2);
  assert.deepEqual(byId.b.rows.map((x) => x.date), ['2026-11-02']);
  assert.equal(byId.b.overlapRemoved, 1);
  assert.equal(byId.k.rows.length, 1);
});

test('overlapWith: count and the overlapping statements, for the upload preview', () => {
  const saved = [{ id: 'a', bank: 'eSewa', from: '2026-10-24', to: '2026-10-31', importedAt: '1', rows: [r('2026-10-30', 100, 500), r('2026-10-31', 650, 440.21)] }];
  const ov = overlapWith([r('2026-10-31', 650, 440.21), r('2026-11-01', 135, 305.21)], { bank: 'eSewa' }, saved);
  assert.equal(ov.count, 1);
  assert.deepEqual([...ov.dupes], [0]);
  assert.deepEqual(ov.from.map((s) => s.id), ['a']);
  assert.equal(overlapWith([r('2026-10-31', 650, 440.21)], { bank: 'Khalti' }, saved).count, 0);
});
