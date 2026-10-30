// IRD Taxpayer Incentive (prize coupon) eligibility engine and portal helpers.
// Rules mirror what prize.ird.gov.np itself enforces, plus the program's published
// list of ineligible bills.
import {
  EXCLUDED_CATEGORIES, IRD_MIN_AMOUNT, IRD_PORTAL_URL, IRD_STATUS, PAYMENT,
} from './constants.js';
import { drawWindowFor, todayAD, todayBS } from './nepaliDate.js';
import { findEarlierInvoiceDuplicate } from './dedupe.js';

export const PAN_RE = /^\d{9}$/;
export const COUPON_RE = /^\d{12}$/;

/** Fonepay / QR / card payments are reported by the bank or wallet and enrolled automatically. */
export const isAutoEnrolled = (e) => e.paymentMethod === PAYMENT.DIGITAL;

/**
 * Checks one expense against the program rules.
 * @returns {{eligible: boolean, reasons: string[], warnings: string[], window: object|null}}
 */
export function checkEligibility(e, { today = todayAD(), todayBs = todayBS() } = {}) {
  const reasons = [];
  const warnings = [];

  if (!e.isNepalBill) {
    return { eligible: false, reasons: ['Not marked as a Nepal bill.'], warnings, window: null };
  }
  const amount = Number(e.totalAmount);
  if (!Number.isFinite(amount) || amount < IRD_MIN_AMOUNT) {
    reasons.push(`Amount must be at least Rs. ${IRD_MIN_AMOUNT}.`);
  }
  if (amount === IRD_MIN_AMOUNT) {
    // The portal accepts exactly Rs. 100, but the Operating Procedure says "more than".
    warnings.push('Exactly Rs. 100: the portal accepts it, but Section 4(1) of the Operating Procedure, 2083 says purchases of more than Rs. 100 ("एक पटकमा रु. १०० भन्दा बढी"), so this bill could be rejected at claim time.');
  }
  if (!PAN_RE.test(String(e.sellerPan || ''))) {
    reasons.push('Seller PAN/VAT number (9 digits) is missing.');
  }
  if (EXCLUDED_CATEGORIES.includes(e.category)) {
    reasons.push(`${e.category} bills are excluded from the program.`);
  }
  if (e.billDateAD && e.billDateAD > today) {
    reasons.push('Bill date is in the future.');
  }
  if (!cleanBillNumber(e.invoiceNumber)) {
    warnings.push('Add the bill / invoice number (letters and digits) — the portal requires it.');
  }

  const window = drawWindowFor(todayBs);
  if (window && e.billDateBS && (e.billDateBS < window.startBS || e.billDateBS > window.endBS)) {
    warnings.push(`Bill date is outside the current draw window (${window.label}).`);
  }

  return { eligible: reasons.length === 0, reasons, warnings, window };
}

export function getIrdStatus(e, opts) {
  if (!checkEligibility(e, opts).eligible) return IRD_STATUS.INELIGIBLE;
  const hasCoupon = COUPON_RE.test(String(e.irdCoupon || ''));
  if (hasCoupon) return IRD_STATUS.APPLIED;
  // Fonepay / QR / card bills are entered by the bank or wallet; only the coupon is left to save.
  if (isAutoEnrolled(e)) return IRD_STATUS.AUTO;
  return IRD_STATUS.NOT_APPLIED;
}

/** Eligible bills the user still has to enroll by hand. */
export const needsManualEntry = (e, opts) => getIrdStatus(e, opts) === IRD_STATUS.NOT_APPLIED;

/** QR/card bills already in the draw whose coupon number is not saved yet. */
export const needsCouponOnly = (e, opts) => getIrdStatus(e, opts) === IRD_STATUS.AUTO;

const toAscii = (v) => String(v ?? '').replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966));

/**
 * Bill number as the portal stores it: Nepali digits to ASCII, upper case, only A-Z 0-9 . / _ -
 * (max 40). "बिल नं ४५७" becomes "457" and "akp 0457" becomes "AKP0457".
 */
