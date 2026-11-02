// Finds a bill in a camera frame: the paper is the large bright area on a darker background.
// Pure (works on a grey-level array), so it's unit-tested and cheap enough to run on every frame
// of a small preview (~160 px wide).

/** Otsu's threshold for 0-255 grey levels. */
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

/** Longest run of indexes where `ok(i)` holds, allowing gaps of up to `gap`. */
function longestRun(n, ok, gap = 2) {
  let best = null;
  let start = -1;
  let last = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && ok(i)) {
      if (start < 0 || i - last > gap + 1) start = i;
      last = i;
      if (!best || last - start > best[1] - best[0]) best = [start, last];
    }
  }
  return best;
}

/**
 * @param {Uint8Array|number[]} gray  w × h grey levels, row by row
 * @returns {null | { x, y, w, h, area, contrast }}  the paper's box, in the same pixels; area 0-1
 */
export function findPaper(gray, w, h) {
  if (!gray || gray.length < w * h || w < 8 || h < 8) return null;
  const t = otsu(gray);
  const on = (x, y) => gray[y * w + x] > t;
  // Rows that are mostly paper, then columns inside those rows, then rows again inside the columns.
  const rows = longestRun(h, (y) => { let c = 0; for (let x = 0; x < w; x++) c += on(x, y); return c > w * 0.25; });
  if (!rows) return null;
  const [y0, y1] = rows;
  const cols = longestRun(w, (x) => { let c = 0; for (let y = y0; y <= y1; y++) c += on(x, y); return c > (y1 - y0 + 1) * 0.6; });
  if (!cols) return null;
  const [x0, x1] = cols;
  const rows2 = longestRun(h, (y) => { let c = 0; for (let x = x0; x <= x1; x++) c += on(x, y); return c > (x1 - x0 + 1) * 0.6; });
  if (!rows2) return null;
  const box = { x: x0, y: rows2[0], w: x1 - x0 + 1, h: rows2[1] - rows2[0] + 1 };
  box.area = (box.w * box.h) / (w * h);
  // How much brighter the paper is than what's around it.
  let inSum = 0; let inN = 0; let outSum = 0; let outN = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const v = gray[y * w + x];
      if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) { inSum += v; inN++; } else { outSum += v; outN++; }
    }
  }
  box.contrast = inN && outN ? inSum / inN - outSum / outN : 0;
  return box;
}

/** A box that looks like a bill: big enough, not the whole frame, clearly brighter than around it. */
export const isBill = (box) => Boolean(box) && box.area > 0.12 && box.area < 0.94 && box.contrast > 28 && box.h > box.w * 0.6;

/** Two boxes about the same (the hand is steady): every edge within `tol` of the frame size. */
export function sameBox(a, b, w, h, tol = 0.04) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < w * tol && Math.abs(a.y - b.y) < h * tol
    && Math.abs(a.x + a.w - b.x - b.w) < w * tol && Math.abs(a.y + a.h - b.y - b.h) < h * tol;
}

/** RGBA pixels → grey levels. */
export function toGray(rgba) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return out;
}
