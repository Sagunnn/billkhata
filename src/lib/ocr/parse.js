// Turns raw OCR text from a Nepali (or any) bill into the editable bill fields.
// Every field is a best guess; the user confirms everything in the form.
import { CATEGORIES, PAYMENT } from '../constants.js';
import { adToBs, bsToAd, isValidAD, isValidBS, toAsciiDigits, ymd } from '../nepaliDate.js';
import { parseLineItemsFromText } from '../splitter.js';

const PAN_KEYWORDS = /(pan|vat|p\.a\.n|प्यान|पान|स्थायी\s*लेखा\s*(नम्बर|नं)|स्था\.?\s*ले\.?\s*नं|भ्याट)/i;
// "Bill No.:- 2083/84-1052", "Invoice # INV-77", "Inv. No.: KTM/0091", "बिल नं: ४५७" and common OCR
// slips ("lnvoice", "Bil1", "N0"). The number may also sit on the next line.
const INVOICE_KEY = /(?:\b(?:b[il1|]{2}[l1|]|invoice|lnvoice|1nvoice|inv|receipt|ref|order|est|estimate)(?:\b|(?=n[o0]\b))|बिल|बीजक|बिजक|रसिद)\s*\.?\s*(?:no\b|n0\b|number|num\b|#|नं|नम्बर)\s*\.?/i;
const INVOICE_VALUE = /^[\s:.#\-–—=]*([A-Za-z0-9/._-]*\d[A-Za-z0-9/._-]*)/;
// A line that is just "No. 1234" (the value must contain a digit, so "No. of items" is skipped).
const INVOICE_FALLBACK_RE = /(?:^|\n)\s*(?:no|नं)\.?\s*[:.#-]?\s*([A-Za-z/._-]{0,10}\d[A-Za-z0-9/._-]{0,29})/i;
// Fonepay, wallets, QR and cards are entered in the IRD draw by the payment provider.
// Plain "QR", "card" or "POS" also show up on cash bills, so they need payment wording around them.
const DIGITAL_PAY_RE = /(fone\s*pay|e-?sewa|khalti|ime\s*pay|connect\s*ips|mobile\s*banking|(?:paid|payment|pay)\s*(?:by|via|mode|method)?\s*[:-]?\s*(?:qr|card)|qr\s*pay|(?:credit|debit)\s*card|visa|master\s*card|union\s*pay)/i;
const TOTAL_RE = /(grand\s*total|net\s*(?:total|amount|payable)|invoice\s*total|bill\s*amount|total\s*(?:amount|payable)?|amount\s*payable|जम्मा|कुल|रकम)/i;
const NOT_TOTAL_RE = /(sub\s*-?\s*total|total\s*qty|items?|discount|taxable|before\s*vat|tender|change|cash\s*received|paid|return|round(?:ing|\s*off|\s*up)?\b)/i;
const VAT_LINE_RE = /(vat|भ्याट|मू\.?\s*अ\.?\s*कर|मूल्य\s*अभिवृद्धि)/i;

/**
 * Letters a thermal font prints like digits, fixed only inside a number: "6O1234567" → 601234567,
 * "S00.00" → 500.00, "2O26-1O-29" → 2026-10-29. A letter next to letters is left alone, so
 * "Bill", "SOUP" and a "B12" item name keep their spelling.
 */
const LOOKALIKE = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', '|': '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };
export function fixOcrDigits(text = '') {
  return String(text).replace(/[0-9OoQDIl|SsBZz.,/:-]+/g, (run) => {
    const digits = (run.match(/\d/g) || []).length;
    const letters = (run.match(/[OoQDIl|SsBZz]/g) || []).length;
    if (digits < 3 || letters > digits / 2 || !letters) return run;
    // Only a lookalike that touches a digit (or a separator between digits) is a digit.
    return run.replace(/[OoQDIl|SsBZz]/g, (ch, i) => (/[\d.,]/.test(run[i - 1] || '') || /[\d.,]/.test(run[i + 1] || '') ? LOOKALIKE[ch] : ch));
  });
}

/**
 * The 13% VAT check, bottom up: a subtotal, its VAT and the total that add up
 * (subtotal × 13% ≈ VAT, subtotal + VAT ≈ total, within रु 1.5) among the amounts in the bottom
 * 60% of the bill. Three printed numbers that agree like that are almost surely read right.
 * @returns {{ subtotal: number, vat: number, total: number } | null}
 */
export function vatTriplet(lines = []) {
  const start = Math.floor(lines.length * 0.4);
  const nums = [];
  lines.slice(start).forEach((l, i) => {
    if (/\b\d{9}\b/.test(l) && PAN_KEYWORDS.test(l)) return; // a PAN line
    for (const n of amountsIn(l)) if (n >= 1 && n !== 13 && n < 1e8) nums.push({ n, i, vatLine: VAT_LINE_RE.test(l) });
  });
  let best = null;
  for (const s of nums) {
    for (const v of nums) {
      if (v === s || Math.abs(s.n * 0.13 - v.n) > 1.5 || v.n >= s.n) continue;
      for (const t of nums) {
        if (t === s || t === v || Math.abs(s.n + v.n - t.n) > 1.5) continue;
        // Prefer the VAT on a "VAT" line, in printed order (subtotal, VAT, total), largest total.
        const score = (v.vatLine ? 4 : 0) + (s.i <= v.i && v.i <= t.i ? 2 : 0) + t.n / 1e9;
        if (!best || score > best.score) best = { score, subtotal: s.n, vat: v.n, total: t.n };
      }
    }
  }
  return best && { subtotal: best.subtotal, vat: best.vat, total: best.total };
}

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
  // Every date on the bill; BS years run ~57 years ahead of AD, so years >= 2060 are BS.
  const re = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)|(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)/g;
  const found = [];
  for (const m of text.matchAll(re)) {
    const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const s = ymd(Number(y), Number(mo), Number(d));
    if (Number(y) >= 2060 && isValidBS(s)) found.push({ bs: s, ad: bsToAd(s) || '' });
    else if (isValidAD(s)) found.push({ ad: s, bs: adToBs(s) || '' });
  }
  if (!found.length) return { ad: '', bs: '' };
  // A bill printing both (Date + Miti) where OCR misread one ("2083" → "2073"): when they
  // disagree, keep the date closest to today that isn't in the future, and derive the other.
  const now = Date.now();
  const dist = (f) => {
    const t = Date.parse(`${f.ad}T00:00:00Z`);
    if (!Number.isFinite(t)) return Infinity;
    return t > now + 2 * 86400000 ? Infinity : Math.abs(now - t);
  };
  const best = [...found].sort((x, y) => dist(x) - dist(y))[0];
  return { ad: best.ad, bs: best.bs };
}

