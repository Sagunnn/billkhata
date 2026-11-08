// Portable JSON backup and restore.
import { CATEGORIES, PAYMENT_METHODS } from './constants.js';
import { finalizeExpense } from './expense.js';
import { EMPTY_PROFILE, validateProfile } from './profile.js';
import { todayAD } from './nepaliDate.js';
import { getIrdStatus } from './ird.js';
import { toCsv } from './format.js';
import { cleanMoney } from './money.js';

export const BACKUP_VERSION = 1;

export function buildBackup(profile, expenses, trips = [], bank = {}, extras = null, { photos = true } = {}) {
  // Without photos: a small file (bills, trips and money in full, just no pictures).
  const noPhoto = ({ receiptImage: _r, ...x }) => x;
  return {
    app: 'BillKhata',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...(photos ? {} : { photos: false }),
    userProfile: profile,
    expenses: photos ? expenses : expenses.map(noPhoto),
    trips: photos ? trips : trips.map((t) => ({ ...t, entries: (t.entries || []).map(noPhoto) })),
    statements: bank.statements || [],
    payments: photos ? bank.payments || [] : (bank.payments || []).map(({ image: _i, ...p }) => p),
    reconOverrides: bank.reconOverrides || { links: [], unlinks: [] },
    money: bank.money || null,
    ...(extras ? { extras } : {}),
  };
}

const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
const SETTINGS_FIELDS = ['ocrEngine', 'nepaliScript', 'theme', 'showLuckyDraw', 'visionProvider', 'models'];

/** Settings, payment QR, friends, groups… (older backups have none). Bad parts are left out. */
function validateExtras(x) {
  if (!plain(x)) return null;
  const list = (v, ok) => (Array.isArray(v) ? v.filter(ok) : undefined);
  const named = (f) => plain(f) && typeof f.name === 'string' && f.name.trim();
  const settings = plain(x.settings) ? Object.fromEntries(SETTINGS_FIELDS.filter((k) => k in x.settings).map((k) => [k, x.settings[k]])) : undefined;
  const qr = plain(x.paymentQr) && ['esewa', 'image'].includes(x.paymentQr.mode)
    && (x.paymentQr.mode !== 'image' || String(x.paymentQr.image || '').startsWith('data:image/')) ? x.paymentQr : undefined;
  const deletedTrips = plain(x.deletedTrips)
    ? Object.fromEntries(Object.entries(x.deletedTrips).filter(([k, v]) => k && typeof v === 'string')) : undefined;
  return {
    settings,
    paymentQr: qr,
    friends: list(x.friends, named),
    groups: list(x.groups, (g) => named(g) && Array.isArray(g.members)),
    receivedSplits: list(x.receivedSplits, plain),
    deletedTrips,
    myAvatar: plain(x.myAvatar) ? { gender: ['m', 'f'].includes(x.myAvatar.gender) ? x.myAvatar.gender : '', look: Number(x.myAvatar.look) || 0 } : undefined,
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

/** Your own bills added or changed after the last backup (none backed up yet: all of them). */
export function changedSince(expenses, lastAt) {
  const own = expenses.filter((e) => !e.isSample);
  return lastAt ? own.filter((e) => (e.updatedAt || e.createdAt || '') > lastAt).length : own.length;
}

/**
 * How fresh the last backup is, for the "saved on this device" indicator and the Home reminder.
 * `changed`: bills added or changed since (changedSince). `stale` (an amber dot) when there are
 * bills of your own and no backup in 14 days, or 10 or more not in one. `nudge`: worth a reminder
 * on Home (5 or more bills never backed up, 10 or more since the last, or 14 days with new ones).
 */
export function backupStatus(lastAt, ownBills, now = Date.now(), changed) {
  if (!ownBills) return { stale: false, text: lastAt ? 'Backed up' : 'Nothing to back up yet' };
  const t = Date.parse(lastAt || '');
  const plural = (n) => `${n} bill${n === 1 ? '' : 's'}`;
  if (!Number.isFinite(t)) return { stale: true, text: 'Not backed up yet', nudge: ownBills >= 5, changed: ownBills };
  const days = Math.max(0, Math.floor((now - t) / 864e5));
  const when = days === 0 ? 'Backed up today' : days === 1 ? 'Backed up yesterday' : `Backed up ${days} days ago`;
  if (changed == null) return { stale: days >= 14, text: when, days };
  const text = changed ? `${when} · ${plural(changed)} since` : when;
  return { stale: changed >= 10 || (days >= 14 && changed > 0), nudge: changed >= 10 || (days >= 14 && changed > 0), text, days, changed };
}

/** Roughly how big a backup is, without building it (photos are most of it). */
export function backupSize(expenses = [], trips = [], payments = [], { photos = true } = {}) {
  const img = (s) => (photos && typeof s === 'string' ? s.length : 0);
  return expenses.reduce((n, e) => n + 1200 + img(e.receiptImage), 0)
    + trips.reduce((n, t) => n + 600 + (t.entries || []).reduce((m, x) => m + 800 + img(x.receiptImage), 0), 0)
    + payments.reduce((n, p) => n + 600 + img(p.image), 0);
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
  return { ok: true, errors, skipped, expenses, trips, ...bank, extras: validateExtras(obj.extras), profile, exportedAt: obj.exportedAt, photos: obj.photos !== false };
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
