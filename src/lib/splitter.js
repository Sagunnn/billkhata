// Split Khata: split an itemised bill between friends, with Nepali menu-aware auto-ticks.
// Pure functions only (no DOM), so the maths and the share-link format are unit-tested.
import { toAsciiDigits } from './nepaliDate.js';

/* ---------- 1. Veg / non-veg / alcohol classifier ---------- */

export const TAGS = ['veg', 'non-veg', 'alcohol', 'shared'];
export const TAG_LABELS = { veg: 'Veg', 'non-veg': 'Non-veg', alcohol: 'Alcohol', shared: 'Shared' };

// Word-bounded so "drumstick" isn't rum, "ginger" isn't gin, "eggplant" isn't egg and "buffet" isn't buff.
const NON_VEG = /\b(chicken|chkn|buff|buffalo|mutton|khasi|goat|lamb|pork|bacon|ham|salami|sausages?|hot ?dogs?|beef|fish|prawns?|shrimps?|crab|tuna|salmon|seafood|duck|turkey|eggs?|omelett?e|anda|sekuwa|choila|chhoila|kachila|sukuti|wings?|drumsticks?|keema|kima|meat|boneless|kukhura(?:ko)?|bandel|wild ?boar|nonveg|non[- ]veg)\b|कुखुरा|खसी|बंगुर|सुँगुर|बफ|माछा|अण्डा|अन्डा|सेकुवा|छोइला|सुकुटी|मासु|कचिला|भुटन/i;
const ALCOHOL = /\b(beers?|tuborg|gorkha|barasinghe|arna|carlsberg|budweiser|heineken|nepal ice|everest beer|kingfisher|whiske?y|vodka|rum|khukuri|khukri|gin|wines?|aila|chhyang|chyang|tongba|raksi|cocktails?|shots?|tequila|brandy|scotch|old durbar|8848|signature|black ?label|red ?label|mojito|margarita|pints?|pitcher|hard ?cider)\b|बियर|रक्सी|ऐला|छ्याङ|तोङ्बा|वाइन/i;
const SHARED = /\b(mineral ?water|water bottle|drinking water|ice ?cubes?|ice bucket|hookah|hukka|table charge|cover charge|packing|packaging|take ?away charge|parcel charge|delivery charge|cigarettes?|tissue)\b/i;
// "Veg" in the name wins over an ambiguous dish word, e.g. "veg sausage" or "egg-less cake" stays veg.
const EXPLICIT_VEG = /\b(veg(?:etable|gie|an|etarian)?|paneer|mushroom|tofu|eggless|egg-?free|soya)\b/i;

/** Tags a menu line as 'veg', 'non-veg', 'alcohol' or 'shared'. Unknown food defaults to 'veg'. */
export function classifyFoodItem(name = '') {
  const s = String(name).toLowerCase();
  if (!s.trim()) return 'veg';
  if (SHARED.test(s)) return 'shared';
  if (ALCOHOL.test(s) && !/\b(mocktail|virgin|non[- ]?alcoholic|0\.0)\b/i.test(s)) return 'alcohol';
  if (NON_VEG.test(s) && !EXPLICIT_VEG.test(s)) return 'non-veg';
  return 'veg';
}

/* ---------- line items from OCR text ---------- */

const SKIP_LINE = /(sub\s*-?\s*total|grand|\btotal\b|net\s*(amount|payable)|\bvat\b|\btax(able)?\b|service|\bs\.?\s?c\b|discount|\bdisc\b|round|\bcash\b|change|tender|\bpaid\b|balance|bill\s*no|invoice|\binv\b|\bdate\b|\bpan\b|phone|\btel\b|\bmob|table\s*no|waiter|cashier|steward|guest|thank|visit|particulars|description|\bqty\b|\brate\b|\bs\.?\s?n\.?\b|जम्मा|कुल|भ्याट|मिति|बिल\s*नं)/i;
const NUM = /^[\d,]+(?:\.\d{1,2})?$/;
const toNum = (t) => Number(String(t).replace(/,/g, ''));

let itemSeq = 0;
export const newItemId = () => `i${Date.now().toString(36)}${(itemSeq++).toString(36)}`;

