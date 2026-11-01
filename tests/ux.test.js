import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../src/lib/format.js';
import { backupStatus, expensesCsv } from '../src/lib/backup.js';
import { billStage } from '../src/lib/expense.js';

test('csvCell quotes commas and quotes, and defuses spreadsheet formulas', () => {
  assert.equal(csvCell('Kirana, Pasal'), '"Kirana, Pasal"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+977'), "'+977");
  assert.equal(csvCell('@sum'), "'@sum");
  assert.equal(csvCell('-12.50'), '-12.50');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(630), '630');
  assert.equal(toCsv(['a', 'b'], [[1, 'x,y']]), 'a,b\n1,"x,y"\n');
});

test('expensesCsv lists bills by date with IRD status and no photo', () => {
  const csv = expensesCsv([
    { billCode: 'KT1-02', billDateAD: '2026-10-29', merchantName: 'Shop B', totalAmount: '630', paymentMethod: 'Cash', isNepalBill: false, receiptImage: 'data:image/jpeg;base64,AAAA' },
    { billCode: 'KT1-01', billDateAD: '2026-10-20', merchantName: 'Shop A', sellerPan: '601234567', totalAmount: 99.5, vatAmount: 11.45, isNepalBill: false },
  ]);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Bill code,Date \(AD\)/);
  assert.match(lines[1], /^KT1-01,2026-10-20,,Shop A,601234567,,,,99.50,11.45,Not a Nepal bill,,$/);
  assert.match(lines[2], /^KT1-02,2026-10-29/);
  assert.doesNotMatch(csv, /base64/);
});

test('backupStatus: stale after 14 days with own bills, never stale without bills', () => {
  const now = Date.parse('2026-11-01T10:00:00Z');
  assert.deepEqual(backupStatus('', 0, now), { stale: false, text: 'Nothing to back up yet' });
  assert.equal(backupStatus('', 3, now).stale, true);
  assert.equal(backupStatus('2026-11-01T08:00:00Z', 3, now).text, 'Backed up today');
  assert.equal(backupStatus('2026-10-31T08:00:00Z', 3, now).text, 'Backed up yesterday');
  const old = backupStatus('2026-10-10T08:00:00Z', 3, now);
  assert.equal(old.text, 'Backed up 22 days ago');
  assert.equal(old.stale, true);
  assert.equal(backupStatus('2026-10-25T08:00:00Z', 3, now).stale, false);
});

test('billStage: scanned → verified → submitted', () => {
  assert.equal(billStage({ ocrEngine: 'tesseract' }, false), 'scanned');
  assert.equal(billStage({ ocrEngine: '' }, false), '');
  assert.equal(billStage({ ocrEngine: 'tesseract' }, true), 'verified');
  assert.equal(billStage({ irdCoupon: '123456789012' }, true), 'submitted');
  assert.equal(billStage({ irdCoupon: '1234' }, true), 'verified');
});

test('Medicine: pharmacies, medical halls and clinics are guessed as Medicine', async () => {
  const { guessCategory } = await import('../src/lib/ocr/parse.js');
  const { CATEGORIES, EXCLUDED_CATEGORIES } = await import('../src/lib/constants.js');
  assert.ok(CATEGORIES.includes('Medicine'));
  assert.ok(!EXCLUDED_CATEGORIES.includes('Medicine')); // medicine bills can enter the IRD draw
  assert.equal(CATEGORIES.at(-1), 'Other');
  for (const shop of ['Om Pharmacy', 'Sagarmatha Medical Hall', 'Kathmandu Medical Store', 'City Polyclinic', 'Everest Dental Care', 'नेपाल मेडिकल']) {
    assert.equal(guessCategory(shop), 'Medicine', shop);
  }
  assert.equal(guessCategory('Annapurna Kirana Store'), 'Groceries');
});

test('a PDF e-bill is read from its own text', async () => {
  const { extractBillFromText } = await import('../src/lib/ocr/index.js');
  const text = [
    'Om Pharmacy',
    'Baneshwor, Kathmandu',
    'PAN No: 609123456',
    'TAX INVOICE',
    'Bill No: OP-2083-0042   Date: 2083-07-15',
    'Paracetamol 500mg x2     60.00',
    'Cough Syrup 100ml        185.00',
    'Sub Total     245.00',
    'Grand Total   245.00',
  ].join('\n');
  const { fields, engine, confidence } = extractBillFromText(text, { region: 'Nepal' });
  assert.equal(engine, 'pdf-text');
  assert.equal(confidence, 100);
  assert.equal(fields.merchantName, 'Om Pharmacy');
  assert.equal(fields.sellerPan, '609123456');
  assert.equal(Number(fields.totalAmount), 245);
  assert.equal(fields.billDateBS, '2083-07-15');
  assert.equal(fields.category, 'Medicine');
  assert.equal(fields.isNepalBill, true);
});

test('settings from the Tesseract days load as the on-device PaddleOCR engine', async () => {
  const store = new Map([['billkhata_settings', JSON.stringify({ ocrEngine: 'tesseract', tesseractNepali: true, visionProvider: 'gemini' })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const { loadSettings } = await import('../src/lib/profile.js');
  const s = loadSettings();
  assert.equal(s.ocrEngine, 'local');
  assert.equal(s.nepaliScript, true);
  assert.equal('tesseractNepali' in s, false);
  delete globalThis.localStorage;
});
