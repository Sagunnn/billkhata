// Turns raw OCR text from a Nepali (or any) bill into the editable bill fields.
// Every field is a best guess; the user confirms everything in the form.
import { CATEGORIES, PAYMENT } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits, ymd } from '../nepaliDate.js';

const PAN_KEYWORDS = /(pan|vat|p\.a\.n|प्यान|पान|स्थायी\s*लेखा\s*(नम्बर|नं)|स्था\.?\s*ले\.?\s*नं|भ्याट)/i;
const INVOICE_RE = /(?:bill|invoice|inv|receipt|ref|बिल|बीजक|बिजक|रसिद)\.?\s*(?:no\.?|number|num|#|नं\.?|नम्बर)\s*[:.\-#]?\s*([A-Za-z0-9][A-Za-z0-9/._-]{0,39})/i;
// A line that is just "No. 1234" (the value must contain a digit, so "No. of items" is skipped).
const INVOICE_FALLBACK_RE = /(?:^|\n)\s*(?:no|नं)\.?\s*[:.#-]?\s*([A-Za-z/._-]{0,10}\d[A-Za-z0-9/._-]{0,29})/i;
// Fonepay, wallets, QR and cards are entered in the IRD draw by the payment provider.
// Plain "QR", "card" or "POS" also show up on cash bills, so they need payment wording around them.
const DIGITAL_PAY_RE = /(fone\s*pay|e-?sewa|khalti|ime\s*pay|connect\s*ips|mobile\s*banking|(?:paid|payment|pay)\s*(?:by|via|mode|method)?\s*[:-]?\s*(?:qr|card)|qr\s*pay|(?:credit|debit)\s*card|visa|master\s*card|union\s*pay)/i;
const TOTAL_RE = /(grand\s*total|net\s*(?:total|amount|payable)|total\s*(?:amount|payable)?|amount\s*payable|जम्मा|कुल|रकम)/i;
const NOT_TOTAL_RE = /(sub\s*-?\s*total|total\s*qty|items?|discount|taxable|before\s*vat|tender|change|cash\s*received|paid)/i;
const VAT_LINE_RE = /(vat|भ्याट|मू\.?\s*अ\.?\s*कर|मूल्य\s*अभिवृद्धि)/i;

const MONEY_RE = /(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

function amountsIn(line) {
  return [...line.matchAll(MONEY_RE)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

function findPan(lines) {
  // 1) a 9-digit number on (or right after) a PAN/VAT line
  for (let i = 0; i < lines.length; i++) {
    if (!PAN_KEYWORDS.test(lines[i])) continue;
    const scope = `${lines[i]} ${lines[i + 1] || ''}`.replace(/(\d)[\s-](?=\d)/g, '$1');
    const m = scope.match(/(?<!\d)(\d{9})(?!\d)/);
    if (m) return m[1];
  }
  // 2) any standalone 9-digit number that does not look like a phone number
  for (const line of lines) {
    const m = line.match(/(?<!\d)(\d{9})(?!\d)/);
    if (m && !/^(97|98)/.test(m[1])) return m[1];
  }
  return '';
}

function findDates(text) {
  const out = { ad: '', bs: '' };
  const re = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)|(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/g;
  for (const m of text.matchAll(re)) {
    const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const s = ymd(Number(y), Number(mo), Number(d));
    // BS years run ~57 years ahead of AD; anything >= 2060 is treated as BS.
    if (Number(y) >= 2060 && isValidBS(s)) out.bs ||= s;
    else if (isValidAD(s)) out.ad ||= s;
  }
  if (out.bs && !out.ad) out.ad = bsToAd(out.bs) || '';
  if (out.ad && !out.bs) out.bs = adToBs(out.ad) || '';
  return out;
}

function findTotal(lines) {
  let best = null;
  lines.forEach((line, i) => {
    if (!TOTAL_RE.test(line) || NOT_TOTAL_RE.test(line) || VAT_LINE_RE.test(line) && !/total/i.test(line)) return;
    // Amount usually sits on the same line; some printers put it on the next one.
    let nums = amountsIn(line);
    if (!nums.length) nums = amountsIn(lines[i + 1] || '').slice(0, 1);
    const n = nums.length ? Math.max(...nums) : null;
    // Prefer "grand/net" lines and later lines (totals usually come last).
    const weight = (/grand|net|payable|जम्मा/i.test(line) ? 2 : 1) * 1000 + i;
    if (n && (!best || weight > best.weight)) best = { n, weight };
  });
  if (best) return best.n;
  const all = lines.flatMap(amountsIn).filter((n) => n < 10_000_000);
  return all.length ? Math.max(...all) : null;
}

function findVat(lines) {
  for (const line of lines) {
    if (!VAT_LINE_RE.test(line) || PAN_KEYWORDS.test(line) && /\d{9}/.test(line)) continue;
    const nums = amountsIn(line).filter((n) => n !== 13);
    if (nums.length) return nums[nums.length - 1];
  }
  return null;
}

function findMerchant(lines) {
  for (const line of lines.slice(0, 6)) {
    const clean = line.replace(/[^\p{L}\p{N}&.'\s-]/gu, '').trim();
    if (clean.length < 3 || /\d{5,}/.test(clean)) continue;
    if (/(tax\s*invoice|invoice|estimate|bill|receipt|pan|vat|tel|phone|date)/i.test(clean) && clean.split(/\s+/).length < 3) continue;
    return clean.slice(0, 80);
  }
  return '';
}

const CATEGORY_HINTS = [
  ['Food & Dining', /(restaurant|cafe|café|momo|khaja|bakery|kitchen|dining|food|tea|coffee|resto|hotel|भोजन|खाजा)/i],
  ['Groceries', /(mart|kirana|grocery|grocer|supermarket|store|pasal|traders|किराना|पसल)/i],
  ['Utilities & Telecom', /(electric|nea|telecom|ncell|ntc|internet|wifi|water|khanepani|recharge|topup)/i],
  ['Transport', /(taxi|bus|ride|fuel|petrol|diesel|airline|ticket|yatayat|पेट्रोल)/i],
  ['Retail/Shopping', /(fashion|clothing|boutique|electronics|mobile|shoes|mall|cosmetic|book)/i],
];

export function guessCategory(text) {
  for (const [cat, re] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return CATEGORIES.at(-1);
}

/** @returns partial bill fields extracted from OCR text */
export function parseReceiptText(raw) {
  const text = toAsciiDigits(raw || '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dates = findDates(text);
  const sellerPan = findPan(lines);
  const totalAmount = findTotal(lines);
  const vatAmount = findVat(lines);
  const looksNepali = Boolean(sellerPan) || /(npr|rs\.?|रु|नेपाल|nepal|kathmandu|lalitpur|pokhara|vat)/i.test(text);
  return {
    merchantName: findMerchant(lines),
    sellerPan,
    invoiceNumber: text.match(INVOICE_RE)?.[1] || text.match(INVOICE_FALLBACK_RE)?.[1] || '',
    paymentMethod: DIGITAL_PAY_RE.test(text) ? PAYMENT.DIGITAL : undefined,
    billDateAD: dates.ad,
    billDateBS: dates.bs,
    totalAmount,
    vatAmount: vatAmount && totalAmount && vatAmount < totalAmount ? vatAmount : null,
    category: guessCategory(text),
    looksNepali,
  };
}
