// Overlapping statements: the same transaction uploaded twice (two statements whose dates
// overlap, the PDF and the Excel export of one account, a screenshot of part of it) must count
// once. Rows can't be compared as text: one export cuts the description short, another has no
// time or no balance. They're compared like a person would: same account, same amount and
// direction, on the same day, with nothing that says they differ.
// Pure functions; unit-tested in tests/overlap.test.js.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const amountOf = (r) => Math.round((r.debit ?? r.credit ?? 0) * 100) / 100;
const dirOf = (r) => (r.debit != null ? 'out' : 'in');
const close = (a, b) => Math.abs(a - b) < 0.005;
const DAY = 864e5;
const dayGap = (a, b) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / DAY));

/**
 * Two statements of the same account: the last 4 digits agree when both have them, and the bank
 * or wallet names agree (one may be a shorter form: "Global IME" / "Global IME Bank").
 */
export function sameAccount(a = {}, b = {}) {
  const na = norm(a.bank);
  const nb = norm(b.bank);
  const names = na && nb ? na.includes(nb) || nb.includes(na) : na === nb;
  if (a.account && b.account) return a.account === b.account && (names || !na || !nb);
  return names;
}

/** Reference codes of a row, cleaned for comparing ("FP-123 456" → "FP123456"). */
const refsOf = (r) => new Set([r.ref, ...(r.refs || [])].map((x) => norm(x).toUpperCase()).filter((x) => x.length >= 5));

/**
 * Which incoming rows are already among `existing` (rows of the same account). Each existing row
 * matches at most one incoming row, so two real रु 100 payments on one day stay two.
 * Checked strongest first:
 *   1. the same transaction ID;
 *   2. the same day with the same balance after it;
 *   3. the same day where one of them has no balance to compare (a screenshot, an export without
 *      the balance column);
 *   4. up to 2 days apart (transaction date vs value date) with exactly the same balance.
 * Rows whose balances both exist and differ are never the same transaction.
 * @returns {Set<number>} indexes into `incoming`
 */
export function duplicateRows(incoming = [], existing = []) {
  const pool = existing.map((r) => ({ r, used: false, refs: refsOf(r) }));
  const groups = new Map();
  for (const p of pool) {
    const k = `${dirOf(p.r)}|${amountOf(p.r)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const dup = new Set();
  const balancesAgree = (a, b) => a.balance != null && b.balance != null && close(a.balance, b.balance);
  const balancesClash = (a, b) => a.balance != null && b.balance != null && !close(a.balance, b.balance);
  const passes = [
    (r, p, refs) => [...refs].some((x) => p.refs.has(x)) && dayGap(r.date, p.r.date) <= 3,
    (r, p) => r.date === p.r.date && balancesAgree(r, p.r),
    (r, p) => r.date === p.r.date && !balancesClash(r, p.r),
    (r, p) => dayGap(r.date, p.r.date) <= 2 && balancesAgree(r, p.r),
  ];
  const refsIn = incoming.map(refsOf);
  for (const test of passes) {
    incoming.forEach((r, i) => {
      if (dup.has(i) || !(amountOf(r) > 0)) return;
      const cands = groups.get(`${dirOf(r)}|${amountOf(r)}`) || [];
      const hit = cands.find((p) => !p.used && test(r, p, refsIn[i]));
      if (hit) { hit.used = true; dup.add(i); }
    });
  }
  return dup;
}

/**
 * The saved statements with rows that an earlier-imported statement of the same account already
 * has taken out. Fixes duplicates saved before this check existed, and keeps the merged table and
 * the Cash & bank card honest whatever was uploaded.
 */
export function withoutOverlaps(statements = []) {
  const ordered = [...statements].sort((a, b) => String(a.importedAt || '').localeCompare(String(b.importedAt || '')));
  const kept = [];
  for (const st of ordered) {
    const earlier = kept.filter((k) => sameAccount(k, st)).flatMap((k) => k.rows || []);
    const dup = earlier.length ? duplicateRows(st.rows || [], earlier) : new Set();
    kept.push(dup.size ? { ...st, rows: (st.rows || []).filter((_, i) => !dup.has(i)), overlapRemoved: dup.size } : st);
  }
  return kept;
}

/**
 * For the upload preview: how many rows of a new statement are already saved, and in which
 * statements (the ones of the same account whose dates overlap).
 * @returns {{ count: number, dupes: Set<number>, from: object[] }}
 */
export function overlapWith(rows = [], meta = {}, statements = []) {
  const same = withoutOverlaps(statements).filter((s) => sameAccount(s, meta));
  const dupes = duplicateRows(rows, same.flatMap((s) => s.rows || []));
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const from = dates.length ? same.filter((s) => s.from && s.to && s.from <= dates.at(-1) && s.to >= dates[0]) : [];
  return { count: dupes.size, dupes, from };
}