export function makeItem({ name = '', qty = 1, price = 0, amount, tag, id } = {}) {
  const q = Number(qty) > 0 ? Number(qty) : 1;
  const a = amount != null && amount !== '' ? Number(amount) : q * (Number(price) || 0);
  const p = Number(price) > 0 ? Number(price) : a / q;
  return {
    id: id || newItemId(),
    name: String(name).trim(),
    qty: q,
    price: Math.round(p * 100) / 100,
    amount: Math.round((Number.isFinite(a) ? a : 0) * 100) / 100,
    tag: TAGS.includes(tag) ? tag : classifyFoodItem(name),
  };
}

/**
 * Pulls item rows out of receipt OCR text: "Chicken Momo 2 x 250 500", "Tuborg 2 450 900",
 * "Veg Chowmein 180.00", "2 Buff Sekuwa 640". Totals, VAT and header lines are skipped.
 */
export function parseLineItemsFromText(rawText = '') {
  const items = [];
  const lines = toAsciiDigits(rawText).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/(\d)\s*[xX×@*]\s*(\d)/g, '$1 $2').replace(/\s+/g, ' ').trim();
    if (!line || SKIP_LINE.test(line)) continue;
    const tokens = line.split(' ');
    const nums = [];
    while (tokens.length && NUM.test(tokens.at(-1))) nums.unshift(toNum(tokens.pop()));
    if (!nums.length) continue;
    let name = tokens.join(' ').replace(/[|:.\-–—]+$/, '').trim();
    let qty = 1;
    const lead = name.match(/^(\d{1,2})\s*[xX]?\s+(.*)$/);
    if (lead) { qty = Number(lead[1]); name = lead[2]; }
    name = name.replace(/^\d+[.)]\s*/, ''); // serial numbers like "1." or "2)"
    if ((name.match(/[A-Za-zऀ-ॿ]/g) || []).length < 2) continue;

    const amount = nums.at(-1);
    let price = amount / qty;
    if (nums.length >= 3) {
      const [q, p] = nums.slice(-3, -1);
      if (Math.abs(q * p - amount) < 0.6) { qty = q; price = p; } // qty, rate, amount
      else if (Number.isInteger(q) && q > 0 && q <= 50) { qty = q; price = amount / q; }
    } else if (nums.length === 2) {
      const [a] = nums;
      if (Number.isInteger(a) && a > 0 && a <= 50 && Math.abs((amount / a) - Math.round(amount / a)) < 1e-9 && amount / a >= 5) { qty = a; price = amount / a; }
      else if (a > 0 && Math.abs(amount / a - Math.round(amount / a)) < 0.01) { price = a; qty = Math.round(amount / a); }
    }
    if (!(amount > 0) || amount > 1e6) continue;
    items.push(makeItem({ name, qty, price, amount }));
  }
  return items;
}

/* ---------- 2. members and auto-ticks ---------- */

export function makeMember({ name = '', diet = 'non-veg', alcohol = false, id, isPayer = false, out = false } = {}) {
  return { id: id || `m${Date.now().toString(36)}${(itemSeq++).toString(36)}`, name: String(name).trim(), diet: diet === 'veg' ? 'veg' : 'non-veg', alcohol: Boolean(alcohol), isPayer, out: Boolean(out) };
}

/** People taking part. A member with `out: true` stays listed but pays nothing (e.g. the payer treating friends). */
export const activeMembers = (split) => (split.members || []).filter((m) => !m.out);

/** The tick a member gets for an item before any manual change. */
export function autoWeight(tag, member) {
  if (tag === 'non-veg') return member.diet === 'non-veg' ? 1 : 0;
  if (tag === 'alcohol') return member.alcohol ? 1 : 0;
  return 1; // veg and shared items go to everyone
}

/** Manual override if there is one, else the auto-tick. In "units" mode the weight is a count. */
export function weightOf(split, item, member) {
  if (member.out) return 0;
  const o = split.overrides?.[item.id]?.[member.id];
  return o != null ? Math.max(0, Number(o) || 0) : autoWeight(item.tag, member);
}

/** Changing a member's diet or drinks re-applies the auto-ticks for that member. */
export function clearMemberOverrides(split, memberId) {
  const overrides = {};
  for (const [itemId, row] of Object.entries(split.overrides || {})) {
    const { [memberId]: _drop, ...rest } = row;
    if (Object.keys(rest).length) overrides[itemId] = rest;
  }
  return { ...split, overrides };
}

