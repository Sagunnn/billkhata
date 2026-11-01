import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, cleanMoney, EMPTY_MONEY, moneyNow, removeEntry, setStart } from '../src/lib/money.js';

const at = new Date('2026-11-02T09:00:00');
const bill = (amount, paymentMethod, billDateAD, createdAt = '2026-11-02T10:00:00.000Z', extra = {}) => ({ id: `${amount}`, totalAmount: amount, paymentMethod, billDateAD, createdAt, ...extra });

test('nothing set yet: not ready, zeros', () => {
  const m = moneyNow(EMPTY_MONEY, [bill(500, 'Cash', '2026-11-02')]);
  assert.equal(m.ready, false);
  assert.equal(m.total, 0);
});

test('bills after the start lower cash or bank by how they were paid', () => {
  const money = setStart(EMPTY_MONEY, { cash: 5000, bank: 40000 }, at);
  const later = new Date(at.getTime() + 3600e3).toISOString();
  const m = moneyNow(money, [
    bill(630, 'Cash', '2026-11-02', later),
    bill(380, 'Digital QR / Card', '2026-11-03'),
    bill(999, 'Cash', '2026-11-01'), // before: already reflected in the starting amounts
    bill(200, 'Cash', '2026-11-02', '2026-11-01T00:00:00.000Z'), // same day, added before setting
    bill(150, 'Cash', '2026-11-04', later, { isSample: true }), // demo bill
    bill(4000, 'Cash', '2026-11-04', later, { excludeFromSpend: true }), // trip bill: your share is a separate entry
  ]);
  assert.deepEqual([m.cash, m.bank, m.total], [4370, 39620, 43990]);
  assert.deepEqual(m.spent, { cash: 630, bank: 380 });
});

test('money in, ATM moves and spending without a bill', () => {
  let money = setStart(EMPTY_MONEY, { cash: 1000, bank: 10000 }, at);
  money = addEntry(money, { kind: 'in', pot: 'bank', amount: 85000, note: 'Salary' }, at);
  money = addEntry(money, { kind: 'move', from: 'bank', to: 'cash', amount: 5000, note: 'ATM' }, at);
  money = addEntry(money, { kind: 'out', pot: 'cash', amount: 120.5, note: 'Bus fare' }, at);
  const m = moneyNow(money, []);
  assert.deepEqual([m.cash, m.bank], [5879.5, 90000]);
  assert.deepEqual(m.credited, { cash: 0, bank: 85000 });
  const undone = moneyNow(removeEntry(money, money.entries[0].id), []);
  assert.equal(undone.bank, 5000);
  assert.throws(() => addEntry(money, { kind: 'in', pot: 'cash', amount: 0 }), /above zero/);
});

test('setting the amounts again starts over (old entries kept as history)', () => {
  let money = setStart(EMPTY_MONEY, { cash: 1000, bank: 0 }, at);
  money = addEntry(money, { kind: 'in', pot: 'cash', amount: 500 }, at);
  money = setStart(money, { cash: 2000, bank: 3000 }, new Date('2026-11-05T09:00:00'));
  assert.equal(money.entries.length, 0);
  assert.equal(money.history.length, 1);
  assert.deepEqual([moneyNow(money, []).cash, moneyNow(money, []).bank], [2000, 3000]);
});

test('cleanMoney drops malformed entries from storage or a backup', () => {
  const m = cleanMoney({ since: '2026-11-02', start: { cash: '100', bank: null }, entries: [{ id: 'a', kind: 'in', pot: 'cash', amount: 50 }, { id: 'b', kind: 'weird', amount: 5 }, null] });
  assert.equal(m.entries.length, 1);
  assert.deepEqual(m.start, { cash: 100, bank: 0 });
  assert.deepEqual(cleanMoney('nope').entries, []);
});

test('money in keeps its source; totals by source; used sources offered first', async () => {
  const { creditsBySource, sourceOptions } = await import('../src/lib/money.js');
  let money = setStart(EMPTY_MONEY, { cash: 0, bank: 0 }, at);
  money = addEntry(money, { kind: 'in', pot: 'bank', amount: 85000, source: 'Salary' }, at);
  money = addEntry(money, { kind: 'in', pot: 'cash', amount: 500, source: 'Friend paid back', note: 'Ram, momo' }, new Date(at.getTime() + 1000));
  money = addEntry(money, { kind: 'in', pot: 'cash', amount: 300, source: 'Friend paid back' }, new Date(at.getTime() + 2000));
  money = addEntry(money, { kind: 'in', pot: 'bank', amount: 120 }, at); // no source given
  assert.deepEqual(creditsBySource(money), [
    { source: 'Salary', amount: 85000, count: 1 },
    { source: 'Friend paid back', amount: 800, count: 2 },
    { source: 'Other', amount: 120, count: 1 },
  ]);
  assert.deepEqual(sourceOptions(money).slice(0, 3), ['Friend paid back', 'Salary', 'Other']);
  assert.ok(sourceOptions(EMPTY_MONEY).includes('Salary'));
});
