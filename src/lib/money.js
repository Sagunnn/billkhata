// Money: what you have, kept up to date as you go. You set each account's starting amount once
// (cash in hand, each bank, each wallet), add money when it's credited (salary, a friend paying you
// back), and move money between accounts (an ATM withdrawal). Every bill saved after that comes off
// the account it was paid from: a cash bill from cash in hand, a QR / wallet / card bill from the
// account picked on the bill (your main account unless you choose another). Quick expenses are
// small Ledger expenses, so they come off the same way. Pure functions; tests in tests/money.test.js.
// Stored in localStorage (small) and included in backups.
import { PAYMENT } from './constants.js';
import { countsAsSpend } from './expense.js';

export const ACCOUNT_KINDS = { cash: 'Cash', bank: 'Bank', wallet: 'Wallet' };
export const EMPTY_MONEY = { setAt: '', since: '', accounts: [], defaultAccount: '', defaults: [], entries: [], history: [] };
/** Wallet apps and banks offered when adding an account. */
export const ACCOUNT_SUGGESTIONS = ['eSewa', 'Khalti', 'IME Pay', 'Laxmi Sunrise Bank', 'Nabil Bank', 'Global IME Bank', 'NIC Asia Bank'];

const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const WALLETS = /esewa|khalti|imepay|prabhupay|mypay|cellpay|namastepay|connectips/;

/** A kind for an account name: wallet apps are wallets, anything else a bank. */
export const kindForName = (name) => (WALLETS.test(norm(name)) ? 'wallet' : 'bank');

/** The accounts (older data had two pots: cash and one bank total; they keep their ids). */
export function accountsOf(money = EMPTY_MONEY) {
  if (Array.isArray(money.accounts) && money.accounts.length) return money.accounts;
  if (money.start) {
    return [
      { id: 'cash', name: 'Cash in hand', kind: 'cash', start: num(money.start.cash) },
      { id: 'bank', name: 'Bank & wallets', kind: 'bank', start: num(money.start.bank) },
    ];
  }
  return [];
}

export const cashAccountId = (money) => accountsOf(money).find((a) => a.kind === 'cash')?.id || 'cash';

/** Accounts still in use: a closed one (removed, but with bills or entries) is kept, out of sight. */
export const openAccounts = (money) => accountsOf(money).filter((a) => !a.archived);

/**
 * The main account for QR / card bills: the one you chose, else the first bank or wallet. `onDay`
 * (a bill's date): the main account then, so changing it later doesn't move older bills.
 */
export function defaultAccountId(money, onDay = '') {
  const open = openAccounts(money);
  const all = accountsOf(money);
  if (onDay) {
    const then = (money.defaults || []).filter((d) => d.from > onDay).map((d) => d.was).find((id) => all.some((a) => a.id === id));
    if (then) return then;
  }
  if (money.defaultAccount && open.some((a) => a.id === money.defaultAccount)) return money.defaultAccount;
  return open.find((a) => a.kind !== 'cash')?.id || 'bank';
}

/** The account a bill was paid from: the one picked on the bill, else cash or the main account on its day. */
export function potOf(e, money = EMPTY_MONEY) {
  const accounts = accountsOf(money);
  if (e.paidFrom && accounts.some((a) => a.id === e.paidFrom)) return e.paidFrom;
  return e.paymentMethod === PAYMENT.DIGITAL ? defaultAccountId(money, e.billDateAD || '') : cashAccountId(money);
}

/** The account a statement or a wallet belongs to, by name ("Laxmi Sunrise" ↔ "Laxmi Sunrise Bank"). */
export function accountForName(money, name) {
  const n = norm(name);
  if (!n) return null;
  return openAccounts(money).find((a) => a.kind !== 'cash' && (norm(a.name).includes(n) || n.includes(norm(a.name)))) || null;
}

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

/** Every bill that comes out of an account: your own spending (trip bills count as your share). */
export const spentBills = (expenses, money) => expenses.filter((e) => !e.isSample && countsAsSpend(e) && paidSince(e, money));

/** An entry's account (older entries say pot: 'cash' | 'bank', the ids of the old two pots). */
const entryAccount = (x) => x.account || x.pot;

