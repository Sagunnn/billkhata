// A bill that arrives as a PDF (an e-bill, a receipt saved from an app or email). Page 1 becomes
// the bill's photo, and the page's own text (when it has a text layer) is read directly instead
// of with OCR. Browser only.
import { loadPdfjs } from './bank/importers.js';

const isPdf = (file) => file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
export { isPdf };

/** The text layer as lines, top to bottom, words left to right. */
function textLines(items, viewport) {
  const words = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { text: it.str, x, y, h: it.height || 8, w: it.width || 0 };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs(l.y - w.y) < Math.max(2, w.h * 0.5));
    if (line) line.words.push(w);
    else lines.push({ y: w.y, words: [w] });
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map((l) => {
      const ws = l.words.sort((a, b) => a.x - b.x);
      // A wide gap becomes several spaces, as on a printed receipt ("Total      1,356.00").
      return ws.reduce((s, w, i) => {
        if (!i) return w.text;
        const gap = w.x - (ws[i - 1].x + ws[i - 1].w);
        return s + (gap > w.h * 1.5 ? '   ' : gap > w.h * 0.15 ? ' ' : '') + w.text;
      }, '');
    })
    .join('\n');
}

/**
 * @returns {Promise<{ image: string, text: string, pages: number }>} page 1 as a JPEG data URL
 *   (about 1400 px wide) and its text ('' for a scanned PDF).
 */
export async function readBillPdf(file) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('This PDF is locked with a password. Open it, save a copy without the password, and add that.');
    throw new Error(`Could not open the PDF (${err?.message || 'unknown error'}).`);
  }
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, Math.max(1.5, 1400 / base.width)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const text = textLines((await page.getTextContent()).items, base);
    return { image: canvas.toDataURL('image/jpeg', 0.92), text: /\d/.test(text) && text.replace(/\s/g, '').length >= 20 ? text : '', pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
