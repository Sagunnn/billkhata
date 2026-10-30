import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkEligibility, extractCouponCodes, findDuplicateBill, formatCoupon, getIrdStatus, lastAnnouncementBS,
  matchWinningCoupons, normalizeCouponCode, normalizeInvoiceNumber,
} from '../src/lib/ird.js';
import { applyMerchantMemory, lookupMerchant, normalizeMerchantName } from '../src/lib/merchants.js';
import { enhancePixelsForOCR } from '../src/lib/image.js';
import { needsBetterRead, visionProviderWithKey } from '../src/lib/ocr/index.js';

const opts = { today: '2026-10-29', todayBs: '2083-07-12' };
const bill = (over = {}) => ({
  id: 'a', merchantName: 'Annapurna Kirana Pasal', isNepalBill: true, totalAmount: 500, sellerPan: '609876543',
  invoiceNumber: 'AKP-0457', category: 'Groceries', paymentMethod: 'Cash', billDateAD: '2026-10-29', billDateBS: '2083-07-12', ...over,
});

test('normalizeInvoiceNumber: Nepali digits, symbols, case', () => {
  assert.equal(normalizeInvoiceNumber('बिल नं ४५७'), '457');
  assert.equal(normalizeInvoiceNumber('akp 2083/0457'), 'AKP2083/0457');
  assert.equal(normalizeInvoiceNumber('#Inv: 12-a.b_c'), 'INV12-A.B_C');
  assert.equal(normalizeInvoiceNumber(), '');
  assert.equal(normalizeInvoiceNumber('x'.repeat(50)).length, 40);
});

test('normalizeCouponCode / formatCoupon', () => {
  assert.equal(normalizeCouponCode('२०८३ ०७००-४५१२'), '208307004512');
  assert.equal(normalizeCouponCode('12345'), '');
  assert.equal(normalizeCouponCode('1234567890123'), '');
  assert.equal(formatCoupon('208307004512'), '208 307 004 512');
});

test('findDuplicateBill: same PAN + normalized invoice', () => {
  const saved = [bill(), bill({ id: 'b', sellerPan: '601111111', invoiceNumber: 'X-1' })];
  assert.equal(findDuplicateBill(bill({ id: 'new', invoiceNumber: 'akp-०४५७' }), saved)?.id, 'a');
  assert.equal(findDuplicateBill(bill({ id: 'new', invoiceNumber: ' akp-0457 ', sellerPan: '६०९८७६५४३' }), saved)?.id, 'a');
});

test('findDuplicateBill: different PAN, self, or missing data is not a duplicate', () => {
  const saved = [bill()];
  assert.equal(findDuplicateBill(bill({ id: 'new', sellerPan: '601234567' }), saved), null);
  assert.equal(findDuplicateBill(bill(), saved), null, 'a bill is not a duplicate of itself');
  assert.equal(findDuplicateBill(bill({ id: 'new', invoiceNumber: '' }), saved), null);
  assert.equal(findDuplicateBill(bill({ id: 'new', sellerPan: '' }), saved), null);
  assert.equal(findDuplicateBill(bill({ id: 'new', invoiceNumber: 'AKP-0458' }), saved), null);
});

test('Rs. 100 exactly: eligible with a soft warning; below 100: ineligible', () => {
  const at100 = checkEligibility(bill({ totalAmount: 100 }), opts);
  assert.equal(at100.eligible, true);
  assert.match(at100.warnings.join(' '), /Section 4\(1\)/);
  assert.equal(getIrdStatus(bill({ totalAmount: 100 }), opts), 'Not Applied');
  const below = checkEligibility(bill({ totalAmount: 99.99 }), opts);
  assert.equal(below.eligible, false);
  assert.doesNotMatch(checkEligibility(bill({ totalAmount: 100.5 }), opts).warnings.join(' '), /Section 4\(1\)/);
});