/**
 * @returns {{ ready: boolean, total: number, cash: number, bank: number,
 *   accounts: { id, name, kind, start, balance, spent, credited }[],
 *   spent: { cash: number, bank: number }, credited: { cash: number, bank: number } }}
 *   cash / bank: cash in hand vs all banks and wallets together.
 */
export function moneyNow(money = EMPTY_MONEY, expenses = []) {
  const ready = Boolean(money.since);
  const accounts = accountsOf(money).map((a) => ({ ...a, start: num(a.start), spent: 0, credited: 0, moved: 0, adjusted: 0 }));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  if (ready) {
    for (const e of spentBills(expenses, money)) {
      const a = byId.get(potOf(e, money));
      if (a) a.spent += num(e.totalAmount);
    }
    for (const x of money.entries || []) {
      const amount = num(x.amount);
      if (x.kind === 'in' && byId.has(entryAccount(x))) byId.get(entryAccount(x)).credited += amount;
      else if (x.kind === 'move' && byId.has(x.from) && byId.has(x.to) && x.from !== x.to) { byId.get(x.from).moved -= amount; byId.get(x.to).moved += amount; }
      else if (x.kind === 'out' && byId.has(entryAccount(x))) byId.get(entryAccount(x)).spent += amount; // older "No bill" entries
      else if (x.kind === 'adjust' && byId.has(entryAccount(x))) byId.get(entryAccount(x)).adjusted += amount; // a correction (+ or −)
    }
  }
  const sum = (list, f) => round2(list.reduce((s, a) => s + f(a), 0));
  // Closed accounts still take their own bills (so others don't jump), but aren't shown or counted.
  const out = accounts.filter((a) => !a.archived)
    .map(({ moved, adjusted, ...a }) => ({ ...a, spent: round2(a.spent), credited: round2(a.credited), balance: round2(a.start + a.credited + moved + adjusted - a.spent) }));
  const cashes = out.filter((a) => a.kind === 'cash');
  const banks = out.filter((a) => a.kind !== 'cash');
  return {
    ready,
    accounts: out,
    cash: sum(cashes, (a) => a.balance),
    bank: sum(banks, (a) => a.balance),
    total: sum(out, (a) => a.balance),
    spent: { cash: sum(cashes, (a) => a.spent), bank: sum(banks, (a) => a.spent) },
    credited: { cash: sum(cashes, (a) => a.credited), bank: sum(banks, (a) => a.credited) },
  };
}

const slug = (name) => norm(name).slice(0, 24) || `acct${Math.random().toString(36).slice(2, 6)}`;

/**
 * Sets every account's starting amount as of now: [{ id?, name, kind, start }]. Earlier entries are
 * kept for the record but no longer count. Account ids stay stable so bills keep their "paid from".
 */
export function setAccounts(money, list, { defaultAccount, now = new Date() } = {}) {
  const seen = new Set();
  const accounts = list
    .filter((a) => String(a.name || '').trim())
    .map((a) => {
      let id = a.id || (a.kind === 'cash' ? 'cash' : slug(a.name));
      while (seen.has(id)) id = `${id}2`;
      seen.add(id);
      return { id, name: String(a.name).trim().slice(0, 40), kind: ACCOUNT_KINDS[a.kind] ? a.kind : kindForName(a.name), start: round2(num(a.start)) };
    });
  const main = accounts.some((a) => a.id === defaultAccount) ? defaultAccount : accounts.find((a) => a.kind !== 'cash')?.id || '';
  return {
    setAt: now.toISOString(),
    since: localDay(now),
    accounts,
    defaultAccount: main,
    defaults: [],
    entries: [],
    history: [...(money.history || []), ...(money.entries || [])].slice(-200),
  };
}

/**
 * Changing your accounts after they're set, without starting over: renaming keeps everything; a
 * new account starts at the amount given; an amount that differs from what the app shows adds a
 * correction for today (the difference); a removed account that has bills or entries is closed
 * (kept out of sight, so its bills don't land on another account), otherwise dropped; a new main
 * account applies from today (older QR bills stay on the main account they had).
 * @param rows [{ id?, name, kind, start (the amount you have now), main }]
 * @param current { [accountId]: balance shown now } (moneyNow)
 * @param used Set of account ids with bills or entries
 * @returns {{ money, corrections: { account, name, amount }[] }}
 */
