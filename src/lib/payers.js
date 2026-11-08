// When more than one person paid a bill: one person keeps the bill and pays "the rest"; the others
// paid part of it (`alsoPaid: [{ memberId, amount }]`), equally or 70 and 50. Who then pays whom
// is worked out in as few payments as possible. Used by trip expenses and split bills.
// Pure functions; tests in tests/payers.test.js.

const paisa = (n) => Math.round((Number(n) || 0) * 100);

/**
 * The others who paid part, tidied: real amounts, one row per person, never the main payer, and
 * together less than the bill (the main payer always pays something).
 */
export function cleanAlsoPaid(alsoPaid, { total, primaryId }) {
  if (!Array.isArray(alsoPaid)) return [];
  const seen = new Set([primaryId]);
  const out = [];
  let left = paisa(total);
  for (const p of alsoPaid) {
    const amount = paisa(p?.amount);
    if (!p?.memberId || seen.has(p.memberId) || amount <= 0 || amount >= left) continue;
    seen.add(p.memberId);
    left -= amount;
    out.push({ memberId: p.memberId, amount: amount / 100 });
  }
  return out;
}

/** Everyone who paid and how much: the main payer first (the rest of the bill), then the others. */
export function payersOf(primaryId, alsoPaid, total) {
  const others = cleanAlsoPaid(alsoPaid, { total, primaryId });
  const rest = (paisa(total) - others.reduce((s, p) => s + paisa(p.amount), 0)) / 100;
  return [{ memberId: primaryId, amount: rest }, ...others];
}

/** The bill paid equally by these people (paisa spread so it adds up): [{ memberId, amount }]. */
export function equalPayers(ids, total) {
  const t = paisa(total);
  const base = Math.floor(t / ids.length);
  return ids.map((memberId, i) => ({ memberId, amount: (base + (i < t - base * ids.length ? 1 : 0)) / 100 }));
}

/** "Ram रु 70 + Hari रु 50" (with a name lookup and a money formatter). */
export const payersText = (payers, nameOf, fmt) => payers.map((p) => `${nameOf(p.memberId)} ${fmt(p.amount)}`).join(' + ');

/**
 * As few payments as possible to settle up: who gives whom how much.
 * @param {{memberId: string, netBalance: number}[]} balances paid minus share (+ gets money back)
 */
export function simplifyDebts(balances) {
  const cents = balances.map((b) => ({ id: b.memberId, v: Math.round(b.netBalance * 100) }));
  const creditors = cents.filter((b) => b.v > 50).sort((a, b) => b.v - a.v);
  const debtors = cents.filter((b) => b.v < -50).map((b) => ({ ...b, v: -b.v })).sort((a, b) => b.v - a.v);
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
