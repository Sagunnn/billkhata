// Supermarket receipts with a discount, from real photos (the customer's name replaced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, parseReceiptText, vatTriplet } from '../src/lib/ocr/parse.js';
import { combineReads } from '../src/lib/ocr/consensus.js';
import { itemsMatchTotal } from '../src/lib/ocr/index.js';
import { PAYMENT } from '../src/lib/constants.js';
import { parseLineItemsFromText } from '../src/lib/splitter.js';

const EGGS = `Kathmandu Kreative Mart pvt. Ltd.
TYAGAL, 7 LALITPUR
PAN NO.: 610146583
01-5921365
ABBREVIATED TAX INVOICE
Bil1 NO: SI35528-TGL-83/84
Date   :11/0472026
Miti   18/07/2083
Name   Ram Bahadur
Address:
PAN No :
Payment Mode : Cash
Sn|HSCl   Particulars   1Qtyl Rate | Amount|
VIZU LOOSE EGG 1PC   30   18   540
Gross Amount   540.00
Discount   5.00
Net Amount   535.00
Tender   535.00
Change   0.00
Rs. Five hundred thirty-five only only
Thank you for visiting us.
Goods purchased must be returned within 3 days.
Counter   TYAGAL 2ND   ( 10:30AM
Cashier   tgmorning1
-POWERED BY IMS SOFTWARE-`;

// The photo caught the bottom of the receipt printed before it.
const MOMO = `mOAL 2ND   curned within 3 days.
(10:30AM
-POWEREn
Kathmandu Kreative Mart Pyt. Ltd.
TYAGAL, 7 LALITPUR
PAN No.:610146583
01-5921365
ABBREVIATED TAX INVOICE
Bi11 NO:SI25946-TGL-83/84
Date   :10/07/2026
Miti   :21/06/2083
Name   Ram Bahadur
Address:
PAN NO :
Payment Mode : FonePay
Sn|HSCl   Particulars   1Qty| Rate | Amountl
URBAN CHICKEN DIET MO   365   365
Gross Amount   365.00
Discount   3.65
Net Amount   361.35
Tender   361.35
Change   0.00
Rs. Three hundred sixty-one and Thirty-five
Paisa only only
Thank you for visiting us.
Goods purchased must be returned within 3 days.
Counter   : TYAGAL 2ND   ( 1:56PM
Cashier   : tgmorning1
-POWERED BY IMS SOFTWARE-`;

test('a discounted bill: the net amount is the total, not the discount or the gross', () => {
  const r = parseReceiptText(EGGS);
  assert.equal(r.totalAmount, 535);
  assert.equal(r.discountAmount, 5);
  assert.equal(r.merchantName, 'Kathmandu Kreative Mart pvt. Ltd.');
  assert.equal(r.sellerPan, '610146583');
  assert.equal(r.invoiceNumber, 'SI35528-TGL-83/84');
  assert.equal(r.billDateBS, '2083-07-18');
  assert.equal(r.paymentMethod, undefined); // cash
  const items = parseLineItemsFromText(EGGS);
  assert.deepEqual(items.map((i) => [i.name, i.qty, i.amount]), [['VIZU LOOSE EGG 1PC', 30, 540]]);
  assert.ok(itemsMatchTotal(items, r.totalAmount, r.discountAmount), '540 of items less 5 off is 535');
  assert.ok(!itemsMatchTotal(items, r.totalAmount), 'without the discount they don’t match');
});

test('paisa in words are paisa, not rupees: 361.35, not 396', () => {
  const r = parseReceiptText(MOMO);
  assert.equal(r.totalAmount, 361.35);
  assert.equal(r.discountAmount, 3.65);
  assert.equal(r.paymentMethod, PAYMENT.DIGITAL);
  assert.equal(r.merchantName, 'Kathmandu Kreative Mart Pyt. Ltd.');
  assert.equal(r.invoiceNumber, 'SI25946-TGL-83/84');
  assert.equal(r.billDateBS, '2083-06-21'); // Miti; the AD "10/07" is month first here
  assert.equal(amountInWords('Rs. Three hundred sixty-one and Thirty-five Paisa only only'), 361.35);
  assert.equal(amountInWords('Rupees Five Thousand One Hundred Fifteen and Fifty Six Paisa Only'), 5115.56);
  assert.equal(amountInWords('one thousand and fifty rupees and paisa twenty'), 1050.2);
  assert.equal(amountInWords('Six hundred and thirty rupees'), 630);
  assert.equal(amountInWords('twelve hundred fifty'), 1250);
});

test('bottom of the bill lost: never a footer number as the total', () => {
  // No "Net Amount" and no amount in words: "within 3 days" and friends once passed as a VAT bill (5).
  const cut = EGGS.split('\n').filter((l) => !/^Net Amount|^Rs\./.test(l)).join('\n');
  assert.equal(parseReceiptText(cut).totalAmount, 535, 'tender less change');
  const noTender = cut.split('\n').filter((l) => !/^Tender|^Change/.test(l)).join('\n');
  const r = parseReceiptText(noTender);
  assert.equal(r.totalAmount, 535, 'items less the discount, flagged as a guess');
  assert.equal(r.totalGuessed, true);
  assert.equal(vatTriplet(['Goods purchased must be returned within 3 days.', 'Counter 1', 'Total 5']), null);
});

test('several reads of a discounted bill keep the item that is bigger than the total', () => {
  const r = combineReads([EGGS, EGGS.replace('Kreative', 'Kreatlve'), { text: EGGS, kind: 'words' }]);
  assert.equal(r.totalAmount, 535);
  assert.equal(r.discountAmount, 5);
  assert.deepEqual(r.lineItems.map((i) => i.amount), [540]);
});

test('a landline under the PAN line is not the PAN', () => {
  assert.equal(parseReceiptText('Shop Pvt. Ltd.\nPAN NOL ILITDUS\n01-5921365\nTotal 100').sellerPan, '');
});