export function editAccounts(money, rows, { current = {}, used = new Set(), now = new Date() } = {}) {
  const today = localDay(now);
  const named = rows.filter((r) => String(r.name || '').trim());
  const before = accountsOf(money);
  const seen = new Set(before.map((a) => a.id));
  const corrections = [];
  const kept = named.map((r) => {
    const name = String(r.name).trim().slice(0, 40);
    const kind = r.kind === 'cash' ? 'cash' : ACCOUNT_KINDS[r.kind] ? r.kind : kindForName(name);
    const old = r.id && before.find((a) => a.id === r.id);
    if (old) {
      const diff = round2(num(r.start) - num(current[old.id]));
      if (Math.abs(diff) >= 0.01) corrections.push({ account: old.id, name, amount: diff });
      return { ...old, name, kind, archived: false };
    }
    let id = kind === 'cash' ? 'cash' : slug(name);
    while (seen.has(id)) id = `${id}2`;
    seen.add(id);
    return { id, name, kind, start: round2(num(r.start)), addedOn: today };
  });
  const keptIds = new Set(kept.map((a) => a.id));
  const closed = before.filter((a) => !keptIds.has(a.id) && used.has(a.id)).map((a) => ({ ...a, archived: true }));
  const accounts = [...kept, ...closed];
  const mainRow = named.findIndex((r) => r.main);
  const wasMain = defaultAccountId(money);
  const nextMain = mainRow >= 0 && kept[mainRow]?.kind !== 'cash' ? kept[mainRow].id : (kept.some((a) => a.id === wasMain) ? wasMain : kept.find((a) => a.kind !== 'cash')?.id || '');
  const defaults = [...(money.defaults || [])];
  if (wasMain && nextMain !== wasMain) defaults.push({ was: wasMain, from: today }); // bills before today stay on the old main
  const entries = [...(money.entries || []), ...corrections.map((c, i) => ({
    id: entryId(new Date(now.getTime() + i)), kind: 'adjust', account: c.account, amount: c.amount, date: today, note: 'Corrected to what you have', createdAt: now.toISOString(),
  }))];
  return { money: { ...money, accounts, defaultAccount: nextMain, defaults, entries }, corrections };
}

/** The two-pot shortcut (cash in hand and one bank total). */
export const setStart = (money, { cash, bank }, now = new Date()) => setAccounts(money, [
  { id: 'cash', name: 'Cash in hand', kind: 'cash', start: cash },
  { id: 'bank', name: 'Bank & wallets', kind: 'bank', start: bank },
], { defaultAccount: 'bank', now });

