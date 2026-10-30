// A real crumpled estimate slip (Kotheys Pimbal), as the on-device reader saw it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { amountInWords, parseReceiptText } from '../src/lib/ocr/parse.js';
import { parseLineItemsFromText } from '../src/lib/splitter.js';
import { itemsMatchTotal, mergeReads, needsBetterRead } from '../src/lib/ocr/index.js';
import { checkEligibility } from '../src/lib/ird.js';

const kotheys = readFileSync(new URL('./fixtures/kotheys-estimate.txt', import.meta.url), 'utf8');

test('amount in words', () => {
  assert.equal(amountInWords('Six hundred and thirty rupees qj'), 630);
  assert.equal(amountInWords('Rupees One Thousand Two Hundred Fifty Only'), 1250);
  assert.equal(amountInWords('In words: Two lakh five thousand three hundred only'), 205300);
  assert.equal(amountInWords('Forty-five rupees'), 45);
  assert.equal(amountInWords('one item, thank you'), null);
});

test('crumpled bill: total from the amount in words, not a misread "330.00"', () => {
  const f = parseReceiptText(kotheys);
  assert.equal(f.totalAmount, 630);
  assert.equal(f.merchantName, 'Kotheys Pimbal');
  assert.equal(f.invoiceNumber, 'EST7136-kP-83/84');
  assert.equal(f.isEstimate, true);
});

test('crumpled bill: AD date wins over a misread BS year (2073 for 2083)', () => {
  const f = parseReceiptText(kotheys);
  assert.equal(f.billDateAD, '2026-10-29');
  assert.equal(f.billDateBS, '2083-07-12');
});

test('crumpled bill: items despite margin noise, glued qty+rate and a row split over two lines', () => {
  const items = parseLineItemsFromText(kotheys);
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.price, i.amount]), [
    ['Chicken Keema Noodles', 1, 250, 250],
    ['Chinese Soup Momo', 1, 200, 200],
    ['Coke', 1, 180, 180],
  ]);
  assert.ok(itemsMatchTotal(items, 630));
});

test('header noise is never an item', () => {
  const items = parseLineItemsFromText('Contact No.: 2\nTHIS IS NOT A VALID BILL. 4\nPinbal, ward 2, Lalitpur\nSix hundred rupees only 600.00');
  assert.deepEqual(items, []);
});

test('items match a total with service charge and VAT on top', () => {
  const items = [{ amount: 500 }, { amount: 500 }];
  assert.ok(itemsMatchTotal(items, 1000));
  assert.ok(itemsMatchTotal(items, 1130));
  assert.ok(itemsMatchTotal(items, 1243));
  assert.ok(!itemsMatchTotal(items, 1180));
});

test('an estimate cannot enter the IRD draw, and a missing PAN on it is not a misread', () => {
  const e = { isNepalBill: true, isEstimate: true, totalAmount: 630, sellerPan: '123456789', invoiceNumber: 'E1', billDateAD: '2026-10-29', category: 'Food & Dining' };
  const r = checkEligibility(e, { today: '2026-10-30', todayBs: '2083-07-13' });
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(' '), /estimate/i);
  const items = parseLineItemsFromText(kotheys);
  assert.equal(needsBetterRead({ fields: { isEstimate: true, totalAmount: 630, lineItems: items }, confidence: 80 }), false);
  assert.equal(needsBetterRead({ fields: { isEstimate: true, totalAmount: 630, lineItems: items.slice(0, 2) }, confidence: 80 }), true);
});

test('fields a read missed are filled from the other reads', () => {
  const f = mergeReads('Shop A\nChicken Momo 250.00\nTotal 250.00', ['Shop A\nPAN: 301234567\nBill No: 77\nDate: 2026-10-29']);
  assert.equal(f.totalAmount, 250);
  assert.equal(f.sellerPan, '301234567');
  assert.equal(f.invoiceNumber, '77');
  assert.equal(f.billDateBS, '2083-07-12');
  assert.equal(f.lineItems.length, 1);
});
