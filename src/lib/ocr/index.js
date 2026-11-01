// OCR entry point: on-device PaddleOCR (free, in the browser; the models download once and stay)
// or a vision API with the user's own key. Returns bill fields ready for the verification form.
import { CATEGORIES, OCR_ENGINES, PAYMENT_METHODS, REGIONS } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits } from '../nepaliDate.js';
import { parseReceiptText } from './parse.js';
import { makeItem, parseLineItemsFromText } from '../splitter.js';
import { combineReads, sumMatches } from './consensus.js';
import { rowsFromWords } from './layout.js';
import { cleanBoxes, rowsText, splitWords } from './rows.js';

/** One on-device read: clean boxes, the text as rows, and single words for layout work. */
async function readImage(image, { nepali, onProgress } = {}) {
  const { ocrWords } = await import('./local.js');
  const { words: raw, confidence } = await ocrWords(image, { nepali, onProgress });
  const boxes = cleanBoxes(raw);
  return { boxes, words: splitWords(boxes), text: rowsText(boxes), confidence };
}

/** Every word with its box, for layouts rebuilt from positions (statements, scanned pages). */
export async function recognizeWords(image, { onProgress } = {}) {
  return (await readImage(image, { onProgress })).words;
}

/** The text of a clean image (a payment screenshot), one line per row. */
export async function recognizeText(image, { onProgress } = {}) {
  return (await readImage(image, { onProgress })).text;
}

/**
 * Reads a bill. A clear one is done in one read. When the first read doesn't add up (no printed
 * total, items that don't match it), a second read of the contrast-stretched copy, and the same two
 * rebuilt from word positions (best for item rows on a curved bill), go to combineReads, which
 * votes on each field.
 */
async function runLocal(images, { nepali, onProgress }) {
  const first = await readImage(images.color, { nepali, onProgress });
  const reads = [{ text: first.text, confidence: first.confidence }];
  if (!selfConsistent(first.text) && images.enhanced && images.enhanced !== images.color) {
    onProgress?.({ status: 'Hard-to-read bill: reading it again', progress: 0.99 });
    const second = await readImage(images.enhanced, { nepali, onProgress });
    reads.push(
      { text: second.text, confidence: second.confidence },
      { text: rowsFromWords(first.words), kind: 'words', confidence: first.confidence },
      { text: rowsFromWords(second.words), kind: 'words', confidence: second.confidence },
    );
  }
  const confs = reads.map((r) => r.confidence).filter((c) => c != null);
  return {
    reads,
    texts: reads.filter((r) => r.kind !== 'words').map((r) => r.text),
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

// Below this mean confidence (0-100) an on-device read is treated as unreliable.
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
 * @param {string|{color: string, enhanced: string}} image data URL, or both OCR copies from prepareForOcr
 * @returns {Promise<{fields: object, rawText: string, engine: string, confidence: number|null}>}
 */
export async function extractBill(image, settings, { region, onProgress } = {}) {
  let fields;
  let texts = []; // the plain-text reads, for the VAT check
  let rawText = '';
  let engine = settings.ocrEngine;
  let confidence = null;
  const color = typeof image === 'string' ? image : image.color;
  const enhanced = typeof image === 'string' ? image : image.enhanced || image.color;

  if (settings.ocrEngine === OCR_ENGINES.VISION) {
    const provider = settings.visionProvider;
    const apiKey = settings.apiKeys?.[provider];
    if (!apiKey) throw new Error('Add an API key in Settings, or switch the OCR engine to On this device.');
    onProgress?.({ status: 'Reading the bill with the vision model', progress: 0.3 });
    const { extractWithVision } = await import('./vision.js');
    const raw = await extractWithVision(color, { provider, apiKey, model: settings.models?.[provider] });
    fields = normalizeExtraction(raw);
    rawText = JSON.stringify(raw, null, 2);
    engine = `${provider}:${settings.models?.[provider]}`;
  } else {
    const read = await runLocal({ color, enhanced }, { nepali: settings.nepaliScript, onProgress });
    confidence = read.confidence;
    texts = read.texts;
    rawText = read.texts.length > 1
      ? read.texts.map((t, i) => `----- read ${i + 1} of ${read.texts.length} -----\n${t.trim()}`).join('\n\n')
      : read.texts[0] || '';
    if (read.reads.length > 1) {
      const { agreement, confident, ...combined } = combineReads(read.reads);
      fields = combined;
    } else {
      fields = { ...parseReceiptText(rawText), lineItems: parseLineItemsFromText(rawText) };
    }
  }

  // The 13% VAT check, from whichever read shows subtotal + VAT = the chosen total.
  if (!fields.vatCheck && fields.totalAmount && texts.length) {
    const check = texts.map((t) => parseReceiptText(t).vatCheck).find((c) => c && Math.abs(c.total - fields.totalAmount) <= 1.5);
    if (check) fields = { ...fields, vatCheck: check, mathVerified: true, vatAmount: fields.vatAmount || check.vat };
  }
  return finishFields(fields, { rawText, engine, confidence, region });
}

/** Shared clean-up for every way of reading a bill. */
function finishFields(fields, { rawText, engine, confidence, region }) {
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

/**
 * A digital PDF bill (an e-bill or a receipt saved as PDF) has its own text layer, so no OCR is
 * needed: the same parser reads the exact text.
 */
export function extractBillFromText(text, { region } = {}) {
  const fields = { ...parseReceiptText(text), lineItems: parseLineItemsFromText(text) };
  return finishFields(fields, { rawText: text, engine: 'pdf-text', confidence: 100, region });
}
