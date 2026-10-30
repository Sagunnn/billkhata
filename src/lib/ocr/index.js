// OCR entry point: picks Tesseract (free, in-browser) or a vision API, and returns
// bill fields ready for the verification form.
import { CATEGORIES, OCR_ENGINES, PAYMENT_METHODS, REGIONS } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits } from '../nepaliDate.js';
import { parseReceiptText } from './parse.js';
import { makeItem, parseLineItemsFromText } from '../splitter.js';

let tesseractWorker = null;
let tesseractLangs = '';

async function runTesseract(image, { nepali, onProgress }) {
  const langs = nepali ? 'eng+nep' : 'eng';
  if (!tesseractWorker || tesseractLangs !== langs) {
    await tesseractWorker?.terminate();
    const { createWorker } = await import('tesseract.js');
    tesseractWorker = await createWorker(langs, 1, {
      logger: (m) => onProgress?.({ status: m.status, progress: m.progress }),
    });
    tesseractLangs = langs;
  }
  // Receipts are one block of rows. Mode 6 ("single uniform block") keeps "item … qty … amount"
  // on one line; the default auto mode often splits a bill into columns, losing every item row.
  // If mode 6 finds no items, modes 4 and 3 are tried too and the best read wins.
  const read = async (psm) => {
    await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
    const { data } = await tesseractWorker.recognize(image);
    return { text: data.text || '', confidence: Number.isFinite(data.confidence) ? data.confidence : null };
  };
  // Keep the first read that finds items; otherwise try the column-aware modes and keep the best.
  const first = await read('6');
  if (parseLineItemsFromText(first.text).length) return first;
  const reads = [first, await read('4'), await read('3')];
  const rank = (r) => parseLineItemsFromText(r.text).length * 10 + readScore(r.text);
  return reads.reduce((best, r) => (rank(r) > rank(best) ? r : best));
}

/** How much a read found: item rows, plus the total, PAN and bill number. */
function readScore(text) {
  const f = parseReceiptText(text);
  return parseLineItemsFromText(text).length + (f.totalAmount ? 2 : 0) + (f.sellerPan ? 1 : 0) + (f.invoiceNumber ? 1 : 0);
}

// Below this mean word confidence (0-100) a Tesseract read is treated as unreliable.
export const LOW_CONFIDENCE = 60;

/** True when a local read missed the fields that matter or was unsure of itself. */
export function needsBetterRead({ fields = {}, confidence = null } = {}) {
  const missingPan = !/^\d{9}$/.test(String(fields.sellerPan || ''));
  const missingTotal = !(Number(fields.totalAmount) > 0);
  return missingPan || missingTotal || (confidence != null && confidence < LOW_CONFIDENCE);
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
    lineItems: Array.isArray(raw.lineItems)
      ? raw.lineItems
        .map((it) => ({ ...it, name: String(it?.name ?? '').trim(), amount: num(it?.amount) ?? (num(it?.qty) || 1) * (num(it?.price) || 0) }))
        .filter((it) => it.name && it.amount > 0)
        .map((it) => makeItem({ name: it.name, qty: num(it.qty) || 1, price: num(it.price) || undefined, amount: it.amount }))
      : [],
  };
}

/**
 * @param {string|{color: string, enhanced: string}} image data URL, or both OCR copies from prepareForOcr
 * @returns {Promise<{fields: object, rawText: string, engine: string, confidence: number|null}>}
 */
export async function extractBill(image, settings, { region, onProgress } = {}) {
  let fields;
  let rawText = '';
  let engine = settings.ocrEngine;
  let confidence = null;
  const color = typeof image === 'string' ? image : image.color;
  const enhanced = typeof image === 'string' ? image : image.enhanced || image.color;

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
    ({ text: rawText, confidence } = await runTesseract(enhanced, { nepali: settings.tesseractNepali, onProgress }));
    fields = { ...parseReceiptText(rawText), lineItems: parseLineItemsFromText(rawText) };
  }

  const { looksNepali, ...rest } = fields;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)));
  return {
    fields: { ...clean, isNepalBill: region === REGIONS.NEPAL || looksNepali },
    rawText,
    engine,
    confidence,
  };
}
