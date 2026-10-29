// OCR entry point: picks Tesseract (free, in-browser) or a vision API, and returns
// bill fields ready for the verification form.
import { CATEGORIES, OCR_ENGINES, PAYMENT_METHODS, REGIONS } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits } from '../nepaliDate.js';
import { parseReceiptText } from './parse.js';

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
  const { data } = await tesseractWorker.recognize(image);
  return data.text || '';
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
    invoiceNumber: String(raw.invoiceNumber ?? '').trim().slice(0, 40),
    billDateAD: ad,
    billDateBS: bs,
    totalAmount: num(raw.totalAmount),
    vatAmount: num(raw.vatAmount),
    paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : undefined,
    category: CATEGORIES.includes(raw.category) ? raw.category : undefined,
    looksNepali: Boolean(raw.isNepalBill) || pan.length === 9,
  };
}

/**
 * @param {string} image data URL
 * @returns {Promise<{fields: object, rawText: string, engine: string}>}
 */
export async function extractBill(image, settings, { region, onProgress } = {}) {
  let fields;
  let rawText = '';
  let engine = settings.ocrEngine;

  if (settings.ocrEngine === OCR_ENGINES.VISION) {
    const provider = settings.visionProvider;
    const apiKey = settings.apiKeys?.[provider];
    if (!apiKey) throw new Error('Add an API key in Settings, or switch the OCR engine to Tesseract.');
    onProgress?.({ status: 'Reading the bill with the vision model', progress: 0.3 });
    const { extractWithVision } = await import('./vision.js');
    const raw = await extractWithVision(image, { provider, apiKey, model: settings.models?.[provider] });
    fields = normalizeExtraction(raw);
    rawText = JSON.stringify(raw, null, 2);
    engine = `${provider}:${settings.models?.[provider]}`;
  } else {
    rawText = await runTesseract(image, { nepali: settings.tesseractNepali, onProgress });
    fields = parseReceiptText(rawText);
  }

  const { looksNepali, ...rest } = fields;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return {
    fields: { ...clean, isNepalBill: region === REGIONS.NEPAL || looksNepali },
    rawText,
    engine,
  };
}