test('matchWinningCoupons: spaced, unspaced and Nepali digits', () => {
  const saved = [
    bill({ id: 's', irdCoupon: '007315254493' }),
    bill({ id: 'u', irdCoupon: '208307004512' }),
    bill({ id: 'n', irdCoupon: '112233445566' }),
    bill({ id: 'none', irdCoupon: '' }),
    bill({ id: 'other', irdCoupon: '999999999999' }),
  ];
  const ids = (t) => matchWinningCoupons(t, saved).map((b) => b.id).sort();
  assert.deepEqual(ids('Daily winner: 007 315 254 493'), ['s']);
  assert.deepEqual(ids('विजेता 208307004512 (बम्पर)'), ['u']);
  assert.deepEqual(ids('कुपन नं. ००७ ३१५ २५४ ४९३ र ११२२३३४४५५६६'), ['n', 's']);
  assert.deepEqual(ids('no coupons here, phone 9841000000, acct 12345678901234'), []);
  assert.deepEqual(matchWinningCoupons('', saved), []);
});

test('extractCouponCodes ignores longer digit runs and accepts 4-4-4', () => {
  assert.deepEqual(extractCouponCodes('A/C 1234567890123 · 0073-1525-4493'), ['007315254493']);
});

test('lastAnnouncementBS: 1st or 16th of the Nepali month', () => {
  assert.equal(lastAnnouncementBS('2083-07-12'), '2083-07-01');
  assert.equal(lastAnnouncementBS('2083-07-16'), '2083-07-16');
  assert.equal(lastAnnouncementBS('2083-07-30'), '2083-07-16');
});

test('OCR preprocessing: grayscale, auto-levels to full black/white, alpha kept', () => {
  // A faded photo: paper ~200 grey, ink ~120 grey, nothing near black or white.
  const px = [];
  for (let k = 0; k < 90; k++) px.push(200, 198, 196, 255);
  for (let k = 0; k < 10; k++) px.push(120, 118, 116, 128);
  const data = enhancePixelsForOCR(new Uint8ClampedArray(px));
  assert.equal(data[0], 255); // paper becomes white
  assert.equal(data[90 * 4], 0); // ink becomes black
  assert.equal(data[90 * 4 + 3], 128); // alpha untouched
  assert.equal(data[0], data[1]); // grayscale
  assert.equal(enhancePixelsForOCR(new Uint8ClampedArray(0)).length, 0);
});

test('merchant memory: by PAN first, then by name; never matches itself', () => {
  const saved = [bill({ id: 'old', category: 'Food & Dining', updatedAt: '2026-10-01' })];
  assert.equal(lookupMerchant({ sellerPan: '609876543' }, saved).merchantName, 'Annapurna Kirana Pasal');
  assert.equal(lookupMerchant({ merchantName: 'annapurna  kirana pasal.' }, saved).sellerPan, '609876543');
  assert.equal(lookupMerchant({ id: 'old', sellerPan: '609876543' }, saved), null);
  const { fields } = applyMerchantMemory({ sellerPan: '609876543', category: 'Other' }, saved);
  assert.equal(fields.merchantName, 'Annapurna Kirana Pasal');
  assert.equal(fields.category, 'Food & Dining');
  assert.equal(normalizeMerchantName('Himal Fresh Mart, Pvt. Ltd.'), 'himal fresh mart pvt ltd');
});

test('hybrid OCR: when to offer a vision re-scan', () => {
  assert.equal(needsBetterRead({ fields: { sellerPan: '609876543', totalAmount: 500 }, confidence: 85 }), false);
  assert.equal(needsBetterRead({ fields: { sellerPan: '', totalAmount: 500 }, confidence: 85 }), true);
  assert.equal(needsBetterRead({ fields: { sellerPan: '609876543' }, confidence: 85 }), true);
  assert.equal(needsBetterRead({ fields: { sellerPan: '609876543', totalAmount: 500 }, confidence: 41 }), true);
  assert.equal(visionProviderWithKey({ visionProvider: 'gemini', apiKeys: { gemini: '', anthropic: 'k' } }), 'anthropic');
  assert.equal(visionProviderWithKey({ visionProvider: 'gemini', apiKeys: { gemini: '', openai: '' } }), '');
});
