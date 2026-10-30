import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTripSettlement, classifyTripItem, entryShares, getDefaultAssignedMembers, makeEntry, makeTripItem,
  makeTripMember, simplifyDebts,
} from '../src/lib/trips.js';
import { buildDynamicNepalQR, computeEMVCoCRC16, emvField, isValidEmv, serializeTLV } from '../src/lib/emvqr.js';

const sagun = makeTripMember({ id: 's', name: 'Sagun', isMe: true });
const asha = makeTripMember({ id: 'a', name: 'Asha', isVeg: true, drinks: false });
const bikash = makeTripMember({ id: 'b', name: 'Bikash' });
const chiran = makeTripMember({ id: 'c', name: 'Chiran', isVeg: true });
const members = [sagun, asha, bikash, chiran];

test('classifyTripItem', () => {
  for (const n of ['Chicken Sekuwa', 'Buff Choila', 'Pangra Fry', 'Egg Curry', 'Mutton Thakali', 'Sukuti', 'Drumstick']) assert.equal(classifyTripItem(n), 'non-veg', n);
  for (const n of ['Tuborg', 'Gorkha Beer', 'Khukuri Rum', 'Coke 500ml', 'Masala Tea', 'Lassi', 'Red Bull', 'Hot Coffee', 'Fresh Juice']) assert.equal(classifyTripItem(n), 'drink', n);
  for (const n of ['Taxi to Nagarkot', 'Pathao', 'Petrol', 'Hotel room 2 nights', 'Entry ticket', 'Parking', 'Mineral Water']) assert.equal(classifyTripItem(n), 'shared', n);
  for (const n of ['Veg Thakali', 'Paneer Chilli', 'Aloo Sadheko', 'Veg Momo', 'Chowmein', 'Ginger Lemon', 'Eggplant', 'Buffet', '']) assert.equal(classifyTripItem(n), 'veg', n);
});

test('getDefaultAssignedMembers: vegetarians skip non-veg, drinks only for drinkers', () => {
  assert.deepEqual(getDefaultAssignedMembers('non-veg', members), ['s', 'b']);
  assert.deepEqual(getDefaultAssignedMembers('drink', members), ['s', 'b', 'c']);
  assert.deepEqual(getDefaultAssignedMembers('veg', members), ['s', 'a', 'b', 'c']);
  assert.deepEqual(getDefaultAssignedMembers('veg', members, { vegOnly: true }), ['a', 'c']);
  assert.deepEqual(getDefaultAssignedMembers('shared', members), ['s', 'a', 'b', 'c']);
});

test('a vegetarian pays 0 for non-veg; drinks split equally among drinkers; VAT proportional', () => {
  const e = makeEntry({ title: 'Dinner', paidByMemberId: 's', totalAmount: 2260, hasBill: true, items: [
    { name: 'Chicken Sekuwa', amount: 800 }, { name: 'Veg Thakali', amount: 600 }, { name: 'Tuborg', amount: 600 },
  ] }, members);
  const { shares, extra } = entryShares(e, members);
  assert.equal(extra, 260);
  assert.equal(shares.a.nonVeg, 0);
  assert.equal(shares.a.drink, 0);
  assert.equal(shares.c.drink, 200);
  assert.equal(shares.b.nonVeg, 400);
  assert.equal(shares.a.veg, 150);
  // Asha's items 150 of 2000 → 150 × 2260 / 2000 = 169.50
  assert.equal(shares.a.total, 169.5);
  assert.equal(Math.round(Object.values(shares).reduce((s, r) => s + r.total, 0) * 100), 226000);
});

test('unticking redistributes; nobody ticked falls back to everyone', () => {
  const it = makeTripItem({ name: 'Gorkha Beer', amount: 900, assignedMemberIds: ['s', 'b'] }, members);
  const e = makeEntry({ title: 'Beers', paidByMemberId: 'b', totalAmount: 900, items: [it] }, members);
  assert.equal(entryShares(e, members).shares.s.drink, 450);
  const none = makeEntry({ title: 'Snacks', paidByMemberId: 'b', totalAmount: 400, items: [{ name: 'Peanut', amount: 400, assignedMemberIds: [] }] }, members);
  const r = entryShares(none, members);
  assert.equal(r.shares.a.total, 100);
  assert.equal(r.warnings.length, 1);
});

