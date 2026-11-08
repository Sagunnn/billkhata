import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarPixels, avatarSvg, nextGender } from '../src/lib/pixelAvatar.js';

test('a name always draws the same face; a new look draws another', () => {
  assert.deepEqual(avatarPixels('Hari'), avatarPixels(' hari '));
  assert.notDeepEqual(avatarPixels('Hari', { look: 1 }).cells, avatarPixels('Hari').cells);
  assert.notDeepEqual(avatarPixels('Sita').cells, avatarPixels('Gita').cells);
});

test('hair and face styles follow the gender', () => {
  const female = new Set(['long', 'bun', 'bob', 'ponytail', 'braids', 'fringe']);
  for (let look = 0; look < 40; look++) {
    assert.ok(female.has(avatarPixels('Ram', { gender: 'f', look }).hair));
    assert.ok(!female.has(avatarPixels('Ram', { gender: 'm', look }).hair));
  }
  // Not set: one of the two, picked by the name.
  assert.ok(['m', 'f'].includes(avatarPixels('Kiran').gender));
  assert.deepEqual(['', 'm', 'f'].map(nextGender), ['m', 'f', '']);
});

test('every pixel is on the 12×12 grid; the SVG is crisp', () => {
  for (const name of ['Ram', 'साथी', '']) {
    for (const gender of ['', 'm', 'f']) {
      const { cells } = avatarPixels(name, { gender });
      assert.ok(cells.every(([x, y, c]) => x >= 0 && x < 12 && y >= 0 && y < 12 && /^#[0-9a-f]{6}$/.test(c)));
    }
  }
  assert.match(avatarSvg('Ram'), /^<svg[^>]+shape-rendering="crispEdges"/);
});
