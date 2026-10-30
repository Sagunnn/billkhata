// Duplicate & cross-reference engine: is this bill already in BillKhata?
// Three independent layers, so a torn, cropped or misread scan is still caught:
//   1. bill / invoice number (exact, then OCR look-alikes)
//   2. the ordered sequence of line items (names and prices, top to bottom)
//   3. a perceptual hash of the receipt photo (dHash, computed in image.js)
// Pure functions only; unit-tested in dedupe.test.js.

const toAscii = (v) => String(v ?? '').replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
const panOf = (b) => toAscii(b?.sellerPan).replace(/\D/g, '');
const totalOf = (b) => Math.round((Number(b?.totalAmount) || 0) * 100);
const PAN_RE = /^\d{9}$/;

/* ---------- 1. bill / invoice numbers ---------- */

const PREFIX = /^(?:TAX\s*)?(?:INVOICE|INV|BILL|RECEIPT|REF|ORDER|VAT\s*BILL)?\s*(?:NO|NUMBER|NUM)?\s*[.:#\-\s]*/;

/**
 * Comparable form of a bill number: Nepali digits → ASCII, upper case, prefixes like "Bill No",
 * "Inv", "#" or ":" removed, separators dropped, leading zeros removed.
 * "INV-452", "00452", "०४५२" and "Bill No.: 452" all become "452".
 */
export function normalizeInvoiceStrict(raw = '') {
  let s = toAscii(raw).toUpperCase().trim();
  // Strip prefixes like "INV-", "BILL NO.:" (repeatedly, for "TAX INVOICE NO: INV-12")
  for (let i = 0; i < 3; i++) {
    const m = PREFIX.exec(s);
    if (!m || !m[0]) break;
    const rest = s.slice(m[0].length);
    if (!rest) break; // the whole thing was letters like "INV": keep it
    s = rest;
  }
  s = s.replace(/[^A-Z0-9]/g, '');
  return s.replace(/^0+(?=[A-Z0-9])/, '');
}

const CONFUSABLE = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8' };

/** Strict form with OCR look-alikes folded together: O/Q/D→0, I/L/|→1, Z→2, S→5, B→8. */
export function normalizeInvoiceOCRCanonical(raw = '') {
  const strict = normalizeInvoiceStrict(String(raw).replace(/\|/g, 'I'));
  return strict.replace(/[OQDILZSB]/g, (c) => CONFUSABLE[c]).replace(/^0+(?=[A-Z0-9])/, '');
}

/** Edit distance, stopping early once it's over `max`. */
export function levenshtein(a = '', b = '', max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/* ---------- 2. ordered line items ---------- */

const amt = (n) => String(Math.round((Number(n) || 0) * 100) / 100);
const token = (name) => toAscii(name).toLowerCase().normalize('NFC').replace(/[^\p{L}]+/gu, '');

/**
 * With 2+ items: `priceSeq` "P:180>250>65>420" and `itemSeq` "I:momo:180>chilly:250>…",
 * top to bottom. Two different bills almost never share the same ordered sequence.
 */
export function buildItemSequenceFingerprints(bill) {
  const items = (bill?.lineItems?.length ? bill.lineItems : bill?.items || []).filter((it) => Number(it.amount) > 0);
  if (items.length < 2) return null;
  return {
    count: items.length,
    priceSeq: `P:${items.map((it) => amt(it.amount)).join('>')}`,
    itemSeq: `I:${items.map((it) => `${token(it.name)}:${amt(it.amount)}`).join('>')}`,
    amounts: items.map((it) => Number(amt(it.amount))),
  };
}

/* ---------- 3. photo hash ---------- */

/** Bits that differ between two 16-hex-char hashes. */
export function hammingHex(a = '', b = '') {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
export const IMAGE_HASH_MAX_DISTANCE = 4;

/* ---------- cross-reference ---------- */

const earlier = (a, b) => (a.createdAt || '') < (b.createdAt || '') || ((a.createdAt || '') === (b.createdAt || '') && String(a.id) < String(b.id));

/**
 * Every saved bill that looks like this one, strongest first:
 * `{ bill, level: 'exact'|'ocr'|'items'|'image', reasons: string[], earlier: boolean }`.
 * `earlier` is true when the other bill was added before this one (so this is the copy).
 */
export function crossReferenceBill(candidate, existingBills = []) {
  if (!candidate) return [];
  const cPan = panOf(candidate);
  const cTotal = totalOf(candidate);
  const cInv = normalizeInvoiceStrict(candidate.invoiceNumber);
  const cCanon = normalizeInvoiceOCRCanonical(candidate.invoiceNumber);
  const cSeq = buildItemSequenceFingerprints(candidate);
  const rank = { exact: 0, ocr: 1, items: 2, image: 3 };
  const out = [];

  for (const b of existingBills) {
    if (!b || b.id === candidate.id) continue;
    const reasons = [];
    let level = null;
    const bPan = panOf(b);
    const samePan = PAN_RE.test(cPan) && cPan === bPan;
    const panMissing = !PAN_RE.test(cPan) || !PAN_RE.test(bPan);
    const sameTotal = cTotal > 0 && cTotal === totalOf(b);
    const bInv = normalizeInvoiceStrict(b.invoiceNumber);

    // 1. Bill number
    if (cInv && bInv) {
      if (cInv === bInv && (samePan || (panMissing && sameTotal))) {
        level = 'exact';
        reasons.push(`Same bill no. (${b.invoiceNumber || bInv})${samePan ? ` from the same seller PAN ${bPan}` : ` and the same total`}`);
      } else if (samePan && sameTotal && cInv.length >= 3) {
        if (cCanon === normalizeInvoiceOCRCanonical(b.invoiceNumber)) {
          level = 'ocr';
          reasons.push(`Bill no. ${candidate.invoiceNumber} looks like a misread of ${b.invoiceNumber} (same seller, same total)`);
        } else if (levenshtein(cInv, bInv, 1) === 1 && candidate.billDateAD && candidate.billDateAD === b.billDateAD) {
          // One character off is also how consecutive bills look, so it needs the same day too.
          level = 'ocr';
          reasons.push(`Bill no. ${candidate.invoiceNumber} is one character off ${b.invoiceNumber} (same seller, total and date)`);
        }
      }
    }

    // 2. Ordered items
    const bSeq = buildItemSequenceFingerprints(b);
    if (cSeq && bSeq) {
      const seqText = `${cSeq.count}-item sequence (${cSeq.amounts.join(' → ')})`;
      if (cSeq.itemSeq === bSeq.itemSeq) {
        level ||= 'items';
        reasons.push(`Identical ${seqText}`);
      } else if (cSeq.priceSeq === bSeq.priceSeq && sameTotal) {
        level ||= 'items';
        reasons.push(`Same prices in the same order, same total: ${seqText}`);
      }
    }

    // 3. Photo. Receipts all look alike at 9 x 8 pixels (in testing, 2 of 78 pairs of different
    // receipts were within 4 bits), so a similar photo only counts when the total matches too.
    if (candidate.imageHash && b.imageHash && sameTotal) {
      const d = hammingHex(candidate.imageHash, b.imageHash);
      if (d <= IMAGE_HASH_MAX_DISTANCE) {
        level ||= 'image';
        reasons.push(d === 0 ? 'Same receipt photo and total' : `Nearly identical receipt photo (${d}/64 bits differ) and the same total`);
      }
    }

    if (level) out.push({ bill: b, level, reasons, earlier: earlier(b, candidate) });
  }
  return out.sort((x, y) => rank[x.level] - rank[y.level] || (y.earlier - x.earlier));
}

/**
 * The bill this one copies for IRD purposes: an earlier bill with the same seller PAN and bill
 * number. Only the later copy is blocked, so the original can still be entered in the draw.
 */
export function findEarlierInvoiceDuplicate(candidate, existingBills = []) {
  const pan = panOf(candidate);
  const inv = normalizeInvoiceStrict(candidate?.invoiceNumber);
  if (!PAN_RE.test(pan) || !inv) return null;
  return existingBills.find((b) => b.id !== candidate.id && panOf(b) === pan
    && normalizeInvoiceStrict(b.invoiceNumber) === inv && earlier(b, candidate)) || null;
}
