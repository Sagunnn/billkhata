// Trip Khata: a trip's shared expenses (scanned bills and no-bill cash), paid by different
// people, split by what each person had, then settled in as few transfers as possible.
// Pure functions only, so all the money maths is unit-tested.
import { adToBs, todayAD } from './nepaliDate.js';
import { ALCOHOL, EXPLICIT_VEG, NON_VEG } from './splitter.js';

/* ---------- categories ---------- */

export const TRIP_CATEGORIES = ['veg', 'non-veg', 'soft', 'drink', 'shared'];
export const TRIP_CATEGORY_LABELS = { veg: 'Veg', 'non-veg': 'Non-veg', soft: 'Soft drink', drink: 'Alcohol', shared: 'Shared' };

// Trip things everyone shares: transport, rooms, tickets, water. Food words (non-veg, alcohol, "veg"
// in the name) are the same lists Split uses (splitter.js), so a dish is sorted the same in both.
const SHARED = /\b(taxi|cab|pathao|indrive|in ?drive|tootle|uber|bus|micro|jeep|flight|air ?ticket|boat|fuel|petrol|diesel|hotel|room|stay|lodge|homestay|resort|tickets?|entry|entrance|permit|toll|parking|water|mineral|ice|guide|porter|rent(al)?|bike rent)\b|ट्याक्सी|पेट्रोल|होटल|टिकट|पानी/i;
// Tea, coffee, juice, cola: everyone has them, drinker or not. "No drinks" means no alcohol.
const SOFT = /\b(coke|coca[- ]?cola|fanta|sprite|pepsi|mountain dew|red ?bull|soda|lassi|juice|coffee|latte|cappuccino|americano|espresso|mocha|tea|chiya|milk ?shake|shake|smoothie|mocktails?|virgin|lemonade|cold drinks?|soft drinks?|maaza|frooti)\b|चिया|कफी|जुस|लस्सी/i;
const NOT_ALCOHOL = /\b(mocktails?|virgin|non[- ]?alcoholic|0\.0|cold drinks?|soft drinks?)\b/i;

/** 'shared' (transport, rooms, tickets, water), 'non-veg', 'drink' (alcohol), 'soft' (tea, juice, cola), else 'veg'. */
export function classifyTripItem(name = '') {
  const s = String(name).toLowerCase();
  if (!s.trim()) return 'veg';
  if (SHARED.test(s)) return 'shared';
  if (NON_VEG.test(s) && !EXPLICIT_VEG.test(s)) return 'non-veg';
  if ((ALCOHOL.test(s) || /\bdrinks?\b/.test(s)) && !NOT_ALCOHOL.test(s)) return 'drink';
  if (SOFT.test(s)) return 'soft';
  return 'veg';
}

/**
 * The people on the trip right now: anyone marked "Not here" (left early, joining later) is left
 * out of new expenses until they're back. Everyone when nobody is marked here.
 */
export function hereMembers(members = []) {
  const here = members.filter((m) => !m.away);
  return here.length ? here : members;
}

/**
 * Who shares an item by default (only people who are here):
 * non-veg → non-vegetarians; drink (alcohol) → people who drink; veg, soft drinks and shared → everyone.
 * `vegOnly` puts a veg item on vegetarians only (e.g. a vegetarian's separate meal).
 */
export function getDefaultAssignedMembers(category, all = [], { vegOnly = false } = {}) {
  const members = hereMembers(all);
  if (category === 'non-veg') return members.filter((m) => !m.isVeg).map((m) => m.id);
  if (category === 'drink') return members.filter((m) => m.drinks !== false).map((m) => m.id);
  if (category === 'veg' && vegOnly) return members.filter((m) => m.isVeg).map((m) => m.id);
  return members.map((m) => m.id);
}

/* ---------- records ---------- */

