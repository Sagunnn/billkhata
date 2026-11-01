// OCR entry point: picks Tesseract (free, in-browser) or a vision API, and returns
// bill fields ready for the verification form.
import { CATEGORIES, OCR_ENGINES, PAYMENT_METHODS, REGIONS } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits } from '../nepaliDate.js';
import { parseReceiptText } from './parse.js';
import { makeItem, parseLineItemsFromText } from '../splitter.js';
import { combineReads, sumMatches } from './consensus.js';
import { rowsFromWords } from './layout.js';

let tesseractWorker = null;
let tesseractLangs = '';
let progressSink = null; // the current caller's onProgress (the worker outlives each call)

async function getWorker(langs, onProgress) {
  progressSink = onProgress || null;
  if (!tesseractWorker || tesseractLangs !== langs) {
    await tesseractWorker?.terminate();
    const { createWorker } = await import('tesseract.js');
    tesseractWorker = await createWorker(langs, 1, {
      logger: (m) => progressSink?.({ status: m.status, progress: m.progress }),
    });
    tesseractLangs = langs;
  }
  return tesseractWorker;
}

/** Every word with its box, for layouts rebuilt from positions (scanned statement pages). */
// Low-confidence words are usually noise (grid lines, smudges), but a clean number next to a table
// line often scores low too: keep words that are plainly an amount, date or time.
const keepWord = (w) => w.confidence >= 30 || (w.confidence >= 10 && /\d/.test(w.text) && /^[\d.,:/-]+$/.test(w.text));

export async function recognizeWords(image, { psm = '6', onProgress } = {}) {
  const worker = await getWorker('eng', onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
  const words = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) if (keepWord(w)) words.push({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1 });
      }
    }
  }
  return words;
}

/** Plain text of a clean image (a payment screenshot). */
export async function recognizeText(image, { psm = '4', onProgress } = {}) {
  const worker = await getWorker('eng', onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
  const { data } = await worker.recognize(image);
  return data.text || '';
}

async function runTesseract(images, { nepali, onProgress }) {
  const langs = nepali ? 'eng+nep' : 'eng';
  await getWorker(langs, onProgress);
  // Receipts are one block of rows. Mode 6 ("single uniform block") keeps "item … qty … amount"
  // on one line; the default auto mode often splits a bill into columns, losing every item row.
  const read = async (image, psm) => {
    await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
    const { data } = await tesseractWorker.recognize(image);
    return { text: data.text || '', confidence: Number.isFinite(data.confidence) ? data.confidence : null };
  };
  // Mode 11 (sparse text) finds every word with its position, line or no line. rowsFromWords then
  // pairs each item name with its numbers by order, which survives a curved, crumpled bill.
  const readWords = async (image) => {
    await tesseractWorker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data } = await tesseractWorker.recognize(image, {}, { blocks: true, text: true });
    const words = [];
    for (const block of data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const w of line.words || []) words.push({ text: w.text, confidence: w.confidence, ...w.bbox });
        }
      }
    }
    return { text: rowsFromWords(words), kind: 'words', confidence: Number.isFinite(data.confidence) ? data.confidence : null };
  };
  // A clean bill is done in one read. A crumpled or curved one reads differently every time, so it
  // gets up to five reads (two images, line and word modes) and combineReads votes on the answer.
  const passes = [
    () => read(images.enhanced, '6'),
    () => readWords(images.enhanced),
    images.threshold && (() => readWords(images.threshold)),
    images.threshold && (() => read(images.threshold, '6')),
    () => read(images.enhanced, '4'),
  ].filter(Boolean);
  const reads = [];
  for (const pass of passes) {
    if (reads.length) onProgress?.({ status: `Hard-to-read bill: reading it again (${reads.length + 1} of ${passes.length})`, progress: reads.length / passes.length });
    reads.push(await pass());
    if (reads.length === 1 && selfConsistent(reads[0].text)) break;
    if (reads.length >= 3 && combineReads(reads).confident) break;
  }
  const confs = reads.map((r) => r.confidence).filter((c) => c != null);
  return {
    reads,
    texts: reads.map((r) => r.text),
    confidence: confs.length ? Math.max(...confs) : null,
  };
}

/** A read that needs no second opinion: a printed total, and items that add up to it. */
function selfConsistent(text) {
  const f = parseReceiptText(text);
  return Boolean(f.totalAmount) && !f.totalGuessed && itemsMatchTotal(parseLineItemsFromText(text), f.totalAmount);
}

/**
 * Items whose sum matches the bill total, directly or with 10% service charge and/or 13% VAT on
 * top: the read got every row.
 */
export function itemsMatchTotal(items = [], total) {
  return items.length > 0 && sumMatches(items.reduce((s, it) => s + (Number(it.amount) || 0), 0), total);
}

// Below this mean word confidence (0-100) a Tesseract read is treated as unreliable.
export const LOW_CONFIDENCE = 60;