function findInvoice(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = INVOICE_KEY.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i].slice(m.index + m[0].length);
    const v = INVOICE_VALUE.exec(rest) || (!/[A-Za-z0-9]/.test(rest) && INVOICE_VALUE.exec(lines[i + 1] || ''));
    if (v && v[1].length <= 40) return v[1].replace(/[.\-_/]+$/, '');
  }
  return '';
}

const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000, lac: 100000, lacs: 100000, crore: 10000000, crores: 10000000 };

/**
 * The amount printed in words ("Six hundred and thirty rupees only", "Rupees One Thousand Two
 * Hundred Fifty Only", "Two lakh five thousand"). Nepali bills nearly always print it, and OCR reads
 * words more reliably than a crumpled "630.00". Paisa after "and … paisa" are ignored.
 */
export function amountInWords(text = '') {
  const words = String(text).toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    let total = 0;
    let current = 0;
    let used = 0;
    let j = i;
    for (; j < words.length; j++) {
      const w = words[j];
      if (w === 'and' && used) continue;
      if (w in ONES) current += ONES[w];
      else if (w in TENS) current += TENS[w];
      else if (w === 'hundred') current = (current || 1) * 100;
      else if (w in SCALES) { total += (current || 1) * SCALES[w]; current = 0; }
      else break;
      used++;
    }
    const value = total + current;
    // Needs at least two number words (or a scale word), so a stray "one" or "ten" doesn't count.
    const hasScale = words.slice(i, j).some((w) => w in SCALES || w === 'hundred');
    if ((used >= 2 || hasScale) && value > best) best = value;
    if (used) i = j - 1;
  }
  return best || null;
}

/**
 * Every value that could be the bill total, with how much to trust it: the amount in words (2),
 * a "Grand / Net / Invoice Total" line (1.5), any other total line (1). Used to vote across reads.
 */
