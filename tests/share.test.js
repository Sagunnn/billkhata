// Sending trips and splits between phones as files, and merging them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTrip, parseShareFile, shareFileName, splitShareFile, stampTrip, tripFromShare, tripShareFile } from '../src/lib/share.js';

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-01T11:00:00.000Z';
const T2 = '2026-11-01T12:00:00.000Z';
const entry = (id, title, amount, updatedAt, extra = {}) => ({ id, title, totalAmount: amount, paidByMemberId: 'me', items: [], updatedAt, ...extra });
const base = () => ({
  id: 'trip-1', name: 'Nagarkot', status: 'active',
  members: [{ id: 'me', name: 'Sagun', isMe: true, updatedAt: T0 }, { id: 'a', name: 'Aarati', isMe: false, updatedAt: T0 }],
  entries: [entry('e1', 'Taxi', 1500, T0), entry('e2', 'Hotel', 6000, T0)],
  paidTransfers: {}, deleted: {},
});

test('stampTrip: changed and new expenses get the time, unchanged keep theirs, removed ones are remembered', () => {
  const before = base();
  const next = { ...before, entries: [{ ...before.entries[0], totalAmount: 1600 }, entry('e3', 'Momo', 800)] };
  const out = stampTrip(before, next, T2);
  assert.equal(out.entries.find((e) => e.id === 'e1').updatedAt, T2, 'edited');
  assert.equal(out.entries.find((e) => e.id === 'e3').updatedAt, T2, 'new');
  assert.equal(out.deleted.e2, T2, 'removed');
  const same = stampTrip(before, { ...before }, T2);
  assert.equal(same.entries[0].updatedAt, T0, 'unchanged keeps its time');
  const merged = stampTrip(before, { ...before, entries: [{ ...before.entries[0], totalAmount: 1700, updatedAt: T1 }, before.entries[1]] }, T2);
  assert.equal(merged.entries[0].updatedAt, T1, 'a friend’s time from a merge is kept');
});

test('mergeTrip: new expenses come in, the newer copy wins, deletes stick, nothing doubles', () => {
  const mine = base();
  const theirs = base();
  theirs.members = theirs.members.map((m) => ({ ...m, isMe: m.id === 'a' }));
  theirs.entries = [entry('e1', 'Taxi', 1500, T0), entry('e2', 'Hotel', 6500, T1), entry('e4', 'Dinner', 2400, T1, { paidByMemberId: 'a', linkedExpenseId: 'their-ledger-id' })];
  mine.entries = [entry('e1', 'Taxi', 1500, T0, { linkedExpenseId: 'my-bill' }), entry('e2', 'Hotel', 6000, T0)];
  const { trip, added, updated, removed } = mergeTrip(mine, theirs);
  assert.deepEqual([added, updated, removed], [1, 1, 0]);
  assert.equal(trip.entries.length, 3);
  assert.equal(trip.entries.find((e) => e.id === 'e2').totalAmount, 6500, 'their newer hotel amount');
  assert.equal(trip.entries.find((e) => e.id === 'e4').linkedExpenseId, '', 'their ledger link is not ours');
  assert.equal(trip.entries.find((e) => e.id === 'e1').linkedExpenseId, 'my-bill');
  assert.equal(trip.members.find((m) => m.id === 'me').isMe, true, 'who I am stays mine');
  assert.equal(trip.members.find((m) => m.id === 'a').isMe, false);
  // Merging the same file again changes nothing.
  const again = mergeTrip(trip, theirs);
  assert.deepEqual([again.added, again.updated, again.removed], [0, 0, 0]);
  // They deleted the taxi after its last change: it goes here too, and stays gone.
  const del = { ...theirs, entries: theirs.entries.filter((e) => e.id !== 'e1'), deleted: { e1: T2 } };
  const gone = mergeTrip(trip, del);
  assert.equal(gone.removed, 1);
  assert.equal(gone.trip.entries.some((e) => e.id === 'e1'), false);
  assert.equal(mergeTrip(gone.trip, theirs).trip.entries.some((e) => e.id === 'e1'), false, 'an older copy doesn’t bring it back');
});

test('a trip file: no isMe, photos from the ledger when asked, and back in as a new trip', () => {
  const t = base();
  t.entries[0].linkedExpenseId = 'bill-1';
  const file = tripShareFile(t, { expenses: [{ id: 'bill-1', receiptImage: 'data:image/jpeg;base64,AAA' }], photos: true, now: T2 });
  assert.equal(file.from.name, 'Sagun');
  assert.equal(file.trip.members.some((m) => 'isMe' in m), false);
  assert.equal(file.trip.entries[0].receiptImage, 'data:image/jpeg;base64,AAA');
  assert.equal(tripShareFile(t, { expenses: [], photos: false }).trip.entries[0].receiptImage, undefined);
  const parsed = parseShareFile(JSON.stringify(file));
  const asAarati = tripFromShare(parsed.trip, { meId: 'a' });
  assert.deepEqual(asAarati.members.map((m) => [m.id, m.isMe]), [['me', false], ['a', true]]);
  const newcomer = tripFromShare(parsed.trip, { myName: 'Bibek' });
  assert.equal(newcomer.members.at(-1).name, 'Bibek');
  assert.equal(newcomer.members.at(-1).isMe, true);
});

test('split files, and files that aren’t ours', () => {
  const f = splitShareFile({ id: 'x', merchantName: 'Momo House', totalAmount: 900, split: { mode: 'equal' } },
    { members: [{ id: 'me', name: 'Sagun', isPayer: true, share: 300, lines: [] }, { id: 'a', name: 'Aarati', share: 300, lines: [] }, { id: 'b', name: 'Bibek', share: 300, out: true }] },
    { payer: { name: 'Sagun' }, pay: { via: 'eSewa', number: '9800000000' } });
  assert.equal(parseShareFile(JSON.stringify(f)).split.people.length, 2);
  assert.throws(() => parseShareFile('not json'), /isn’t a BillKhata file/);
  assert.throws(() => parseShareFile(JSON.stringify({ version: 1, expenses: [] })), /full BillKhata backup/);
  assert.throws(() => parseShareFile(JSON.stringify({ kind: 'billkhata-share', v: 9, type: 'trip' })), /newer BillKhata/);
  assert.match(shareFileName('trip', 'Nagarkot Weekend!', new Date(T2)), /^billkhata-trip-nagarkot-weekend-2026-11-01\.json$/);
});
