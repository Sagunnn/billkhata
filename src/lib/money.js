// Cash & bank: what you have, kept up to date as you go. You set the starting amounts once
// ("I have रु 5,000 in cash and रु 40,000 in bank today"), add money when it's credited (salary, a
// friend paying you back), and move money between the two (an ATM withdrawal). Every bill saved
// after that lowers cash (a cash bill) or bank (QR, wallet or card). Pure functions; tests in
// tests/money.test.js. Stored in localStorage (small) and included in backups.
import { PAYMENT } from './constants.js';
import { countsAsSpend } from './expense.js';

export const POTS = { cash: 'Cash', bank: 'Bank & wallets' };
export const EMPTY_MONEY = { setAt: '', since: '', start: { cash: 0, bank: 0 }, entries: [] };

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Which pot a bill was paid from: QR / wallet / card from the bank, everything else in cash. */
export const potOf = (e) => (e.paymentMethod === PAYMENT.DIGITAL ? 'bank' : 'cash');

/**
 * A bill paid after the amounts were set. Bills dated before are already reflected in them; on the
 * day itself, only bills added after setting the amounts count.
 */
export function paidSince(e, money) {
  if (!money.since) return false;
  const d = e.billDateAD || '';
  if (d > money.since) return true;
  return d === money.since && (e.createdAt || '') >= (money.setAt || '');
}

/** Every bill that comes out of cash or bank: your own spending (trip bills count as your share). */
export const spentBills = (expenses, money) => expenses.filter((e) => !e.isSample && countsAsSpend(e) && paidSince(e, money));

/**
 * @returns {{ ready: boolean, cash: number, bank: number, total: number,
 *   spent: { cash: number, bank: number }, credited: { cash: number, bank: number } }}
 */
export function moneyNow(money = EMPTY_MONEY, expenses = []) {
  const ready = Boolean(money.since);
  const spent = { cash: 0, bank: 0 };
  const credited = { cash: 0, bank: 0 };
  const moved = { cash: 0, bank: 0 };
  if (ready) {
    for (const e of spentBills(expenses, money)) spent[potOf(e)] += num(e.totalAmount);
    for (const x of money.entries || []) {
      const amount = num(x.amount);
      if (x.kind === 'in' && POTS[x.pot]) credited[x.pot] += amount;
      else if (x.kind === 'move' && POTS[x.from] && POTS[x.to] && x.from !== x.to) { moved[x.from] -= amount; moved[x.to] += amount; }
      else if (x.kind === 'out' && POTS[x.pot]) spent[x.pot] += amount; // spending with no bill (a fare, a tip)
    }
  }
  const cash = round2(num(money.start?.cash) + credited.cash + moved.cash - spent.cash);
  const bank = round2(num(money.start?.bank) + credited.bank + moved.bank - spent.bank);
  return {
    ready,
    cash,
    bank,
    total: round2(cash + bank),
    spent: { cash: round2(spent.cash), bank: round2(spent.bank) },
    credited: { cash: round2(credited.cash), bank: round2(credited.bank) },
  };
}

/** Sets the starting amounts as of now. Earlier entries are kept for the record but no longer count. */
export function setStart(money, { cash, bank }, now = new Date()) {
  return { ...money, setAt: now.toISOString(), since: localDay(now), start: { cash: round2(num(cash)), bank: round2(num(bank)) }, entries: [], history: [...(money.history || []), ...(money.entries || [])].slice(-200) };
}

