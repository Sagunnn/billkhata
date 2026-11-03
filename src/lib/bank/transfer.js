// Money moving between your own accounts: a bank loading a linked wallet ("ESEWA LOAD"), a wallet
// paying from its linked bank (credited, then debited for the payment), a wallet sending money back
// to the bank. Such a row is neither spending nor money in, so it must not ask for a bill or be
// counted as income; the payment itself is the one expense. Pure, so it's unit-tested.

const WALLET = /\b(e-?sewa|khalti|ime ?pay|prabhu ?pay|cell ?pay|namaste ?pay|my ?pay|fonepay wallet)\b/i;
const WALLET_NAME = [['eSewa', /e-?sewa/i], ['Khalti', /khalti/i], ['IME Pay', /ime ?pay/i], ['Prabhu Pay', /prabhu ?pay/i], ['CellPay', /cell ?pay/i], ['Namaste Pay', /namaste ?pay/i], ['MyPay', /my ?pay/i]];
const LOAD = /\b(load(ed|ing)?|top ?-?up|fund ?(load|transfer|received)|wallet|topup)\b/i;
// On a wallet statement: money in from your own bank (not "received from 98…", a person).
const FROM_BANK = /\b(load(ed)? (from|via)|from (your |linked )?bank|bank (load|transfer|deposit)|linked bank|connect ?ips|c-?ips|mobile banking|internet banking|fund (load|received from bank)|load fund|bank to wallet)\b/i;
// Money from a wallet back to a bank, as either side writes it.
const TO_BANK = /\b(transfer(red)? to (bank|a\/c|account)|withdraw(al)? to bank|wallet to bank|bank withdraw)\b/i;

const amountOf = (r) => Number(r?.debit ?? r?.credit) || 0;
export const isWalletName = (name) => WALLET.test(String(name || ''));
const walletIn = (text) => WALLET_NAME.find(([, re]) => re.test(text))?.[0] || '';
const dayGap = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);

/**
 * Whether a statement row looks like a transfer between your own accounts, from its narration.
 * @param {object} row  a statement row ({ description, debit?, credit? })
 * @param {string} account  the statement's bank or wallet name
 * @returns {null | { dir: 'out' | 'in', other: string }}  other: the far account's name, if it says
 */
export function transferHint(row, account) {
  const text = String(row?.description || '');
  const onWallet = isWalletName(account);
  const out = row?.debit > 0;
  if (!onWallet) {
    // A bank row: loading a wallet, or money back from one.
    const w = walletIn(text);
    if (out && w && LOAD.test(text)) return { dir: 'out', other: w };
    if (!out && w && (TO_BANK.test(text) || /\b(withdraw|transfer)\b/i.test(text))) return { dir: 'in', other: w };
    return null;
  }
  if (!out && FROM_BANK.test(text)) return { dir: 'in', other: '' };
  if (out && TO_BANK.test(text)) return { dir: 'out', other: '' };
  return null;
}

/**
 * Marks every transfer row across the statements, pairing the two sides when both were uploaded
 * (same amount, opposite sides, different statements, within two days). A row's own `isTransfer`
 * (set by you) wins: true makes it a transfer, false never.
 * @returns {Map<string, { dir, other, partner: string | null }>}  by row key; `other` is filled in
 *   from the partner statement's name when the narration didn't say
 */
export function findTransfers(statements = []) {
  const rows = statements.flatMap((s) => (s.rows || []).map((r) => ({ r, s })));
  const out = new Map();
  for (const { r, s } of rows) {
    if (r.isTransfer === false) continue;
    const hint = transferHint(r, s.bank);
    if (hint || r.isTransfer === true) out.set(r.key, { dir: hint?.dir || (r.debit > 0 ? 'out' : 'in'), other: hint?.other || '', partner: null, account: s.bank || '' });
  }
  // Pair: each marked row with an opposite row of the same amount in another statement.
  const taken = new Set();
  for (const { r, s } of rows) {
    const mine = out.get(r.key);
    if (!mine || mine.partner) continue;
    const want = mine.dir === 'out' ? 'credit' : 'debit';
    const match = rows.find(({ r: q, s: t }) => t.id !== s.id && !taken.has(q.key) && q.isTransfer !== false && q[want] > 0
      && Math.abs(amountOf(q) - amountOf(r)) < 0.01 && dayGap(q.date, r.date) <= 2
      && (!out.has(q.key) || out.get(q.key).dir !== mine.dir));
    if (!match) continue;
    taken.add(r.key);
    taken.add(match.r.key);
    mine.partner = match.r.key;
    mine.other = mine.other || match.s.bank || '';
    const theirs = out.get(match.r.key) || { dir: mine.dir === 'out' ? 'in' : 'out', other: '', account: match.s.bank || '' };
    out.set(match.r.key, { ...theirs, partner: r.key, other: theirs.other || s.bank || '' });
  }
  return out;
}
