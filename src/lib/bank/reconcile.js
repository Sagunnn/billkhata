// Matches bank statement rows, payment screenshots and saved bills into one table.
//   bank row ↔ screenshot: same amount, same direction, a date within the bank's posting delay,
//                          and best of all the screenshot's transaction ID in the bank narration.
//   either   ↔ saved bill: same total (or rounded off), same or next day, similar shop name.
// Each item is used once; the strongest pairs are taken first. You can unlink a wrong pair or
// link two items by hand, and that choice wins over the scores. Pure; tests/reconcile.test.js.
import { toAsciiDigits } from '../nepaliDate.js';

const DAY = 864e5;
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const minutesOf = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const compact = (s) => toAsciiDigits(String(s || '')).toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, '');
const STOP = new Set(['pvt', 'ltd', 'limited', 'the', 'and', 'store', 'shop', 'restaurant', 'cafe', 'payment', 'pay', 'fonepay', 'esewa', 'khalti', 'qr', 'transfer', 'trf', 'merchant', 'nepal', 'kathmandu', 'bank', 'mobile', 'supermarket', 'mart', 'traders', 'trading', 'enterprises', 'suppliers', 'center', 'centre', 'hotel', 'kitchen', 'house']);

/** How much of shop name `a` appears in text `b`, 0..1. */
export function nameScore(a, b) {
  const words = toAsciiDigits(String(a || '')).toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length || !b) return 0;
  const hay = compact(b);
  if (compact(a).length >= 5 && hay.includes(compact(a))) return 1;
  // Narrations cut names short: a 5-letter start counts, and so does a start the narration ends on ("KOTHEYS PIM").
  const cutAtEnd = (w) => { for (let k = w.length - 1; k >= 3; k--) if (hay.endsWith(w.slice(0, k))) return true; return false; };
  const hit = words.filter((w) => hay.includes(w) || (w.length >= 6 && hay.includes(w.slice(0, 5))) || cutAtEnd(w));
  return hit.length / words.length;
}

const amountOf = (row) => row.debit ?? row.credit ?? 0;
const directionOf = (row) => (row.credit != null && row.debit == null ? 'in' : 'out');

export const nodeId = {
  bank: (r) => `b:${r.key}`,
  payment: (p) => `p:${p.id}`,
  expense: (e) => `e:${e.id}`,
};
const pairKey = (a, b) => [a, b].sort().join('|');

/** Score for a bank row and a screenshot, or 0 when they can't be the same payment. */
export function scoreBankPayment(row, p) {
  if (!(p.amount > 0) || p.status === 'failed' || !p.dateAD || !row.date) return 0;
  if (Math.abs(amountOf(row) - p.amount) > 0.005 || directionOf(row) !== (p.direction || 'out')) return 0;
  const d = dayDiff(row.date, p.dateAD); // the bank posts on the same day or a few days later
  if (d < -1 || d > 4) return 0;
  const reasons = ['same amount'];
  let s = 50;
  const narration = compact(`${row.description} ${(row.refs || []).join(' ')} ${row.ref || ''}`);
  const refHit = (p.refs || []).some((r) => {
    const c = compact(r);
    return c.length >= 6 && (narration.includes(c) || (c.length >= 10 && narration.includes(c.slice(-8))));
  });
  if (refHit) { s += 60; reasons.push('transaction ID in the narration'); }
  if (d === 0) { s += 20; reasons.push('same day'); } else if (d === 1) { s += 10; reasons.push('bank posted next day'); } else if (d === -1) s += 5;
  const tb = minutesOf(row.time);
  const tp = minutesOf(p.time);
  if (d === 0 && tb != null && tp != null && Math.abs(tb - tp) <= 20) { s += 15; reasons.push('same time'); }
  const n = nameScore(p.merchant, row.description);
  if (n > 0) { s += Math.round(20 * n); reasons.push('name in the narration'); }
  return { score: s, reasons, strong: refHit || (d === 0 && tb != null && tp != null && Math.abs(tb - tp) <= 5) };
}

/** Score for a saved bill and a screenshot or bank row (whichever the group has). */
export function scoreExpense(e, { date, amount, name, maxLag = 1 }) {
  const total = Number(e.totalAmount);
  if (!(total > 0) || !amount || !date || !e.billDateAD) return 0;
  const diff = Math.abs(total - amount);
  let s;
  const reasons = [];
  if (diff < 0.005) { s = 40; reasons.push('same amount'); } else if (diff <= 1 && amount >= 100) { s = 25; reasons.push('amount rounded off'); } else return 0;
  const d = dayDiff(date, e.billDateAD);
  if (d < -1 || d > maxLag) return 0;
  if (d === 0) { s += 20; reasons.push('same day'); } else s += 8;
  const n = Math.max(nameScore(e.merchantName, name), nameScore(name, e.merchantName));
  if (n > 0) { s += Math.round(25 * n); reasons.push('same shop'); }
  if (e.paymentMethod && /digital|qr|card/i.test(e.paymentMethod)) s += 10;
  return { score: s, reasons };
}

