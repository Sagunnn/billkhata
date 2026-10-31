import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePaymentText } from '../src/lib/bank/payment.js';

test('Fonepay via a bank app: labels and values on one line', () => {
  const p = parsePaymentText(`9:41
Payment Successful
NPR 630.00
Merchant Name KOTHEYS PIMBAL
Fonepay Trace ID 712345678
Transaction ID FP2610291432ABCD
Date 2026-10-29 14:32:11
Remarks Dinner
Powered by fonepay`);
  assert.equal(p.app, 'Fonepay');
  assert.equal(p.amount, 630);
  assert.equal(p.merchant, 'KOTHEYS PIMBAL');
  assert.equal(p.dateAD, '2026-10-29');
  assert.equal(p.time, '14:32');
  assert.equal(p.ref, '712345678');
  assert.ok(p.refs.includes('FP2610291432ABCD'));
  assert.equal(p.remarks, 'Dinner');
  assert.equal(p.status, 'success');
});

test('eSewa: value below its label, 12-hour time, balance ignored', () => {
  const p = parsePaymentText(`eSewa
Rs. 1,250.00
Payment Successful
Paid To
Bhatbhateni Supermarket
Transaction Code
0A1B2C3
Date & Time
Oct 28, 2026 | 06:05 PM
Available Balance
Rs. 3,412.50
Service Charge
Rs. 0.00`);
  assert.equal(p.app, 'eSewa');
  assert.equal(p.amount, 1250);
  assert.equal(p.merchant, 'Bhatbhateni Supermarket');
  assert.equal(p.dateAD, '2026-10-28');
  assert.equal(p.time, '18:05');
  assert.equal(p.ref, '0A1B2C3');
});

test('Khalti: total amount wins over the amount before a fee', () => {
  const p = parsePaymentText(`khalti
Transaction Successful
Amount Rs 500
Charge Rs 5
Total Amount Rs 505
To: Ncell Recharge 9800000000
Transaction ID: KH-77881234
29 Oct 2026, 08:15 AM`);
  assert.equal(p.amount, 505);
  assert.equal(p.merchant, 'Ncell Recharge');
  assert.equal(p.dateAD, '2026-10-29');
  assert.equal(p.time, '08:15');
  assert.equal(p.ref, 'KH-77881234');
});

test('a failed payment is marked so it is never matched', () => {
  assert.equal(parsePaymentText('Payment Failed\nNPR 630.00\n29/10/2026 14:32').status, 'failed');
});

test('money received is money in', () => {
  const p = parsePaymentText('You received NPR 2,000.00\nReceived from Asha\n30/10/2026 10:00');
  assert.equal(p.direction, 'in');
  assert.equal(p.amount, 2000);
});
