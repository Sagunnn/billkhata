// Client-side image handling with <canvas>: shrink receipt photos to under 300 KB
// for storage, and make a sharper copy for OCR.
import { MAX_IMAGE_BYTES } from './constants.js';

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function render(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // flatten transparent PNGs onto white
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
}

/** Compresses to a JPEG data URL no bigger than maxBytes. */
export async function compressImage(src, maxBytes = MAX_IMAGE_BYTES) {
  const img = await loadImage(src);
  let side = 1600;
  let quality = 0.82;
  let out = render(img, side, quality);
  while (dataUrlBytes(out.dataUrl) > maxBytes && side > 320) {
    if (quality > 0.5) quality -= 0.1;
    else side = Math.round(side * 0.8);
    out = render(img, side, quality);
  }
  return { ...out, bytes: dataUrlBytes(out.dataUrl) };
}

/**
 * Grayscale (Rec. 601 luminance), then auto-levels: the darkest 1% maps to black and the brightest
 * 2% to white, with a slight darkening curve (gamma 1.3) for faint print. Because it adapts to each
 * photo's own lighting, faded thermal bills and grey, unevenly lit photos come out crisp; a fixed
 * contrast stretch lost the PAN line and garbled digits on the same test photo.
 * Works on any RGBA byte array, so it's testable without a canvas.
 */
export function enhancePixelsForOCR(data) {
  const n = data.length / 4;
  if (!n) return data;
  const lum = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    lum[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    hist[lum[j]]++;
  }
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
  for (let v = 255, acc = 0; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) table[v] = Math.round(Math.pow(Math.min(1, Math.max(0, (v - lo) / span)), 1.3) * 255);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const v = table[lum[j]];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return data;
}

/**
 * Adaptive threshold (Bradley–Roth): a pixel turns black when it's clearly darker than its
 * neighbourhood. Copes with the shadows and creases of a crumpled bill, where one global contrast
 * setting either loses faint print or blackens the folds. `win` is the neighbourhood size in pixels.
 */
export function adaptiveThreshold(data, width, height, win = Math.max(16, Math.round(width / 16)), t = 0.15) {
  const w = width;
  const h = height;
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  const sums = new Float64Array((w + 1) * (h + 1)); // integral image
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + x - 1];
      sums[y * (w + 1) + x] = sums[(y - 1) * (w + 1) + x] + row;
    }
  }
  const r = Math.max(4, Math.round(win / 2));
  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - r);
    const y2 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(w, x + r + 1);
      const sum = sums[y2 * (w + 1) + x2] - sums[y1 * (w + 1) + x2] - sums[y2 * (w + 1) + x1] + sums[y1 * (w + 1) + x1];
      const v = gray[y * w + x] < (sum / ((x2 - x1) * (y2 - y1))) * (1 - t) ? 0 : 255;
      const i = (y * w + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
  return data;
}

/**
 * The angle (degrees) a photographed bill is tilted by. Text rows are sharpest, with the most
 * contrast between busy and empty rows, when the bill is straight, so each candidate angle is
 * scored by how peaked the row profile of dark pixels is. `gray` is a small grayscale copy.
 */
export function estimateSkew(gray, width, height, { maxAngle = 12 } = {}) {
  let mean = 0;
  for (let i = 0; i < gray.length; i++) mean += gray[i];
  mean /= gray.length || 1;
  // Text pixels only: clearly darker than their surroundings, on paper (brighter than the photo
  // average). Dark tables and cloth around the bill would otherwise drown the text rows out.
  const w = width;
  const sums = new Float64Array((w + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) { row += gray[(y - 1) * w + x - 1]; sums[y * (w + 1) + x] = sums[(y - 1) * (w + 1) + x] + row; }
  }
  const r = Math.max(3, Math.round(w / 40));
  const xs = [];
  const ys = [];
  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - r);
    const y2 = Math.min(height, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r);
      const x2 = Math.min(w, x + r + 1);
      const local = (sums[y2 * (w + 1) + x2] - sums[y1 * (w + 1) + x2] - sums[y2 * (w + 1) + x1] + sums[y1 * (w + 1) + x1]) / ((x2 - x1) * (y2 - y1));
      if (local > mean && gray[y * w + x] < local * 0.75) { xs.push(x - w / 2); ys.push(y - height / 2); }
    }
  }
  if (xs.length < 50) return 0;
  const diag = Math.ceil(Math.hypot(width, height));
  const score = (deg) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const rows = new Float64Array(diag + 2);
    for (let i = 0; i < xs.length; i++) rows[Math.round(ys[i] * cos - xs[i] * sin + diag / 2)]++;
    let s = 0;
    for (let i = 1; i < rows.length; i++) s += (rows[i] - rows[i - 1]) ** 2;
    return s;
  };
  let best = 0;
  let bestScore = score(0);
  for (let d = -maxAngle; d <= maxAngle; d += 0.5) {
    const sc = score(d);
    if (sc > bestScore) { best = d; bestScore = sc; }
  }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) {
    const sc = score(d);
    if (sc > bestScore) { best = d; bestScore = sc; }
  }
  return Math.round(best * 10) / 10;
}

/** Applies the OCR enhancement to a canvas and returns it. */
export function preprocessCanvasForOCR(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixelsForOCR(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Larger, sharper copies for text recognition: `color` for vision models, `enhanced` (grayscale,
 * auto-levelled) for Tesseract, and `threshold` (black and white) for a second Tesseract read of
 * crumpled or shadowed bills. The stored photo stays untouched.
 */
/** The tilt of a photo, measured on a 600 px copy. */
function skewOf(img) {
  const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return estimateSkew(gray, w, h);
}

export async function prepareForOcr(src) {
  const img = await loadImage(src);
  // Small or distant photos are enlarged (up to 2.5x) so small print like the PAN line stays readable.
  const scale = Math.min(2.5, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  // Straighten a tilted photo first: the reader loses whole rows on a bill a few degrees off.
  const angle = skewOf(img);
  if (Math.abs(angle) >= 0.5) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  const color = canvas.toDataURL('image/jpeg', 0.92);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const enhanced = preprocessCanvasForOCR(canvas).toDataURL('image/png');
  adaptiveThreshold(pixels.data, canvas.width, canvas.height);
  ctx.putImageData(pixels, 0, 0);
  const threshold = canvas.toDataURL('image/png');
  return { color, enhanced, threshold, angle };
}

export function validateImageFile(file) {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use a JPG, PNG or WEBP image.';
  if (file.size > 25 * 1024 * 1024) return 'That image is over 25 MB.';
  return '';
}

/**
 * 64-bit difference hash from a 9 × 8 grayscale grid (row by row): each bit says whether a pixel
 * is brighter than its right neighbour. Returned as 16 hex characters.
 */
export function dHashFromGray(gray) {
  let hex = '';
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Perceptual hash of a receipt photo, for spotting the same photo added twice. */
export async function imageHash(src) {
  const img = await loadImage(src);
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 8;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, 9, 8);
  const { data } = g.getImageData(0, 0, 9, 8);
  const gray = new Array(72);
  for (let i = 0; i < 72; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return dHashFromGray(gray);
}
