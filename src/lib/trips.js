// Trip Khata: a trip's shared expenses (scanned bills and no-bill cash), paid by different
// people, split by what each person had, then settled in as few transfers as possible.
// Pure functions only, so all the money maths is unit-tested.
import { adToBs, todayAD } from './nepaliDate.js';

/* ---------- categories ---------- */

export const TRIP_CATEGORIES = ['veg', 'non-veg', 'drink', 'shared'];
export const TRIP_CATEGORY_LABELS = { veg: 'Veg', 'non-veg': 'Non-veg', drink: 'Drink', shared: 'Shared' };

// Word-bounded so "drumstick" isn't rum, "ginger" isn't gin, "eggplant" isn't egg, "buffet" isn't buff.
const SHARED = /\b(taxi|cab|pathao|indrive|in ?drive|tootle|uber|bus|micro|jeep|flight|air ?ticket|boat|fuel|petrol|diesel|hotel|room|stay|lodge|homestay|resort|tickets?|entry|entrance|permit|toll|parking|water|mineral|ice|guide|porter|rent(al)?|bike rent)\b|ट्याक्सी|पेट्रोल|होटल|टिकट|पानी/i;
const NON_VEG = /\b(chicken|chkn|buff|buffalo|mutton|khasi|goat|lamb|pork|bacon|ham|salami|sausages?|beef|fish|prawns?|shrimps?|crab|tuna|duck|eggs?|omelett?e|anda|sekuwa|choila|chhoila|kachila|sukuti|pangra|wings?|drumsticks?|keema|kima|meat|kukhura(?:ko)?|bandel|nonveg|non[- ]veg)\b|कुखुरा|खसी|बफ|माछा|अण्डा|सेकुवा|छोइला|सुकुटी|पाङ्ग्रा|मासु/i;
const DRINK = /\b(beers?|tuborg|gorkha|barasinghe|arna|carlsberg|budweiser|heineken|nepal ice|whiske?y|vodka|rum|khukuri|khukri|gin|wines?|aila|chhyang|tongba|raksi|cocktails?|mocktails?|shots?|coke|coca[- ]?cola|fanta|sprite|pepsi|mountain dew|red ?bull|soda|lassi|juice|coffee|latte|cappuccino|americano|tea|chiya|milk ?shake|shake|smoothie|drinks?)\b|बियर|रक्सी|चिया|कफी|जुस/i;
const EXPLICIT_VEG = /\b(veg(?:etable|gie|an|etarian)?|paneer|mushroom|tofu|eggless|soya)\b/i;

/** 'shared' (transport, rooms, tickets, water), 'non-veg', 'drink', else 'veg'. */
export function classifyTripItem(name = '') {
  const s = String(name).toLowerCase();
  if (!s.trim()) return 'veg';
  if (SHARED.test(s)) return 'shared';
  if (NON_VEG.test(s) && !EXPLICIT_VEG.test(s)) return 'non-veg';
  if (DRINK.test(s)) return 'drink';
  return 'veg';
}

/**
 * Who shares an item by default:
 * non-veg → non-vegetarians; drink → people who take drinks; veg and shared → everyone.
 * `vegOnly` puts a veg item on vegetarians only (e.g. a vegetarian's separate meal).
 */
export function getDefaultAssignedMembers(category, members = [], { vegOnly = false } = {}) {
  if (category === 'non-veg') return members.filter((m) => !m.isVeg).map((m) => m.id);
  if (category === 'drink') return members.filter((m) => m.drinks !== false).map((m) => m.id);
  if (category === 'veg' && vegOnly) return members.filter((m) => m.isVeg).map((m) => m.id);
  return members.map((m) => m.id);
}

/* ---------- records ---------- */

let seq = 0;
export const tripId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function makeTripMember({ id, name = '', isVeg = false, drinks = true, paymentQrRaw = '', isMe = false } = {}) {
  return { id: id || tripId('m'), name: String(name).trim(), isVeg: Boolean(isVeg), drinks: drinks !== false, paymentQrRaw: String(paymentQrRaw || ''), isMe: Boolean(isMe) };
}

