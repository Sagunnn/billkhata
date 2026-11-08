// Money sheets (Figma: Phone 12 · Quick cash out, Home wallet card actions): set your accounts,
// money in, move money between accounts (ATM), quick cash out, and the history.
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, Banknote, Check, Landmark, Lock, Luggage, Pencil, Plus, Trash, Wallet } from 'lucide-react';
import { CATEGORIES, PAYMENT } from '../lib/constants.js';
import { blankExpense } from '../lib/expense.js';
import { money as fmt } from '../lib/format.js';
import { adToBs, formatAD, todayAD } from '../lib/nepaliDate.js';
import {
  ACCOUNT_SUGGESTIONS, addEntry, cashAccountId, creditsBySource, defaultAccountId, kindForName, moneyNow, potOf,
  editAccounts, entryId, removeEntry, restoreEntry, setAccounts, sourceOptions, spentBills, updateEntry,
} from '../lib/money.js';
import { ongoingTrips } from '../lib/trips.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Field, Modal } from './ui.jsx';

export const ACCOUNT_ICON = { cash: Banknote, bank: Landmark, wallet: Wallet };

/** The big centred amount with +20 / +50 / +100 / +500 nudges (Phone 12). */
export function AmountInput({ value, onChange, error, readOnly = false, autoFocus = true }) {
  return (
    <div className="flex flex-col items-center gap-3 pb-2">
      <label htmlFor="mn-amt" className="t-label text-ink-2">Amount</label>
      <div className={`flex items-baseline justify-center gap-1 border-b-2 pb-1 ${error ? 'border-danger' : 'border-transparent focus-within:border-brand'}`}>
        <span className="t-money-xl font-nepali text-ink">रु</span>
        <input
          id="mn-amt"
          inputMode="decimal"
          autoFocus={autoFocus && !readOnly}
          readOnly={readOnly}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          className="t-money-xl num w-[6ch] bg-transparent text-ink placeholder:text-ink-3 focus:outline-none"
          style={{ width: `${Math.max(2, String(value || '0').length + 0.5)}ch` }}
        />
      </div>
      {error && <p className="t-caption text-danger">{error}</p>}
      {!readOnly && <div className="flex flex-wrap justify-center gap-2">
        {[20, 50, 100, 500].map((n) => (
          <button key={n} type="button" onClick={() => onChange(String((Number(value) || 0) + n))} className="tap rounded-full bg-sunken px-4 py-1.5 text-[14px] font-medium text-ink-2 hover:text-ink">+{n}</button>
        ))}
      </div>}
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

function NoteField({ value, onChange, placeholder, id = 'mn-note', label = 'Note (optional)' }) {
  return (
    <Field label={label} htmlFor={id}>
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
  const { money, setMoney, expenses } = useStore();
  const toast = useToast();
  const now = useAccountsNow();
  const [rows, setRows] = useState(() => (now.ready
    ? now.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, start: String(a.balance), main: a.id === defaultAccountId(money) }))
    : [{ id: 'cash', name: 'Cash in hand', kind: 'cash', start: '' }, { name: 'eSewa', kind: 'wallet', start: '', main: true }]));
  const set = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const makeMain = (i) => setRows((r) => r.map((x, j) => ({ ...x, main: j === i })));
  const missing = ACCOUNT_SUGGESTIONS.filter((n) => !rows.some((r) => r.name.toLowerCase() === n.toLowerCase())).slice(0, 4);
  /** First time, or on purpose: every account starts at the amount given, from today. */
  function startOver() {
    setMoney((m) => {
      // Ids are given in order to the named rows, so the main row's id is found by position.
      const named = rows.filter((r) => String(r.name || '').trim());
      const next = setAccounts(m, named);
      const i = named.findIndex((r) => r.main);
      return i >= 0 && next.accounts[i]?.kind !== 'cash' ? { ...next, defaultAccount: next.accounts[i].id } : next;
    });
  }
  function save() {
    if (!now.ready) {
      startOver();
      toast('Accounts set. Bills you save from now on come off the account they were paid from.');
      onClose();
      return;
    }
    // Already set: edits never start over. A different amount is a correction for today.
    const current = Object.fromEntries(now.accounts.map((a) => [a.id, a.balance]));
    const used = new Set([
      ...spentBills(expenses, money).map((e) => potOf(e, money)),
      ...(money.entries || []).flatMap((x) => [x.account, x.pot, x.from, x.to]).filter(Boolean),
    ]);
    const { money: next, corrections } = editAccounts(money, rows, { current, used });
    setMoney(next);
    const sign = (n) => `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
    toast(corrections.length
      ? `Saved. ${corrections.map((c) => `${c.name} ${sign(c.amount)}`).join(', ')} added as ${corrections.length === 1 ? 'a correction' : 'corrections'} for today.`
      : 'Accounts saved.');
    onClose();
  }
  function restart() {
    if (!window.confirm('Start over from today? Every account starts at the amount shown here. Bills and money in from before today stop counting, and money in and moves can no longer be edited.')) return;
    startOver();
    toast('Started over from today.');
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
                {/* Name, and under it Main / Make main (cash: always here), so every row has the same columns. */}
                <span className="min-w-0 flex-1">
                  <input aria-label="Account name" className="block w-full bg-transparent text-[15px] font-medium leading-5 text-ink focus:outline-none" value={r.name} disabled={r.kind === 'cash'}
                    onChange={(e) => set(i, { name: e.target.value, kind: r.kind === 'cash' ? 'cash' : kindForName(e.target.value) })} placeholder="Bank or wallet" />
                  {r.kind === 'cash'
                    ? <span className="t-caption block text-ink-3">Counted by you</span>
                    : r.main
                      ? <span className="mt-0.5 inline-block rounded-full bg-navy-soft px-1.5 text-[12px] font-medium leading-4 text-navy">Main account</span>
                      : <button type="button" onClick={() => makeMain(i)} className="t-caption block text-ink-3 underline-offset-2 hover:text-ink hover:underline" title="Main account: QR and card bills come off it unless you pick another">Make main</button>}
                </span>
                <label className="flex w-[104px] shrink-0 items-center gap-1 rounded-[10px] border border-line-strong bg-raised px-2 focus-within:border-navy">
                  <span className="font-nepali text-[14px] text-ink-3">रु</span>
                  <input aria-label={`${r.name || 'Account'} amount`} inputMode="decimal" className="num min-w-0 flex-1 bg-transparent py-1.5 text-right text-[15px] text-ink focus:outline-none" value={r.start}
                    onChange={(e) => set(i, { start: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                </label>
                {r.kind !== 'cash'
                  ? <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="tap flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:text-danger"><Trash className="size-4" /></button>
                  : <span className="tap flex size-8 shrink-0 items-center justify-center text-ink-3" title="Cash in hand is always here"><Lock className="size-3.5" /></span>}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          {missing.map((n) => <button key={n} type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: n, kind: kindForName(n), start: '' }])}><Plus className="size-4" />{n}</button>)}
          <button type="button" className="chip tap" onClick={() => setRows((r) => [...r, { name: '', kind: 'bank', start: '' }])}><Plus className="size-4" />Other</button>
        </div>
        <p className="t-caption text-ink-3">Cash bills come off Cash in hand; QR and card bills off the account picked on the bill (the main one unless you choose).{now.ready ? ' Change an amount to what you really have and the difference is added as a correction for today; your bills and money in stay as they are.' : ''}</p>
        {now.ready && <button type="button" onClick={restart} className="t-caption text-ink-3 underline-offset-2 hover:text-ink hover:underline">Start over from today instead</button>}
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- Money in ---------- */

/** Removes an entry, with Undo on the toast. */
function useRemoveEntry() {
  const { setMoney } = useStore();
  const toast = useToast();
  return (entry) => {
    setMoney((m) => removeEntry(m, entry.id));
    toast(`${fmt(Math.abs(entry.amount))} ${entry.kind === 'move' ? 'move' : entry.kind === 'in' ? 'money in' : entry.kind === 'adjust' ? 'correction' : 'entry'} deleted${entry.bankKey ? '; its bank row can be added again' : ''}.`, 'success', {
      action: { label: 'Undo', run: () => setMoney((m) => restoreEntry(m, entry)) },
    });
  };
}

/** Taken back with the toast's Undo, right after adding it by mistake. */
function undoAdd(setMoney, id) {
  return { action: { label: 'Undo', run: () => setMoney((m) => removeEntry(m, id)) } };
}

const FromStatement = () => (
  <p className="t-caption text-center text-ink-3">The amount and date come from your bank statement. To take it out of Money, delete it: the bank row stays.</p>
);

/** `entry`: an entry already saved, to fix or delete (opened from History or the Money page). */
export function MoneyInSheet({ onClose, account: preset, entry }) {
  const { money, setMoney, statements, saveStatement } = useStore();
  const toast = useToast();
  const remove = useRemoveEntry();
  const now = useAccountsNow();
  const editing = Boolean(entry);
  const fromBank = Boolean(entry?.bankKey);
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [source, setSource] = useState(entry?.source || '');
  const [account, setAccount] = useState(entry?.account || entry?.pot || preset || defaultAccountId(money));
  const [note, setNote] = useState(entry?.note || '');
  const [date, setDate] = useState(entry?.date || todayAD());
  const [error, setError] = useState('');
  const options = sourceOptions(money).slice(0, 6);
  async function save() {
    const kind = source === 'Cash deposit' ? 'move' : 'in';
    const next = { kind, amount, account, from: cashAccountId(money), to: account, source, note, date };
    try {
      if (editing) {
        setMoney((m) => updateEntry(m, entry.id, next));
        // Money in from a statement row: the row takes the new title too, so both say the same.
        if (fromBank && source.trim() !== (entry.source || '')) {
          const st = statements.find((s) => s.rows.some((r) => r.key === entry.bankKey));
          if (st) await saveStatement({ ...st, rows: st.rows.map((r) => (r.key === entry.bankKey ? { ...r, source: source.trim().slice(0, 40) } : r)) });
        }
        toast(kind === 'move' ? `Changed to a cash deposit: ${fmt(Number(amount))} moved from cash.` : 'Money in saved.');
      } else {
        const id = entryId();
        setMoney((m) => addEntry(m, { ...next, id }));
        toast(`${fmt(Number(amount))} in${source ? ` from ${source}` : ''}.`, 'success', undoAdd(setMoney, id));
      }
      onClose();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal open keepFooter onClose={onClose} size="md" title={editing ? 'Edit money in' : 'Money in'} subtitle={editing ? `Added ${formatAD(entry.date)}` : 'Salary, a friend paying you back, a refund'}
      footer={editing ? (
        <>
          <Button variant="danger" icon={Trash} className="mr-auto" onClick={() => { remove(entry); onClose(); }}>Delete</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} onClick={save}>Save</Button>
        </>
      ) : <Button variant="primary" size="lg" icon={Check} className="w-full" onClick={save}>Add {amount ? fmt(Number(amount)) : 'money'}</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} error={error} readOnly={fromBank} autoFocus={!editing} />
        {fromBank && <FromStatement />}
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
          <Field label="Date" htmlFor="mn-date"><input id="mn-date" type="date" className="input" value={date} disabled={fromBank} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/* ---------- Move / ATM ---------- */

export function MoveSheet({ onClose, entry }) {
  const { money, setMoney } = useStore();
  const toast = useToast();
  const remove = useRemoveEntry();
  const now = useAccountsNow();
  const editing = Boolean(entry);
  const fromBank = Boolean(entry?.bankKey);
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [from, setFrom] = useState(entry?.from || defaultAccountId(money));
  const [to, setTo] = useState(entry?.to || cashAccountId(money));
  const [note, setNote] = useState(entry ? entry.note || '' : 'ATM');
  const [date, setDate] = useState(entry?.date || todayAD());
  const [error, setError] = useState('');
  function save() {
    const next = { kind: 'move', amount, from, to, note, date };
    try {
      const name = (id) => now.accounts.find((a) => a.id === id)?.name || id;
      if (editing) {
        setMoney((m) => updateEntry(m, entry.id, next));
        toast(`Move saved: ${fmt(Number(amount))}, ${name(from)} → ${name(to)}.`);
      } else {
        const id = entryId();
        setMoney((m) => addEntry(m, { ...next, id }));
        toast(`${fmt(Number(amount))} moved: ${name(from)} → ${name(to)}.`, 'success', undoAdd(setMoney, id));
      }
      onClose();
    } catch (e) { setError(e.message); }
  }
  return (
    <Modal open keepFooter onClose={onClose} size="md" title={editing ? 'Edit move' : 'ATM / Move'} subtitle={editing ? `Added ${formatAD(entry.date)}` : 'Money between your own accounts'}
      footer={editing ? (
        <>
          <Button variant="danger" icon={Trash} className="mr-auto" onClick={() => { remove(entry); onClose(); }}>Delete</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} onClick={save} disabled={from === to}>Save</Button>
        </>
      ) : <Button variant="primary" size="lg" icon={ArrowLeftRight} className="w-full" onClick={save} disabled={from === to}>Move {amount ? fmt(Number(amount)) : 'money'}</Button>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <AmountInput value={amount} onChange={(v) => { setAmount(v); setError(''); }} error={error} readOnly={fromBank} autoFocus={!editing} />
        {fromBank && <FromStatement />}
        <AccountPicker label="From" value={from} onChange={(v) => { setFrom(v); if (v === to) setTo(now.accounts.find((a) => a.id !== v)?.id || ''); }} accounts={now.accounts} />
        <AccountPicker label="To" value={to} onChange={setTo} accounts={now.accounts} exclude={from} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <NoteField value={note} onChange={setNote} placeholder="ATM, deposit" />
          <Field label="Date" htmlFor="mv-date"><input id="mv-date" type="date" className="input" value={date} max={todayAD()} disabled={fromBank} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
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
/** `split`: opened from Split, so after saving it goes on to sharing it with friends. */
export function QuickOutSheet({ onClose, split = false }) {
  const { money, profile, saveExpense, removeExpense, trips, openSheet } = useStore();
  const onTrip = ongoingTrips(trips)[0];
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
    const category = QUICK.find(([l]) => l === label)?.[1] || CATEGORIES.at(-1);
    const paymentMethod = acc ? (acc.kind === 'cash' ? PAYMENT.CASH : PAYMENT.DIGITAL) : method;
    if (!(Number(amount) > 0)) { setError('Enter an amount above zero.'); return; }
    const saved = await saveExpense({
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
    toast(`${fmt(Number(amount))} for ${note.trim() || label.toLowerCase()} saved${acc ? `, off ${acc.name}` : ''}.`, 'success',
      split ? {} : { action: { label: 'Undo', run: () => removeExpense(saved.id) } });
    if (again) { setAmount(''); setNote(''); setError(''); setCount((n) => n + 1); return; }
    onClose();
    if (split) window.location.hash = `#/split-bill/${encodeURIComponent(saved.id)}`;
  }

  return (
    <Modal open keepFooter onClose={onClose} size="md" title={split ? 'Quick expense to split' : 'Quick expense'}
      subtitle={split ? 'No bill: you paid, friends pay you back their part' : count ? `${count} saved · no bill needed` : 'No bill: a fare, snacks, a tip, a recharge'}
      footer={(
        <div className="w-full">
          <Button variant="primary" size="lg" icon={Check} className="w-full" onClick={() => save(false)}>{split ? `Next: who shares ${amount ? fmt(Number(amount)) : 'it'}` : `Save ${amount ? `${fmt(Number(amount))} ` : ''}expense`}</Button>
          {!split && <button type="button" onClick={() => save(true)} className="mt-2 w-full text-center text-[14px] font-medium text-brand">Save &amp; add another</button>}
          {acc && amount && <p className="t-caption mt-1 text-center text-ink-3">{acc.name} will show {fmt(after)}.</p>}
        </div>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        {onTrip && !split && (
          <button type="button" onClick={() => openSheet('tripQuick', { tripId: onTrip.id })}
            className="t-label flex w-full items-center gap-2 rounded-[12px] bg-marigold-soft px-3 py-2.5 text-left text-ink">
            <Luggage className="size-4 shrink-0 text-marigold-ink" />
            <span className="min-w-0 flex-1">On {onTrip.name}? <b className="font-medium text-brand">Add it to the trip</b> to split it.</span>
          </button>
        )}
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

/** What each kind of entry is called in History and on the Money page. */
export const ENTRY_KIND = { in: 'Money in', move: 'Moved', out: 'Spent, no bill', adjust: 'Correction', bill: 'Bill', quick: 'Quick expense' };
const DELETE_ONLY = new Set(['out', 'adjust']); // older no-bill spending and corrections: delete (with Undo), nothing to edit

/** Opens an entry or a bill to fix it; `back` is the sheet to return to after. */
export function useOpenEntry(back) {
  const { money, expenses, openSheet, openEditor } = useStore();
  const remove = useRemoveEntry();
  return (x) => {
    if (x.kind === 'bill' || x.kind === 'quick') { const e = expenses.find((y) => y.id === x.id); if (e) openEditor(e); return; }
    const entry = (money.entries || []).find((y) => y.id === x.id);
    if (!entry) return;
    if (entry.kind === 'in') openSheet('moneyIn', { entry, back });
    else if (entry.kind === 'move') openSheet('move', { entry, back });
    else if (window.confirm(`Delete this ${entry.kind === 'adjust' ? 'correction' : 'entry'} (${fmt(Math.abs(entry.amount))})?`)) remove(entry);
  };
}

/** One entry or bill: what, when, which account, the amount; tapping it opens it to fix. */
export function EntryRow({ x, name, onOpen }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(x)} className="tap flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunken/60"
        aria-label={`${DELETE_ONLY.has(x.kind) ? 'Delete' : 'Edit'} ${ENTRY_KIND[x.kind].toLowerCase()} ${fmt(Math.abs(x.amount))} on ${formatAD(x.date)}`}>
        <span className="min-w-0 flex-1">
          <span className="t-body block truncate font-semibold text-ink">{x.kind === 'in' ? [x.source, x.note].filter(Boolean).join(': ') : x.note || ENTRY_KIND[x.kind]}</span>
          <span className="t-caption num block truncate text-ink-3">{formatAD(x.date)} · {ENTRY_KIND[x.kind]} · {x.kind === 'move' ? `${name(x.from)} → ${name(x.to)}` : name(x.account || x.pot)}</span>
        </span>
        <span className={`num shrink-0 font-nepali text-[15px] font-semibold ${x.kind === 'in' || (x.kind === 'adjust' && x.amount > 0) ? 'text-leaf' : 'text-ink'}`}>{x.kind === 'in' || (x.kind === 'adjust' && x.amount > 0) ? '+ ' : x.kind === 'move' ? '' : '− '}{fmt(Math.abs(x.amount))}</span>
        {DELETE_ONLY.has(x.kind) ? <Trash className="size-4 shrink-0 text-ink-3" /> : <Pencil className="size-4 shrink-0 text-ink-3" />}
      </button>
    </li>
  );
}

/** Money in and moves, newest first. */
export const entriesNewestFirst = (money) => [...(money.entries || [])].sort((a, b) => `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`));

export function MoneyHistorySheet({ onClose }) {
  const { money, expenses } = useStore();
  const now = useAccountsNow();
  const open = useOpenEntry('moneyHistory');
  const name = (id) => now.accounts.find((a) => a.id === id)?.name || id;
  const bills = useMemo(() => spentBills(expenses, money), [expenses, money]);
  const bySource = creditsBySource(money);
  const rows = [
    ...(money.entries || []).map((x) => ({ ...x, sort: `${x.date}|${x.createdAt}` })),
    ...bills.map((e) => ({ id: e.id, kind: e.quick ? 'quick' : 'bill', account: potOf(e, money), amount: Number(e.totalAmount) || 0, date: e.billDateAD, note: e.merchantName || 'Bill', sort: `${e.billDateAD}|${e.createdAt}` })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  return (
    <Modal open onClose={onClose} size="md" title="Money history" subtitle={money.since ? `Since ${formatAD(money.since)} · tap one to fix or delete it` : ''}>
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
          {rows.map((x) => <EntryRow key={`${x.kind}-${x.id}`} x={x} name={name} onOpen={open} />)}
        </ul>
      ) : <p className="t-body py-6 text-center text-ink-3">Nothing yet. Bills you save and money you add show up here.</p>}
    </Modal>
  );
}

export { ArrowDownLeft };
