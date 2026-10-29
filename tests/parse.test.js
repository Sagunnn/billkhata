import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText } from '../src/lib/ocr/parse.js';
import { checkEligibility, getIrdStatus } from '../src/lib/ird.js';

const SAMPLE = `ANNAPURNA KIRANA PASAL
Baneshwor, Kathmandu
PAN No: 609876543
TAX INVOICE
Bill No: AKP-2083-0457
Date: 2083-07-12
Rice 5kg        650.00
Lentils 2kg     550.00
Sub Total      1200.00
VAT 13%         156.00
Grand Total    1,356.00
Cash Received  1,500.00`;

test('parses an English Nepali bill', () => {
  const r = parseReceiptText(SAMPLE);
  assert.equal(r.merchantName, 'ANNAPURNA KIRANA PASAL');
  assert.equal(r.sellerPan, '609876543');
  assert.equal(r.invoiceNumber, 'AKP-2083-0457');
  assert.equal(r.billDateBS, '2083-07-12');
  assert.equal(r.billDateAD, '2026-10-29');
  assert.equal(r.totalAmount, 1356);
  assert.equal(r.vatAmount, 156);
  assert.equal(r.category, 'Groceries');
});

test('parses Devanagari digits and keywords', () => {
  const r = parseReceiptText('स्थायी लेखा नम्बर: ६०१२३४५६७\nबिल नं: १२३\nजम्मा: १,२५०.००');
  assert.equal(r.sellerPan, '601234567');
  assert.equal(r.invoiceNumber, '123');
  assert.equal(r.totalAmount, 1250);
});

const base = {
  isNepalBill: true, totalAmount: 1356, sellerPan: '609876543', invoiceNumber: 'A1',
  category: 'Groceries', paymentMethod: 'Cash', billDateAD: '2026-10-29', billDateBS: '2083-07-12',
};
const opts = { today: '2026-10-29', todayBs: '2083-07-12' };

test('eligibility rules', () => {
  assert.equal(getIrdStatus(base, opts), 'Not Applied');
  assert.equal(getIrdStatus({ ...base, irdCoupon: '208307004512' }, opts), 'Applied - Coupon Saved');
  assert.equal(getIrdStatus({ ...base, paymentMethod: 'Digital QR / Card' }, opts), 'Auto-Entered via QR');
  assert.equal(getIrdStatus({ ...base, paymentMethod: 'Digital QR / Card', irdCoupon: '208307004512' }, opts), 'Applied - Coupon Saved');
  assert.equal(getIrdStatus({ ...base, totalAmount: 100 }, opts), 'Not Applied'); // portal: at least 100
  assert.equal(getIrdStatus({ ...base, totalAmount: 99.5 }, opts), 'Ineligible');
  assert.equal(getIrdStatus({ ...base, sellerPan: '' }, opts), 'Ineligible');
  assert.equal(getIrdStatus({ ...base, category: 'Transport' }, opts), 'Ineligible');
  assert.equal(getIrdStatus({ ...base, isNepalBill: false }, opts), 'Ineligible');
  const old = checkEligibility({ ...base, billDateBS: '2083-06-20', billDateAD: '2026-10-06' }, opts);
  assert.equal(old.eligible, true);
  assert.match(old.warnings.join(), /outside the current draw window/);
});

test('detects Fonepay / wallet payments, not a bare POS or QR', () => {
  assert.equal(parseReceiptText('Total 500\nPaid by: Fonepay QR').paymentMethod, 'Digital QR / Card');
  assert.equal(parseReceiptText('Total 500\nPayment mode: eSewa').paymentMethod, 'Digital QR / Card');
  assert.equal(parseReceiptText('POS Terminal 2\nScan QR to rate us\nTotal 500\nCash').paymentMethod, undefined);
});

test('more bill number styles', () => {
  assert.equal(parseReceiptText('Inv. No.: KTM/0091\nTotal 300').invoiceNumber, 'KTM/0091');
  assert.equal(parseReceiptText('बिजक नं: ४५७\nजम्मा 300').invoiceNumber, '457');
  assert.equal(parseReceiptText('No. 8812\nTotal 300').invoiceNumber, '8812');
  assert.equal(parseReceiptText('No. of items 3\nTotal 300').invoiceNumber, '');
});
