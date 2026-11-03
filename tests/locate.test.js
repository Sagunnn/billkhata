// Finding each read field on the bill photo from the OCR word boxes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { joinBoxes, locateFields } from '../src/lib/ocr/locate.js';

const words = JSON.parse(readFileSync(new URL('./fixtures/kotheys-words.json', import.meta.url), 'utf8'));
const W = 1600;
const H = 2200;

test('a real read: shop at the top, bill no. and date in the middle, total lower down', () => {
  const box = locateFields(words, {
    merchantName: 'Kotheys Pimbal', invoiceNumber: 'EST7135-KP-83/84', billDateAD: '2026-10-29', totalAmount: 630,
    lineItems: [{ name: 'Chicken Keema Noodles' }, { name: 'Coke' }],
  }, { width: W, height: H });
  assert.ok(box.merchantName && box.merchantName.y < 0.05, 'shop name on the first row');
  assert.ok(box.invoiceNumber && Math.abs(box.invoiceNumber.y - 600 / H) < 0.03, 'bill no. on its row');
  assert.ok(box.billDate && Math.abs(box.billDate.y - 600 / H) < 0.03, 'date on the same row');
  assert.ok(box.lineItems && box.lineItems.y > 0.5 && box.lineItems.y < 0.6, 'items from the first item row');
  for (const b of Object.values(box)) for (const v of [b.x, b.y, b.w, b.h]) assert.ok(v >= 0 && v <= 1);
});

test('amounts: the total row is preferred over the same number elsewhere', () => {
  const ws = [
    { text: 'Momo', x0: 10, y0: 100, x1: 80, y1: 120 }, { text: '500.00', x0: 200, y0: 100, x1: 260, y1: 120 },
    { text: 'VAT', x0: 10, y0: 300, x1: 50, y1: 320 }, { text: '65.00', x0: 200, y0: 300, x1: 260, y1: 320 },
    { text: 'TOTAL', x0: 10, y0: 400, x1: 70, y1: 420 }, { text: '565.00', x0: 200, y0: 400, x1: 260, y1: 420 },
    { text: 'Cash', x0: 10, y0: 450, x1: 60, y1: 470 }, { text: '565.00', x0: 200, y0: 450, x1: 260, y1: 470 },
  ];
  const box = locateFields(ws, { totalAmount: 565, vatAmount: 65 }, { width: 300, height: 500 });
  assert.equal(Math.round(box.totalAmount.y * 500), 400);
  assert.equal(Math.round(box.vatAmount.y * 500), 300);
});

test('a PAN is found by its digits, and a straightened read is turned back', () => {
  const ws = [{ text: 'PAN:', x0: 40, y0: 100, x1: 90, y1: 120 }, { text: '601234567', x0: 100, y0: 100, x1: 220, y1: 120 }];
  const flat = locateFields(ws, { sellerPan: '601234567' }, { width: 400, height: 400 });
  assert.equal(Math.round(flat.sellerPan.x * 400), 100);
  const turned = locateFields(ws, { sellerPan: '601234567' }, { width: 400, height: 400, angle: 3 });
  assert.notEqual(Math.round(turned.sellerPan.y * 400), 100);
  assert.deepEqual(locateFields([], { sellerPan: '1' }, { width: 1, height: 1 }), {});
});

test('joinBoxes spans boxes and skips missing ones', () => {
  assert.deepEqual(joinBoxes([{ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, null, { x: 0.5, y: 0.3, w: 0.1, h: 0.1 }]), { x: 0.1, y: 0.1, w: 0.5, h: 0.30000000000000004 });
  assert.equal(joinBoxes([null]), null);
});
