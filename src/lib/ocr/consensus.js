// Combines several OCR reads of the same bill into one answer.
// A crumpled or curved bill reads differently every time: one read gets the total, another the
// Coke row, a third the bill number. Instead of trusting one read, every field is voted on, items
// are matched up across reads, and the set of items that adds up to the total is kept.
// Pure functions; unit-tested in tests/consensus.test.js.
import { adToBs } from '../nepaliDate.js';
import { levenshtein, normalizeInvoiceOCRCanonical } from '../dedupe.js';
import { makeItem, nearMisread, parseLineItemsFromText } from '../splitter.js';
import { parseReceiptText, totalCandidates } from './parse.js';

const CHARGE_FACTORS = [1, 1.1, 1.13, 1.1 * 1.13]; // plain, +10% service, +13% VAT, both

/** True when the items add up to the total, directly or with service charge and/or VAT on top. */
export function sumMatches(sum, total) {
  const t = Number(total);
  if (!(t > 0) || !(sum > 0)) return false;
  return CHARGE_FACTORS.some((f) => Math.abs(sum * f - t) <= Math.max(0.6, t * 0.005));
}

/* ---------- item names ---------- */

const WORDLIKE = /^(?:[A-Z][a-z]{2,}|[a-z]{3,}|[A-Z]{3,}|[\p{Script=Devanagari}]{2,})$/u;

/**
 * How much a name looks like real words (0-1): "Chinese Soup Momo" 1, "Chicken Keena Noodles1"
 * ~0.7, "STE NaSE 0:00" or "Gr eee" ~0.
 */
export function nameQuality(name = '') {
  const tokens = String(name).split(/\s+/).map((t) => t.replace(/[\d.,:;©|!]+$/, '')).filter(Boolean);
  if (!tokens.length) return 0;
  const good = tokens.filter((t) => WORDLIKE.test(t) && /[aeiouAEIOU\p{Script=Devanagari}]/u.test(t)
    && !/(.)\1\1/i.test(t) && !/^[A-Z][a-z]+[A-Z]/.test(t));
  // Short all-caps words ("SLE", "ONE", "STE") are mostly misread specks: half credit.
  const letters = good.reduce((n, t) => n + (/^[A-Z]{1,3}$/.test(t) ? t.length / 2 : t.length), 0);
  return Math.min(1, letters / Math.max(3, tokens.join('').length));
}

const key = (name) => String(name).toLowerCase().replace(/[^\p{L}]+/gu, '');
const similar = (a, b) => {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  return levenshtein(x, y, 4) <= Math.max(1, Math.floor(Math.min(x.length, y.length) * 0.3));
};
const sameAmount = (a, b) => Math.abs(a - b) <= 0.1 || (Math.round(a) === Math.round(b) && Math.abs(a - b) < 0.5);

/**
 * Item rows from every read, grouped: one group per row of the bill. A group holds at most one item
 * per read, all with the same amount; names that are clearly different stay apart.
 */
export function clusterItems(itemLists) {
  const clusters = [];
  itemLists.forEach((items, read) => {
    items.forEach((it, idx) => {
      const pos = items.length > 1 ? idx / (items.length - 1) : 0.5;
      let best = null;
      let bestScore = -1;
      for (const c of clusters) {
        if (c.reads.has(read)) continue;
        // A misread amount ("189" for "180") still joins the row when the name or place matches.
        const misread = !sameAmount(c.amount, it.amount) && (nearMisread(c.amount, it.amount) || nearMisread(it.amount, c.amount))
          && (similar(it.name, c.name) || Math.abs(c.pos - pos) <= 0.15);
        if (!sameAmount(c.amount, it.amount) && !misread) continue;
        // Same amount: same row unless both names are readable, different, and in different places
        // on the bill ("Coke" and "Commons" at the same spot are one row read two ways).
        const readable = nameQuality(it.name) > 0.5 && nameQuality(c.name) > 0.5;
        if (readable && !similar(it.name, c.name) && Math.abs(c.pos - pos) > 0.2) continue;
        const score = (similar(it.name, c.name) ? 2 : 0) + (1 - Math.abs(c.pos - pos)) - (misread ? 1 : 0);
        if (score > bestScore) { best = c; bestScore = score; }
      }
      if (!best) {
        best = { members: [], reads: new Set(), amount: it.amount, name: it.name, pos };
        clusters.push(best);
      }
      best.members.push(it);
      best.reads.add(read);
      best.pos = (best.pos * (best.members.length - 1) + pos) / best.members.length;
      // The amount most reads agree on; on a tie, one that qty × rate produces, then the rounder one
      // (200.09 is a misread 200.00, 189 a misread 180).
      const counts = new Map();
      for (const m of best.members) counts.set(m.amount, (counts.get(m.amount) || 0) + 1);
      const fromRate = (a) => best.members.some((m) => m.qty > 1 && Math.abs(m.qty * m.price - a) < 0.01) ? 1 : 0;
      const round = (a) => (a % 10 === 0 ? 2 : Number.isInteger(a) ? 1 : 0);
      best.amount = [...counts].sort((x, y) => (y[1] - x[1]) || (fromRate(y[0]) - fromRate(x[0])) || (round(y[0]) - round(x[0])) || (x[0] - y[0]))[0][0];
      // The name most reads back (weighted by how word-like each reading is), then the most word-like.
      const backing = (n) => best.members.filter((m) => similar(m.name, n)).reduce((sum, m) => sum + nameQuality(m.name), 0);
      best.name = [...best.members].sort((x, y) => (backing(y.name) - backing(x.name)) || (nameQuality(y.name) - nameQuality(x.name)))[0].name;
    });
  });
  return clusters.map((c) => ({ ...c, support: c.reads.size, quality: nameQuality(c.name) }));
}

