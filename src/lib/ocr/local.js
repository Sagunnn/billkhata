// Main-thread side of on-device OCR: starts the worker on first use (nothing loads with the page),
// sends it a picture, and returns positioned words in the shape the parsers use:
// [{ text, confidence (0-100), x0, y0, x1, y1 }].

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./paddle.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    // Download progress goes to every waiting read: a scan started while the background warm-up
    // is downloading the models waits on that same download.
    if (data.type === 'progress') {
      const everyone = /Downloading|Starting/.test(data.status || '');
      for (const [id, job] of pending) if (everyone || id === data.id) job.onProgress?.({ status: data.status, progress: data.progress });
      return;
    }
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.type === 'error') job.reject(new Error(data.message));
    else job.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'The text reader stopped.'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function toBitmap(image) {
  if (typeof image === 'string') return createImageBitmap(await (await fetch(image)).blob());
  return createImageBitmap(image); // canvas, Blob, ImageBitmap
}

/**
 * @param image data URL, canvas or Blob
 * @param {{ nepali?: boolean, onProgress?: Function, strategy?: 'per-box'|'per-line' }} opts
 * @returns {Promise<{ words: Array, confidence: number, width: number, height: number }>}
 */
export async function ocrWords(image, { nepali = false, onProgress, strategy } = {}) {
  const bitmap = await toBitmap(image);
  const w = getWorker();
  const id = ++seq;
  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, type: 'recognize', bitmap, nepali, strategy }, [bitmap]);
  });
  const words = result.items
    .filter((r) => r.text && r.text.trim() && r.box.width > 0 && r.box.height > 0)
    .map((r) => ({
      text: r.text.trim().replace(/\s+/g, ' '),
      confidence: Math.round(r.confidence * 100),
      x0: r.box.x, y0: r.box.y, x1: r.box.x + r.box.width, y1: r.box.y + r.box.height,
      parts: r.parts, // word positions within the box, measured from the ink
    }));
  return { words, confidence: Math.round((result.confidence || 0) * 100), width: result.width, height: result.height };
}

/** Starts downloading the models in the background (when the scanner opens), without reading anything. */
export async function warmUp({ nepali = false } = {}) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.getContext('2d').fillRect(0, 0, 1, 1);
    return await ocrWords(canvas, { nepali });
  } catch {
    return null; // offline, or the download failed: the real scan will try again and say so
  }
}
