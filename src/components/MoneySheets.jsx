// Money sheets (Figma: Phone 12 · Quick cash out, Home wallet card actions): set your accounts,
// money in, move money between accounts (ATM), quick cash out, and the history.
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, Banknote, Check, Landmark, Plus, Trash, Wallet } from 'lucide-react';
import { CATEGORIES, PAYMENT } from '../lib/constants.js';
import { blankExpense } from '../lib/expense.js';
import { money as fmt } from '../lib/format.js';
import { adToBs, formatAD, todayAD } from '../lib/nepaliDate.js';
import {
  ACCOUNT_SUGGESTIONS, addEntry, cashAccountId, creditsBySource, defaultAccountId, kindForName, moneyNow, potOf,
  removeEntry, setAccounts, sourceOptions, spentBills,
} from '../lib/money.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Field, Modal } from './ui.jsx';

export const ACCOUNT_ICON = { cash: Banknote, bank: Landmark, wallet: Wallet };

/** The big centred amount with +20 / +50 / +100 / +500 nudges (Phone 12). */
function AmountInput({ value, onChange, error }) {
  return (
    <div className="flex flex-col items-center gap-3 pb-2">
      <label htmlFor="mn-amt" className="t-label text-ink-2">Amount</label>
      <div className={`flex items-baseline justify-center gap-1 border-b-2 pb-1 ${error ? 'border-danger' : 'border-transparent focus-within:border-brand'}`}>
        <span className="t-money-xl font-nepali text-ink">रु</span>
        <input
          id="mn-amt"
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          className="t-money-xl num w-[6ch] bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
          style={{ width: `${Math.max(2, String(value || '0').length + 0.5)}ch` }}
        />
      </div>
      {error && <p className="t-caption text-danger">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {[20, 50, 100, 500].map((n) => (
          <button key={n} type="button" onClick={() => onChange(String((Number(value) || 0) + n))} className="tap rounded-full bg-sunken px-4 py-1.5 text-[14px] font-medium text-ink-2 hover:text-ink">+{n}</button>
        ))}
      </div>
    </div>
  );
}

/** Account cards to pick from, each with its balance now. */
function AccountPicker({ label, value, onChange, accounts, exclude }) {
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {accounts.filter((a) => a.id !== exclude).map((a) => {
          const on = a.id === value;
          return (
            <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(a.id)}
              className={`tap min-w-0 rounded-[14px] border px-3 py-2.5 text-left transition ${on ? 'border-ink bg-ink text-ink-inverse' : 'border-line-strong bg-surface text-ink hover:bg-sunken'}`}>
              <span className={`block truncate text-[13px] leading-4 ${on ? 'text-ink-inverse/80' : 'text-ink-2'}`}>{a.name}</span>
              <span className="num block truncate font-nepali text-[15px] font-semibold leading-[22px]">{fmt(a.balance)}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function NoteField({ value, onChange, placeholder, id = 'mn-note' }) {
  return (
    <Field label="Note (optional)" htmlFor={id}>
      <input id={id} className="input" value={value} maxLength={80} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </Field>
  );
}

function useAccountsNow() {
  const { money, expenses } = useStore();
  return useMemo(() => moneyNow(money, expenses), [money, expenses]);
}

/* ---------- Set your accounts ---------- */

export function AccountsSheet({ onClose }) {
  const { money, setMoney } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const [rows, setRows] = useState(() => (now.ready
    ? now.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, start: String(a.balance), main: a.id === defaultAccountId(money) }))
    : [{ id: 'cash', name: 'Cash in hand', kind: 'cash', start: '' }, { name: 'eSewa', kind: 'wallet', start: '', main: true }]));
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const makeMain = (i) => setRows((r) => r.map((x, j) => ({ ...x, main: j === i })));
  const missing = ACCOUNT_SUGGESTIONS.filter((n) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase())).slice(0, 4);
  function save() {
    setMoney((m) => {
      // Ids are given in order to the named rows, so the main row's id is found by position.
      const named = rows.filter((r) => String(r.name || '').trim());
      const next = setAccounts(m, named);
      const i = named.findIndex((r) => r.main);
      return i >= 0 && next.accounts[i]?.kind !== 'cash' ? { ...next, defaultAccount: next.accounts[i].id } : next;
    });
    toast('Accounts set. Bills you save from now on come off the account they were paid from.');
    onClose();
  }
  return (
    <Modal open onClose={onClose} size="md" title={now.ready ? 'Your accounts' : 'What do you have now?'} subtitle="Count your cash; check each bank and wallet app"
      footer={<Button variant="primary" size="lg" icon={Check} className="w-full" onClick={save}>Save amounts</Button>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const Icon = ACCOUNT_ICON[r.kind] || Landmark;
            return (
              <li key={i} className="flex items-center gap-2 rounded-[14px] border border-line bg-surface p-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-sunken"><Icon className="size-[18px] text-ink-2" /></span>
                <input aria-label="Account name" className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink focus:outline-none" value={r.name} disabled={r.kind === 'cash'}
                  onChange={(e) => set(i, { name: e.target.value, kind: r.kind === 'cash' ? 'cash' : kindForName(e.target.value) })} placeholder="Bank or wallet" />
                <span className="font-nepali text-[15px] text-ink-3">रु</span>
                <input aria-label={`${r.name || 'Account'} amount`} inputMode="decimal" className="num w-24 rounded-[10px] border border-line-strong bg-raised px-2 py-1.5 text-right text-[15px] text-ink focus:border-navy focus:outline-none" value={r.start}
                  onChange={(e) => set(i, { start: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                {r.kind !== 'cash' && (
                  <>
                    <button type="button" onClick={() => makeMain(i)} title="Main account: QR and card bills come off it unless you pick another"
                      className={`tap rounded-full px-2 text-[12px] font-medium ${r.main ? 'bg-navy-soft text-navy' : 'text-ink-3 hover:text-ink'}`}>{r.main ? 'Main' : 'Set main'}</button>
                    <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="tap rounded-full p-1.5 text-ink-3 hover:text-danger"><Trash className="size-4" /></button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          {missing.map((n) => <button key={n} type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: n, kind: kindForName(n), start: '' }])}><Plus className="size-4" />{n}</button>)}
          <button type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: '', kind: 'bank', start: '' }])}><Plus className="size-4" />Other</button>
        </div>
        <p className="t-caption text-ink-3">Cash bills come off Cash in hand; QR and card bills off the account picked on the bill (the main one unless you choose). {now.ready ? 'Saving starts over from today.' : ''}</p>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- Money in ---------- */

export function MoneyInSheet({ onClose, account: preset }) {
  const { money, setMoney } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [account, setAccount] = useState(preset || defaultAccountId(money));
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayAD());
  const [error, setError] = useState('');
  const options = sourceOptions(money).slice(0, 6);
  function save() {
    try {
      setMoney((m) => addEntry(m, { kind: source === 'Cash deposit' ? 'move' : 'in', amount, account, from: cashAccountId(m), to: account, source, note, date }));
      toast(`${fmt(Number(amount))} in${source ? ` from ${source}` : ''}.`);
      onClose();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal open keepFooter onClose={onClose} size="md" title="Money in" subtitle="Salary, a friend paying you back, a refund"
      footer={<Button variant="primary" size="lg" icon={Check} className="w-full" onClick={save}>Add {amount ? fmt(Number(amount)) : 'money'}</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} error={error} />
        <fieldset>
          <legend className="label">From</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => <button key={o} type="button" aria-pressed={source === o} className="chip tap" onClick={() => setSource(o)}>{source === o && <Check className="size-4" />}{o}</button>)}
          </div>
          <input aria-label="Or type where it came from" className="input mt-2" value={source} maxLength={40} onChange={(e) => setSource(e.target.value)} placeholder="Or type: Ram paid back, from Dad…" />
        </fieldset>
        <AccountPicker label="Into" value={account} onChange={setAccount} accounts={now.accounts} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <NoteField value={note} onChange={setNote} placeholder="October" />
          <Field label="Date" htmlFor="mn-date"><input id="mn-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- Move / ATM ---------- */

export function MoveSheet({ onClose }) {
  const { money, setMoney } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(defaultAccountId(money));
  const [to, setTo] = useState(cashAccountId(money));
  const [note, setNote] = useState('ATM');
  const [error, setError] = useState('');
  function save() {
    try {
      setMoney((m) => addEntry(m, { kind: 'move', amount, from, to, note }));
      const name = (id) => now.accounts.find((a) => a.id === id)?.name || id;
      toast(`${fmt(Number(amount))} moved: ${name(from)} → ${name(to)}.`);
      onClose();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal open keepFooter onClose={onClose} size="md" title="ATM / Move" subtitle="Money between your own accounts"
      footer={<Button variant="primary" size="lg" icon={ArrowLeftRight} className="w-full" onClick={save} disabled={from === to}>Move {amount ? fmt(Number(amount)) : 'money'}</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} error={error} />
        <AccountPicker label="From" value={from} onChange={(v) => { setFrom(v); if (v === to) setTo(now.accounts.find((a) => a.id !== v)?.id || ''); }} accounts={now.accounts} />
        <AccountPicker label="To" value={to} onChange={setTo} accounts={now.accounts} exclude={from} />
        <NoteField value={note} onChange={setNote} placeholder="ATM, deposit" />
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- Quick expense (Phone 12: Quick cash out) ---------- */

// What it was for, and the Ledger category each files under.
const QUICK = [
  ['Food', 'Food & Dining'], ['Transport', 'Transport'], ['Groceries', 'Groceries'], ['Medicine', 'Medicine'],
  ['Recharge', 'Utilities & Telecom'], ['Shopping', 'Retail/Shopping'], ['Tips', 'Other'], ['Other', 'Other'],
];
const LAST_KEY = 'billkhata_quick_last';
const lastQuick = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || '{}'); } catch { return {}; } };

/**
 * Spending with no bill (a fare, snacks, a tip): amount, what it was for, an optional note. Saved as
 * a Ledger expense (in spending and categories, never in the IRD draw); with accounts set up, it
 * comes off the one picked.
 */
export function QuickOutSheet({ onClose }) {
  const { money, profile, saveExpense } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const last = lastQuick();
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState(QUICK.some(([l]) => l === last.label) ? last.label : 'Food');
  const [account, setAccount] = useState(now.accounts.some((a) => a.id === last.account) ? last.account : cashAccountId(money));
  const [method, setMethod] = useState(last.method || PAYMENT.CASH); // without accounts: cash or QR / card
  const [note, setNote] = useState('');
  const [day, setDay] = useState(todayAD());
  const [error, setError] = useState('');
  const [count, setCount] = useState(0); // saved in this sheet, with "Save & add another"
  const hasAccounts = money.since && now.accounts.length > 0;
  const acc = hasAccounts ? now.accounts.find((a) => a.id === account) : null;
  const after = acc ? acc.balance - (Number(amount) || 0) : null;
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA');

  async function save(again = false) {
    if (!(Number(amount) > 0)) { setError('Enter an amount above zero.'); return; }
    const category = QUICK.find(([l]) => l === label)?.[1] || CATEGORIES.at(-1);
    const paymentMethod = acc ? (acc.kind === 'cash' ? PAYMENT.CASH : PAYMENT.DIGITAL) : method;
    await saveExpense({
      ...blankExpense(profile.region),
      merchantName: note.trim() || label,
      totalAmount: Number(amount),
      billDateAD: day,
      billDateBS: adToBs(day) || '',
      category,
      paymentMethod,
      ...(acc ? { paidFrom: account } : {}),
      isNepalBill: false,
      quick: true,
      quickLabel: label,
      notes: note.trim(),
    });
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ label, account, method })); } catch { /* ignore */ }
    toast(`${fmt(Number(amount))} for ${note.trim() || label.toLowerCase()} saved${acc ? `, off ${acc.name}` : ''}.`);
    if (again) { setAmount(''); setNote(''); setError(''); setCount((n) => n + 1); return; }
    onClose();
  }

  return (
    <Modal open keepFooter onClose={onClose} size="md" title="Quick expense" subtitle={count ? `${count} saved · no bill needed` : 'No bill: a fare, snacks, a tip, a recharge'}
      footer={(
        <div className="w-full">
          <Button variant="primary" size="lg" icon={Check} className="w-full" onClick={() => save(false)}>Save {amount ? `${fmt(Number(amount))} ` : ''}expense</Button>
          <button type="button" onClick={() => save(true)} className="mt-2 w-full text-center text-[14px] font-medium text-brand">Save &amp; add another</button>
          {acc && amount && <p className="t-caption mt-1 text-center text-ink-3">{acc.name} will show {fmt(after)}.</p>}
        </div>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} error={error} />
        <fieldset>
          <legend className="label">For</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK.map(([l]) => <button key={l} type="button" aria-pressed={label === l} className="chip tap" onClick={() => setLabel(l)}>{label === l && <Check className="size-4" />}{l}</button>)}
          </div>
        </fieldset>
        <NoteField value={note} onChange={setNote} placeholder="Microbus to Ratnapark, momo with Ram…" />
        <fieldset>
          <legend className="label">When</legend>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-pressed={day === todayAD()} className="chip tap" onClick={() => setDay(todayAD())}>Today</button>
            <button type="button" aria-pressed={day === yesterday} className="chip tap" onClick={() => setDay(yesterday)}>Yesterday</button>
            <input type="date" aria-label="Another day" className="input h-9 w-auto py-0" value={day} max={todayAD()} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </div>
        </fieldset>
        {hasAccounts
          ? <AccountPicker label="Paid from" value={account} onChange={setAccount} accounts={now.accounts} />
          : (
            <div>
              <p className="label">Paid with</p>
              <div className="flex gap-2">
                {[[PAYMENT.CASH, 'Cash'], [PAYMENT.DIGITAL, 'QR / card']].map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={method === v} className="chip tap" onClick={() => setMethod(v)}>{method === v && <Check className="size-4" />}{l}</button>
                ))}
              </div>
            </div>
          )}
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- History ---------- */