/** Two groups with similar names but different amounts are the same row read two ways. */
const conflicts = (a, b) => similar(a.name, b.name) && a.quality > 0.5 && b.quality > 0.5 && ![...a.reads].some((r) => b.reads.has(r));

/**
 * The best set of rows that adds up to `total`: most reads backing it, then the most readable
 * names. Returns null when no set adds up.
 */
function bestSubset(clusters, total) {
  const pool = [...clusters]
    .sort((a, b) => b.support - a.support || b.quality - a.quality).slice(0, 16);
  let best = null;
  const n = pool.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    let score = 0;
    const picked = [];
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      sum += pool[i].amount;
      // Rows many reads saw, with readable names, count most; every extra row costs a little, so
      // two weak rows can't beat one strong row that adds up the same.
      score += pool[i].support * (0.5 + 0.5 * pool[i].quality) - 0.6;
      picked.push(pool[i]);
    }
    if (!sumMatches(sum, total)) continue;
    if (picked.some((a, i) => picked.slice(i + 1).some((b) => conflicts(a, b)))) continue;
    if (!best || score > best.score) best = { picked, score };
  }
  return best;
}

/** The value most reads agree on (weighted); `same` decides when two values agree. */
function vote(values, same = (a, b) => a === b) {
  const groups = [];
  for (const { value, weight = 1 } of values) {
    if (value === '' || value == null) continue;
    const g = groups.find((x) => same(x.value, value));
    if (g) { g.weight += weight; g.all.push(value); } else groups.push({ value, weight, all: [value] });
  }
  return groups.sort((a, b) => b.weight - a.weight);
}

/** The spelling closest to all the others (OCR errors scatter; the true text sits in the middle). */
const medoid = (all) => [...all].sort((a, b) => all.reduce((s, x) => s + levenshtein(a, x, 6), 0) - all.reduce((s, x) => s + levenshtein(b, x, 6), 0))[0];

const commonestRank = (list, qty) => list.filter((m) => m.qty === qty).length;

/** The spelling that occurs most often in a group; on a tie, the longest. */
const commonest = (all) => {
  const counts = new Map();
  for (const v of all) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || String(b[0]).length - String(a[0]).length)[0][0];
};

/**
 * One set of bill fields from several OCR texts of the same photo.
 * @returns fields like parseReceiptText, plus `lineItems` and `agreement` (how sure: 0-1)
 */