/** Changing an item's tag re-applies the auto-ticks for that item. */
export function clearItemOverrides(split, itemId) {
  const { [itemId]: _drop, ...overrides } = split.overrides || {};
  return { ...split, overrides };
}

/* ---------- 3. shares: items, then VAT / service charge / discount ---------- */

const paisa = (n) => Math.round(Number(n) * 100);

/** Rounds floats to paisa so they add up exactly to `target` (largest remainder). */
function roundToTarget(values, target) {
  const floors = values.map((v) => Math.floor(v * 100 + 1e-6));
  let left = paisa(target) - floors.reduce((s, v) => s + v, 0);
  const order = values.map((v, i) => [v * 100 - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) floors[order[k][1]] += 1;
  for (let k = 0; left < 0 && order.length; k = (k + 1) % order.length, left++) floors[order[k][1]] -= 1;
  return floors.map((v) => v / 100);
}

/**
 * Works out every member's share.
 * - Each item is divided among its ticked members by weight (equal ticks, or 1x/2x units).
 * - The gap between the bill total and the items (VAT, service charge, discount) is spread
 *   proportionally to each member's items (share = subtotal × total / items subtotal), or equally.
 * - With mode 'equal', or no items at all, the total is split equally between the people in the split.
 * - People marked `out` get nothing and aren't counted.
 */
export function computeSplit(split) {
  const members = split.members || [];
  const equalMode = split.mode === 'equal';
  const items = (equalMode ? [] : split.items || []).map((it) => ({ ...it, amount: Number(it.amount) || 0 }));
  const itemsSubtotal = items.reduce((s, it) => s + it.amount, 0);
  const total = Number(split.total) > 0 ? Number(split.total) : itemsSubtotal;
  const extra = total - itemsSubtotal;
  const rows = members.map((m) => ({ id: m.id, name: m.name, isPayer: Boolean(m.isPayer), out: Boolean(m.out), subtotal: 0, extra: 0, share: 0, lines: [] }));
  const active = rows.filter((r) => !r.out);
  let unassignedItems = 0;

  for (const it of items) {
    const weights = members.map((m) => weightOf(split, it, m));
    const sumW = weights.reduce((s, w) => s + w, 0);
    if (!sumW) { unassignedItems += it.amount; continue; }
    weights.forEach((w, i) => {
      if (!w) return;
      const part = (it.amount * w) / sumW;
      rows[i].subtotal += part;
      rows[i].lines.push({ itemId: it.id, name: it.name, tag: it.tag, amount: part, weight: w, of: sumW });
    });
  }

  let unassigned = 0;
  if (!items.length || itemsSubtotal <= 0) {
    active.forEach((r) => { r.extra = total / active.length; });
    if (!active.length) unassigned = total;
  } else if (split.taxMode === 'equal') {
    const payers = active.filter((r) => r.subtotal > 0);
    const among = payers.length ? payers : active;
    // Unassigned items keep their own share of the extra so the rest of the table isn't charged for it.
    const extraForAssigned = extra * ((itemsSubtotal - unassignedItems) / itemsSubtotal);
    among.forEach((r) => { r.extra = among.length ? extraForAssigned / among.length : 0; });
    unassigned = unassignedItems * (total / itemsSubtotal);
  } else {
    const ratio = total / itemsSubtotal;
    rows.forEach((r) => { r.extra = r.subtotal * ratio - r.subtotal; });
    unassigned = unassignedItems * ratio;
  }

  const raw = rows.map((r) => r.subtotal + r.extra);
  const target = Math.round((total - unassigned) * 100) / 100;
  const shares = rows.length ? roundToTarget(raw, target) : [];
  rows.forEach((r, i) => {
    r.share = shares[i];
    r.subtotal = Math.round(r.subtotal * 100) / 100;
    r.extra = Math.round((r.share - r.subtotal) * 100) / 100;
    r.lines.forEach((l) => { l.amount = Math.round(l.amount * 100) / 100; });
  });

  const payer = rows.find((r) => r.isPayer);
  const myShare = payer ? payer.share : 0;
  return {
    total,
    itemsSubtotal: Math.round(itemsSubtotal * 100) / 100,
    extra: Math.round(extra * 100) / 100,
    extraPct: itemsSubtotal > 0 ? extra / itemsSubtotal : 0,
    unassigned: Math.round(unassigned * 100) / 100,
    members: rows,
    myShare,
    recoverable: Math.round((rows.reduce((s, r) => s + r.share, 0) - myShare) * 100) / 100,
  };
}

/** Money still owed to the payer: shares of members not marked as paid. */
export function outstanding(split, result = computeSplit(split)) {
  return Math.round(result.members.filter((r) => !r.isPayer && !r.out && !split.paid?.[r.id]).reduce((s, r) => s + r.share, 0) * 100) / 100;
}

/** A fresh split for a saved bill. The payer (the BillKhata user) is the first member. */
export function newSplitForExpense(expense, profile) {
  const me = makeMember({ name: (profile?.fullName || '').split(' ')[0] || 'Me', diet: 'non-veg', alcohol: false, isPayer: true, id: 'me' });
  return {
    v: 1,
    title: expense.merchantName || 'Bill',
    dateAD: expense.billDateAD || '',
    dateBS: expense.billDateBS || '',
    total: Number(expense.totalAmount) || 0,
    items: (expense.lineItems || []).map((it) => makeItem(it)),
    members: [me],
    overrides: {},
    taxMode: 'proportional',
    mode: (expense.lineItems || []).length ? 'items' : 'equal',
    paid: {},
  };
}

/* ---------- 4. share link: #/split/<base64url> ---------- */

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/** Only what a friend needs to see: no photo, no PAN, no IDs of other bills. */
export function sharePayload(split, { payerName = '', qrText = '', qrLabel = '' } = {}) {
  return {
    v: 1,
    t: split.title,
    d: split.dateAD,
    b: split.dateBS,
    T: Number(split.total) || 0,
    x: split.taxMode === 'equal' ? 'e' : 'p',
    M: split.mode === 'equal' ? 'e' : 'i',
    i: (split.items || []).map((it) => [it.id, it.name, it.qty, it.price, it.amount, it.tag, it.units ? 1 : 0]),
    m: (split.members || []).map((mb) => [mb.id, mb.name, mb.diet === 'veg' ? 1 : 0, mb.alcohol ? 1 : 0, mb.isPayer ? 1 : 0, mb.out ? 1 : 0]),
    o: split.overrides || {},
    p: { n: payerName, q: qrText, l: qrLabel },
  };
}

/** Rebuilds a split from a share payload (inverse of sharePayload). */
export function splitFromPayload(p) {
  if (!p || p.v !== 1 || !Array.isArray(p.i) || !Array.isArray(p.m)) throw new Error('This split link is damaged or from a newer BillKhata.');
  return {
    split: {
      v: 1,
      title: String(p.t || 'Bill'),
      dateAD: p.d || '',
      dateBS: p.b || '',
      total: Number(p.T) || 0,
      taxMode: p.x === 'e' ? 'equal' : 'proportional',
      mode: p.M === 'e' ? 'equal' : 'items',
      items: p.i.map(([id, name, qty, price, amount, tag, units]) => ({ ...makeItem({ id, name, qty, price, amount, tag }), units: Boolean(units) })),
      members: p.m.map(([id, name, veg, alc, isPayer, out]) => makeMember({ id, name, diet: veg ? 'veg' : 'non-veg', alcohol: alc, isPayer: Boolean(isPayer), out: Boolean(out) })),
      overrides: p.o && typeof p.o === 'object' ? p.o : {},
      paid: {},
    },
    payer: { name: String(p.p?.n || ''), qrText: String(p.p?.q || ''), qrLabel: String(p.p?.l || '') },
  };
}

/** Deflate + base64url, so a 15-item bill fits comfortably in a chat message. */
export async function encodeSplit(payload) {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return bytesToB64url(await pipe(json, new CompressionStream('deflate-raw')));
}

export async function decodeSplit(token) {
  const bytes = await pipe(b64urlToBytes(token), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ---------- payment QR text ---------- */

/** eSewa personal QR payload as described for BillKhata: {"eSewa_id":"98…","name":"…"}. */
export const esewaQrText = (id, name) => JSON.stringify({ eSewa_id: String(id || '').trim(), name: String(name || '').trim() });
