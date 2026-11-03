// Where each read field sits on the bill photo, from the OCR word boxes, so "Check the details" can
// zoom the photo to it and draw a box around it. Pure: works on words { text, x0, y0, x1, y1 }.
import { toAsciiDigits } from '../nepaliDate.js';
import { buildRows } from './rows.js';

const digits = (t) => toAsciiDigits(String(t ?? '')).replace(/\D/g, '');
const alnum = (t) => toAsciiDigits(String(t ?? '')).toLowerCase().replace(/[^a-z0-9]/g, '');

function union(list) {
  if (!list.length) return null;
  return {
    x0: Math.min(...list.map((b) => b.x0)),
    y0: Math.min(...list.map((b) => b.y0)),
    x1: Math.max(...list.map((b) => b.x1)),
    y1: Math.max(...list.map((b) => b.y1)),
  };
}

/** "6,115.56" → 6115.56; null when the word isn't a number. */
function amountOf(text) {
  const t = toAsciiDigits(String(text)).replace(/^[^\d]+/, '').replace(/[^\d.,]+$/, '');
  if (!/^\d[\d,]*(\.\d{1,2})?$/.test(t)) return null;
  return Number(t.replace(/,/g, ''));
}

/** The row with a word whose amount is `value`, preferring rows that say `label`, else the lowest. */
function amountRow(rows, value, label) {
  if (!(Number(value) > 0)) return null;
  const hits = rows.filter((r) => r.boxes.some((b) => amountOf(b.text) != null && Math.abs(amountOf(b.text) - value) < 0.011));
  if (!hits.length) return null;
  return hits.find((r) => label.test(r.text)) || hits.at(-1);
}

/** Shop name: the row near the top sharing the most words with the name. */
function nameRow(rows, name, maxY) {
  const want = String(name || '').toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length >= 3);
  if (!want.length) return null;
  let best = null;
  for (const r of rows) {
    if (r.cy > maxY) break;
    const have = r.text.toLowerCase();
    const score = want.filter((w) => have.includes(w)).length;
    if (score && (!best || score > best.score)) best = { row: r, score };
  }
  return best?.row || null;
}

/** A date written any common way (2083-07-17, 17/07/2083, 2083.7.17) for one of the dates. */
function dateWord(words, dates) {
  const forms = new Set();
  for (const d of dates.filter(Boolean)) {
    const [y, m, day] = d.split('-');
    for (const mm of [m, String(Number(m))]) {
      for (const dd of [day, String(Number(day))]) forms.add(`${y}${mm}${dd}`).add(`${dd}${mm}${y}`).add(`${mm}${dd}${y}`);
    }
  }
  return words.find((w) => /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(toAsciiDigits(w.text)) && forms.has(digits(w.text))) || null;
}

/**
 * @param {object[]} words  OCR word boxes in the read image's pixels
 * @param {object} fields   the fields read from those words
 * @param {{ width: number, height: number, angle?: number }} image  the read image's size, and the
 *   degrees it was straightened by before reading (boxes are turned back onto the photo)
 * @returns {Record<string, {x: number, y: number, w: number, h: number}>}  each found field's box,
 *   as fractions of the photo (0-1). Keys: merchantName, sellerPan, invoiceNumber, billDate,
 *   totalAmount, vatAmount, lineItems.
 */
export function locateFields(words = [], fields = {}, { width, height, angle = 0 } = {}) {
  if (!words.length || !(width > 0) || !(height > 0)) return {};
  const rows = buildRows(words);
  const rowBox = (r) => r && union(r.boxes);
  const found = {};

  found.merchantName = rowBox(nameRow(rows, fields.merchantName, height * 0.45));

  const pan = digits(fields.sellerPan);
  if (pan.length >= 5) {
    const r = rows.find((x) => digits(x.text).includes(pan));
    if (r) found.sellerPan = union(r.boxes.filter((b) => digits(b.text).length >= 3 && pan.includes(digits(b.text)))) || rowBox(r);
  }
  if (!found.sellerPan) found.sellerPan = rowBox(rows.find((r) => /\b(pan|vat)\b|प्यान|पान/i.test(r.text)));

  const inv = alnum(fields.invoiceNumber);
  if (inv.length >= 2) {
    const w = words.find((x) => alnum(x.text).length >= 2 && (alnum(x.text) === inv || (inv.length >= 4 && alnum(x.text).includes(inv))));
    if (w) found.invoiceNumber = union([w]);
  }

  const dw = dateWord(words, [fields.billDateBS, fields.billDateAD]);
  if (dw) found.billDate = union([dw]);

  found.totalAmount = rowBox(amountRow(rows, Number(fields.totalAmount), /total|grand|net|payable|amount|जम्मा|कुल/i));
  found.vatAmount = rowBox(amountRow(rows, Number(fields.vatAmount), /vat|tax|भ्याट|कर/i));

  const items = (fields.lineItems || []).map((it) => String(it.name || '').toLowerCase().split(/\s+/)[0]).filter((w) => w.length >= 3);
  const itemRows = rows.filter((r) => items.some((w) => r.text.toLowerCase().includes(w)));
  if (itemRows.length) found.lineItems = union(itemRows.flatMap((r) => r.boxes));

  // Back onto the photo: undo the straightening (a turn about the centre), then as fractions.
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;
  const turn = ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
  const out = {};
  for (const [k, b] of Object.entries(found)) {
    if (!b) continue;
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(turn);
    const x0 = Math.max(0, Math.min(...pts.map((p) => p[0])) / width);
    const y0 = Math.max(0, Math.min(...pts.map((p) => p[1])) / height);
    const x1 = Math.min(1, Math.max(...pts.map((p) => p[0])) / width);
    const y1 = Math.min(1, Math.max(...pts.map((p) => p[1])) / height);
    if (x1 > x0 && y1 > y0) out[k] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return out;
}

/** Rough areas of a bill, for photos with no word boxes (a vision read, an attached photo). */
export const BILL_AREAS = {
  shop: { x: 0, y: 0, w: 1, h: 0.26 },
  bill: { x: 0, y: 0.1, w: 1, h: 0.3 },
  amount: { x: 0, y: 0.55, w: 1, h: 0.45 },
};

/** Boxes together (the area a step covers). */
export function joinBoxes(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x0 = Math.min(...list.map((b) => b.x));
  const y0 = Math.min(...list.map((b) => b.y));
  const x1 = Math.max(...list.map((b) => b.x + b.w));
  const y1 = Math.max(...list.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
