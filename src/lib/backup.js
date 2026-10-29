// Portable JSON backup and restore.
import { CATEGORIES, PAYMENT_METHODS } from './constants.js';
import { finalizeExpense } from './expense.js';
import { EMPTY_PROFILE, validateProfile } from './profile.js';
import { todayAD } from './nepaliDate.js';

export const BACKUP_VERSION = 1;

export function buildBackup(profile, expenses) {
  return {
    app: 'BillKhata',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userProfile: profile,
    expenses,
  };
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

  return { ok: true, errors, skipped, expenses, profile, exportedAt: obj.exportedAt };
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
