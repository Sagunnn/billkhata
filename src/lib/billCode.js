// Voucher codes: short, human-writable references like "KT1-03" (Kartik, 1st fortnight, bill 3)
// or "NW-02" (2nd bill of the "Nagarkot Weekend" trip). Assigned once and stored on the bill, so
// a code written on the paper bill stays valid; it only changes if the bill moves to another
// fortnight or trip.
import { parseYmd } from './nepaliDate.js';

// Two letters per Nepali month (Asar and Asoj both start "As", so Asoj is "AW" for Ashwin).
export const BS_MONTH_CODES = ['BA', 'JE', 'AS', 'SA', 'BH', 'AW', 'KT', 'MG', 'PS', 'MA', 'FA', 'CH'];

/** "Nagarkot Weekend" → "NW", "Pokhara" → "PO", "" → "TR". */
export function tripInitials(name = '') {
  const words = String(name).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`;
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2);
  return 'TR';
}

/** The group a bill's code belongs to: trip initials, or BS month + fortnight ("KT1", "KT2"). */
export function billCodePrefix(e, trips = []) {
  const tripId = e.tripId || e.tripShareOf;
  if (tripId) return tripInitials(trips.find((t) => t.id === tripId)?.name || 'Trip');
  const bs = parseYmd(e.billDateBS);
  if (bs && bs.m >= 1 && bs.m <= 12) return `${BS_MONTH_CODES[bs.m - 1]}${bs.d <= 15 ? 1 : 2}`;
  return 'XX';
}

const CODE_RE = /^([A-Z0-9]{2,3})-(\d{2,})$/;
const seqOf = (code) => Number(CODE_RE.exec(code || '')?.[2] || 0);

/**
 * The code this bill should have: its current one if still in the right group and unique,
 * else the next free number in its group.
 */
export function assignBillCode(e, all = [], trips = []) {
  const prefix = billCodePrefix(e, trips);
  const others = all.filter((o) => o.id !== e.id);
  const taken = new Set(others.map((o) => o.billCode).filter(Boolean));
  if (e.billCode && e.billCode.startsWith(`${prefix}-`) && !taken.has(e.billCode)) return e.billCode;
  const max = others.filter((o) => o.billCode?.startsWith(`${prefix}-`)).reduce((m, o) => Math.max(m, seqOf(o.billCode)), 0);
  let n = max + 1;
  while (taken.has(`${prefix}-${String(n).padStart(2, '0')}`)) n++;
  return `${prefix}-${String(n).padStart(2, '0')}`;
}

/**
 * Gives every bill a valid, unique code, oldest first (by bill date, then when it was added).
 * Returns only the bills whose code changed, ready to save.
 */
export function ensureBillCodes(expenses = [], trips = []) {
  const order = [...expenses].sort((a, b) => (a.billDateAD || '').localeCompare(b.billDateAD || '')
    || (a.createdAt || '').localeCompare(b.createdAt || '') || String(a.id).localeCompare(String(b.id)));
  const working = order.map((e) => ({ ...e }));
  const changed = [];
  // Keep valid codes first so older bills never lose theirs to a newer duplicate.
  const seen = new Set();
  for (const e of working) {
    const ok = e.billCode && e.billCode.startsWith(`${billCodePrefix(e, trips)}-`) && !seen.has(e.billCode);
    if (ok) seen.add(e.billCode);
    else e.billCode = '';
  }
  for (const e of working) {
    if (e.billCode) continue;
    e.billCode = assignBillCode(e, working, trips);
    changed.push(e);
  }
  return changed;
}
