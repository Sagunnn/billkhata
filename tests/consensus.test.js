// Combining several OCR reads of one crumpled bill, and rebuilding rows from word positions.
// Fixtures are real reads of a crumpled estimate slip (Kotheys Pimbal): total 630,
// Chicken Keema Noodles 250, Chinese Soup Momo 200, Coke 2 × 90 = 180.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clusterItems, combineReads, nameQuality, sumMatches } from '../src/lib/ocr/consensus.js';
import { cleanNumberToken, rowsFromWords } from '../src/lib/ocr/layout.js';
import { parseLineItemsFromText } from '../src/lib/splitter.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const rows = (items) => items.map((i) => [i.name, i.qty, i.amount]);
const TRUTH = [['Chicken Keema Noodles', 1, 250], ['Chinese Soup Momo', 1, 200], ['Coke', 2, 180]];

test('number tokens are cleaned of OCR specks', () => {
  assert.equal(cleanNumberToken('<.80.00'), '80.00');
  assert.equal(cleanNumberToken('250,'), '250');
  assert.equal(cleanNumberToken('{1'), '1');
  assert.equal(cleanNumberToken('200,00'), '200.00');
  assert.equal(cleanNumberToken('—'), '');
});

test('rows rebuilt from word positions: numbers half a line (or more) below their names', () => {
  const words = JSON.parse(fixture('kotheys-words.json'));
  assert.deepEqual(rows(parseLineItemsFromText(rowsFromWords(words))), TRUTH);
});

test('rows rebuilt from a tilted photo, with misread digits fixed by qty × rate', () => {
  // Read as "1200.00 209" and "90.00 189": 1 × 200 = 200 and 2 × 90 = 180.
  const words = JSON.parse(fixture('kotheys-tilted-words.json'));
  assert.deepEqual(rows(parseLineItemsFromText(rowsFromWords(words))), TRUTH);
});

test('misread amounts are repaired from the row arithmetic, real rows are left alone', () => {
  assert.deepEqual(rows(parseLineItemsFromText('Coke 90.00 189.09')), [['Coke', 2, 180]]);
  assert.deepEqual(rows(parseLineItemsFromText('Momo 1 200.00 209')), [['Momo', 1, 200]]);
  assert.deepEqual(rows(parseLineItemsFromText('Lassi 2 60.00 120.00')), [['Lassi', 2, 120]]);
  assert.deepEqual(rows(parseLineItemsFromText('Momo Platter 450')), [['Momo Platter', 1, 450]]);
});

test('name quality separates words from OCR noise', () => {
  assert.ok(nameQuality('Chinese Soup Momo') > 0.9);
  assert.ok(nameQuality('Coke') > 0.9);
  assert.ok(nameQuality('Gr eee') < 0.5);
  assert.ok(nameQuality('EEE ONE') < 0.5);
  assert.ok(nameQuality('a oe ff SLE') < 0.5);
});

test('totals with service charge / VAT on top still match', () => {
  assert.ok(sumMatches(1000, 1130));
  assert.ok(sumMatches(1000, 1243));
  assert.ok(!sumMatches(450, 630));
});

test('the same row read different ways is grouped once', () => {
  const groups = clusterItems([
    [{ name: 'Coke', amount: 180, qty: 2, price: 90 }],
    [{ name: 'Gr eee', amount: 180, qty: 1, price: 180 }],
    [{ name: 'Coke', amount: 189, qty: 1, price: 189 }],
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].amount, 180);
  assert.equal(groups[0].name, 'Coke');
});

test('poor reads of a low-quality photo combine into the right bill', () => {
  // No single read has all three rows: one misses Coke, one reads it 19.09, one 189, one names it "Tree".
  const reads = fixture('kotheys-lowq-reads.txt').split(/----- read \d+ of \d+ -----\n/).filter(Boolean);
  for (const r of reads) assert.notDeepEqual(parseLineItemsFromText(r).map((i) => i.amount), [250, 200, 180]);
  const f = combineReads(reads);
  assert.equal(f.totalAmount, 630);
  assert.deepEqual(f.lineItems.map((i) => [i.name, i.amount]), TRUTH.map(([n, , a]) => [n, a]));
  assert.equal(f.billDateBS, '2083-07-12');
  assert.equal(f.invoiceNumber.toUpperCase(), 'EST7135-KP-83/84');
});

test('when no read finds the total, the sum of the items is flagged as a guess', () => {
  const f = combineReads(['Chicken Momo 250.00\nChinese Soup Momo 200.00', 'Chicken Momo 250.00\nChinese Soup Momo 200.00']);
  assert.equal(f.totalAmount, 450);
  assert.equal(f.totalGuessed, true);
});
