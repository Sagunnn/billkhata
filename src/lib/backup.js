// Portable JSON backup and restore.
import { CATEGORIES, PAYMENT_METHODS } from './constants.js';
import { finalizeExpense } from './expense.js';
import { EMPTY_PROFILE, validateProfile } from './profile.js';
import { todayAD } from './nepaliDate.js';
import { getIrdStatus } from './ird.js';
import { toCsv } from './format.js';
import { cleanMoney } from './money.js';

export const BACKUP_VERSION = 1;

export function buildBackup(profile, expenses, trips = [], bank = {}) {
  return {
    app: 'BillKhata',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userProfile: profile,
    expenses,
    trips,
    statements: bank.statements || [],
    payments: bank.payments || [],
    reconOverrides: bank.reconOverrides || { links: [], unlinks: [] },
    money: bank.money || null,
  };
}

/** Bank statements and payment screenshots are optional in a backup (older files have none). */
function validateBank(obj, skipped) {
  const statements = [];
  const payments = [];
  if (Array.isArray(obj.statements)) {
    obj.statements.forEach((st, i) => {
      if (!st || typeof st.id !== 'string' || !Array.isArray(st.rows)) return skipped.push(`Statement #${i + 1}: missing id or rows.`);
      statements.push({ ...st, rows: st.rows.filter((r) => r && DATE.test(r.date || '') && typeof r.key === 'string') });
    });
  }
  if (Array.isArray(obj.payments)) {
    obj.payments.forEach((p, i) => {
      if (!p || typeof p.id !== 'string') return skipped.push(`Payment screenshot #${i + 1}: missing id.`);
      if (p.image != null && !(typeof p.image === 'string' && p.image.startsWith('data:image/'))) return skipped.push(`Payment screenshot #${i + 1}: image is not embedded.`);
      payments.push({ ...p, amount: Number.isFinite(Number(p.amount)) && p.amount !== null ? Number(p.amount) : null });
    });
  }
  const ro = obj.reconOverrides && typeof obj.reconOverrides === 'object' ? obj.reconOverrides : null;
  const reconOverrides = ro ? {
    links: Array.isArray(ro.links) ? ro.links.filter((l) => Array.isArray(l) && l.every((x) => typeof x === 'string')) : [],
    unlinks: Array.isArray(ro.unlinks) ? ro.unlinks.filter((x) => typeof x === 'string') : [],
  } : null;
  // Cash & bank amounts (optional; older backups have none).
  const money = obj.money && typeof obj.money === 'object' ? cleanMoney(obj.money) : null;
  return { statements, payments, reconOverrides, money };
}

