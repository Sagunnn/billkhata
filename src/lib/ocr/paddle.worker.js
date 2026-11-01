// On-device OCR in a Web Worker, so reading a bill never freezes the page. PaddleOCR (PP-OCRv6
// tiny: ~6.4 MB of models) through ONNX Runtime Web; the Devanagari model (~12.7 MB) only when
// "Read Nepali bills" is on. Models are fetched once and kept in Cache Storage, so later scans
// don't download them again. Messages: { id, type: 'recognize', bitmap, nepali } → { id, result }.
import { PaddleOcrService, V5_DEVANAGARI_MOBILE_MODEL, V6_TINY_MODEL } from 'ppu-paddle-ocr/web';
import { splitByInk } from './rows.js';

const CACHE = 'billkhata-ocr-models-v1';
const services = new Map(); // 'latin' | 'nepali' → Promise<PaddleOcrService>

const progress = (id, status, value) => self.postMessage({ id, type: 'progress', status, progress: value });

/** One model file, from Cache Storage or the network (with download progress). */
async function fetchModel(url, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* private mode: no cache */ }
  const hit = await cache?.match(url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    onBytes(buf.byteLength, buf.byteLength);
    return buf;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download the text reader (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onBytes(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.byteLength; }
  try { await cache?.put(url, new Response(buf.slice(), { headers: { 'Content-Type': 'application/octet-stream' } })); } catch { /* quota */ }
  return buf.buffer;
}

function getService(nepali, id) {
  const key = nepali ? 'nepali' : 'latin';
  if (!services.has(key)) {
    const model = nepali ? V5_DEVANAGARI_MOBILE_MODEL : V6_TINY_MODEL;
    const files = ['detection', 'recognition', 'charactersDictionary'];
    const seen = Object.fromEntries(files.map((f) => [f, [0, 0]]));
    const report = () => {
      const [loaded, total] = Object.values(seen).reduce(([l, t], [a, b]) => [l + a, t + b], [0, 0]);
      if (total) progress(id, 'Downloading the text reader (first time only)', Math.min(0.95, loaded / total));
    };
    const ready = (async () => {
      const [detection, recognition, charactersDictionary] = await Promise.all(files.map((f) => fetchModel(model[f], (l, t) => { seen[f] = [l, t]; report(); })));
      progress(id, 'Starting the text reader', 0.97);
      const service = new PaddleOcrService({
        model: { detection, recognition, charactersDictionary },
        // We filter by confidence ourselves: a faint amount next to a table line scores low but is real.
        recognition: { minimumConfidence: 0.3 },
      });
      await service.initialize();
      return service;
    })();
    ready.catch(() => services.delete(key)); // a failed download can be retried
    services.set(key, ready);
  }
  return services.get(key);
}

// One read at a time: an ONNX session can't run two inferences at once ("Session already
// started"), and the warm-up started when the scanner opens may still be running.
let queue = Promise.resolve();

/**
 * Measures a box against the ink inside it. PaddleOCR pads every box (about half a line on each
 * side), so its edges aren't where the text starts and ends: `trim` is the tight box. A box can
 * also span two table columns ("20,000.00   32,000.00"); `parts` gives each word's own span, from
 * runs of inked columns (splitByInk). Ink is darker than halfway between paper and print, or
 * lighter on a dark screen.
 */
function measureInk({ data, width, height }, { text, box }) {
  const bx0 = Math.max(0, Math.floor(box.x));
  const bx1 = Math.min(width, Math.ceil(box.x + box.width));
  const by0 = Math.max(0, Math.floor(box.y));
  const by1 = Math.min(height, Math.ceil(box.y + box.height));
  const w = bx1 - bx0;
  const h = by1 - by0;
  if (w < 4 || h < 4) return {};
  const lum = new Uint8Array(w * h);
  let k = 0;
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      const i = (y * width + x) * 4;
      lum[k++] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  const sorted = Uint8Array.from(lum).sort();
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  if (hi - lo < 40) return {}; // no contrast to measure
  const mid = (lo + hi) / 2;
  const darkInk = sorted[Math.floor(sorted.length / 2)] > mid; // mostly light background
  const cols = new Uint16Array(w);
  const rows = new Uint16Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      if (darkInk ? v < mid : v > mid) { cols[x]++; rows[y]++; }
    }
  }
  // Rows: the text line's own rows (a neighbour's descender at the edge doesn't count).
  const rowMin = Math.max(1, Math.round(w * 0.004));
  let top = rows.findIndex((n) => n >= rowMin);
  let bottom = h - 1 - [...rows].reverse().findIndex((n) => n >= rowMin);
  if (top < 0) return {};
  // Columns, counted over the middle of the line only.
  const mid0 = Math.floor(top + (bottom - top) * 0.2);
  const mid1 = Math.ceil(top + (bottom - top) * 0.8);
  const profile = new Uint16Array(w);
  for (let y = mid0; y <= mid1; y++) for (let x = 0; x < w; x++) {
    const v = lum[y * w + x];
    if (darkInk ? v < mid : v > mid) profile[x]++;
  }
  for (let x = 0; x < w; x++) if (profile[x] < 2) profile[x] = 0;
  const left = profile.findIndex((n) => n > 0);
  const right = w - 1 - [...profile].reverse().findIndex((n) => n > 0);
  if (left < 0 || right <= left) return {};
  const trim = { x: bx0 + left, y: by0 + top, width: right - left + 1, height: bottom - top + 1 };
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const spans = words > 1 ? splitByInk(profile.slice(left, right + 1), words) : null;
  void cols;
  return { trim, parts: spans || undefined };
}

self.onmessage = ({ data }) => {
  if (data.type !== 'recognize') return;
  queue = queue.then(() => handle(data));
};

async function handle(data) {
  const { id } = data;
  try {
    const service = await getService(Boolean(data.nepali), id);
    progress(id, 'Reading the text', 0.98);
    const { bitmap } = data;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const out = await service.recognize(canvas, { flatten: true, strategy: data.strategy || 'per-box' });
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const items = (out.results || []).map((r) => {
      const { trim, parts } = measureInk(pixels, r);
      return { text: r.text, confidence: r.confidence, box: trim || r.box, parts };
    });
    self.postMessage({ id, type: 'result', result: { items, confidence: out.confidence, width: canvas.width, height: canvas.height } });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
}
