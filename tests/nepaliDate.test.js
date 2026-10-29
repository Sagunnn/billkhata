import test from 'node:test';
import assert from 'node:assert/strict';
import { adToBs, bsToAd, drawWindowFor, isValidBS, toAsciiDigits } from '../src/lib/nepaliDate.js';

test('known BS/AD pairs', () => {
  assert.equal(adToBs('1943-04-14'), '2000-01-01');
  assert.equal(adToBs('2025-04-14'), '2082-01-01'); // Nepali new year 2082
  assert.equal(adToBs('2026-04-14'), '2083-01-01'); // Nepali new year 2083
  assert.equal(bsToAd('2083-01-01'), '2026-04-14');
});

test('round trip over many days', () => {
  let t = Date.UTC(2015, 0, 1);
  for (let i = 0; i < 6000; i++, t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    assert.equal(bsToAd(adToBs(d)), d);
  }
});

test('invalid dates', () => {
  assert.equal(isValidBS('2083-13-01'), false);
  assert.equal(isValidBS('2083-01-32'), adToBs(bsToAd('2083-01-31')) === '2083-01-32');
  assert.equal(adToBs('2026-02-30'), null);
});

test('draw window halves', () => {
  assert.equal(drawWindowFor('2083-07-12').label, 'Kartik 1–15, 2083');
  assert.match(drawWindowFor('2083-07-16').label, /^Kartik 16–\d\d, 2083$/);
});

test('devanagari digits', () => {
  assert.equal(toAsciiDigits('२०८३-०७-१२'), '2083-07-12');
});
