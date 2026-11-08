import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPhoto } from '../src/lib/db.js';
import { hasPhoto } from '../src/lib/expense.js';
import { buildBackup, validateBackup } from '../src/lib/backup.js';

const photo = `data:image/jpeg;base64,${'A'.repeat(5000)}`;

test('a bill is stored without its photo; the photo goes to its own store', () => {
  const [rec, p] = splitPhoto({ id: 'b1', merchantName: 'Shop', receiptImage: photo });
  assert.equal(p, photo);
  assert.equal(rec.receiptImage, undefined);
  assert.deepEqual([rec.hasPhoto, rec.photoBytes], [true, photo.length]);
});

test('saving without a photo field keeps the stored photo; null removes it', () => {
  const kept = splitPhoto({ id: 'b1', merchantName: 'Edited', hasPhoto: true, thumb: 'data:image/jpeg;base64,T', photoBytes: 9 });
  assert.equal(kept[1], undefined); // keep
  assert.deepEqual([kept[0].hasPhoto, kept[0].thumb], [true, 'data:image/jpeg;base64,T']);
  const removed = splitPhoto({ id: 'b1', hasPhoto: true, thumb: 'x', receiptImage: null });
  assert.equal(removed[1], null); // remove
  assert.deepEqual([removed[0].hasPhoto, removed[0].thumb, removed[0].photoBytes], [false, '', 0]);
  assert.equal(hasPhoto(kept[0]), true);
  assert.equal(hasPhoto(removed[0]), false);
  assert.equal(hasPhoto({ receiptImage: photo }), true);
});

test('backups carry photos back on the bill, and say honestly when they don’t', () => {
  const stored = { id: 'b1', merchantName: 'Shop', totalAmount: 100, billDateAD: '2026-11-01', hasPhoto: true, photoBytes: 9, thumb: 'data:image/jpeg;base64,T' };
  // With photos (loaded back on): restores with the photo.
  const full = validateBackup(JSON.parse(JSON.stringify(buildBackup({}, [{ ...stored, receiptImage: photo }]))));
  assert.deepEqual([full.expenses[0].hasPhoto, full.expenses[0].receiptImage === photo, full.expenses[0].thumb], [true, true, 'data:image/jpeg;base64,T']);
  // Without photos: the bill doesn't claim one.
  const small = buildBackup({}, [stored], [], {}, null, { photos: false });
  assert.deepEqual([small.expenses[0].hasPhoto, small.expenses[0].thumb, small.expenses[0].photoBytes], [false, undefined, undefined]);
  // A record that says it has a photo but carries none (a damaged file) restores without one.
  const odd = validateBackup({ app: 'BillKhata', version: 1, expenses: [stored] });
  assert.deepEqual([odd.expenses[0].hasPhoto, odd.expenses[0].thumb], [false, '']);
});