export function MoneyHistorySheet({ onClose }) {
  const { money, setMoney, expenses } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const name = (id) => now.accounts.find((a) => a.id === id)?.name || id;
  const bills = useMemo(() => spentBills(expenses, money), [expenses, money]);
  const bySource = creditsBySource(money);
  const rows = [
    ...(money.entries || []).map((x) => ({ ...x, sort: `${x.date}|${x.createdAt}` })),
    ...bills.map((e) => ({ id: e.id, kind: e.quick ? 'quick' : 'bill', account: potOf(e, money), amount: Number(e.totalAmount) || 0, date: e.billDateAD, note: e.merchantName || 'Bill', sort: `${e.billDateAD}|${e.createdAt}` })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  const what = { in: 'Money in', move: 'Moved', out: 'Spent, no bill', bill: 'Bill', quick: 'Quick expense' };
  return (
    <Modal open onClose={onClose} size="md" title="Money history" subtitle={money.since ? `Since ${formatAD(money.since)}` : ''}>
      {bySource.length > 0 && (
        <div className="mb-3 rounded-[14px] bg-leaf-soft px-3.5 py-2.5">
          <p className="t-overline text-leaf">Money in, by source</p>
          <ul className="mt-1 space-y-0.5">
            {bySource.map((c) => <li key={c.source} className="t-label flex justify-between gap-3 text-ink"><span className="truncate">{c.source}{c.count > 1 ? ` · ${c.count} times` : ''}</span><b className="num">+{fmt(c.amount)}</b></li>)}
          </ul>
        </div>
      )}
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((x) => (
            <li key={`${x.kind}-${x.id}`} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-semibold text-ink">{x.kind === 'in' ? [x.source, x.note].filter(Boolean).join(': ') : x.note || what[x.kind]}</span>
                <span className="t-caption num block text-ink-3">{formatAD(x.date)} · {what[x.kind]} · {x.kind === 'move' ? `${name(x.from)} → ${name(x.to)}` : name(x.account || x.pot)}</span>
              </span>
              <span className={`num shrink-0 font-nepali text-[15px] font-semibold ${x.kind === 'in' ? 'text-leaf' : 'text-ink'}`}>{x.kind === 'in' ? '+ ' : x.kind === 'move' ? '' : '− '}{fmt(x.amount)}</span>
              {['in', 'move', 'out'].includes(x.kind)
                ? <button type="button" className="tap rounded-full p-1.5 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label="Remove this entry" onClick={() => { setMoney((m) => removeEntry(m, x.id)); toast('Entry removed.'); }}><Trash className="size-4" /></button>
                : <span className="w-8" />}
            </li>
          ))}
        </ul>
      ) : <p className="t-body py-6 text-center text-ink-3">Nothing yet. Bills you save and money you add show up here.</p>}
    </Modal>
  );
}

export { ArrowDownLeft };
