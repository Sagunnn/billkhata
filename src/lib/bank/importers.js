// Browser side of the bank features: opening statement files and reading payment screenshots.
// Everything runs on this device; nothing is uploaded.
import { compressImage, fileToDataUrl, imageHash, prepareScreenshot } from '../image.js';
import { readPdfTokens } from './pdfText.js';
import { parseStatementCsv, parseStatementPages } from './statement.js';
import { parsePaymentText } from './payment.js';

export { PdfPasswordError } from './pdfText.js';

// The legacy build carries fallbacks for JavaScript features older phones lack (the modern
// build needs Uint8Array.toHex, which Chrome only gained in 2025).
let pdfjsPromise;
export async function loadPdfjs() {
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.min.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

/** A scanned page: drawn at 2× and read word by word. */
async function ocrPage(page, onProgress) {
  const viewport = page.getViewport({ scale: 2.2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const { recognizeWords } = await import('../ocr/index.js');
  return recognizeWords(canvas, { psm: '6', onProgress });
}

const SHEET_RE = /\.(xlsx|xlsm|xls|ods)$/i;
const SHEET_TYPES = /spreadsheet|ms-excel|officedocument\.spreadsheetml/i;

/**
 * @returns parsed statement ({ bank, account, from, to, rows, checks, warnings, … }) plus fileName and scannedPages.
 * Throws PdfPasswordError when the PDF is locked.
 */
export async function readStatementFile(file, { password, onProgress } = {}) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That file is over 30 MB.');
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (isCsv) return { ...parseStatementCsv(await file.text()), fileName: file.name, scannedPages: 0 };
  if (SHEET_RE.test(file.name) || SHEET_TYPES.test(file.type)) {
    const [XLSX, { parseStatementSheet }] = await Promise.all([import('xlsx'), import('./sheet.js')]);
    onProgress?.({ status: 'Reading the spreadsheet', progress: 0.5 });
    return { ...parseStatementSheet(XLSX, new Uint8Array(await file.arrayBuffer())), fileName: file.name, scannedPages: 0 };
  }
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    // A screenshot of the statement: read word by word, like a scanned PDF page.
    onProgress?.({ status: 'Reading the picture with OCR', progress: 0.05 });
    const img = await prepareScreenshot(await fileToDataUrl(file));
    const { recognizeWords } = await import('../ocr/index.js');
    const st = parseStatementPages([await recognizeWords(img, { psm: '6', onProgress })]);
    st.warnings.unshift('Read from a picture with OCR, which can misread numbers, and cut-off text stays cut off. The statement file itself (Excel or PDF) reads exactly.');
    return { ...st, fileName: file.name, scannedPages: 1 };
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose the statement as a PDF, Excel (.xlsx / .xls), CSV or a screenshot.');
  const pdfjs = await loadPdfjs();
  const { pages, scannedPages } = await readPdfTokens(pdfjs, await file.arrayBuffer(), {
    password,
    onProgress,
    ocrPage: (page) => ocrPage(page, onProgress),
  });
  const st = parseStatementPages(pages);
  if (scannedPages) st.warnings.unshift(`${scannedPages} page${scannedPages === 1 ? ' was a scan' : 's were scans'} and read with OCR, which can misread numbers. Rows that don't add up are marked.`);
  return { ...st, fileName: file.name, scannedPages };
}

/** A payment screenshot: the stored copy, and what OCR found on it. */
export async function readPaymentScreenshot(file, { onProgress } = {}) {
  const src = await fileToDataUrl(file);
  const [stored, ocrImage] = await Promise.all([compressImage(src), prepareScreenshot(src)]);
  const { recognizeText } = await import('../ocr/index.js');
  const rawText = await recognizeText(ocrImage, { psm: '4', onProgress });
  return { image: stored.dataUrl, imageHash: await imageHash(stored.dataUrl).catch(() => ''), rawText, fields: parsePaymentText(rawText) };
}
