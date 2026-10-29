import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkEligibility, cleanBillNumber, encodePayload, portalFields, portalLink, portalPayload } from '../src/lib/ird.js';

const bill = {
  id: 'b1', merchantName: 'काठमाडौं किराना', isNepalBill: true, totalAmount: 1356, sellerPan: '६०९८७६५४३',
  invoiceNumber: 'akp 2083/0457', category: 'Groceries', paymentMethod: 'Cash', billDateAD: '2026-10-29', billDateBS: '2083-07-12',
};
const profile = { fullName: 'Sita Sharma', phone: '9841000000', address: 'Baneshwor-10, Kathmandu' };

test('bill number is cleaned the way the portal cleans it', () => {
  assert.equal(cleanBillNumber('akp 2083/0457'), 'AKP2083/0457');
  assert.equal(cleanBillNumber('बिल नं ४५७'), '457');
  assert.equal(cleanBillNumber('#12-A.b_c'), '12-A.B_C');
  assert.equal(cleanBillNumber('बिल'), '');
});

test('a bill number the portal would strip to nothing is flagged', () => {
  const r = checkEligibility({ ...bill, invoiceNumber: 'नं' }, { today: '2026-10-29', todayBs: '2083-07-12' });
  assert.match(r.warnings.join(), /bill \/ invoice number/);
});

test('portal fields cover the whole form', () => {
  assert.deepEqual(portalFields(bill, profile), {
    bill_number: 'AKP2083/0457', seller_pan_no: '609876543', billed_total_amount: '1356.00',
    name: 'Sita Sharma', mobile_number: '9841000000', address: 'Baneshwor-10, Kathmandu',
  });
});

test('payload survives the URL fragment, Nepali text included', () => {
  const link = portalLink(bill, profile, 'https://expense.sagunpradhan.com.np');
  const m = link.match(/^https:\/\/prize\.ird\.gov\.np\/#billkhata=([A-Za-z0-9_-]+)$/);
  assert.ok(m, link);
  const back = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  assert.deepEqual(back, portalPayload(bill, profile, 'https://expense.sagunpradhan.com.np'));
  assert.equal(back.merchant, 'काठमाडौं किराना');
  assert.equal(back.pay, 'cash');
  assert.equal(encodePayload({ a: 1 }).includes('='), false);
});

test('QR / card bills are marked digital so the helper never enrolls them', () => {
  assert.equal(portalPayload({ ...bill, paymentMethod: 'Digital QR / Card' }, profile, 'x').pay, 'digital');
});

test('helper source is valid JavaScript and never touches the honeypot or submit', () => {
  const src = readFileSync(new URL('../src/ird-helper/helper.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new Function(`${src}; return billkhataIrdHelper;`));
  assert.doesNotMatch(src, /company_website/);
  assert.doesNotMatch(src, /type=["']?submit|requestSubmit|\.submit\(/);
  assert.doesNotMatch(src, /(^|[^:])\/\/ /m, 'use block comments only (bookmarklet safety)');
});