/**
 * @param {{ bankRows: object[], payments: object[], expenses: object[], overrides?: { links?: string[][], unlinks?: string[] } }} input
 *   bankRows need a stable `key` (bankRowKey). overrides: links are lists of node ids that belong
 *   together; unlinks are pair keys that must not be matched.
 * @returns {{ entries: object[], stats: object }}
 */
export function reconcile({ bankRows = [], payments = [], expenses = [], overrides = {} }) {
  const blocked = new Set(overrides.unlinks || []);
  const byId = new Map();
  for (const r of bankRows) byId.set(nodeId.bank(r), { type: 'bank', item: r });
  for (const p of payments) byId.set(nodeId.payment(p), { type: 'payment', item: p });
  for (const e of expenses) byId.set(nodeId.expense(e), { type: 'expense', item: e });
  const used = new Set();
  const groups = [];

  // 1. Your own links first.
  for (const link of overrides.links || []) {
    const parts = link.map((id) => byId.get(id) && !used.has(id) ? [id, byId.get(id)] : null).filter(Boolean);
    if (parts.length < 2) continue;
    const g = { manual: true, reasons: ['linked by you'] };
    for (const [id, { type, item }] of parts) {
      if (g[type]) continue;
      g[type] = item;
      used.add(id);
    }
    groups.push(g);
  }

  // 2. Bank rows ↔ screenshots, strongest first.
  const pairs = [];
  for (const r of bankRows) {
    const rid = nodeId.bank(r);
    if (used.has(rid)) continue;
    for (const p of payments) {
      const pid = nodeId.payment(p);
      if (used.has(pid) || blocked.has(pairKey(rid, pid))) continue;
      const sc = scoreBankPayment(r, p);
      if (sc) pairs.push({ rid, pid, r, p, ...sc });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  for (const pr of pairs) {
    if (used.has(pr.rid) || used.has(pr.pid)) continue;
    // Two rows that fit equally well (two रु 500 payments the same day) make the pick a guess.
    const rivals = pairs.filter((x) => x !== pr && (x.rid === pr.rid || x.pid === pr.pid) && !used.has(x.rid) && !used.has(x.pid) && pr.score - x.score < 10);
    used.add(pr.rid);
    used.add(pr.pid);
    groups.push({ bank: pr.r, payment: pr.p, score: pr.score, reasons: pr.reasons, unsure: !pr.strong && rivals.length > 0 });
  }
  for (const r of bankRows) if (!used.has(nodeId.bank(r))) { used.add(nodeId.bank(r)); groups.push({ bank: r }); }
  for (const p of payments) if (!used.has(nodeId.payment(p))) { used.add(nodeId.payment(p)); groups.push({ payment: p }); }

  // 3. Saved bills onto those groups.
  const ePairs = [];
  groups.forEach((g, gi) => {
    if (g.expense) return;
    if (g.bank && directionOf(g.bank) === 'in') return; // money in isn't a bill you paid
    if (g.payment && g.payment.direction === 'in') return;
    const ids = [g.bank && nodeId.bank(g.bank), g.payment && nodeId.payment(g.payment)].filter(Boolean);
    for (const e of expenses) {
      const eid = nodeId.expense(e);
      if (used.has(eid) || ids.some((id) => blocked.has(pairKey(id, eid)))) continue;
      const fromPayment = g.payment && scoreExpense(e, { date: g.payment.dateAD, amount: g.payment.amount, name: g.payment.merchant, maxLag: 1 });
      const fromBank = g.bank && scoreExpense(e, { date: g.bank.date, amount: amountOf(g.bank), name: g.bank.description, maxLag: 4 });
      const best = [fromPayment, fromBank].filter(Boolean).sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 40) ePairs.push({ gi, e, eid, ...best });
    }
  });
  ePairs.sort((a, b) => b.score - a.score);
  const filled = new Set();
  for (const ep of ePairs) {
    if (filled.has(ep.gi) || used.has(ep.eid)) continue;
    filled.add(ep.gi);
    used.add(ep.eid);
    const g = groups[ep.gi];
    g.expense = ep.e;
    g.reasons = [...(g.reasons || []), ...ep.reasons.map((x) => `bill: ${x}`)];
  }
  for (const e of expenses) if (!used.has(nodeId.expense(e))) groups.push({ expense: e });

  const entries = groups.map((g) => {
    const date = g.payment?.dateAD || g.bank?.date || g.expense?.billDateAD || '';
    const time = g.payment?.time || g.bank?.time || '';
    const direction = g.bank ? directionOf(g.bank) : g.payment ? (g.payment.direction || 'out') : 'out';
    const amount = g.bank ? amountOf(g.bank) : g.payment ? g.payment.amount : Number(g.expense.totalAmount) || 0;
    const kinds = ['bank', 'payment', 'expense'].filter((k) => g[k]);
    return {
      id: kinds.map((k) => nodeId[k](g[k])).join('+'),
      nodes: kinds.map((k) => nodeId[k](g[k])),
      bank: g.bank || null,
      payment: g.payment || null,
      expense: g.expense || null,
      date,
      time,
      postedDate: g.bank?.date || '',
      amount,
      direction,
      name: g.expense?.merchantName || g.payment?.merchant || g.bank?.description || '',
      reasons: g.reasons || [],
      manual: Boolean(g.manual),
      unsure: Boolean(g.unsure),
      status: kinds.join('+'),
    };
  });
  // By date; on the same day, bank rows keep their statement order and the rest go by time.
  entries.sort((a, b) => a.date.localeCompare(b.date)
    || (a.bank && b.bank && a.bank.statementId === b.bank.statementId ? (a.bank.seq ?? 0) - (b.bank.seq ?? 0) : (a.time || '99').localeCompare(b.time || '99')));

  const out = entries.filter((x) => x.direction === 'out');
  return {
    entries,
    stats: {
      bankRows: bankRows.length,
      withPayment: entries.filter((x) => x.bank && x.payment).length,
      withBill: entries.filter((x) => x.bank && x.expense).length,
      bankOnlyOut: out.filter((x) => x.bank && !x.payment && !x.expense).length,
      paymentsMissing: entries.filter((x) => x.payment && !x.bank).length,
    },
  };
}

/** Unlink every pair inside an entry. */
export function unlinkPairs(entry) {
  const out = [];
  for (let i = 0; i < entry.nodes.length; i++) for (let j = i + 1; j < entry.nodes.length; j++) out.push(pairKey(entry.nodes[i], entry.nodes[j]));
  return out;
}

/** Items that could be linked to an entry by hand: the same amount within a week. */
export function linkCandidates(entry, { entries }) {
  const has = new Set(entry.nodes.map((n) => n[0]));
  return entries.filter((x) => x !== entry && Math.abs(x.amount - entry.amount) <= 1 && x.direction === entry.direction
    && Math.abs(dayDiff(x.date, entry.date)) <= 7
    && x.nodes.every((n) => !has.has(n[0])));
}

const isDigital = (e) => /digital|qr|card/i.test(e?.paymentMethod || '');
const within = (d, range, pad = 0) => Boolean(range?.from && d) && dayDiff(d, range.from) >= -pad && dayDiff(range.to, d) >= -pad;

/**
 * Rows worth showing: everything from the bank and the screenshots, and saved bills only when
 * they matched something, or were paid digitally inside a statement's dates (so should be there).
 */
export function visibleEntries(entries, range) {
  return entries.filter((x) => x.bank || x.payment || (x.expense && isDigital(x.expense) && within(x.date, range)));
}

/** Why an entry needs a look, or '' when it's fine. */
export function needsLook(x, range) {
  if (x.payment && (!(x.payment.amount > 0) || !x.payment.dateAD)) return "Screenshot wasn't fully read: add the amount and date";
  if (x.payment?.status === 'failed') return 'Failed payment: it should not be on the statement';
  if (x.unsure) return 'Two payments fit equally well: check this pair';
  if (x.bank?.balanceMismatch) return "Balance doesn't follow from the row above: check the amounts";
  if (x.bank && !x.payment && !x.expense && x.direction === 'out') return 'No bill or screenshot for this payment';
  if (!x.bank && within(x.date, range, 0) && dayDiff(range.to, x.date) >= 3) return 'Not on the statement';
  return '';
}

/** Rows past the statement's last date (the bank hasn't sent them yet). */
export const afterStatement = (x, range) => !x.bank && Boolean(range?.to) && dayDiff(x.date, range.to) > 0;

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The merged table as CSV, for a spreadsheet. */
export function mergedCsv(entries, range) {
  const head = ['Date', 'Time', 'Bank posted', 'Bank narration', 'Paid to (screenshot)', 'App', 'Transaction ID', 'Bill: shop', 'Bill code', 'Category', 'Money out', 'Money in', 'Balance', 'Found in', 'Note'];
  const lines = entries.map((x) => [
    x.date,
    x.time,
    x.postedDate && x.postedDate !== x.date ? x.postedDate : '',
    x.bank?.description || '',
    x.payment?.merchant || '',
    x.payment?.app || '',
    x.payment?.ref || '',
    x.expense?.merchantName || '',
    x.expense?.billCode || '',
    x.expense?.category || '',
    x.direction === 'out' ? x.amount.toFixed(2) : '',
    x.direction === 'in' ? x.amount.toFixed(2) : '',
    x.bank?.balance != null ? x.bank.balance.toFixed(2) : '',
    [x.bank && 'statement', x.payment && 'screenshot', x.expense && 'bill'].filter(Boolean).join(' + '),
    needsLook(x, range),
  ].map(csvCell).join(','));
  return `${[head.join(','), ...lines].join('\n')}\n`;
}
