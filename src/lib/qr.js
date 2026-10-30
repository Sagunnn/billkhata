// Payment QR: render (qrcode), read an uploaded QR photo (jsQR), and keep it small.
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { MAX_QR_IMAGE_BYTES } from './profile.js';
import { dataUrlBytes } from './image.js';
import { esewaQrText } from './splitter.js';

export const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });
export const qrDataUrl = (text, width = 480) => QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } });

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

/** Tries to read a QR code from an image at a few sizes. Returns its text, or ''. */
export async function decodeQrFromImage(src) {
  const img = typeof src === 'string' ? await loadImage(src) : src;
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  for (const maxSide of [1000, 700, 1400, 500]) {
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale));
    c.height = Math.max(1, Math.round(h0 * scale));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const hit = jsQR(data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
    if (hit?.data) return hit.data;
  }
  return '';
}

/** PNG if it fits (QR codes compress well), else ever-smaller JPEGs, always under 100 KB. */
export function compressQrCanvas(canvas, maxBytes = MAX_QR_IMAGE_BYTES) {
  let out = canvas.toDataURL('image/png');
  if (dataUrlBytes(out) <= maxBytes) return out;
  let side = canvas.width;
  let quality = 0.9;
  while (side >= 160) {
    const c = document.createElement('canvas');
    c.width = side;
    c.height = Math.round((canvas.height * side) / canvas.width);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(canvas, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(out) <= maxBytes) return out;
    if (quality > 0.6) quality -= 0.1;
    else side = Math.round(side * 0.8);
  }
  return out;
}

/**
 * What a split should show for "pay me": QR text to render (carried in share links),
 * an uploaded image (summary picture only), and a short label.
 */
export function paymentQrInfo(config, profile) {
  if (config?.mode === 'esewa') {
    const id = String(config.esewaId || profile?.phone || '').trim();
    const name = String(config.name || profile?.fullName || '').trim();
    if (!id) return null;
    return { text: esewaQrText(id, name), image: '', label: `eSewa ${id}`, payerName: name };
  }
  if (config?.mode === 'image' && (config.image || config.text)) {
    return { text: config.text || '', image: config.image || '', label: config.label || 'Scan to pay', payerName: profile?.fullName || '' };
  }
  return null;
}