/** Adds money in, money moved (bank → cash), or spending without a bill. */
export function addEntry(money, entry, now = new Date()) {
  const amount = round2(num(entry.amount));
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  const clean = { id: entry.id || `m${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: entry.kind, amount, date: entry.date || localDay(now), note: String(entry.note || '').trim().slice(0, 80), createdAt: now.toISOString() };
  if (entry.kind === 'move') Object.assign(clean, { from: entry.from, to: entry.to });
  else clean.pot = entry.pot;
  if (entry.kind === 'in') clean.source = String(entry.source || '').trim().slice(0, 40) || 'Other';
  if (entry.bankKey) clean.bankKey = String(entry.bankKey); // added from a statement row (only once)
  return { ...money, entries: [...(money.entries || []), clean] };
}

/** Common sources of money in, offered as quick picks (with the ones you've used first). */
export const MONEY_SOURCES = ['Salary', 'Family', 'Friend paid back', 'Refund', 'Business', 'Interest', 'Cash deposit'];

/** Sources you've used before (most recent first), then the common ones. */
export function sourceOptions(money) {
  const used = [...(money.entries || []), ...(money.history || [])]
    .filter((x) => x.kind === 'in' && x.source)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((x) => x.source);
  return [...new Set([...used, ...MONEY_SOURCES])];
}

/** Money in since the amounts were set, by source, largest first: [{ source, amount, count }]. */
export function creditsBySource(money) {
  const by = new Map();
  for (const x of money.entries || []) {
    if (x.kind !== 'in') continue;
    const key = x.source || 'Other';
    const cur = by.get(key) || { source: key, amount: 0, count: 0 };
    cur.amount = round2(cur.amount + num(x.amount));
    cur.count += 1;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => b.amount - a.amount);
}

/** A source for a credit, guessed from the bank's narration ('' when nothing fits). */
export function guessSource(text = '') {
  const t = String(text);
  if (/cash\s*dep/i.test(t)) return 'Cash deposit';
  if (/salary|payroll|\bsal\b/i.test(t)) return 'Salary';
  if (/refund|reversal|\brev\b|cash\s*back/i.test(t)) return 'Refund';
  if (/interest|\bint\.?\s*(cr|paid|pay)/i.test(t)) return 'Interest';
  return '';
}

/** Where a credited row came from: the title you gave it, else a guess, else ''. */
export const creditSource = (row) => String(row?.source || '').trim() || guessSource(row?.description);

/**
 * A credited statement row as a Cash & bank entry: a cash deposit moves cash into the bank (it isn't
 * new money); anything else is money in, titled with the row's source (yours, or a guess).
 */
export function entryFromCredit(row) {
  const text = String(row.description || '');
  const base = { amount: row.credit, date: row.date, note: text.replace(/\s+/g, ' ').trim().slice(0, 80), bankKey: row.key };
  const source = creditSource(row);
  if (source === 'Cash deposit') return { ...base, kind: 'move', from: 'cash', to: 'bank' };
  return { ...base, kind: 'in', pot: 'bank', source: source || 'Other' };
}

/**
 * A credit's title changed on the Bank page: its Cash & bank entry follows (a cash deposit is a
 * cash → bank move; anything else is money in with that source).
 */
export function retitleCredit(money, bankKey, source) {
  const title = String(source || '').trim().slice(0, 40);
  return {
    ...money,
    entries: (money.entries || []).map((x) => {
      if (x.bankKey !== bankKey) return x;
      const { from, to, pot, source: old, ...rest } = x;
      void from; void to; void pot; void old;
      return title === 'Cash deposit'
        ? { ...rest, kind: 'move', from: 'cash', to: 'bank' }
        : { ...rest, kind: 'in', pot: 'bank', source: title || 'Other' };
    }),
  };
}

/**
 * Whether a credited statement row can go into Cash & bank: 'added' (already there), 'not-set'
 * (no starting amounts yet), 'before' (dated before them, so already counted in them), or 'ready'.
 */
export function creditState(money, row) {
  if ((money.entries || []).some((x) => x.bankKey && x.bankKey === row.key)) return 'added';
  if (!money.since) return 'not-set';
  if ((row.date || '') < money.since) return 'before';
  return 'ready';
}

export const removeEntry = (money, id) => ({ ...money, entries: (money.entries || []).filter((x) => x.id !== id) });

/** Reads a stored or backed-up value, dropping anything malformed. */
export function cleanMoney(v) {
  if (!v || typeof v !== 'object') return { ...EMPTY_MONEY };
  const entries = Array.isArray(v.entries) ? v.entries.filter((x) => x && typeof x.id === 'string' && num(x.amount) > 0 && ['in', 'out', 'move'].includes(x.kind)) : [];
  // (each entry keeps its fields, including source and bankKey)
  return {
    setAt: typeof v.setAt === 'string' ? v.setAt : '',
    since: /^\d{4}-\d{2}-\d{2}$/.test(v.since || '') ? v.since : '',
    start: { cash: num(v.start?.cash), bank: num(v.start?.bank) },
    entries,
    history: Array.isArray(v.history) ? v.history.slice(-200) : [],
  };
}

function localDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