/** True when a local read missed the fields that matter, its items don't add up, or it was unsure. */
export function needsBetterRead({ fields = {}, confidence = null, totalGuessed = false } = {}) {
  // An estimate has no PAN to find, so its absence isn't a misread.
  const missingPan = !fields.isEstimate && !/^\d{9}$/.test(String(fields.sellerPan || ''));
  const missingTotal = !(Number(fields.totalAmount) > 0) || totalGuessed;
  // Items that don't add up to the total mean a row was misread or lost.
  const itemsOff = (fields.lineItems || []).length > 0 && !itemsMatchTotal(fields.lineItems, fields.totalAmount);
  return missingPan || missingTotal || itemsOff || (confidence != null && confidence < LOW_CONFIDENCE);
}

/** The vision provider to use for a re-scan: the chosen one if it has a key, else any with a key. */
export function visionProviderWithKey(settings) {
  const keys = settings?.apiKeys || {};
  if (keys[settings?.visionProvider]) return settings.visionProvider;
  return Object.keys(keys).find((k) => keys[k]) || '';
}

/** Normalises whatever a vision model returned into clean form values. */
export function normalizeExtraction(raw = {}) {
  const num = (v) => {
    const n = Number(toAsciiDigits(String(v ?? '')).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const date = (v) => toAsciiDigits(String(v ?? '')).trim().replace(/\//g, '-');
  let ad = date(raw.billDateAD);
  let bs = date(raw.billDateBS);
  if (!isValidAD(ad)) ad = '';
  if (!isValidBS(bs)) bs = '';
  if (ad && !bs) bs = adToBs(ad) || '';
  if (bs && !ad) ad = bsToAd(bs) || '';
  const pan = toAsciiDigits(String(raw.sellerPan ?? '')).replace(/\D/g, '');
  return {
    merchantName: String(raw.merchantName ?? '').trim().slice(0, 120),
    sellerPan: pan.length === 9 ? pan : '',
    invoiceNumber: toAsciiDigits(String(raw.invoiceNumber ?? '')).trim().slice(0, 40),
    billDateAD: ad,
    billDateBS: bs,
    totalAmount: num(raw.totalAmount),
    vatAmount: num(raw.vatAmount),
    paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : undefined,
    category: CATEGORIES.includes(raw.category) ? raw.category : undefined,
    looksNepali: Boolean(raw.isNepalBill) || pan.length === 9,
    isEstimate: Boolean(raw.isEstimate) || undefined,
    lineItems: Array.isArray(raw.lineItems)
      ? raw.lineItems
        .map((it) => ({ ...it, name: String(it?.name ?? '').trim(), amount: num(it?.amount) ?? (num(it?.qty) || 1) * (num(it?.price) || 0) }))
        .filter((it) => it.name && it.amount > 0)
        .map((it) => makeItem({ name: it.name, qty: num(it.qty) || 1, price: num(it.price) || undefined, amount: it.amount }))
      : [],
  };
}

/**
 * @param {string|{color: string, enhanced: string, threshold?: string}} image data URL, or both OCR copies from prepareForOcr
 * @returns {Promise<{fields: object, rawText: string, engine: string, confidence: number|null}>}
 */
export async function extractBill(image, settings, { region, onProgress } = {}) {
  let fields;
  let rawText = '';
  let engine = settings.ocrEngine;
  let confidence = null;
  const color = typeof image === 'string' ? image : image.color;
  const enhanced = typeof image === 'string' ? image : image.enhanced || image.color;
  const threshold = typeof image === 'string' ? '' : image.threshold || '';

  if (settings.ocrEngine === OCR_ENGINES.VISION) {
    const provider = settings.visionProvider;
    const apiKey = settings.apiKeys?.[provider];
    if (!apiKey) throw new Error('Add an API key in Settings, or switch the OCR engine to Tesseract.');
    onProgress?.({ status: 'Reading the bill with the vision model', progress: 0.3 });
    const { extractWithVision } = await import('./vision.js');
    const raw = await extractWithVision(color, { provider, apiKey, model: settings.models?.[provider] });
    fields = normalizeExtraction(raw);
    rawText = JSON.stringify(raw, null, 2);
    engine = `${provider}:${settings.models?.[provider]}`;
  } else {
    const read = await runTesseract({ enhanced, threshold }, { nepali: settings.tesseractNepali, onProgress });
    confidence = read.confidence;
    rawText = read.texts.length > 1
      ? read.texts.map((t, i) => `----- read ${i + 1} of ${read.texts.length} -----\n${t.trim()}`).join('\n\n')
      : read.texts[0] || '';
    if (read.texts.length > 1) {
      const { agreement, confident, ...combined } = combineReads(read.reads);
      fields = combined;
    } else {
      fields = { ...parseReceiptText(rawText), lineItems: parseLineItemsFromText(rawText) };
    }
  }

  // An item bigger than the whole bill is a misread number.
  if (fields.lineItems?.length && fields.totalAmount > 0) {
    fields.lineItems = fields.lineItems.filter((it) => it.amount <= fields.totalAmount + 0.5);
  }

  const { looksNepali, totalGuessed, ...rest } = fields;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)));
  return {
    fields: { ...clean, isNepalBill: region === REGIONS.NEPAL || looksNepali },
    rawText,
    engine,
    confidence,
    // No total was printed or read; the one shown is the items' sum (or a guess).
    totalGuessed: Boolean(totalGuessed && clean.totalAmount),
  };
}
