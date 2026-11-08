import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAlsoPaid, equalPayers, payersOf, simplifyDebts } from '../src/lib/payers.js';
import { calculateTripSettlement, entryPayers, makeEntry, makeTripMember, quickTripEntry } from '../src/lib/trips.js';
import { computeSplit, makeMember, outstanding, splitText, transferKey } from '../src/lib/splitter.js';
import { outOfPocket } from '../src/lib/money.js';
import { parseShareFile, splitShareFile } from '../src/lib/share.js';

test('who paid: the main payer pays the rest; the others as entered, tidied', () => {
  assert.deepEqual(payersOf('r', [{ memberId: 'h', amount: '50' }], 120), [{ memberId: 'r', amount: 70 }, { memberId: 'h', amount: 50 }]);
  // Blank, zero, the main payer again, a repeat, or too much: dropped.
  assert.deepEqual(cleanAlsoPaid([{ memberId: 'h', amount: '' }, { memberId: 'r', amount: 10 }, { memberId: 's', amount: 30 }, { memberId: 's', amount: 5 }, { memberId: 'g', amount: 90 }], { total: 120, primaryId: 'r' }),
    [{ memberId: 's', amount: 30 }]);
  assert.deepEqual(equalPayers(['a', 'b', 'c'], 100), [{ memberId: 'a', amount: 33.34 }, { memberId: 'b', amount: 33.33 }, { memberId: 'c', amount: 33.33 }]);
  assert.deepEqual(simplifyDebts([{ memberId: 'a', netBalance: 40 }, { memberId: 'b', netBalance: -40 }]), [{ fromMemberId: 'b', toMemberId: 'a', amount: 40 }]);
});

test('trip: Ram paid 70 and Hari 50 of a 120 dinner for four', () => {
  const members = ['r', 'h', 's', 'g'].map((id) => makeTripMember({ id, name: id.toUpperCase(), isMe: id === 'r' }));
  const e = makeEntry({ title: 'Dinner', totalAmount: 120, paidByMemberId: 'r', alsoPaid: [{ memberId: 'h', amount: '50' }] }, members);
  assert.deepEqual(entryPayers(e), [{ memberId: 'r', amount: 70 }, { memberId: 'h', amount: 50 }]);
  const s = calculateTripSettlement({ members, entries: [e] });
  const net = Object.fromEntries(s.members.map((m) => [m.memberId, m.netBalance]));
  assert.deepEqual(net, { r: 40, h: 20, s: -30, g: -30 });
  assert.equal(s.transfers.reduce((t, x) => t + x.amount, 0), 60);
  assert.ok(s.transfers.every((t) => ['s', 'g'].includes(t.fromMemberId)));
  // Quick expense too; a single payer stays as before (no alsoPaid stored).
  assert.equal(quickTripEntry({ title: 'Taxi', amount: 900, paidByMemberId: 'r', alsoPaid: [{ memberId: 'h', amount: 450 }] }, members).alsoPaid.length, 1);
  assert.equal(makeEntry({ title: 'Tea', totalAmount: 60, paidByMemberId: 'r' }, members).alsoPaid, undefined);
});

test('split: you paid 70, Hari 50; everyone pays the right person', () => {
  const members = [makeMember({ id: 'me', name: 'Ram', isPayer: true }), makeMember({ id: 'h', name: 'Hari' }), makeMember({ id: 's', name: 'Sita' }), makeMember({ id: 'g', name: 'Gita' })];
  const split = { total: 120, mode: 'equal', items: [], members, overrides: {}, alsoPaid: [{ memberId: 'h', amount: 50 }], paid: {} };
  const r = computeSplit(split);
  assert.deepEqual(r.payers, [{ memberId: 'me', amount: 70 }, { memberId: 'h', amount: 50 }]);
  assert.deepEqual(r.members.map((m) => [m.id, m.share, m.paid]), [['me', 30, 70], ['h', 30, 50], ['s', 30, 0], ['g', 30, 0]]);
  assert.deepEqual(r.transfers.map((t) => `${t.fromMemberId}>${t.toMemberId}:${t.amount}`).sort(), ['g>h:20', 'g>me:10', 's>me:30'].sort());
  assert.equal(r.recoverable, 40); // what comes back to you
  assert.equal(outstanding(split, r), 40);
  const g2me = r.transfers.find((t) => t.fromMemberId === 'g' && t.toMemberId === 'me');
  const g2h = r.transfers.find((t) => t.toMemberId === 'h');
  assert.deepEqual([transferKey(g2me, 'me'), transferKey(g2h, 'me')], ['g', 'g>h']);
  assert.equal(outstanding({ ...split, paid: { s: '2026-11-08', 'g>h': '2026-11-08' } }, r), 10); // Gita→Hari isn't yours to collect
  const text = splitText(split, r);
  assert.match(text, /Paid: Ram रु 70, Hari रु 50/);
  assert.match(text, /Gita pays Hari रु 20/);
  // Money: only your 70 left your account; with nobody else paying, the whole bill.
  assert.equal(outOfPocket({ totalAmount: 120, split }), 70);
  assert.equal(outOfPocket({ totalAmount: 120, split: { ...split, alsoPaid: [] } }), 120);
  // You paid alone: same as always, everyone pays you their share.
  const solo = computeSplit({ ...split, alsoPaid: [] });
  assert.deepEqual([solo.payers.length, solo.recoverable, solo.transfers.length], [1, 90, 3]);
  // The file friends get says who pays whom; a bad list in a file is dropped.
  const file = splitShareFile({ id: 'x', merchantName: 'Momo', totalAmount: 120, split }, r, {});
  assert.equal(file.split.transfers.length, 3);
  assert.equal(file.split.people.find((p) => p.id === 'h').paidPart, 50);
  const bad = parseShareFile(JSON.stringify({ ...file, split: { ...file.split, transfers: 'oops' } }));
  assert.equal(bad.split.transfers, undefined);
});
