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

/** Applies the OCR enhancement to a canvas and returns it. */
export function preprocessCanvasForOCR(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixelsForOCR(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Larger, sharper copies for text recognition: `color` for vision models and `enhanced`
 * (grayscale, auto-levelled) for Tesseract. The stored photo stays untouched.
 */
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
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const color = canvas.toDataURL('image/jpeg', 0.92);
  const enhanced = preprocessCanvasForOCR(canvas).toDataURL('image/png');
  return { color, enhanced };
}

export function validateImageFile(file) {
  if (!file) return 'No file selected.';
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use a JPG, PNG or WEBP image.';
  if (file.size > 25 * 1024 * 1024) return 'That image is over 25 MB.';
  return '';
}
