// Words and their positions from a PDF, page by page, for parseStatementPages.
// A text PDF (what banks email) is read directly. A scanned page has no text layer, so it is
// drawn to a canvas and read with OCR (`ocrPage`, browser only). Works in Node too, given the
// legacy pdf.js build, which is how the tests use it.

/** Thrown when the PDF needs a password (`needsPassword`) or the one given was wrong (`wrongPassword`). */
export class PdfPasswordError extends Error {
  constructor(wrong) {
    super(wrong ? 'That password did not open the PDF.' : 'This PDF is locked with a password.');
    this.needsPassword = true;
    this.wrongPassword = Boolean(wrong);
  }
}

/**
 * @param pdfjs the pdf.js module
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{ password?: string, ocrPage?: (page, viewport) => Promise<token[]>, onProgress?: Function }} opts
 * @returns {Promise<{ pages: token[][], scannedPages: number }>}
 */
export async function readPdfTokens(pdfjs, data, { password, ocrPage, onProgress } = {}) {
  const task = pdfjs.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    password: password || undefined,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 2);
    throw new Error(`Could not open the PDF (${err?.message || 'unknown error'}).`);
  }
  const pages = [];
  let scannedPages = 0;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.({ status: `Reading page ${n} of ${doc.numPages}`, progress: (n - 1) / doc.numPages });
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const tokens = [];
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const [, , c, d, e, f] = item.transform;
        const [x, y] = viewport.convertToViewportPoint(e, f);
        const h = item.height || Math.hypot(c, d) || 8;
        tokens.push({ text: item.str, x0: x, x1: x + (item.width || item.str.length * h * 0.5), y0: y - h, y1: y });
      }
      if (tokens.length < 5 && ocrPage) {
        scannedPages++;
        onProgress?.({ status: `Page ${n} is a scan: reading it with OCR (slow)`, progress: (n - 1) / doc.numPages });
        pages.push(await ocrPage(page));
      } else pages.push(tokens);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { pages, scannedPages };
}
