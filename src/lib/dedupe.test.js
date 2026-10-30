import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildItemSequenceFingerprints, crossReferenceBill, findEarlierInvoiceDuplicate, hammingHex, levenshtein,
  normalizeInvoiceOCRCanonical, normalizeInvoiceStrict,
} from './dedupe.js';
import { dHashFromGray } from './image.js';

const PAN = '609876543';
const bill = (id, over = {}) => ({
  id, billCode: `KT1-0${id.length}`, merchantName: 'Thamel Momo House', sellerPan: PAN, invoiceNumber: '', totalAmount: 1036.25,
  billDateAD: '2026-10-29', createdAt: `2026-10-29T10:00:0${id.length % 10}Z`, ...over,
});
const items = (...amounts) => amounts.map((a, i) => ({ name: ['Buff Momo', 'Chicken Chilly', 'Coke', 'Sekuwa Platter', 'Tea'][i], amount: a }));
const levels = (cand, saved) => crossReferenceBill(cand, saved).map((m) => [m.bill.id, m.level]);

test('normalizeInvoiceStrict: prefixes, separators, leading zeros, Nepali digits', () => {
  for (const v of ['00452', 'INV-452', '०४५२', 'Bill No.: 452', '#452', 'Inv No: 0452', ' inv 452 ']) assert.equal(normalizeInvoiceStrict(v), '452', v);
  assert.equal(normalizeInvoiceStrict('2083/84-1052'), '2083841052');
  assert.equal(normalizeInvoiceStrict('AKP-2083-0457'), 'AKP20830457');
  assert.equal(normalizeInvoiceStrict(''), '');
});

test('normalizeInvoiceOCRCanonical folds look-alikes', () => {
  assert.equal(normalizeInvoiceOCRCanonical('INV-B04'), normalizeInvoiceOCRCanonical('INV-804'));
  assert.equal(normalizeInvoiceOCRCanonical('S1O2'), '5102');
  assert.equal(normalizeInvoiceOCRCanonical('|Z7'), '127');
  assert.equal(levenshtein('1052', '1O52'), 1);
  assert.equal(levenshtein('abc', 'xyz', 1), 2);
});

test('exact duplicate: 00452 vs INV-452 vs ०४५२ (same PAN)', () => {
  const saved = [bill('a', { invoiceNumber: 'INV-452' })];
  assert.deepEqual(levels(bill('new', { invoiceNumber: '00452' }), saved), [['a', 'exact']]);
  assert.deepEqual(levels(bill('new', { invoiceNumber: '०४५२' }), saved), [['a', 'exact']]);
  // No PAN on the scan: the same number still matches when the total matches.
  assert.deepEqual(levels(bill('new', { invoiceNumber: '452', sellerPan: '' }), saved), [['a', 'exact']]);
  assert.deepEqual(levels(bill('new', { invoiceNumber: '452', sellerPan: '', totalAmount: 99 }), saved), []);
  // Same number from a different seller is a different bill.
  assert.deepEqual(levels(bill('new', { invoiceNumber: '452', sellerPan: '601111111' }), saved), []);
});

test('OCR look-alike: INV-804 vs INV-B04 on the same PAN and total', () => {
  const saved = [bill('a', { invoiceNumber: 'INV-804' })];
  assert.deepEqual(levels(bill('new', { invoiceNumber: 'INV-B04' }), saved), [['a', 'ocr']]);
  assert.deepEqual(levels(bill('new', { invoiceNumber: 'INV-B04', totalAmount: 500 }), saved), [], 'different total');
  // One character off counts only on the same day (consecutive bills look like that too).
  assert.deepEqual(levels(bill('new', { invoiceNumber: 'INV-805' }), saved), [['a', 'ocr']]);
  assert.deepEqual(levels(bill('new', { invoiceNumber: 'INV-805', billDateAD: '2026-10-30' }), saved), []);
});