export function makeTrip({ name = 'New trip', profile } = {}) {
  const me = makeTripMember({ id: 'me', name: (profile?.fullName || '').trim() || 'Me', isMe: true });
  return { id: tripId('trip-'), name: String(name).trim() || 'New trip', createdAt: new Date().toISOString(), status: 'active', members: [me], entries: [], paidTransfers: {} };
}

export function makeTripItem({ id, name = '', amount = 0, category, assignedMemberIds, vegOnly = false } = {}, members = []) {
  const cat = TRIP_CATEGORIES.includes(category) ? category : classifyTripItem(name);
  return {
    id: id || tripId('it'),
    name: String(name).trim(),
    amount: Math.round((Number(amount) || 0) * 100) / 100,
    category: cat,
    vegOnly: cat === 'veg' && Boolean(vegOnly),
    assignedMemberIds: Array.isArray(assignedMemberIds) ? [...assignedMemberIds] : getDefaultAssignedMembers(cat, members, { vegOnly }),
  };
}

/** A trip expense. A no-bill expense without items becomes one item for the whole amount. */
export function makeEntry({ id, title = '', paidByMemberId, dateAD = todayAD(), totalAmount = 0, hasBill = false, items, linkedExpenseId = '', ...rest } = {}, members = []) {
  const total = Math.round((Number(totalAmount) || 0) * 100) / 100;
  const list = Array.isArray(items) && items.length
    ? items.map((it) => makeTripItem(it, members))
    : [makeTripItem({ name: title, amount: total }, members)];
  return {
    ...rest,
    id: id || tripId('e'),
    title: String(title).trim(),
    paidByMemberId: paidByMemberId || members[0]?.id || 'me',
    dateAD,
    dateBS: adToBs(dateAD) || '',
    totalAmount: total,
    hasBill: Boolean(hasBill),
    linkedExpenseId: linkedExpenseId || '',
    items: list,
  };
}

/* ---------- shares ---------- */

const KEY = { veg: 'veg', 'non-veg': 'nonVeg', drink: 'drink', shared: 'shared' };
const empty = () => ({ veg: 0, nonVeg: 0, drink: 0, shared: 0, tax: 0, total: 0 });
const r2 = (n) => Math.round(n * 100) / 100;

