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

export const OCR_CONTRAST = 1.45;

/**
 * Grayscale (Rec. 601 luminance) plus a contrast stretch around mid-grey, in place.
 * Faded thermal print and carbon-copy handwriting gain enough contrast for Tesseract.
 * Works on any RGBA byte array, so it is testable without a canvas.
 */
export function enhancePixelsForOCR(data, contrast = OCR_CONTRAST) {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const v = Math.max(0, Math.min(255, Math.round((y - 128) * contrast + 128)));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return data;
}

/** Applies the OCR enhancement to a canvas and returns it. */
export function preprocessCanvasForOCR(canvas, contrast = OCR_CONTRAST) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixelsForOCR(img.data, contrast);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Larger, sharper copies for text recognition: `color` for vision models and `enhanced`
 * (grayscale, contrast-stretched) for Tesseract. The stored photo stays untouched.
 */
export async function prepareForOcr(src) {
  const img = await loadImage(src);
  const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
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