/** Trips are optional in a backup (older files have none). Bad ones are skipped and reported. */
function validateTrips(list, skipped) {
  if (list == null) return [];
  if (!Array.isArray(list)) { skipped.push('“trips” is not a list, so no trips were read.'); return []; }
  const seen = new Set();
  const out = [];
  list.forEach((t, i) => {
    const label = `Trip #${i + 1}${t?.name ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return skipped.push(`${label}: missing id.`);
    if (seen.has(t.id)) return skipped.push(`${label}: duplicate id.`);
    if (!Array.isArray(t.members) || !Array.isArray(t.entries)) return skipped.push(`${label}: missing members or expenses.`);
    if (t.entries.some((e) => !e || !Number.isFinite(Number(e.totalAmount)))) return skipped.push(`${label}: an expense has no valid amount.`);
    seen.add(t.id);
    out.push({ ...t, status: t.status === 'settled' ? 'settled' : 'active', paidTransfers: t.paidTransfers || {} });
  });
  return out;
}

/** Bills as a spreadsheet (no photos). For Excel or Google Sheets; restoring needs the JSON backup. */
export function expensesCsv(expenses = []) {
  const head = ['Bill code', 'Date (AD)', 'Date (BS)', 'Shop', 'Seller PAN', 'Invoice no.', 'Category', 'Paid by', 'Total', 'VAT', 'IRD draw', 'IRD coupon', 'Notes'];
  const rows = [...expenses]
    .sort((a, b) => String(a.billDateAD || '').localeCompare(String(b.billDateAD || '')) || String(a.billCode || '').localeCompare(String(b.billCode || '')))
    .map((e) => [
      e.billCode || '',
      e.billDateAD || '',
      e.billDateBS || '',
      e.merchantName || '',
      e.sellerPan || '',
      e.invoiceNumber || '',
      e.category || '',
      e.paymentMethod || '',
      Number(e.totalAmount || 0).toFixed(2),
      e.vatAmount ? Number(e.vatAmount).toFixed(2) : '',
      e.isNepalBill ? getIrdStatus(e) : 'Not a Nepal bill',
      e.irdCoupon || '',
      e.notes || '',
    ]);
  return toCsv(head, rows);
}

export const csvFilename = () => `billkhata_bills_${todayAD().replace(/-/g, '_')}.csv`;

/**
 * How fresh the last backup is, for the "saved on this device" indicator.
 * `stale` when there are bills of your own and no backup in the last 14 days.
 */
export function backupStatus(lastAt, ownBills, now = Date.now()) {
  if (!ownBills) return { stale: false, text: lastAt ? 'Backed up' : 'Nothing to back up yet' };
  const t = Date.parse(lastAt || '');
  if (!Number.isFinite(t)) return { stale: true, text: 'Not backed up yet' };
  const days = Math.max(0, Math.floor((now - t) / 864e5));
  const text = days === 0 ? 'Backed up today' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;
  return { stale: days >= 14, text, days };
}

export const backupFilename = () => `billkhata_backup_${todayAD().replace(/-/g, '_')}.json`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a parsed backup file. Bad records are skipped and reported, not imported.
 * @returns {{ok: boolean, errors: string[], skipped: string[], expenses: object[], profile: object|null}}
 */
export function validateBackup(obj) {
  const errors = [];
  const skipped = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['This is not a BillKhata backup file.'], skipped, expenses: [], profile: null };
  }
  if (typeof obj.version !== 'number') errors.push('Missing "version".');
  else if (obj.version > BACKUP_VERSION) errors.push(`Backup version ${obj.version} is newer than this app supports (${BACKUP_VERSION}).`);
  if (!Array.isArray(obj.expenses)) errors.push('Missing the "expenses" list.');
  if (errors.length) return { ok: false, errors, skipped, expenses: [], profile: null };

  const seen = new Set();
  const expenses = [];
  obj.expenses.forEach((e, i) => {
    const label = `Bill #${i + 1}${e?.merchantName ? ` (${e.merchantName})` : ''}`;
    if (!e || typeof e !== 'object') return skipped.push(`${label}: not an object.`);
    if (typeof e.id !== 'string' || !e.id) return skipped.push(`${label}: missing id.`);
    if (seen.has(e.id)) return skipped.push(`${label}: duplicate id.`);
    if (!Number.isFinite(Number(e.totalAmount))) return skipped.push(`${label}: amount is not a number.`);
    if (e.billDateAD && !DATE.test(e.billDateAD)) return skipped.push(`${label}: bad date "${e.billDateAD}".`);
    if (e.receiptImage != null && !(typeof e.receiptImage === 'string' && e.receiptImage.startsWith('data:image/'))) {
      return skipped.push(`${label}: receipt image is not an embedded image.`);
    }
    seen.add(e.id);
    expenses.push(finalizeExpense({
      ...e,
      paymentMethod: PAYMENT_METHODS.includes(e.paymentMethod) ? e.paymentMethod : PAYMENT_METHODS[0],
      category: CATEGORIES.includes(e.category) ? e.category : CATEGORIES.at(-1),
      updatedAt: e.updatedAt,
    }));
  });

  let profile = null;
  if (obj.userProfile && typeof obj.userProfile === 'object') {
    const p = { ...EMPTY_PROFILE, ...obj.userProfile };
    const pErr = validateProfile(p);
    if (Object.keys(pErr).length) skipped.push(`Profile has issues (${Object.values(pErr).join(' ')}) — you can fix it in Settings.`);
    profile = p;
  }

  const trips = validateTrips(obj.trips, skipped);
  const bank = validateBank(obj, skipped);
  return { ok: true, errors, skipped, expenses, trips, ...bank, profile, exportedAt: obj.exportedAt };
}

export async function readBackupFile(file) {
  if (!file) throw new Error('No file selected.');
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') throw new Error('Choose a .json backup file.');
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}
