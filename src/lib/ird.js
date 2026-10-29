// IRD Taxpayer Incentive (prize coupon) eligibility engine and portal helpers.
// Rules mirror what prize.ird.gov.np itself enforces, plus the program's published
// list of ineligible bills.
import {
  EXCLUDED_CATEGORIES, IRD_MIN_AMOUNT, IRD_STATUS, PAYMENT,
} from './constants.js';
import { drawWindowFor, formatAD, formatBS, todayAD, todayBS } from './nepaliDate.js';

export const PAN_RE = /^\d{9}$/;
export const COUPON_RE = /^\d{12}$/;

/** Card/QR payments are reported by the bank or wallet and enrolled automatically. */
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
  if (!String(e.invoiceNumber || '').trim()) {
    warnings.push('Add the bill / invoice number — the portal requires it.');
  }

  const window = drawWindowFor(todayBs);
  if (window && e.billDateBS && (e.billDateBS < window.startBS || e.billDateBS > window.endBS)) {
    warnings.push(`Bill date is outside the current draw window (${window.label}).`);
  }

  return { eligible: reasons.length === 0, reasons, warnings, window };
}

export function getIrdStatus(e, opts) {
  if (!checkEligibility(e, opts).eligible) return IRD_STATUS.INELIGIBLE;
  if (isAutoEnrolled(e)) return IRD_STATUS.AUTO;
  if (COUPON_RE.test(String(e.irdCoupon || ''))) return IRD_STATUS.APPLIED;
  return IRD_STATUS.NOT_APPLIED;
}

/** Eligible bills the user still has to enroll by hand. */
export const needsManualEntry = (e, opts) => getIrdStatus(e, opts) === IRD_STATUS.NOT_APPLIED;

/** The values the portal's "enroll a cash bill" form asks for, keyed by its input names. */
export function portalFields(e, profile) {
  return {
    bill_number: String(e.invoiceNumber || '').trim(),
    seller_pan_no: String(e.sellerPan || '').trim(),
    billed_total_amount: Number(e.totalAmount || 0).toFixed(2),
    name: String(profile?.fullName || '').trim(),
    mobile_number: String(profile?.phone || '').trim(),
    address: String(profile?.address || '').trim(),
  };
}

/**
 * Builds a script that fills the portal form in the user's own browser tab.
 * It only types into the visible fields: it never touches the hidden
 * honeypot field, the security check or the submit button.
 */
export function buildFillScript(e, profile) {
  const data = {
    fields: portalFields(e, profile),
    dateBS: e.billDateBS ? `${e.billDateBS} (${formatBS(e.billDateBS)})` : '',
    dateAD: e.billDateAD ? `${e.billDateAD} (${formatAD(e.billDateAD)})` : '',
  };
  // Kept ES5-ish and self-contained so it runs as a bookmarklet.
  return `(function(){
var d=${JSON.stringify(data)};
if(!/(^|\\.)prize\\.ird\\.gov\\.np$/.test(location.hostname)){alert('BillKhata: open https://prize.ird.gov.np first, then run this again.');return;}
function setVal(el,v){var p=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
var cash=[].slice.call(document.querySelectorAll('[role=radio]')).filter(function(b){return /cash|नगद/i.test(b.textContent);})[0];
if(cash&&cash.getAttribute('aria-checked')!=='true'){cash.click();}
setTimeout(function(){
var done=[],miss=[];
Object.keys(d.fields).forEach(function(n){var el=document.querySelector('form input[name="'+n+'"]:not([type=hidden]), form textarea[name="'+n+'"]');if(el&&d.fields[n]){setVal(el,d.fields[n]);done.push(n);}else{miss.push(n);}});
var msg='BillKhata filled '+done.length+' field(s).';
if(miss.length){msg+='\\nNot found or empty: '+miss.join(', ')+'.';}
msg+='\\n\\nNow pick the bill date in the calendar:\\n  BS '+d.dateBS+'\\n  AD '+d.dateAD+'\\nThen complete the security check and press Generate Prize Coupon.';
alert(msg);
},400);
})();`;
}

export function buildBookmarklet(e, profile) {
  const code = buildFillScript(e, profile).replace(/\n/g, '');
  return `javascript:${encodeURIComponent(code)}`;
}
