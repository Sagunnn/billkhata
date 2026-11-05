import test from 'node:test';
import assert from 'node:assert/strict';
import { findPaper, isBill, otsu, toGray } from '../src/lib/paperEdge.js';

// A dark frame with a light rectangle (the bill), plus some noise and dark "text" lines on it.
function frame(w, h, r, { bg = 50, paper = 225 } = {}) {
  const g = new Uint8Array(w * h);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      const text = inside && y % 6 === 0 && x > r.x + 4 && x < r.x + r.w - 4;
      g[y * w + x] = Math.max(0, Math.min(255, (text ? 80 : inside ? paper : bg) + (rnd() - 0.5) * 30));
    }
  }
  return g;
}

test('findPaper: finds the bill on a darker table', () => {
  const r = { x: 40, y: 30, w: 80, h: 150 };
  const box = findPaper(frame(160, 220, r), 160, 220);
  assert.ok(box);
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(box[k] - r[k]) <= 4, `${k}: ${box[k]} vs ${r[k]}`);
  assert.ok(isBill(box));
});

test('findPaper: an empty, even frame is not a bill', () => {
  const g = new Uint8Array(160 * 220).fill(120);
  assert.equal(isBill(findPaper(g, 160, 220)), false);
});

test('findPaper: a tiny scrap far away is not a bill', () => {
  assert.equal(isBill(findPaper(frame(160, 220, { x: 70, y: 90, w: 12, h: 18 }), 160, 220)), false);
});

test('otsu and toGray', () => {
  const t = otsu(Uint8Array.from([...Array(50).fill(40), ...Array(50).fill(220)]));
  assert.ok(t >= 40 && t < 220);
  assert.deepEqual([...toGray(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
});

test('sharpness: crisp text scores far above the same text blurred', async () => {
  const { sharpness } = await import('../src/lib/paperEdge.js');
  const w = 120;
  const h = 80;
  const crisp = new Uint8Array(w * h).fill(230);
  for (let y = 10; y < h - 10; y += 8) for (let x = 10; x < w - 10; x++) if ((x >> 2) % 3) { crisp[y * w + x] = 30; crisp[(y + 1) * w + x] = 30; }
  // 5 × 5 box blur, as a shaky or out-of-focus photo
  const blur = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; let c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy; const xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += crisp[yy * w + xx]; c++; } }
    blur[y * w + x] = s / c;
  }
  assert.ok(sharpness(crisp, w, h) > 8 * sharpness(blur, w, h));
  const { focusScore } = await import('../src/lib/paperEdge.js');
  // The same, faded to a third of the contrast: the focus score hardly moves.
  const faded = crisp.map((v) => 180 + Math.round((v - 180) / 3));
  assert.ok(focusScore(crisp, w, h) > 40 && focusScore(faded, w, h) > 40);
  assert.ok(focusScore(blur, w, h) < focusScore(crisp, w, h) / 5);
  assert.equal(sharpness(new Uint8Array(w * h).fill(128), w, h), 0);
});
