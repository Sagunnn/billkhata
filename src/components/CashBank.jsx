// Cash & bank card: what you have now, kept up to date as bills are saved. You add money in
// yourself (salary, a friend paying back), move money (ATM), and note spending without a bill.
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, History, Landmark, Plus, ReceiptText, RotateCcw, Trash, Wallet } from 'lucide-react';
import { money as fmt } from '../lib/format.js';
import { formatAD, todayAD } from '../lib/nepaliDate.js';
import { addEntry, creditsBySource, moneyNow, POTS, potOf, removeEntry, setStart, sourceOptions, spentBills } from '../lib/money.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Card, Field, Modal, Segmented } from './ui.jsx';

const KIND = {
  in: { title: 'Money in', button: 'Add money', hint: 'Salary, a friend paying you back, a refund.' },
  move: { title: 'Move money', button: 'Move', hint: 'An ATM withdrawal (bank → cash) or a cash deposit (cash → bank).' },
  out: { title: 'Spent without a bill', button: 'Take off', hint: 'A bus fare, a tip: money gone with no bill to scan.' },
};

const amountInput = (id, value, onChange, autoFocus) => (
  <input id={id} inputMode="decimal" autoFocus={autoFocus} className="input num text-lg font-semibold" placeholder="0" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
);

function SetAmounts({ current, onClose }) {
  const { setMoney } = useStore();
  const toast = useToast();
  const [cash, setCash] = useState(current.ready ? String(current.cash) : '');
  const [bank, setBank] = useState(current.ready ? String(current.bank) : '');
  function save() {
    setMoney((m) => setStart(m, { cash, bank }));
    toast('Amounts set. Bills you save from now on are taken off.');
    onClose();
  }
  return (
    <Modal open onClose={onClose} title={current.ready ? 'Set the amounts again' : 'What do you have now?'} size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save}>Save</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="text-sm text-slate-600">Count your cash, and check your bank and wallet apps. From now on every bill you save is taken off: cash bills from cash, QR and card bills from the bank.</p>
        <Field label="Cash in hand (रु)" htmlFor="mn-cash">{amountInput('mn-cash', cash, setCash, true)}</Field>
        <Field label="Bank & wallets (रु)" htmlFor="mn-bank" hint="All your accounts together: bank, eSewa, Khalti…">{amountInput('mn-bank', bank, setBank)}</Field>
        {current.ready && <p className="text-xs text-amber-800">This starts over from today. Money in and moves added so far stop counting.</p>}
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

/** Where money came from: a box with quick picks (sources used before first). */
function SourceField({ value, onChange, money }) {
  const options = sourceOptions(money);
  return (
    <Field label="From (source)" htmlFor="mn-src">
      <input id="mn-src" list="mn-src-list" className="input" value={value} maxLength={40} onChange={(e) => onChange(e.target.value)} placeholder="Salary, a friend, a refund…" autoComplete="off" />
      <datalist id="mn-src-list">{options.map((o) => <option key={o} value={o} />)}</datalist>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {options.slice(0, 6).map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)} className={`tap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${value === o ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{o}</button>
        ))}
      </div>
    </Field>
  );
}

function EntryForm({ kind, onClose }) {
  const { setMoney, money } = useStore();
  const [source, setSource] = useState('');
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [pot, setPot] = useState(kind === 'out' ? 'cash' : 'bank');
  const [dir, setDir] = useState('bank-cash');
  const [note, setNote] = useState(kind === 'move' ? 'ATM' : '');
  const [date, setDate] = useState(todayAD());
  const [error, setError] = useState('');
  const k = KIND[kind];
  function save() {
    try {
      const [from, to] = dir.split('-');
      setMoney((m) => addEntry(m, kind === 'move' ? { kind, amount, from, to, note, date } : { kind, amount, pot, note, date, source }));
      toast(`${k.title}${kind === 'in' && source.trim() ? ` from ${source.trim()}` : ''}: ${fmt(Number(amount))} saved.`);
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal open onClose={onClose} title={k.title} size="md" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={save}>{k.button}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="text-sm text-slate-600">{k.hint}</p>
        <Field label="Amount (रु)" htmlFor="mn-amt" error={error}>{amountInput('mn-amt', amount, (v) => { setAmount(v); setError(''); }, true)}</Field>
        {kind === 'in' && <SourceField value={source} onChange={setSource} money={money} />}
        {kind === 'move' ? (
          <Field label="From → to">
            <Segmented value={dir} onChange={setDir} options={[{ value: 'bank-cash', label: 'Bank → Cash' }, { value: 'cash-bank', label: 'Cash → Bank' }]} />
          </Field>
        ) : (
          <Field label={kind === 'in' ? 'Into' : 'From'}>
            <Segmented value={pot} onChange={setPot} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank & wallets' }]} />
          </Field>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <Field label="Note" htmlFor="mn-note"><input id="mn-note" className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'in' ? 'October, from Ram…' : kind === 'out' ? 'Bus fare' : ''} /></Field>
          <Field label="Date" htmlFor="mn-date"><input id="mn-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
      </form>
    </Modal>
  );
}

function HistoryList({ onClose }) {
  const { money, setMoney, expenses } = useStore();
  const toast = useToast();
  const bills = useMemo(() => spentBills(expenses, money), [expenses, money]);
  const bySource = creditsBySource(money);
  const rows = [
    ...(money.entries || []).map((x) => ({ ...x, sort: `${x.date}|${x.createdAt}` })),
    ...bills.map((e) => ({ id: e.id, kind: 'bill', pot: potOf(e), amount: Number(e.totalAmount) || 0, date: e.billDateAD, note: e.merchantName || 'Bill', sort: `${e.billDateAD}|${e.createdAt}` })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  const label = (x) => (x.kind === 'move' ? `${POTS[x.from]} → ${POTS[x.to]}` : POTS[x.pot]);
  const sign = (x) => (x.kind === 'in' ? '+' : x.kind === 'move' ? '' : '−');
  return (
    <Modal open onClose={onClose} title="Cash & bank history" size="md" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <p className="mb-2 text-sm text-slate-600">Since {formatAD(money.since)}: started with {fmt(money.start.cash)} cash and {fmt(money.start.bank)} in the bank.</p>
      {bySource.length > 0 && (
        <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 ring-1 ring-inset ring-emerald-200">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-900">Money in, by source</p>
          <ul className="mt-1 space-y-0.5">
            {bySource.map((c) => (
              <li key={c.source} className="flex justify-between gap-3 text-sm text-emerald-950">
                <span className="truncate">{c.source}{c.count > 1 ? <span className="text-emerald-800"> · {c.count} times</span> : ''}</span>
                <b className="num shrink-0">{fmt(c.amount)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length ? (
        <ul className="divide-y divide-slate-100">
          {rows.map((x) => (
            <li key={`${x.kind}-${x.id}`} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900">{x.kind === 'in' ? [x.source, x.note].filter(Boolean).join(': ') || 'Money in' : x.note || KIND[x.kind]?.title || 'Bill'}</span>
                <span className="num block text-xs text-slate-500">{formatAD(x.date)} · {x.kind === 'bill' ? 'bill' : KIND[x.kind].title.toLowerCase()} · {label(x)}</span>
              </span>
              <span className={`num shrink-0 text-sm font-bold ${x.kind === 'in' ? 'text-emerald-700' : 'text-slate-900'}`}>{sign(x)}{fmt(x.amount)}</span>
              {x.kind !== 'bill' ? (
                <button type="button" className="tap rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-brand" aria-label="Remove this entry" onClick={() => { setMoney((m) => removeEntry(m, x.id)); toast('Entry removed.'); }}><Trash className="size-4" /></button>
              ) : <span className="w-8" />}
            </li>
          ))}
        </ul>
      ) : <p className="py-6 text-center text-sm text-slate-500">Nothing yet. Bills you save, and money you add, show up here.</p>}
    </Modal>
  );
}

export function CashBankCard() {
  const { money, expenses } = useStore();
  const now = useMemo(() => moneyNow(money, expenses), [money, expenses]);
  const [open, setOpen] = useState(null); // 'set' | 'in' | 'move' | 'out' | 'history'
  const tile = (Icon, label, value) => (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Icon className="size-3.5" />{label}</p>
      <p className={`num mt-0.5 truncate text-xl font-extrabold ${value < 0 ? 'text-amber-700' : 'text-slate-900'}`}>{fmt(value)}</p>
    </div>
  );
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold"><Wallet className="size-4 text-navy" />Cash & bank</h2>
        {now.ready && (
          <span className="flex">
            <button type="button" onClick={() => setOpen('history')} className="tap rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="History" title="History"><History className="size-4" /></button>
            <button type="button" onClick={() => setOpen('set')} className="tap rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Set the amounts again" title="Set the amounts again"><RotateCcw className="size-4" /></button>
          </span>
        )}
      </div>
      {now.ready ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {tile(Banknote, 'Cash', now.cash)}
            {tile(Landmark, 'Bank & wallets', now.bank)}
          </div>
          <p className="num mt-2 text-sm text-slate-600">
            Total <b className="text-slate-900">{fmt(now.total)}</b>
            <span className="text-slate-400"> · </span>
            spent {fmt(now.spent.cash + now.spent.bank)} since {formatAD(money.since).replace(/ \d{4}$/, '')}
          </p>
          {(now.cash < 0 || now.bank < 0) && <p className="mt-1 text-xs text-amber-800">Below zero: add the money that came in, or set the amounts again.</p>}
          <div className="mt-3 grid grid-cols-[1.3fr_1fr_1fr] gap-2">
            <Button variant="dark" icon={Plus} className="whitespace-nowrap px-2" onClick={() => setOpen('in')}>Money in</Button>
            <Button icon={ArrowLeftRight} className="whitespace-nowrap px-2" onClick={() => setOpen('move')}>Move</Button>
            <Button icon={ReceiptText} className="whitespace-nowrap px-2" onClick={() => setOpen('out')} title="Spent without a bill">No bill</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">Enter what you have in cash and in the bank. Every bill you save after that is taken off, and you add money when it comes in, so you always know what’s left.</p>
          <Button variant="dark" className="mt-3" onClick={() => setOpen('set')}>Set my amounts</Button>
        </>
      )}
      {open === 'set' && <SetAmounts current={now} onClose={() => setOpen(null)} />}
      {['in', 'move', 'out'].includes(open) && <EntryForm kind={open} onClose={() => setOpen(null)} />}
      {open === 'history' && <HistoryList onClose={() => setOpen(null)} />}
    </Card>
  );
}