export function totalCandidates(raw = '') {
  const lines = toAsciiDigits(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((l, i) => {
    if (!TOTAL_RE.test(l) || NOT_TOTAL_RE.test(l) || VAT_LINE_RE.test(l) && !/total/i.test(l)) return;
    // Amount usually sits on the same line; some printers put it on the next one.
    let nums = amountsIn(l);
    if (!nums.length) nums = amountsIn(lines[i + 1] || '').slice(0, 1);
    if (!nums.length) return;
    const strong = /grand|net|payable|invoice\s*total|जम्मा/i.test(l);
    out.push({ value: Math.max(...nums), weight: strong ? 1.5 : 1, at: i, source: 'line' });
  });
  const words = amountInWords(lines.join(' '));
  if (words) out.push({ value: words, weight: 2, at: lines.length, source: 'words' });
  return out;
}

/**
 * The bill total. Candidates: a total line ("Grand Total", "Invoice Total", …), the amount in words,
 * and the sum of the items. One that two sources agree on wins; the amount in words beats a lone
 * total line; the largest number on the bill is only a last resort.
 */
function findTotal(lines, itemsSum = 0) {
  const cands = totalCandidates(lines.join('\n'));
  const lineCands = cands.filter((c) => c.source === 'line');
  // Prefer "grand/net/invoice total" lines and later lines (totals usually come last).
  const line = lineCands.sort((x, y) => (y.weight - x.weight) || (y.at - x.at))[0]?.value || null;
  const words = cands.find((c) => c.source === 'words')?.value || null;
  const sum = Math.round(itemsSum * 100) / 100;
  const near = (a, b) => a && b && Math.abs(a - b) < 0.6;
  const agreed = lineCands.find((c) => near(c.value, words) || near(c.value, sum));
  if (agreed) return { value: agreed.value, guessed: false };
  if (words) return { value: words, guessed: false };
  if (line) return { value: line, guessed: false };
  // No total printed or read: a guess. Flagged, so a missed item can't pass as a matching total.
  if (sum > 0) return { value: sum, guessed: true };
  const all = lines.flatMap(amountsIn).filter((n) => n < 10_000_000);
  return { value: all.length ? Math.max(...all) : null, guessed: true };
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
    const clean = line.replace(/[^\p{L}\p{N}&.'\s-]/gu, '').replace(/\s+/g, ' ').trim();
    // A stray mark or number above the name ("1T4") isn't a shop: it needs a few letters.
    if (clean.length < 3 || /\d{5,}/.test(clean) || (clean.match(/\p{L}/gu) || []).length < 4) continue;
    if (/(tax\s*invoice|invoice|estimate|bill|receipt|pan|vat|tel|phone|date)/i.test(clean) && clean.split(/\s+/).length < 3) continue;
    return clean.slice(0, 80);
  }
  return '';
}

const CATEGORY_HINTS = [
  ['Food & Dining', /(restaurant|cafe|café|momo|khaja|bakery|kitchen|dining|food|tea\b|coffee|resto|restro|hotel|sekuwa|thakali|choila|grill|pizza|burger|biryani|dhaba|lounge|bar\b|pub\b|भोजन|खाजा)/i],
  // Before Groceries: "Medical Store", "Pharmacy & Store".
  ['Medicine', /(pharma\w*|medic(al|ine|o)\w*|chemist|drug|clinic|hospital|health\s*care|dental|diagnostic|path(o)?\s*lab|औषधि|औषधी|मेडिकल|फार्मेसी|अस्पताल)/i],
  ['Groceries', /(mart|kirana|grocery|grocer|supermarket|store|pasal|traders|किराना|पसल)/i],
  // Not "mineral water" on a menu: a water or power utility.
  ['Utilities & Telecom', /(electric|\bnea\b|telecom|ncell|\bntc\b|internet|wifi|water\s*(supply|bill|tariff)|khanepani|recharge|top\s*up)/i],
  ['Transport', /(taxi|\bbus\b|ride|fuel|petrol|diesel|airline|ticket|yatayat|पेट्रोल)/i],
  ['Retail/Shopping', /(fashion|clothing|boutique|electronics|mobile|shoes|mall|cosmetic|book)/i],
];

/** The shop's kind: from its name and address at the top first, then from the whole bill. */
export function guessCategory(text) {
  const head = String(text).split(/\r?\n/).slice(0, 4).join(' ');
  for (const scope of [head, text]) {
    for (const [cat, re] of CATEGORY_HINTS) if (re.test(scope)) return cat;
  }
  return CATEGORIES.at(-1);
}

/** @returns partial bill fields extracted from OCR text */
// "Estimate", "THIS IS NOT A VALID BILL", "only for accounting purpose", proforma: not a tax bill.
const ESTIMATE_RE = /\b(estimate|not\s+a\s+valid\s+bill|only\s+for\s+accounting|pro\s*-?\s*forma|take\s+(?:a\s+)?vaild?\s+bill|valid\s+bill\s+from)\b/i;

export function parseReceiptText(raw) {
  const text = fixOcrDigits(toAsciiDigits(raw || ''));
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dates = findDates(text);
  const sellerPan = findPan(lines);
  const itemsSum = parseLineItemsFromText(text).reduce((sum, it) => sum + it.amount, 0);
  let { value: totalAmount, guessed: totalGuessed } = findTotal(lines, itemsSum);
  let vatAmount = findVat(lines);
  // Subtotal + 13% VAT = total: when the numbers agree, the total and VAT are confirmed. A missing
  // or guessed total takes the checked one; a printed total that differs (rounded, a tip) stays.
  const tri = vatTriplet(lines);
  let mathVerified = false;
  if (tri) {
    if (!totalAmount || totalGuessed) { totalAmount = tri.total; totalGuessed = false; }
    if (Math.abs(totalAmount - tri.total) <= 1.5) {
      mathVerified = true;
      vatAmount = tri.vat;
    }
  }
  const looksNepali = Boolean(sellerPan) || /(npr|rs\.?|रु|नेपाल|nepal|kathmandu|lalitpur|pokhara|vat)/i.test(text);
  return {
    merchantName: findMerchant(lines),
    sellerPan,
    invoiceNumber: findInvoice(lines) || text.match(INVOICE_FALLBACK_RE)?.[1] || '',
    paymentMethod: DIGITAL_PAY_RE.test(text) ? PAYMENT.DIGITAL : undefined,
    billDateAD: dates.ad,
    billDateBS: dates.bs,
    totalAmount,
    totalGuessed,
    vatAmount: vatAmount && totalAmount && vatAmount < totalAmount ? vatAmount : null,
    category: guessCategory(text),
    isEstimate: ESTIMATE_RE.test(text),
    looksNepali,
    mathVerified,
    vatCheck: mathVerified ? tri : null,
  };
}
