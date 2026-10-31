import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bankRowKey } from '../src/lib/bank/statement.js';
import { linkCandidates, nameScore, reconcile, unlinkPairs } from '../src/lib/bank/reconcile.js';

const row = (o) => { const r = { time: '', description: '', refs: [], debit: null, credit: null, balance: null, seq: 0, ...o }; r.key = bankRowKey(r); return r; };
const pay = (o) => ({ id: o.id, amount: 0, dateAD: '', time: '', merchant: '', refs: [], direction: 'out', status: 'success', ...o });
const bill = (o) => ({ paymentMethod: 'Digital QR / Card', ...o });

test('shop names in bank narrations', () => {
  assert.equal(nameScore('Kotheys Pimbal', 'FONEPAY/712345678/KOTHEYS PIM'), 1);
  assert.equal(nameScore('Bhatbhateni Supermarket', 'QR PAYMENT BHATBHATENI'), 1);
  assert.equal(nameScore('Kotheys Pimbal', 'ATM WITHDRAWAL'), 0);
});

test('bank row + screenshot + bill become one row', () => {
  const b = row({ date: '2026-10-29', description: 'FONEPAY 712345678 KOTHEYS', refs: ['712345678'], debit: 630, balance: 9370 });
  const p = pay({ id: 'p1', amount: 630, dateAD: '2026-10-29', time: '14:32', merchant: 'KOTHEYS PIMBAL', refs: ['712345678'] });
  const e = bill({ id: 'e1', totalAmount: 630, billDateAD: '2026-10-29', merchantName: 'Kotheys Pimbal' });
  const { entries, stats } = reconcile({ bankRows: [b], payments: [p], expenses: [e] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'bank+payment+expense');
  assert.equal(entries[0].time, '14:32');
  assert.ok(entries[0].reasons.includes('transaction ID in the narration'));
  assert.equal(stats.withPayment, 1);
});

test('the transaction ID decides between two equal payments on the same day', () => {
  const b1 = row({ date: '2026-10-29', description: 'FONEPAY 111111111', refs: ['111111111'], debit: 500, seq: 1 });
  const b2 = row({ date: '2026-10-29', description: 'FONEPAY 222222222', refs: ['222222222'], debit: 500, seq: 2 });
  const p1 = pay({ id: 'p1', amount: 500, dateAD: '2026-10-29', refs: ['222222222'] });
  const p2 = pay({ id: 'p2', amount: 500, dateAD: '2026-10-29', refs: ['111111111'] });
  const { entries } = reconcile({ bankRows: [b1, b2], payments: [p1, p2], expenses: [] });
  const of = (pid) => entries.find((x) => x.payment?.id === pid).bank.description;
  assert.equal(of('p1'), 'FONEPAY 222222222');
  assert.equal(of('p2'), 'FONEPAY 111111111');
  assert.ok(entries.every((x) => !x.unsure));
});

test('without IDs, two equal payments are flagged as unsure', () => {
  const b1 = row({ date: '2026-10-29', description: 'QR PAYMENT', debit: 500, seq: 1 });
  const b2 = row({ date: '2026-10-29', description: 'QR PAYMENT', debit: 500, balance: 1, seq: 2 });
  const p1 = pay({ id: 'p1', amount: 500, dateAD: '2026-10-29' });
  const p2 = pay({ id: 'p2', amount: 500, dateAD: '2026-10-29' });
  const { entries } = reconcile({ bankRows: [b1, b2], payments: [p1, p2], expenses: [] });
  assert.equal(entries.filter((x) => x.bank && x.payment).length, 2);
  assert.ok(entries.some((x) => x.unsure));
});

test('a bank posting days later still matches; a week later does not', () => {
  const p = pay({ id: 'p1', amount: 1250, dateAD: '2026-10-24' });
  assert.equal(reconcile({ bankRows: [row({ date: '2026-10-26', debit: 1250 })], payments: [p] }).entries.length, 1);
  assert.equal(reconcile({ bankRows: [row({ date: '2026-10-31', debit: 1250 })], payments: [p] }).entries.length, 2);
});

test('money in is never matched to a bill; a failed payment is never matched', () => {
  const salary = row({ date: '2026-10-29', description: 'SALARY', credit: 630 });
  const e = bill({ id: 'e1', totalAmount: 630, billDateAD: '2026-10-29', merchantName: 'X' });
  assert.equal(reconcile({ bankRows: [salary], payments: [], expenses: [e] }).entries.length, 2);
  const failed = pay({ id: 'p1', amount: 630, dateAD: '2026-10-29', status: 'failed' });
  assert.equal(reconcile({ bankRows: [row({ date: '2026-10-29', debit: 630 })], payments: [failed] }).entries.length, 2);
});

test('a bill rounded off by the shop still matches the bank row', () => {
  const b = row({ date: '2026-10-29', description: 'QR BHATBHATENI', debit: 1250 });
  const e = bill({ id: 'e1', totalAmount: 1249.6, billDateAD: '2026-10-29', merchantName: 'Bhatbhateni' });
  const { entries } = reconcile({ bankRows: [b], payments: [], expenses: [e] });
  assert.equal(entries[0].status, 'bank+expense');
});

test('unlink and link by hand win over the scores', () => {
  const b = row({ date: '2026-10-29', debit: 630, description: 'FONEPAY' });
  const p = pay({ id: 'p1', amount: 630, dateAD: '2026-10-29' });
  const first = reconcile({ bankRows: [b], payments: [p] });
  const unlinks = unlinkPairs(first.entries[0]);
  const split = reconcile({ bankRows: [b], payments: [p], overrides: { unlinks } });
  assert.equal(split.entries.length, 2);
  const cands = linkCandidates(split.entries[0], split);
  assert.equal(cands.length, 1);
  const linked = reconcile({ bankRows: [b], payments: [p], overrides: { unlinks, links: [[...split.entries[0].nodes, ...cands[0].nodes]] } });
  assert.equal(linked.entries.length, 1);
  assert.ok(linked.entries[0].manual);
});

test('what needs a look, and the CSV', async () => {
  const { needsLook, visibleEntries, mergedCsv } = await import('../src/lib/bank/reconcile.js');
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const b = row({ date: '2026-10-29', description: 'ATM, THAMEL', debit: 2000, balance: 8000 });
  const lonePay = pay({ id: 'p9', amount: 75, dateAD: '2026-10-10', merchant: 'Tea' });
  const cashBill = bill({ id: 'e8', totalAmount: 300, billDateAD: '2026-10-05', merchantName: 'Cash shop', paymentMethod: 'Cash' });
  const qrBill = bill({ id: 'e9', totalAmount: 400, billDateAD: '2026-10-06', merchantName: 'QR shop' });
  const { entries } = reconcile({ bankRows: [b], payments: [lonePay], expenses: [cashBill, qrBill] });
  const shown = visibleEntries(entries, range);
  assert.deepEqual(shown.map((x) => x.name).sort(), ['ATM, THAMEL', 'QR shop', 'Tea']);
  assert.equal(needsLook(shown.find((x) => x.bank), range), 'No bill or screenshot for this payment');
  assert.equal(needsLook(shown.find((x) => x.payment), range), 'Not on the statement');
  const csv = mergedCsv(shown, range);
  assert.match(csv, /"ATM, THAMEL"/);
  assert.match(csv, /2000\.00,,8000\.00,statement/);
});