export function normalizeInvoiceNumber(raw = '') {
  return toAscii(raw).toUpperCase().replace(/[^A-Z0-9./_-]/g, '').slice(0, 40);
}
export const cleanBillNumber = normalizeInvoiceNumber;

/** A 12-digit prize coupon from any spacing or Nepali digits, or '' when it isn't 12 digits. */
export function normalizeCouponCode(raw = '') {
  const digits = toAscii(raw).replace(/\D/g, '');
  return digits.length === 12 ? digits : '';
}

/** "208307123456" -> "208 307 123 456" */
export const formatCoupon = (code) => normalizeCouponCode(code).replace(/(\d{3})(?=\d)/g, '$1 ');

/**
 * An earlier saved bill with the same seller PAN and bill number (Nepali digits, prefixes like
 * "INV-" and leading zeros ignored). The program allows each bill into the draw once (Operating
 * Procedure 2083, Section 4(6)), so the later copy is blocked; the original stays enterable.
 */
export const findDuplicateBill = findEarlierInvoiceDuplicate;

/* ---------- winners ---------- */

// Prize rules from the Operating Procedure, 2083 (Sections 6, 8 and 9).
export const PRIZES = {
  daily: { gross: 133334, net: 100000 },
  bumper: { gross: 1000000, net: 750000 },
  taxRate: 0.25,
};
export const CLAIM_DAYS = 15;

/**
 * Every 12-digit coupon number in a pasted winners list. Accepts "007 315 254 493",
 * "007315254493", "0073-1525-4493" and Nepali digits; longer digit runs are ignored.
 */
export function extractCouponCodes(rawNoticeText = '') {
  const text = toAscii(rawNoticeText);
  const found = new Set();
  // 12 digits with at most one space or hyphen between any two (covers 3-3-3-3, 4-4-4 and none).
  for (const m of text.matchAll(/(?<!\d)(?:\d[ \t-]?){11}\d(?!\d)/g)) {
    found.add(m[0].replace(/\D/g, ''));
  }
  return [...found];
}

/** Saved bills whose coupon appears in the pasted winners list. */
export function matchWinningCoupons(rawNoticeText = '', savedBills = []) {
  const codes = new Set(extractCouponCodes(rawNoticeText));
  return savedBills.filter((b) => {
    const c = normalizeCouponCode(b.irdCoupon);
    return c && codes.has(c);
  });
}

/** Winners are announced on the 1st and 16th of the Nepali month: the latest one on or before a BS date. */
export function lastAnnouncementBS(bsDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bsDate || '');
  if (!m) return '';
  return `${m[1]}-${m[2]}-${Number(m[3]) >= 16 ? '16' : '01'}`;
}

/** The values the portal's "enroll a cash bill" form asks for, keyed by its input names. */
export function portalFields(e, profile) {
  return {
    bill_number: cleanBillNumber(e.invoiceNumber),
    seller_pan_no: toAscii(e.sellerPan).replace(/\D/g, '').slice(0, 9),
    billed_total_amount: Number(e.totalAmount || 0).toFixed(2),
    name: String(profile?.fullName || '').trim(),
    mobile_number: toAscii(profile?.phone).replace(/\D/g, ''),
    address: String(profile?.address || '').trim(),
  };
}

/** Everything the portal helper needs for one bill. */
export function portalPayload(e, profile, app) {
  return {
    v: 1,
    id: e.id,
    app,
    merchant: e.merchantName || '',
    pay: isAutoEnrolled(e) ? 'digital' : 'cash',
    bs: e.billDateBS || '',
    ad: e.billDateAD || '',
    ...portalFields(e, profile),
  };
}

/** UTF-8 safe base64url, so Nepali names survive the trip in the URL fragment. */
export function encodePayload(p) {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Portal link carrying the bill in the #fragment. Browsers never send the fragment to the
 * server, and the helper removes it from the address bar as soon as the page loads.
 */
export function portalLink(e, profile, app) {
  return `${IRD_PORTAL_URL}/#billkhata=${encodePayload(portalPayload(e, profile, app))}`;
}
