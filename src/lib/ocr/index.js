// OCR entry point: picks Tesseract (free, in-browser) or a vision API, and returns
// bill fields ready for the verification form.
import { CATEGORIES, OCR_ENGINES, PAYMENT_METHODS, REGIONS } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits } from '../nepaliDate.js';
import { parseReceiptText } from './parse.js';
import { makeItem, parseLineItemsFromText } from '../splitter.js';

let tesseractWorker = null;
let tesseractLangs = '';

async function runTesseract(images, { nepali, onProgress }) {
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
  const read = async (image, psm) => {
    await tesseractWorker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
    const { data } = await tesseractWorker.recognize(image);
    return { text: data.text || '', confidence: Number.isFinite(data.confidence) ? data.confidence : null };
  };
  // The first read is usually enough. When its items don't add up to the total (a crumpled bill,
  // a row lost to a crease), up to three more reads are tried (column-aware modes, then the black
  // and white copy) and the most complete one wins. The others still fill in fields it missed.
  const passes = [[images.enhanced, '6'], [images.enhanced, '4'], [images.threshold, '6'], [images.enhanced, '3']]
    .filter(([img]) => img);
  const reads = [];
  for (const [img, psm] of passes) {
    if (reads.length) onProgress?.({ status: `Bill is hard to read: trying again (${reads.length + 1} of ${passes.length})`, progress: 0 });
    const r = await read(img, psm);
    Object.assign(r, readScore(r.text));
    reads.push(r);
    if (r.complete) break;
  }
  const best = reads.reduce((a, r) => (r.score > a.score ? r : a));
  return { ...best, others: reads.filter((r) => r !== best).map((r) => r.text) };
}

/**
 * Items whose sum matches the bill total, directly or with 10% service charge and/or 13% VAT on
 * top: the read got every row.
 */
export function itemsMatchTotal(items = [], total) {
  const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const t = Number(total);
  if (!items.length || !(t > 0) || !(sum > 0)) return false;
  return [1, 1.1, 1.13, 1.1 * 1.13].some((f) => Math.abs(sum * f - t) <= Math.max(0.6, t * 0.005));
}

/** How much a read found: item rows, the total, PAN, bill number, date; most of all, items that add up. */
function readScore(text) {
  const f = parseReceiptText(text);
  const items = parseLineItemsFromText(text);
  const complete = itemsMatchTotal(items, f.totalAmount);
  const score = (complete ? 50 : 0) + items.length * 3 + (f.totalAmount ? 2 : 0) + (f.sellerPan ? 2 : 0)
    + (f.invoiceNumber ? 1 : 0) + (f.billDateAD ? 1 : 0);
  return { score, complete };
}

// Below this mean word confidence (0-100) a Tesseract read is treated as unreliable.
export const LOW_CONFIDENCE = 60;

/** True when a local read missed the fields that matter, its items don't add up, or it was unsure. */
export function needsBetterRead({ fields = {}, confidence = null } = {}) {
  // An estimate has no PAN to find, so its absence isn't a misread.
  const missingPan = !fields.isEstimate && !/^\d{9}$/.test(String(fields.sellerPan || ''));
  const missingTotal = !(Number(fields.totalAmount) > 0);
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
 * Fields from the best read, with anything it missed (PAN, bill number, dates, total) taken from
 * the other reads. Items come from one read only, so rows aren't counted twice.
 */
export function mergeReads(bestText, otherTexts = []) {
  const fields = { ...parseReceiptText(bestText), lineItems: parseLineItemsFromText(bestText) };
  for (const text of otherTexts) {
    const other = parseReceiptText(text);
    for (const key of ['sellerPan', 'invoiceNumber', 'billDateAD', 'billDateBS', 'vatAmount', 'paymentMethod', 'merchantName']) {
      if (!fields[key] && other[key]) fields[key] = other[key];
    }
    if (!fields.totalAmount && other.totalAmount) fields.totalAmount = other.totalAmount;
    fields.isEstimate ||= other.isEstimate;
    if (!fields.lineItems.length) {
      const items = parseLineItemsFromText(text);
      if (items.length) fields.lineItems = items;
    }
  }
  if (fields.billDateAD && !fields.billDateBS) fields.billDateBS = adToBs(fields.billDateAD) || '';
  if (fields.billDateBS && !fields.billDateAD) fields.billDateAD = bsToAd(fields.billDateBS) || '';
  return fields;
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
    ({ text: rawText, confidence } = read);
    fields = mergeReads(rawText, read.others);
  }

  // An item bigger than the whole bill is a misread number.
  if (fields.lineItems?.length && fields.totalAmount > 0) {
    fields.lineItems = fields.lineItems.filter((it) => it.amount <= fields.totalAmount + 0.5);
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