test('ordered item sequence catches a duplicate with no bill number', () => {
  const saved = [bill('a', { invoiceNumber: 'TMH-8812', lineItems: items(180, 250, 65, 420) })];
  const torn = bill('new', { invoiceNumber: '', sellerPan: '', lineItems: items(180, 250, 65, 420) });
  const m = crossReferenceBill(torn, saved);
  assert.deepEqual(m.map((x) => [x.bill.id, x.level]), [['a', 'items']]);
  assert.match(m[0].reasons[0], /Identical 4-item sequence \(180 → 250 → 65 → 420\)/);
  // Same prices but different names: still a match when the total also matches.
  const renamed = bill('new', { lineItems: [180, 250, 65, 420].map((a, i) => ({ name: `item ${'abcd'[i]}`, amount: a })) });
  assert.deepEqual(levels(renamed, saved), [['a', 'items']]);
  assert.equal(buildItemSequenceFingerprints({ lineItems: items(180, 250, 65, 420) }).priceSeq, 'P:180>250>65>420');
  assert.equal(buildItemSequenceFingerprints({ items: items(180, 250) }).itemSeq, 'I:buffmomo:180>chickenchilly:250');
});

test('not duplicates: a single Rs. 200 item, or different sequences from the same seller', () => {
  const saved = [
    bill('a', { invoiceNumber: '101', totalAmount: 200, lineItems: items(200) }),
    bill('b', { invoiceNumber: '102', lineItems: items(180, 250, 65, 420) }),
  ];
  assert.deepEqual(levels(bill('new', { invoiceNumber: '205', totalAmount: 200, lineItems: items(200) }), saved), []);
  assert.deepEqual(levels(bill('new', { invoiceNumber: '206', lineItems: items(180, 65, 250, 420) }), saved), [], 'same prices, different order');
  assert.deepEqual(levels(bill('new', { invoiceNumber: '207', lineItems: items(180, 250, 65) , totalAmount: 495 }), saved), []);
  assert.equal(buildItemSequenceFingerprints({ lineItems: items(200) }), null);
});

test('photo hash: same photo + same total matches; similar photo with a different total does not', () => {
  const grad = Array.from({ length: 72 }, (_, i) => (i % 9) * 20 + (i % 3));
  const h = dHashFromGray(grad);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(hammingHex(h, h), 0);
  assert.equal(hammingHex('ffffffffffffffff', '0000000000000000'), 64);
  const saved = [bill('a', { imageHash: h })];
  assert.deepEqual(levels(bill('new', { imageHash: h }), saved), [['a', 'image']]);
  assert.deepEqual(levels(bill('new', { imageHash: h, totalAmount: 10 }), saved), []);
});

test('only the later copy is blocked for IRD; the original stays enterable', () => {
  const original = bill('orig', { invoiceNumber: '452', createdAt: '2026-10-29T09:00:00Z' });
  const copy = bill('copy', { invoiceNumber: 'INV-0452', createdAt: '2026-10-29T11:00:00Z' });
  assert.equal(findEarlierInvoiceDuplicate(copy, [original, copy])?.id, 'orig');
  assert.equal(findEarlierInvoiceDuplicate(original, [original, copy]), null);
  const [m] = crossReferenceBill(original, [copy]);
  assert.equal(m.earlier, false, 'from the original, the copy is the later one');
});

test('same shop + same total + same day is flagged (bill entered twice by hand)', () => {
  const saved = [bill('a', { merchantName: 'Annapurna Kirana Pasal', sellerPan: '', totalAmount: 1356 })];
  const again = bill('new', { merchantName: 'annapurna  kirana pasal', sellerPan: '', totalAmount: 1356 });
  assert.deepEqual(levels(again, saved), [['a', 'same-day']]);
  assert.deepEqual(levels({ ...again, billDateAD: '2026-10-30' }, saved), [], 'another day');
  assert.deepEqual(levels({ ...again, totalAmount: 1357 }, saved), [], 'another total');
  assert.deepEqual(levels({ ...again, merchantName: 'Other Shop' }, saved), [], 'another shop');
  // With PANs, the PAN decides the shop.
  assert.deepEqual(levels(bill('n2', { totalAmount: 1036.25 }), [bill('b', { merchantName: 'Different name' })]), [['b', 'same-day']]);
  // Both have bill numbers and they differ: two real bills.
  assert.deepEqual(levels(bill('n3', { invoiceNumber: '205' }), [bill('c', { invoiceNumber: '101' })]), []);
});