/** Rounds floats to paisa so they add up exactly to `target` (largest remainder). */
function roundToTarget(values, target) {
  const floors = values.map((v) => Math.floor(v * 100 + 1e-6));
  let left = Math.round(target * 100) - floors.reduce((s, v) => s + v, 0);
  const order = values.map((v, i) => [v * 100 - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) floors[order[k][1]] += 1;
  for (let k = 0; left < 0 && order.length; k = (k + 1) % order.length, left++) floors[order[k][1]] -= 1;
  return floors.map((v) => v / 100);
}

/**
 * Each member's share of one entry, broken down by category, adding up exactly to the entry total.
 * - An item is split equally among its ticked members (nobody ticked → everyone, flagged).
 * - Total minus items (VAT, service charge, discount) goes in proportion to each member's items.
 */
export function entryShares(entry, members) {
  const ids = members.map((m) => m.id);
  const rows = Object.fromEntries(ids.map((id) => [id, empty()]));
  const warnings = [];
  const items = entry.items?.length ? entry.items : [{ id: 'all', name: entry.title, amount: entry.totalAmount, category: 'shared', assignedMemberIds: ids }];
  let itemsSum = 0;
  for (const it of items) {
    const amount = Number(it.amount) || 0;
    itemsSum += amount;
    let who = (it.assignedMemberIds || []).filter((id) => rows[id]);
    if (!who.length) {
      who = ids;
      if (amount) warnings.push(`Nobody is ticked for “${it.name || 'an item'}”, so it’s shared by everyone.`);
    }
    const key = KEY[it.category] || 'shared';
    for (const id of who) rows[id][key] += amount / who.length;
  }
  const total = Number(entry.totalAmount) || 0;
  const extra = total - itemsSum;
  if (Math.abs(extra) >= 0.005 && ids.length) {
    const subs = ids.map((id) => rows[id].veg + rows[id].nonVeg + rows[id].drink + rows[id].shared);
    const base = subs.reduce((s, v) => s + v, 0);
    ids.forEach((id, i) => { rows[id].tax = base > 0 ? (extra * subs[i]) / base : extra / ids.length; });
  }
  const raw = ids.map((id) => { const r = rows[id]; return r.veg + r.nonVeg + r.drink + r.shared + r.tax; });
  const exact = ids.length ? roundToTarget(raw, total) : [];
  ids.forEach((id, i) => {
    const r = rows[id];
    r.veg = r2(r.veg); r.nonVeg = r2(r.nonVeg); r.drink = r2(r.drink); r.shared = r2(r.shared);
    r.total = exact[i];
    // Rounding pennies land in the tax line so the breakdown always adds up to the share.
    r.tax = r2(r.total - r.veg - r.nonVeg - r.drink - r.shared);
  });
  return { shares: rows, itemsSum: r2(itemsSum), extra: r2(extra), warnings };
}

/* ---------- settlement ---------- */

/**
 * Fewest-hops settlement: largest debtor pays largest creditor, repeat.
 * Balances within ±Rs. 0.50 count as settled. Gives at most N − 1 transfers.
 * @param {{memberId: string, netBalance: number}[]} balances
 */
export function simplifyDebts(balances) {
  const paisa = balances.map((b) => ({ id: b.memberId, v: Math.round(b.netBalance * 100) }));
  const creditors = paisa.filter((b) => b.v > 50).sort((a, b) => b.v - a.v);
  const debtors = paisa.filter((b) => b.v < -50).map((b) => ({ ...b, v: -b.v })).sort((a, b) => b.v - a.v);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].v, creditors[j].v);
    if (amt > 0) transfers.push({ fromMemberId: debtors[i].id, toMemberId: creditors[j].id, amount: amt / 100 });
    debtors[i].v -= amt;
    creditors[j].v -= amt;
    if (debtors[i].v <= 50) i++;
    if (creditors[j].v <= 50) j++;
  }
  return transfers;
}

/** Paid, consumed (by category), net balance per member, and who pays whom. */
export function calculateTripSettlement(trip) {
  const members = trip.members || [];
  const acc = Object.fromEntries(members.map((m) => [m.id, { ...empty(), paid: 0 }]));
  const warnings = [];
  let tripTotal = 0;
  for (const entry of trip.entries || []) {
    tripTotal += Number(entry.totalAmount) || 0;
    if (acc[entry.paidByMemberId]) acc[entry.paidByMemberId].paid += Number(entry.totalAmount) || 0;
    else warnings.push(`“${entry.title || 'An expense'}” was paid by someone no longer on the trip.`);
    const { shares, warnings: w } = entryShares(entry, members);
    warnings.push(...w.map((x) => `${entry.title || 'Expense'}: ${x}`));
    for (const [id, s] of Object.entries(shares)) for (const k of Object.keys(s)) acc[id][k] += s[k];
  }
  const rows = members.map((m) => {
    const a = acc[m.id];
    const totalConsumed = r2(a.total);
    const totalPaid = r2(a.paid);
    return {
      memberId: m.id,
      name: m.name,
      isMe: Boolean(m.isMe),
      totalPaid,
      totalConsumed,
      netBalance: r2(totalPaid - totalConsumed),
      breakdown: { veg: r2(a.veg), nonVeg: r2(a.nonVeg), drink: r2(a.drink), shared: r2(a.shared), tax: r2(a.tax) },
    };
  });
  return { members: rows, transfers: simplifyDebts(rows), total: r2(tripTotal), warnings };
}

export const transferKey = (t) => `${t.fromMemberId}>${t.toMemberId}`;