export function combineReads(input = []) {
  // Each read: a text, or { text, kind: 'words' } for one rebuilt from word positions. Those are
  // best at item rows; for the header fields (shop, bill number) they count less.
  const reads = input.map((r) => (typeof r === 'string' ? { text: r } : r)).filter((r) => r?.text?.trim());
  if (!reads.length) return { lineItems: [], agreement: 0, confident: false };
  const parsed = reads.map(({ text, kind }) => ({
    fields: parseReceiptText(text),
    items: parseLineItemsFromText(text),
    totals: totalCandidates(text),
    weight: kind === 'words' ? 0.4 : 1,
  }));

  // Totals: every read's printed totals and amount in words vote. A total a read only guessed
  // (sum of the items it found, largest number) barely counts.
  const totalVotes = vote(parsed.flatMap((p) => [
    ...p.totals,
    ...(p.fields.totalAmount ? [{ value: p.fields.totalAmount, weight: p.fields.totalGuessed ? 0.2 : 0.5 }] : []),
  ]), (a, b) => Math.abs(a - b) < 0.6);

  const clusters = clusterItems(parsed.map((p) => p.items));
  // A total smaller than a row several reads agree on is a partial read ("hundred and thirty").
  const surest = Math.max(0, ...clusters.filter((c) => c.support >= 2 && c.quality >= 0.5).map((c) => c.amount));
  for (const t of totalVotes) if (t.value < surest) t.weight *= 0.4;
  totalVotes.sort((a, b) => b.weight - a.weight);
  // Try the leading totals; keep the total + rows that best explain all the reads.
  let choice = null;
  for (const t of totalVotes.slice(0, 4).filter((x) => x.weight >= totalVotes[0].weight * 0.4)) {
    const subset = bestSubset(clusters, t.value);
    if (!subset) continue;
    const score = t.weight * 2 + subset.score;
    if (!choice || score > choice.score) choice = { total: t.value, rows: subset.picked, score };
  }
  let totalAmount = totalVotes[0]?.value ?? null;
  let rows;
  if (choice) {
    totalAmount = choice.total;
    rows = choice.rows;
  } else {
    // Nothing adds up: keep rows most reads saw, and drop the weaker of two readings of one row.
    const need = Math.max(1, Math.ceil(reads.length / 2));
    rows = clusters.filter((c) => c.support >= need && (!totalAmount || c.amount <= totalAmount + 0.5));
    rows = rows.filter((c) => !rows.some((o) => o !== c && conflicts(c, o) && (o.support > c.support || (o.support === c.support && o.quality > c.quality))));
  }
  // A misread decimal ("200.09" for "200.00"): when the rows miss the total by under a rupee and
  // only one row has odd paisa, that row takes the difference.
  if (choice) {
    const sum = rows.reduce((s, c) => s + c.amount, 0);
    const diff = Math.round((totalAmount - sum) * 100) / 100;
    const odd = rows.filter((c) => !Number.isInteger(c.amount * 2));
    if (diff && Math.abs(diff) < 1 && odd.length === 1) {
      rows = rows.map((c) => (c === odd[0] ? { ...c, amount: Math.round((c.amount + diff) * 100) / 100 } : c));
    }
  }
  const lineItems = rows
    .sort((a, b) => a.pos - b.pos)
    .map((c) => {
      // qty × rate from a reading where they multiply out to the amount; most common one wins.
      const exact = c.members.filter((m) => Math.abs(m.qty * m.price - c.amount) < 0.6);
      // Readings of the chosen name first; with none of those multiplying out, qty 1 (amount = rate).
      const own = exact.filter((m) => similar(m.name, c.name));
      const qty = own.length ? [...own].sort((a, b) => commonestRank(own, b.qty) - commonestRank(own, a.qty))[0].qty : 1;
      const name = c.quality >= 0.5 ? c.name.replace(/[\d.,:;©|!]+$/, '').trim() : 'Item (name unclear)';
      return makeItem({ name, qty, price: c.amount / qty, amount: c.amount });
    });

  const pick = (k, same, choose = commonest) => {
    const v = vote(parsed.map((p) => ({ value: p.fields[k], weight: p.weight })), same)[0];
    return v ? choose(v.all) : '';
  };
  // Dates: a misread year ("2073" for "2083") lands years away, so recent dates weigh more.
  const now = Date.now();
  const dateVotes = vote(parsed.map((p) => {
    const t = Date.parse(`${p.fields.billDateAD}T00:00:00Z`);
    const years = Number.isFinite(t) ? Math.abs(now - t) / 3.15e10 : 99;
    return { value: p.fields.billDateAD, weight: t > now + 2 * 86400000 ? 0.05 : 1 / (1 + years * 2) };
  }));
  const billDateAD = dateVotes[0]?.value || '';
  const invoiceNumber = pick('invoiceNumber', (a, b) => normalizeInvoiceOCRCanonical(a) === normalizeInvoiceOCRCanonical(b)
    || levenshtein(normalizeInvoiceOCRCanonical(a), normalizeInvoiceOCRCanonical(b), 2) <= 2, medoid);
  const fields = {
    merchantName: pick('merchantName', similar),
    sellerPan: pick('sellerPan'),
    invoiceNumber,
    paymentMethod: pick('paymentMethod') || undefined,
    billDateAD,
    billDateBS: billDateAD ? adToBs(billDateAD) || pick('billDateBS') : pick('billDateBS'),
    totalAmount,
    totalGuessed: !totalVotes.length || totalVotes[0].weight < 1 || undefined,
    vatAmount: pick('vatAmount', (a, b) => Math.abs(a - b) < 0.6) || null,
    category: pick('category'),
    isEstimate: parsed.filter((p) => p.fields.isEstimate).length * 2 >= reads.length || undefined,
    looksNepali: parsed.some((p) => p.fields.looksNepali),
    lineItems,
  };
  // Sure enough to stop reading: rows add up to a total that two reads printed, and every row was
  // seen by at least two reads.
  const readsWithTotal = parsed.filter((p) => p.totals.some((c) => Math.abs(c.value - totalAmount) < 0.6)).length;
  const confident = Boolean(choice) && readsWithTotal >= 2 && rows.every((c) => c.support >= 2);
  const agreement = (choice ? 0.5 : 0) + 0.5 * (readsWithTotal / reads.length);
  return { ...fields, agreement, confident };
}
