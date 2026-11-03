// Transfers between your own accounts: a bank loading a wallet, a wallet paying from its bank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTransfers, transferHint } from '../src/lib/bank/transfer.js';

test('a bank row loading a wallet is a transfer out to it; a fonepay payment is not', () => {
  assert.deepEqual(transferHint({ description: 'ESEWA LOAD 98XXXXXX12', debit: 500 }, 'Laxmi Sunrise Bank'), { dir: 'out', other: 'eSewa' });
  assert.deepEqual(transferHint({ description: 'Khalti wallet topup', debit: 1000 }, 'NIC Asia'), { dir: 'out', other: 'Khalti' });
  assert.equal(transferHint({ description: 'FONEPAY/712349999/HIMALAYAN JAVA', debit: 380 }, 'Laxmi Sunrise Bank'), null);
  assert.equal(transferHint({ description: 'ESEWA/BHATBHATENI', debit: 900 }, 'Laxmi Sunrise Bank'), null, 'paid a shop through eSewa, not a load');
});

test('a wallet credit from the linked bank is a transfer in; one from a person is money in', () => {
  assert.deepEqual(transferHint({ description: 'Load Fund from Laxmi Sunrise Bank', credit: 500 }, 'eSewa'), { dir: 'in', other: '' });
  assert.deepEqual(transferHint({ description: 'Fund received via ConnectIPS', credit: 2000 }, 'Khalti'), { dir: 'in', other: '' });
  assert.equal(transferHint({ description: 'Received from 9800000000 (Ram)', credit: 300 }, 'eSewa'), null);
  assert.equal(transferHint({ description: 'Payment to Kotheys Pimbal', debit: 500 }, 'eSewa'), null, 'the payment itself is spending');
});

test('both statements: the bank load and the wallet credit pair up; the wallet payment stays spending', () => {
  const bank = { id: 'b', bank: 'Laxmi Sunrise Bank', rows: [
    { key: 'b1', date: '2026-11-01', description: 'ESEWA LOAD 98XXXXXX12', debit: 500 },
    { key: 'b2', date: '2026-11-01', description: 'FONEPAY/7123/HIMALAYAN JAVA', debit: 380 },
  ] };
  const wallet = { id: 'w', bank: 'eSewa', rows: [
    { key: 'w1', date: '2026-11-01', description: 'Load Fund from bank', credit: 500 },
    { key: 'w2', date: '2026-11-01', description: 'Payment to Kotheys Pimbal', debit: 500 },
  ] };
  const t = findTransfers([bank, wallet]);
  assert.deepEqual(t.get('b1'), { dir: 'out', other: 'eSewa', partner: 'w1', account: 'Laxmi Sunrise Bank' });
  assert.deepEqual(t.get('w1'), { dir: 'in', other: 'Laxmi Sunrise Bank', partner: 'b1', account: 'eSewa' });
  assert.equal(t.has('w2'), false, 'the payment from the wallet is the expense');
  assert.equal(t.has('b2'), false);
});

test('a row you marked wins over the guess', () => {
  const s = { id: 'w', bank: 'eSewa', rows: [
    { key: 'a', date: '2026-11-01', description: 'Load Fund from bank', credit: 500, isTransfer: false },
    { key: 'b', date: '2026-11-02', description: 'Received from Dad', credit: 2000, isTransfer: true },
  ] };
  const t = findTransfers([s]);
  assert.equal(t.has('a'), false);
  assert.equal(t.get('b').dir, 'in');
});
