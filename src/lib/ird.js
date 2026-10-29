// IRD Taxpayer Incentive (prize coupon) eligibility engine and portal helpers.
// Rules mirror what prize.ird.gov.np itself enforces, plus the program's published
// list of ineligible bills.
import {
  EXCLUDED_CATEGORIES, IRD_MIN_AMOUNT, IRD_PORTAL_URL, IRD_STATUS, PAYMENT,
} from './constants.js';
import { drawWindowFor, todayAD, todayBS } from './nepaliDate.js';

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
 * The portal keeps only letters, digits and . / _ - in a bill number (max 40, upper case),
 * so "बिल नं ४५७" or "AKP 0457" would otherwise arrive empty or changed.
 */
export function cleanBillNumber(v) {
  return toAscii(v).replace(/[^0-9A-Za-z./_-]/g, '').slice(0, 40).toUpperCase();
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