let seq = 0;
export const tripId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function makeTripMember({ id, name = '', isVeg = false, drinks = true, paymentQrRaw = '', isMe = false, away = false, gender = '', look = 0 } = {}) {
  return {
    id: id || tripId('m'), name: String(name).trim(), isVeg: Boolean(isVeg), drinks: drinks !== false, paymentQrRaw: String(paymentQrRaw || ''), isMe: Boolean(isMe),
    ...(away ? { away: true } : {}), ...(gender === 'm' || gender === 'f' ? { gender } : {}), ...(Number(look) ? { look: Number(look) } : {}),
  };
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

const KEY = { veg: 'veg', 'non-veg': 'nonVeg', soft: 'soft', drink: 'drink', shared: 'shared' };
const empty = () => ({ veg: 0, nonVeg: 0, soft: 0, drink: 0, shared: 0, tax: 0, total: 0 });
const itemsOf = (r) => r.veg + r.nonVeg + r.soft + r.drink + r.shared;
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
    const subs = ids.map((id) => itemsOf(rows[id]));
    const base = subs.reduce((s, v) => s + v, 0);
    ids.forEach((id, i) => { rows[id].tax = base > 0 ? (extra * subs[i]) / base : extra / ids.length; });
  }
  const raw = ids.map((id) => itemsOf(rows[id]) + rows[id].tax);
  const exact = ids.length ? roundToTarget(raw, total) : [];
  ids.forEach((id, i) => {
    const r = rows[id];
    r.veg = r2(r.veg); r.nonVeg = r2(r.nonVeg); r.soft = r2(r.soft); r.drink = r2(r.drink); r.shared = r2(r.shared);
    r.total = exact[i];
    // Rounding pennies land in the tax line so the breakdown always adds up to the share.
    r.tax = r2(r.total - itemsOf(r));
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
      breakdown: { veg: r2(a.veg), nonVeg: r2(a.nonVeg), soft: r2(a.soft), drink: r2(a.drink), shared: r2(a.shared), tax: r2(a.tax) },
    };
  });
  return { members: rows, transfers: simplifyDebts(rows), total: r2(tripTotal), warnings };
}

export const transferKey = (t) => `${t.fromMemberId}>${t.toMemberId}`;

/* ---------- ongoing trips ---------- */

/**
 * A trip is 'active' (on now: Home offers Scan and Quick expense for it), 'ended' (no more
 * expenses expected; settle up) or 'settled'. Older trips without a status are active.
 */
export const tripStatus = (t) => (['active', 'ended', 'settled'].includes(t?.status) ? t.status : 'active');
export const ongoingTrips = (trips = []) => trips.filter((t) => tripStatus(t) === 'active')
  .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));

/** "Day 3" of a trip: from its first expense (or its start) to today. */
export function tripDay(trip, today = todayAD()) {
  const first = [trip.createdAt?.slice(0, 10), ...(trip.entries || []).map((e) => e.dateAD)].filter(Boolean).sort()[0] || today;
  return Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 864e5) + 1);
}

/** A bill from the ledger (or just scanned) as a trip expense you paid, its items read from it. */
export function entryFromExpense(exp, trip) {
  const members = trip.members;
  const me = members.find((m) => m.isMe) || members[0];
  const items = (exp.lineItems || []).filter((it) => Number(it.amount) > 0).map((it) => makeTripItem({ name: it.name, amount: it.amount }, members));
  return makeEntry({
    title: exp.merchantName, paidByMemberId: me?.id, dateAD: exp.billDateAD || todayAD(), totalAmount: exp.totalAmount, hasBill: true, items,
    sellerPan: exp.sellerPan, invoiceNumber: exp.invoiceNumber, vatAmount: exp.vatAmount, paymentMethod: exp.paymentMethod, linkedExpenseId: exp.id,
  }, members);
}

/**
 * Cash with no bill, added in a few taps: what, how much, who paid, and who it's for (everyone
 * when nobody is picked). Veg / non-veg / drink is guessed from the name.
 */
export function quickTripEntry({ title, amount, paidByMemberId, forIds, dateAD = todayAD() }, members) {
  const name = String(title || '').trim() || 'Expense';
  const category = classifyTripItem(name);
  const ids = forIds?.length ? forIds : hereMembers(members).map((m) => m.id);
  return makeEntry({
    title: name, paidByMemberId, dateAD, totalAmount: amount, hasBill: false,
    items: [makeTripItem({ name, amount, category, assignedMemberIds: ids }, members)],
  }, members);
}
