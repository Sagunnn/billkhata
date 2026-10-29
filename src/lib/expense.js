// The expense record: creation, cleanup, summaries and filters.
import { CATEGORIES, IRD_STATUS, PAYMENT, PAYMENT_METHODS, REGIONS } from './constants.js';
import { getIrdStatus } from './ird.js';
import { addDaysAD, adToBs, parseYmd, todayAD, todayBS } from './nepaliDate.js';
import { newId } from './db.js';

export function blankExpense(region = REGIONS.NEPAL) {
  const ad = todayAD();
  return {
    id: newId(),
    merchantName: '',
    sellerPan: '',
    invoiceNumber: '',
    billDateAD: ad,
    billDateBS: adToBs(ad) || '',
    totalAmount: '',
    vatAmount: '',
    paymentMethod: PAYMENT.CASH,
    category: CATEGORIES.at(-1),
    isNepalBill: region === REGIONS.NEPAL,
    notes: '',
    receiptImage: null,
    irdCoupon: '',
    irdAppliedAt: null,
    ocrEngine: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Coerces types before saving, and stores the derived IRD status for readable backups. */
export function finalizeExpense(e) {
  const amount = Number(e.totalAmount);
  const vat = Number(e.vatAmount);
  const out = {
    ...e,
    merchantName: String(e.merchantName || '').trim(),
    sellerPan: String(e.sellerPan || '').replace(/\D/g, ''),
    invoiceNumber: String(e.invoiceNumber || '').trim(),
    totalAmount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    vatAmount: e.vatAmount === '' || e.vatAmount == null || !Number.isFinite(vat) ? null : Math.round(vat * 100) / 100,
    paymentMethod: PAYMENT_METHODS.includes(e.paymentMethod) ? e.paymentMethod : PAYMENT.CASH,
    category: CATEGORIES.includes(e.category) ? e.category : CATEGORIES.at(-1),
    isNepalBill: Boolean(e.isNepalBill),
    irdCoupon: String(e.irdCoupon || '').replace(/\D/g, ''),
    updatedAt: new Date().toISOString(),
  };
  out.irdStatus = getIrdStatus(out);
  return out;
}

export function validateExpense(e) {
  const errors = {};
  if (!String(e.merchantName || '').trim()) errors.merchantName = 'Add the shop or seller name.';
  const amount = Number(e.totalAmount);
  if (e.totalAmount === '' || !Number.isFinite(amount) || amount <= 0) errors.totalAmount = 'Enter the bill total.';
  if (!parseYmd(e.billDateAD)) errors.billDateAD = 'Pick the bill date.';
  if (e.sellerPan && !/^\d{9}$/.test(String(e.sellerPan))) errors.sellerPan = 'PAN/VAT must be 9 digits.';
  if (e.vatAmount !== '' && e.vatAmount != null && Number(e.vatAmount) > amount) errors.vatAmount = 'VAT cannot be more than the total.';
  return errors;
}

const sum = (list, f) => list.reduce((s, e) => s + (Number(f(e)) || 0), 0);

export function summarize(expenses, { today = todayAD(), region = REGIONS.NEPAL } = {}) {
  const tBs = todayBS() || '';
  const inMonth = region === REGIONS.NEPAL
    ? (e) => (e.billDateBS || '').slice(0, 7) === tBs.slice(0, 7)
    : (e) => (e.billDateAD || '').slice(0, 7) === today.slice(0, 7);
  const statuses = expenses.map((e) => getIrdStatus(e));
  return {
    today: sum(expenses.filter((e) => e.billDateAD === today), (e) => e.totalAmount),
    month: sum(expenses.filter(inMonth), (e) => e.totalAmount),
    eligible: statuses.filter((s) => s !== IRD_STATUS.INELIGIBLE).length,
    pending: statuses.filter((s) => s === IRD_STATUS.NOT_APPLIED).length,
    applied: statuses.filter((s) => s === IRD_STATUS.APPLIED).length,
  };
}

export function reportTotals(list) {
  const cashLike = (e) => e.paymentMethod !== PAYMENT.DIGITAL;
  return {
    count: list.length,
    total: sum(list, (e) => e.totalAmount),
    vat: sum(list, (e) => e.vatAmount),
    cash: sum(list.filter(cashLike), (e) => e.totalAmount),
    digital: sum(list.filter((e) => !cashLike(e)), (e) => e.totalAmount),
    coupons: list.filter((e) => /^\d{12}$/.test(e.irdCoupon || '')).length,
  };
}

export function byCategory(list) {
  const map = new Map();
  for (const e of list) map.set(e.category, (map.get(e.category) || 0) + (Number(e.totalAmount) || 0));
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

/** Start/end AD dates for a named range. Week starts on Sunday, as in Nepal. */
export function rangeFor(preset, { from, to } = {}, today = todayAD()) {
  const p = parseYmd(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
      return { from: addDaysAD(today, -dow), to: addDaysAD(today, 6 - dow) };
    }
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: addDaysAD(`${p.m === 12 ? p.y + 1 : p.y}-${String(p.m === 12 ? 1 : p.m + 1).padStart(2, '0')}-01`, -1) };
    case 'custom':
      return { from: from || '', to: to || '' };
    default:
      return { from: '', to: '' };
  }
}

export function filterExpenses(list, f) {
  const { from, to } = rangeFor(f.range, { from: f.from, to: f.to });
  const q = (f.search || '').trim().toLowerCase();
  return list
    .filter((e) => (!from || e.billDateAD >= from) && (!to || e.billDateAD <= to))
    .filter((e) => !f.category || e.category === f.category)
    .filter((e) => !f.payment || e.paymentMethod === f.payment)
    .filter((e) => !f.status || getIrdStatus(e) === f.status)
    .filter((e) => !q || [e.merchantName, e.invoiceNumber, e.sellerPan, e.irdCoupon, e.notes].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => (b.billDateAD || '').localeCompare(a.billDateAD || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}