/** Adds money in, money moved between accounts, or spending without a bill. */
export function addEntry(money, entry, now = new Date()) {
  const amount = round2(num(entry.amount));
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  const clean = { id: entry.id || entryId(now), kind: entry.kind, amount, date: entry.date || localDay(now), note: String(entry.note || '').trim().slice(0, 80), createdAt: now.toISOString() };
  if (entry.kind === 'move') Object.assign(clean, { from: entry.from, to: entry.to });
  else clean.account = entry.account || entry.pot || (entry.kind === 'in' ? defaultAccountId(money) : cashAccountId(money));
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
 * A credited statement row as an entry in `account` (the statement's own account when known): a cash
 * deposit moves cash into it (it isn't new money); anything else is money in, titled with the row's
 * source (yours, or a guess).
 */
export function entryFromCredit(row, account, money = EMPTY_MONEY) {
  const text = String(row.description || '');
  const to = account || defaultAccountId(money);
  const base = { amount: row.credit, date: row.date, note: text.replace(/\s+/g, ' ').trim().slice(0, 80), bankKey: row.key };
  const source = creditSource(row);
  if (source === 'Cash deposit') return { ...base, kind: 'move', from: cashAccountId(money), to };
  return { ...base, kind: 'in', account: to, source: source || 'Other' };
}

/**
 * A credit's title changed on the Money page: its entry follows (a cash deposit is a cash → account
 * move; anything else is money in with that source), staying in the same account.
 */
export function retitleCredit(money, bankKey, source) {
  const title = String(source || '').trim().slice(0, 40);
  return {
    ...money,
    entries: (money.entries || []).map((x) => {
      if (x.bankKey !== bankKey) return x;
      const account = x.kind === 'move' ? x.to : entryAccount(x);
      const { from, to, pot, account: a, source: old, ...rest } = x;
      void from; void to; void pot; void a; void old;
      return title === 'Cash deposit'
        ? { ...rest, kind: 'move', from: cashAccountId(money), to: account }
        : { ...rest, kind: 'in', account, source: title || 'Other' };
    }),
  };
}

/**
 * Whether a credited statement row can go into Money: 'added' (already there), 'not-set'
 * (no starting amounts yet), 'before' (dated before them, so already counted in them), or 'ready'.
 */
export function creditState(money, row) {
  if ((money.entries || []).some((x) => x.bankKey && x.bankKey === row.key)) return 'added';
  if (!money.since) return 'not-set';
  if ((row.date || '') < money.since) return 'before';
  return 'ready';
}

export const removeEntry = (money, id) => ({ ...money, entries: (money.entries || []).filter((x) => x.id !== id) });

/** A new entry's id, made before saving so the toast's Undo can take it back. */
export const entryId = (now = new Date()) => `m${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** An entry put back after Undo (once: it isn't added twice). */
export const restoreEntry = (money, entry) => ((money.entries || []).some((x) => x.id === entry.id)
  ? money
  : { ...money, entries: [...(money.entries || []), entry] });

/**
 * An entry fixed after saving: amount, date, account, source or note, or money in that was really a
 * cash deposit (it becomes a move). Keeps its id, when it was added and the statement row it came from.
 */
export function updateEntry(money, id, entry, now = new Date()) {
  const old = (money.entries || []).find((x) => x.id === id);
  if (!old) throw new Error('That entry was already removed.');
  const [fixed] = addEntry({ ...money, entries: [] }, { ...entry, id, bankKey: old.bankKey }, now).entries;
  return { ...money, entries: money.entries.map((x) => (x.id === id ? { ...fixed, createdAt: old.createdAt, editedAt: now.toISOString() } : x)) };
}

/** Reads a stored or backed-up value, dropping anything malformed; two-pot data becomes accounts. */
export function cleanMoney(v) {
  if (!v || typeof v !== 'object') return { ...EMPTY_MONEY };
  const entries = Array.isArray(v.entries)
    ? v.entries.filter((x) => x && typeof x.id === 'string' && (x.kind === 'adjust' ? num(x.amount) !== 0 : num(x.amount) > 0 && ['in', 'out', 'move'].includes(x.kind)))
    : [];
  const accounts = (Array.isArray(v.accounts) && v.accounts.length ? v.accounts : accountsOf({ start: v.start || { cash: 0, bank: 0 } }))
    .filter((a) => a && typeof a.id === 'string' && String(a.name || '').trim())
    .map((a) => ({ id: a.id, name: String(a.name).slice(0, 40), kind: ACCOUNT_KINDS[a.kind] ? a.kind : 'bank', start: num(a.start), ...(a.archived ? { archived: true } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(a.addedOn || '') ? { addedOn: a.addedOn } : {}) }));
  const since = /^\d{4}-\d{2}-\d{2}$/.test(v.since || '') ? v.since : '';
  return {
    setAt: typeof v.setAt === 'string' ? v.setAt : '',
    since,
    accounts: since ? accounts : [],
    defaultAccount: typeof v.defaultAccount === 'string' ? v.defaultAccount : (v.start ? 'bank' : ''),
    defaults: Array.isArray(v.defaults) ? v.defaults.filter((d) => d && typeof d.was === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.from || '')) : [],
    entries,
    history: Array.isArray(v.history) ? v.history.slice(-200) : [],
  };
}

function localDay(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