function nagarkot() {
  return {
    members,
    entries: [
      makeEntry({ title: 'Hotel', paidByMemberId: 's', totalAmount: 6000, hasBill: true, items: [{ name: 'Room 2 nights', amount: 6000 }] }, members),
      makeEntry({ title: 'Dinner', paidByMemberId: 's', totalAmount: 3955, hasBill: true, items: [
        { name: 'Chicken Sekuwa', amount: 1200 }, { name: 'Veg Thakali x4', amount: 1400 }, { name: 'Gorkha Beer x3', amount: 900 },
      ] }, members),
      makeEntry({ title: 'Taxi', paidByMemberId: 'b', totalAmount: 2500 }, members),
      makeEntry({ title: 'Breakfast Tea', paidByMemberId: 'c', totalAmount: 333 }, members),
      makeEntry({ title: 'Petrol', paidByMemberId: 'a', totalAmount: 1000 }, members),
      makeEntry({ title: 'Khukuri Rum', paidByMemberId: 'b', totalAmount: 1150 }, members),
    ],
  };
}

test('4-person multi-payer trip conserves money and settles in at most N−1 transfers', () => {
  const trip = nagarkot();
  const s = calculateTripSettlement(trip);
  const paid = s.members.reduce((x, m) => x + m.totalPaid, 0);
  const used = s.members.reduce((x, m) => x + m.totalConsumed, 0);
  assert.equal(Math.round(paid * 100), Math.round(s.total * 100));
  assert.equal(Math.round(used * 100), Math.round(s.total * 100));
  assert.equal(Math.round(s.members.reduce((x, m) => x + m.netBalance, 0) * 100), 0);
  assert.ok(s.transfers.length <= members.length - 1);
  // Applying the transfers leaves everyone within Rs. 0.50 of zero.
  const net = Object.fromEntries(s.members.map((m) => [m.memberId, m.netBalance]));
  for (const t of s.transfers) { net[t.fromMemberId] += t.amount; net[t.toMemberId] -= t.amount; }
  for (const v of Object.values(net)) assert.ok(Math.abs(v) <= 0.5, `left ${v}`);
  // Asha (veg, no drinks) never pays for sekuwa, beer or rum.
  const asha = s.members.find((m) => m.memberId === 'a');
  assert.equal(asha.breakdown.nonVeg, 0);
  assert.equal(asha.breakdown.drink, 0);
  // Breakdown adds up to what each person consumed.
  for (const m of s.members) {
    const b = m.breakdown;
    assert.ok(Math.abs(b.veg + b.nonVeg + b.drink + b.shared + b.tax - m.totalConsumed) < 0.011, m.name);
  }
});

test('simplifyDebts: greedy largest-first, ignores ±0.50 dust', () => {
  const t = simplifyDebts([{ memberId: 'a', netBalance: 300 }, { memberId: 'b', netBalance: -200 }, { memberId: 'c', netBalance: -100 }, { memberId: 'd', netBalance: 0.4 }]);
  assert.deepEqual(t, [{ fromMemberId: 'b', toMemberId: 'a', amount: 200 }, { fromMemberId: 'c', toMemberId: 'a', amount: 100 }]);
  assert.deepEqual(simplifyDebts([{ memberId: 'a', netBalance: 0.3 }, { memberId: 'b', netBalance: -0.3 }]), []);
});

test('buildDynamicNepalQR: tag 54 injected, 4-hex CRC-16/CCITT-FALSE', () => {
  assert.equal(computeEMVCoCRC16('123456789'), '29B1');
  const body = serializeTLV([{ tag: '00', value: '01' }, { tag: '01', value: '11' }, { tag: '53', value: '524' }, { tag: '58', value: 'NP' }, { tag: '59', value: 'ASHA' }]) + '6304';
  const dyn = buildDynamicNepalQR(body + computeEMVCoCRC16(body), 1240.5);
  assert.equal(emvField(dyn, '54'), '1240.50');
  assert.equal(emvField(dyn, '01'), '12');
  assert.match(dyn.slice(-4), /^[0-9A-F]{4}$/);
  assert.equal(isValidEmv(dyn), true);
});
