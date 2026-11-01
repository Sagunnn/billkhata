import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRows, cleanBoxes, rowsText, splitByInk, splitWords } from '../src/lib/ocr/rows.js';
import { fixOcrDigits, parseReceiptText, vatTriplet } from '../src/lib/ocr/parse.js';
import { contrastStretchPixels } from '../src/lib/image.js';
import { parseStatementPages } from '../src/lib/bank/statement.js';

const box = (text, x0, y0, x1, y1, confidence = 95, extra = {}) => ({ text, x0, y0, x1, y1, confidence, ...extra });

test('cleanBoxes: CJK noise from rule lines goes, a faint amount stays', () => {
  const out = cleanBoxes([
    box('一一一', 0, 0, 100, 10),
    box('三E', 0, 20, 30, 30),
    box('--=-==-T', 0, 40, 200, 50),
    box('Grand Total', 0, 60, 80, 70),
    box('536.00', 200, 60, 240, 70, 35),
    box('blurry', 0, 80, 40, 90, 35),
    box('canceled 。', 0, 100, 60, 110),
  ]);
  assert.deepEqual(out.map((b) => b.text), ['E', 'Grand Total', '536.00', 'canceled']);
});

test('splitByInk: one run per word, joining the smallest gaps first', () => {
  //            "20,000.00"            gap            "32,000.00"
  const profile = [0, 3, 3, 0, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 3, 3, 0];
  assert.deepEqual(splitByInk(profile, 2), [{ x0: 1, x1: 7 }, { x0: 14, x1: 19 }]);
  assert.equal(splitByInk([0, 3, 3, 0], 2), null); // one run can't be two words
});

test('splitWords uses measured parts, else shares the width by length', () => {
  const measured = splitWords([box('1,250.00 30,750.00', 700, 0, 1220, 20, 95, { parts: [{ x0: 75, x1: 194 }, { x0: 383, x1: 513 }] })]);
  assert.deepEqual(measured.map((w) => [w.text, w.x0, w.x1]), [['1,250.00', 775, 894], ['30,750.00', 1083, 1213]]);
  const shared = splitWords([box('ab cd', 0, 0, 50, 10)]);
  assert.deepEqual(shared.map((w) => [w.text, w.x0, w.x1]), [['ab', 0, 20], ['cd', 30, 50]]);
});

test('buildRows: a label and its amount half a line apart are one row; the next line is not', () => {
  const rows = buildRows([
    box('Grand Total', 10, 100, 120, 120),
    box('536.00', 300, 108, 360, 128), // curled: 8 px lower
    box('Thank you', 10, 130, 100, 150), // next printed line
  ]);
  assert.deepEqual(rows.map((r) => r.text), ['Grand Total   536.00', 'Thank you']);
  assert.equal(rowsText([box('b', 50, 0, 60, 10), box('a', 0, 0, 10, 10)]), 'a   b');
});

test('fixOcrDigits: lookalike letters only inside numbers', () => {
  assert.equal(fixOcrDigits('PAN 6O1234567'), 'PAN 601234567');
  assert.equal(fixOcrDigits('Total S00.00'), 'Total 500.00');
  assert.equal(fixOcrDigits('Date 2O26-1O-29'), 'Date 2026-10-29');
  assert.equal(fixOcrDigits('Bill SOUP B12 COKE'), 'Bill SOUP B12 COKE');
});

test('vatTriplet: subtotal × 13% = VAT and subtotal + VAT = total', () => {
  const lines = ['Sub Total 4,920.00', 'Service Charge 10% 492.00', 'Taxable Amount 5,412.00', 'VAT 13% 703.56', 'Grand Total 6,115.56', 'Tender 7,000.00', 'Change 884.44'];
  assert.deepEqual(vatTriplet(['Shop', 'PAN 610234567', ...lines]), { subtotal: 5412, vat: 703.56, total: 6115.56 });
  assert.equal(vatTriplet(['Coke 2 90.00 180.00', 'Total 180.00']), null);
});

test('a Paddle read of a restaurant bill: total checked by VAT, bill number, category', () => {
  const text = readFileSync(new URL('./fixtures/paddle-restaurant.txt', import.meta.url), 'utf8');
  const f = parseReceiptText(text);
  assert.equal(f.totalAmount, 6115.56);
  assert.equal(f.vatAmount, 703.56);
  assert.equal(f.mathVerified, true);
  assert.equal(f.invoiceNumber, '2083/84-1052'); // "Bi11No.:-2083/84-1052"
  assert.equal(f.category, 'Food & Dining'); // not Utilities for "Mineral Water"
  assert.equal(f.sellerPan, '610234567');
});

test('a stray mark above the shop name is not the shop', () => {
  assert.equal(parseReceiptText('1T4\nKotheys Pimbal\nPimbal, Lalitpur\nTotal 630.00').merchantName, 'Kotheys Pimbal');
});

test('a total excludes rounding and returns', () => {
  const f = parseReceiptText('Shop Name Here\nGrand Total 536.00\nRounding 0.00\nReturn 464.00\nCash 1000.00');
  assert.equal(f.totalAmount, 536);
});

test('contrastStretchPixels: darkest 5% black, brightest 15% white', () => {
  const n = 100;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const v = 60 + i; data.set([v, v, v, 255], i * 4); }
  contrastStretchPixels(data);
  assert.equal(data[0], 0);
  assert.equal(data[(n - 1) * 4], 255);
  assert.equal(data[90 * 4], 255); // inside the top 15%
});

test('Paddle words of a scanned statement page: packed headers, right-aligned amounts', () => {
  const words = JSON.parse(readFileSync(new URL('./fixtures/paddle-scanned-statement.words.json', import.meta.url)));
  const st = parseStatementPages([words]);
  assert.equal(st.openingBalance, 12000);
  assert.deepEqual(st.rows.map((r) => [r.date, r.debit, r.credit, r.balance]), [
    ['2026-10-24', null, 20000, 32000],
    ['2026-10-25', 1250, null, 30750],
    ['2026-10-26', 5000, null, 25750],
    ['2026-10-29', 630, null, 25120],
    ['2026-10-30', null, 85000, 110120],
  ]);
  assert.deepEqual(st.checks, { checked: 5, ok: 5, fixed: 0 });
});

test('Paddle words of a wallet screenshot: "DescriptiolDr." split, Dr. amounts under a narrow header', () => {
  const words = JSON.parse(readFileSync(new URL('./fixtures/paddle-wallet-screenshot.words.json', import.meta.url)));
  const st = parseStatementPages([words]);
  assert.deepEqual(st.rows.map((r) => [r.date, r.ref, r.debit, r.credit, r.balance]), [
    ['2026-10-31', '1WXYZ34', 650, null, 647.4],
    ['2026-11-01', '1ABCD12', 135, null, 512.4],
  ]);
  assert.deepEqual(st.checks, { checked: 1, ok: 1, fixed: 0 });
});
