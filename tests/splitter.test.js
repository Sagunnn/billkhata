import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoWeight, classifyFoodItem, clearMemberOverrides, computeSplit, decodeSplit, encodeSplit, esewaQrText,
  makeItem, makeMember, outstanding, parseLineItemsFromText, sharePayload, splitFromPayload,
} from '../src/lib/splitter.js';

test('classifyFoodItem: Nepali menu words', () => {
  for (const n of ['Chicken Momo', 'Buff Sekuwa', 'Mutton Choila', 'Sukuti Sadeko', 'Egg Fried Rice', 'Local Kukhurako Jhol', 'Khasi ko Masu', 'Pork Bacon', 'Fish Finger', 'Chicken Wings', 'कुखुराको मासु', 'Keema Noodles', 'Drumstick 2pc']) {
    assert.equal(classifyFoodItem(n), 'non-veg', n);
  }
  for (const n of ['Tuborg Strong 650ml', 'Gorkha Beer', 'Barasinghe', 'Old Durbar Whisky', 'Khukuri Rum', 'Gin & Tonic', 'House Wine', 'Aila', 'Chhyang', 'Tequila Shot', 'Arna', 'बियर']) {
    assert.equal(classifyFoodItem(n), 'alcohol', n);
  }
  for (const n of ['Veg Momo', 'Paneer Chilli', 'Aloo Gobi', 'Dal Bhat', 'Butter Naan', 'French Fries', 'Peanut Sadeko', 'Bhatmas', 'Mushroom Choila', 'Masala Tea', 'Lassi', 'Ginger Lemon Honey', 'Eggplant Curry', 'Buffet Veg', 'Virgin Mojito', 'Eggless Cake', '']) {
    assert.equal(classifyFoodItem(n), 'veg', n);
  }
  assert.equal(classifyFoodItem('Mineral Water 1L'), 'shared');
  assert.equal(classifyFoodItem('Hookah'), 'shared');
});

test('parseLineItemsFromText: common receipt layouts', () => {
  const items = parseLineItemsFromText(`HIMALAYAN BHANCHA GHAR
Bill No: 2231   Date: 2083-07-12
S.N  Particulars   Qty  Rate  Amount
1. Chicken Momo     2   250   500.00
2. Veg Chowmein          180.00
Tuborg Strong 2 x 450      900
3 Masala Tea               150
Sub Total                1730.00
Service Charge 10%        173.00
VAT 13%                   247.49
Grand Total              2150.49`);
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.price, i.amount, i.tag]), [
    ['Chicken Momo', 2, 250, 500, 'non-veg'],
    ['Veg Chowmein', 1, 180, 180, 'veg'],
    ['Tuborg Strong', 2, 450, 900, 'alcohol'],
    ['Masala Tea', 3, 50, 150, 'veg'],
  ]);
});

test('parseLineItemsFromText: Nepali digits and nothing from non-item text', () => {
  const [it] = parseLineItemsFromText('बफ सेकुवा २ ६४०');
  assert.equal(it.amount, 640);
  assert.equal(it.qty, 2);
  assert.equal(it.tag, 'non-veg');
  assert.deepEqual(parseLineItemsFromText('Thank you\nPAN 609876543\nTotal 500'), []);
});

const me = makeMember({ id: 'me', name: 'Sagun', diet: 'non-veg', alcohol: true, isPayer: true });
const veg = makeMember({ id: 'v', name: 'Asha', diet: 'veg', alcohol: false });
const nv = makeMember({ id: 'n', name: 'Bikash', diet: 'non-veg', alcohol: false });

test('auto-ticks follow diet and drinks', () => {
  assert.equal(autoWeight('veg', veg), 1);
  assert.equal(autoWeight('non-veg', veg), 0);
  assert.equal(autoWeight('non-veg', nv), 1);
  assert.equal(autoWeight('alcohol', nv), 0);
  assert.equal(autoWeight('alcohol', me), 1);
  assert.equal(autoWeight('shared', veg), 1);
});

const base = () => ({
  total: 2150.49,
  members: [me, veg, nv],
  items: [
    makeItem({ id: 'momo', name: 'Chicken Momo', qty: 2, price: 250, amount: 500 }),
    makeItem({ id: 'chow', name: 'Veg Chowmein', amount: 180 }),
    makeItem({ id: 'beer', name: 'Tuborg', qty: 2, price: 450, amount: 900 }),
    makeItem({ id: 'tea', name: 'Masala Tea', qty: 3, price: 50, amount: 150 }),
  ],
  overrides: {},
  taxMode: 'proportional',
});

test('proportional VAT + service charge: share = subtotal × total / items subtotal, sums to the bill', () => {
  const r = computeSplit(base());
  const by = Object.fromEntries(r.members.map((m) => [m.id, m]));
  // momo 500 → me+n; chow 180 + tea 150 → all three; beer 900 → me only.
  assert.equal(by.me.subtotal, 1260);
  assert.equal(by.v.subtotal, 110);
  assert.equal(by.n.subtotal, 360);
  const ratio = 2150.49 / 1730;
  assert.ok(Math.abs(by.v.share - 110 * ratio) < 0.011);
  assert.ok(Math.abs(by.n.share - 360 * ratio) < 0.011);
  assert.equal(Math.round((by.me.share + by.v.share + by.n.share) * 100), 215049);
  assert.equal(r.myShare, by.me.share);
  assert.equal(r.recoverable, Math.round((by.v.share + by.n.share) * 100) / 100);
  assert.equal(r.unassigned, 0);
});

