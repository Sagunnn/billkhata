// Merchant memory: shops seen in earlier bills, so a known PAN or name fills in the rest.
import { CATEGORIES } from './constants.js';
import { toAsciiDigits } from './nepaliDate.js';

const panOf = (v) => toAsciiDigits(v || '').replace(/\D/g, '');

/** "Annapurna  Kirana Pasal, Pvt. Ltd." -> "annapurna kirana pasal pvt ltd" */
export function normalizeMerchantName(name = '') {
  return String(name).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * One entry per shop, newest bill first: { merchantName, sellerPan, category, count }.
 * Keyed by PAN when there is one, otherwise by name.
 */
export function merchantDirectory(bills = []) {
  const byKey = new Map();
  const sorted = [...bills].sort((a, b) => (b.billDateAD || '').localeCompare(a.billDateAD || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  for (const b of sorted) {
    const name = String(b.merchantName || '').trim();
    if (!name) continue;
    const pan = panOf(b.sellerPan);
    const key = pan.length === 9 ? `pan:${pan}` : `name:${normalizeMerchantName(name)}`;
    const hit = byKey.get(key);
    if (hit) hit.count += 1;
    else byKey.set(key, { merchantName: name, sellerPan: pan.length === 9 ? pan : '', category: b.category, count: 1 });
  }
  return [...byKey.values()];
}

/**
 * The remembered shop for a draft bill: by seller PAN first, then by name.
 * Ignores the draft itself so editing a bill doesn't match itself.
 */
export function lookupMerchant({ id, sellerPan, merchantName } = {}, bills = []) {
  const others = bills.filter((b) => b.id !== id);
  const pan = panOf(sellerPan);
  const dir = merchantDirectory(others);
  if (pan.length === 9) {
    const hit = dir.find((m) => m.sellerPan === pan);
    if (hit) return { ...hit, matchedBy: 'pan' };
  }
  const name = normalizeMerchantName(merchantName);
  if (name.length >= 3) {
    const hit = dir.find((m) => normalizeMerchantName(m.merchantName) === name);
    if (hit) return { ...hit, matchedBy: 'name' };
  }
  return null;
}

/**
 * Fills a freshly scanned bill from memory: missing name or PAN, and the category the user
 * picked last time for this shop (a better guess than the keyword-based one).
 */
export function applyMerchantMemory(fields, bills) {
  const hit = lookupMerchant(fields, bills);
  if (!hit) return { fields, hit: null };
  const next = { ...fields };
  if (!String(next.merchantName || '').trim()) next.merchantName = hit.merchantName;
  if (!panOf(next.sellerPan) && hit.sellerPan) next.sellerPan = hit.sellerPan;
  if (CATEGORIES.includes(hit.category)) next.category = hit.category;
  return { fields: next, hit };
}