test('equal tax mode spreads the extra evenly among members with items', () => {
  const r = computeSplit({ ...base(), taxMode: 'equal' });
  const extra = (2150.49 - 1730) / 3;
  const v = r.members.find((m) => m.id === 'v');
  assert.ok(Math.abs(v.share - (110 + extra)) < 0.011);
  assert.equal(Math.round(r.members.reduce((s, m) => s + m.share, 0) * 100), 215049);
});

test('discounts reduce shares proportionally; manual overrides and 2x units', () => {
  const s = { ...base(), total: 1557 }; // 10% off the items
  const r = computeSplit(s);
  assert.equal(r.members.find((m) => m.id === 'v').share, 99);
  // Bikash had 2 of the 3 teas, and Asha skips tea.
  const s2 = { ...base(), total: 1730, overrides: { tea: { me: 1, v: 0, n: 2 } } };
  const r2 = computeSplit(s2);
  assert.equal(r2.members.find((m) => m.id === 'n').subtotal, 250 + 60 + 100);
  assert.equal(r2.members.find((m) => m.id === 'v').subtotal, 60);
  // Diet change clears that member's overrides.
  assert.deepEqual(clearMemberOverrides(s2, 'n').overrides, { tea: { me: 1, v: 0 } });
});

test('unassigned items are reported, not charged to anyone', () => {
  const r = computeSplit({ ...base(), total: 1730, overrides: { beer: { me: 0 } } });
  assert.equal(r.unassigned, 900);
  assert.equal(Math.round(r.members.reduce((s, m) => s + m.share, 0) * 100), 83000);
});

test('no items: the total is split equally to the paisa', () => {
  const r = computeSplit({ total: 1000, members: [me, veg, nv], items: [], overrides: {} });
  assert.deepEqual(r.members.map((m) => m.share).sort(), [333.33, 333.33, 333.34]);
});

test('outstanding counts unpaid friends only', () => {
  const s = { ...base(), paid: { v: true } };
  const r = computeSplit(s);
  assert.equal(outstanding(s, r), r.members.find((m) => m.id === 'n').share);
});

test('#/split/<base64url> round trip, URL-safe, same shares', async () => {
  const s = { ...base(), title: 'काठमाडौं Bhancha Ghar', dateAD: '2026-10-29', dateBS: '2083-07-12', overrides: { tea: { n: 2 } } };
  const token = await encodeSplit(sharePayload(s, { payerName: 'Sagun', qrText: esewaQrText('9800000000', 'Sagun Pradhan'), qrLabel: 'eSewa 9800000000' }));
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  const { split, payer } = splitFromPayload(await decodeSplit(token));
  assert.equal(split.title, 'काठमाडौं Bhancha Ghar');
  assert.equal(payer.qrText, '{"eSewa_id":"9800000000","name":"Sagun Pradhan"}');
  assert.deepEqual(computeSplit(split).members.map((m) => m.share), computeSplit(s).members.map((m) => m.share));
  await assert.rejects(decodeSplit('not-a-real-token'));
  assert.throws(() => splitFromPayload({ v: 9 }));
});

test('split equally: total ÷ people in the split, items ignored', () => {
  const r = computeSplit({ ...base(), mode: 'equal' });
  assert.deepEqual(r.members.map((m) => m.share), [716.83, 716.83, 716.83]);
  assert.equal(Math.round(r.members.reduce((s, m) => s + m.share, 0) * 100), 215049);
});

test('a person left out pays nothing and is not counted', () => {
  const out = makeMember({ id: 'n', name: 'Bikash', diet: 'non-veg', out: true });
  const r = computeSplit({ ...base(), members: [me, veg, out] });
  const n = r.members.find((m) => m.id === 'n');
  assert.equal(n.share, 0);
  assert.equal(n.lines.length, 0);
  // Bikash's items are re-shared among the rest; the bill still adds up.
  assert.equal(r.members.find((m) => m.id === 'me').subtotal, 500 + 90 + 900 + 75); // momo alone, chowmein and tea halves
  assert.equal(Math.round(r.members.reduce((s, m) => s + m.share, 0) * 100), 215049);
  const eq = computeSplit({ total: 900, mode: 'equal', members: [me, veg, out], items: [], overrides: {} });
  assert.deepEqual(eq.members.map((m) => m.share), [450, 450, 0]);
  // Payer treating everyone: payer left out, friends owe it all.
  const treat = computeSplit({ total: 900, mode: 'equal', members: [{ ...me, out: true }, veg, nv], items: [], overrides: {} });
  assert.equal(treat.myShare, 0);
  assert.equal(treat.recoverable, 900);
  assert.equal(outstanding({ paid: {} }, eq), 450);
});

test('equal mode and left-out people survive the share link', async () => {
  const s = { ...base(), mode: 'equal', members: [me, { ...veg, out: true }, nv] };
  const { split } = splitFromPayload(await decodeSplit(await encodeSplit(sharePayload(s))));
  assert.equal(split.mode, 'equal');
  assert.equal(split.members[1].out, true);
  assert.deepEqual(computeSplit(split).members.map((m) => m.share), computeSplit(s).members.map((m) => m.share));
});
