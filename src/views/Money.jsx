// Money (Figma: Phone 06 · Money): what you have in each account now, and the bank rows. A statement
// or payment screenshot is read on this device, each row matched with its bill, and the ones without
// one wait under "Need a look". Credits are counted into their own account with one tap.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, CircleCheck, Download, FileUp, History, ImageUp, Landmark, Link2, Link2Off, LoaderCircle, Lock, Pencil, Plus, Receipt, Search, ShieldCheck, Smartphone, Trash, TriangleAlert, Undo2, X } from 'lucide-react';
import { PAYMENT } from '../lib/constants.js';
import { blankExpense } from '../lib/expense.js';
import { downloadBlob, money } from '../lib/format.js';
import { adToBs, formatAD, shortBS, todayAD } from '../lib/nepaliDate.js';
import { newId } from '../lib/db.js';
import { ACCOUNT_NAMES, bankRowKey } from '../lib/bank/statement.js';
import { overlapWith, withoutOverlaps } from '../lib/bank/overlap.js';
import { accountForName, accountsOf, addEntry, cashAccountId, creditSource, creditState, defaultAccountId, entryFromCredit, moneyNow, potOf, retitleCredit, sourceOptions } from '../lib/money.js';
import { afterStatement, linkCandidates, mergedCsv, needsLook, unlinkPairs, visibleEntries } from '../lib/bank/reconcile.js';
import { useStore } from '../store.jsx';
import { takeStatement } from '../lib/statementHandoff.js';
import { useToast } from '../components/Toast.jsx';
import { Badge, Button, Card, Chip, EmptyState, Field, Modal, Segmented, useFileDrop } from '../components/ui.jsx';
import { ACCOUNT_ICON } from '../components/MoneySheets.jsx';

// MIME types too: iPhone's file picker greys out files whose type isn't listed.
const STATEMENT_TYPES = [
  '.pdf', '.csv', '.xlsx', '.xls', '.ods',
  'application/pdf', 'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/*',
].join(',');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDate = (d) => formatAD(d).replace(/ \d{4}$/, '');

/** "FONEPAY/712345678/KOTHEYS PIMBAL" → "Kotheys Pimbal", for a new bill's shop name. */
function shopFromNarration(text = '') {
  const words = text.split(/[\s/:|,-]+/).filter((w) => w && !/\d{4,}/.test(w)
    && !/^(fonepay|esewa|khalti|qr|payment|pay|to|from|trf|transfer|merchant|pos|purchase|ref|txn|by|via|mobile|banking|npr|rs)$/i.test(w));
  return words.join(' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}

/* ---------- statement upload ---------- */

function StatementUpload({ statements, onSaved, defaultName = '' }) {
  const { saveStatement } = useStore();
  const toast = useToast();
  const input = useRef(null);
  const [state, setState] = useState({ step: 'idle' }); // idle | reading | password | preview
  const [password, setPassword] = useState('');
  // A statement dropped on the Scan page comes here to be read.
  useEffect(() => { const f = takeStatement(); if (f) read(f); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function read(file, pw) {
    setState({ step: 'reading', file, status: 'Opening the statement' });
    try {
      const { readStatementFile } = await import('../lib/bank/importers.js');
      const st = await readStatementFile(file, { password: pw, onProgress: (p) => setState((s) => ({ ...s, status: p.status || s.status })) });
      setPassword('');
      setState({ step: 'preview', file, st });
    } catch (err) {
      if (err.needsPassword) setState({ step: 'password', file, wrong: err.wrongPassword });
      else { toast(err.message || 'Could not read that file.', 'error'); setState({ step: 'idle' }); }
    }
  }

  async function save(name) {
    const { st, file } = state;
    const id = newId();
    const meta = { bank: name.trim(), account: st.account };
    // Rows already saved from an overlapping statement of the same account are skipped, however
    // differently this file writes them (see overlap.js).
    const overlap = overlapWith(st.rows, meta, statements);
    const keys = new Set(statements.flatMap((s) => s.rows.map((r) => r.key)));
    const seen = new Map();
    const fresh = st.rows.flatMap((r, i) => {
      if (overlap.dupes.has(i)) return [];
      let key = bankRowKey(r);
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      if (n) key = `${key}#${n}`; // two identical rows on one statement are still two payments
      while (keys.has(key)) key = `${key}+`; // a different transaction that prints the same
      keys.add(key);
      return [{ ...r, key, seq: i, statementId: id }];
    });
    if (!fresh.length) { toast('Everything in this statement is already saved.', 'error'); setState({ step: 'idle' }); return; }
    await saveStatement({
      id, fileName: file.name, ...meta, from: st.from, to: st.to,
      openingBalance: st.openingBalance, closingBalance: st.closingBalance, checks: st.checks, warnings: st.warnings,
      rows: fresh, importedAt: new Date().toISOString(),
    });
    const spent = fresh.filter((r) => r.debit).length;
    const inCount = fresh.length - spent;
    toast(`Imported ${plural(spent, 'expense')}${inCount ? ` and ${inCount} money in` : ''}${overlap.count ? `; ${plural(overlap.count, 'row')} already saved from an earlier statement ${overlap.count === 1 ? 'was' : 'were'} skipped` : ''}.`);
    setState({ step: 'idle' });
    onSaved?.();
  }

  const { step } = state;
  const [dragging, dropProps] = useFileDrop((files) => (step === 'idle' || step === 'preview') && read(files[0]));
  return (
    <Card className={`p-4 transition ${dragging ? 'ring-2 ring-navy ring-offset-2' : ''}`} {...dropProps}>
      <h2 className="flex items-center gap-2 font-bold"><Landmark className="size-5 text-navy" />Bank statement</h2>
      <p className="mt-0.5 text-sm text-slate-600">The PDF your bank emails, or an Excel (.xlsx / .xls) or CSV export from your bank or wallet app. A screenshot works too, less exactly. Read on this device.</p>
      <input ref={input} type="file" accept={STATEMENT_TYPES} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />

      {step === 'idle' && (
        <>
          <Button className="mt-3 w-full" variant="dark" icon={FileUp} onClick={() => input.current?.click()}>{dragging ? 'Drop it here' : 'Upload statement'}</Button>
          <p className="mt-1.5 hidden text-center text-xs text-slate-500 md:block">or drop a PDF, Excel, CSV or screenshot on this box</p>
        </>
      )}
      {step === 'reading' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-700"><LoaderCircle className="size-4 animate-spin" />{state.status}…</p>
      )}
      {step === 'password' && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); read(state.file, password); }}>
          <Field label={<span className="flex items-center gap-1.5"><Lock className="size-4" />{state.wrong ? 'Wrong password, try again' : 'This PDF is locked'}</span>} htmlFor="st-pw" hint="Banks often use your date of birth or part of your account number. Used once to open the file; never saved.">
            <input id="st-pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="dark" disabled={!password}>Open</Button>
            <Button variant="ghost" onClick={() => setState({ step: 'idle' })}>Cancel</Button>
          </div>
        </form>
      )}
      {step === 'preview' && <StatementPreview st={state.st} statements={statements} defaultName={defaultName} onSave={save} onCancel={() => setState({ step: 'idle' })} />}
    </Card>
  );
}

/** Names to offer: ones you used before first, then common wallets and banks. */
function nameOptions(statements) {
  return [...new Set([...statements.map((s) => s.bank).filter(Boolean), ...ACCOUNT_NAMES])];
}

/** "Bank or wallet" box with suggestions, and quick picks for the likely ones. */
function AccountName({ id, value, onChange, statements, autoFocus }) {
  const options = nameOptions(statements);
  const quick = [...new Set([...statements.map((s) => s.bank).filter(Boolean), 'eSewa', 'Khalti', 'Laxmi Sunrise Bank'])].slice(0, 5);
  return (
    <div>
      <input id={id} list={`${id}-list`} className="input py-2" value={value} onChange={(e) => onChange(e.target.value)} placeholder="eSewa, Khalti, Laxmi Sunrise Bank…" autoComplete="off" autoFocus={autoFocus} maxLength={40} />
      <datalist id={`${id}-list`}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button key={q} type="button" onClick={() => onChange(q)} className={`tap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${value === q ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{q}</button>
        ))}
      </div>
    </div>
  );
}

function StatementPreview({ st, statements, onSave, onCancel, defaultName = '' }) {
  const { profile } = useStore();
  const [name, setName] = useState(st.bank || defaultName);
  const spent = st.rows.filter((r) => r.debit);
  const out = spent.reduce((s, r) => s + r.debit, 0);
  const credits = st.rows.filter((r) => r.credit);
  const inn = credits.reduce((t, r) => t + r.credit, 0);
  const overlap = useMemo(() => overlapWith(st.rows, { bank: name.trim(), account: st.account }, statements), [st, name, statements]);
  const dupOut = st.rows.filter((r, i) => r.debit && overlap.dupes.has(i)).length;
  const good = st.checks.checked > 0 && st.checks.ok === st.checks.checked;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <label htmlFor="st-name" className="mb-1 block text-xs font-semibold text-slate-700">
        Bank or wallet{st.bank ? '' : ': not named in the file, so pick or type it'}
      </label>
      <AccountName id="st-name" value={name} onChange={setName} statements={statements} />
      <p className="mt-2 font-semibold text-slate-900">{name.trim() || 'Statement'}{st.account ? ` ••${st.account}` : ''}</p>
      <p className="text-slate-600">{st.from ? `${formatAD(st.from)} – ${formatAD(st.to)}` : 'No dates found'} · {plural(spent.length, 'expense')} <b className="num text-slate-900">{money(out, profile.region)}</b>{credits.length > 0 && <> · {credits.length} in <b className="num text-emerald-700">{money(inn, profile.region)}</b></>}</p>
      {overlap.count > 0 && (
        <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-blue-900">
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          <span>{dupOut ? `${plural(dupOut, 'expense')} already saved` : `${plural(overlap.count, 'row')} already saved`}{overlap.from.length ? ` from ${overlap.from.map((s) => `${s.bank || 'a statement'} ${shortDate(s.from)} – ${shortDate(s.to)}`).join(', ')}` : ''}: skipped, so nothing is counted twice.</span>
        </p>
      )}
      {st.checks.checked > 0 && (
        <p className={`mt-1 flex items-center gap-1.5 font-medium ${good ? 'text-emerald-800' : 'text-amber-800'}`}>
          {good ? <CircleCheck className="size-4" /> : <TriangleAlert className="size-4" />}
          Amounts checked against the statement: {st.checks.ok} of {st.checks.checked} rows{st.checks.fixed ? ` (${st.checks.fixed} corrected)` : ''}
        </p>
      )}
      {st.warnings.map((w) => <p key={w} className="mt-1 text-amber-800">{w}</p>)}
      {st.rows.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white">
          {st.rows.slice(0, 8).map((r, i) => {
            const dup = overlap.dupes.has(i);
            return (
              <div key={i} className={`flex justify-between gap-2 border-b border-slate-100 px-2 py-1 text-xs last:border-0 ${dup ? 'text-slate-400' : ''}`}>
                <span className="truncate"><span className={dup ? '' : 'text-slate-500'}>{shortDate(r.date)}</span> {r.description}{dup ? ' · already saved' : ''}</span>
                <span className={`num shrink-0 font-semibold ${dup ? 'line-through' : r.credit ? 'text-emerald-700' : ''}`}>{r.credit ? '+' : ''}{money(r.debit ?? r.credit, profile.region, { symbol: false })}</span>
              </div>
            );
          })}
          {st.rows.length > 8 && <p className="px-2 py-1 text-xs text-slate-500">and {st.rows.length - 8} more</p>}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="dark" onClick={() => onSave(name)} disabled={!st.rows.length || overlap.count === st.rows.length}>{overlap.count === st.rows.length ? 'All already saved' : 'Add to ledger'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/* ---------- payment screenshots ---------- */

function sameScreenshot(a, b) {
  if (a.imageHash && a.imageHash === b.imageHash) return true;
  if (a.ref && a.ref === b.ref) return true;
  return a.amount > 0 && a.amount === b.amount && a.dateAD && a.dateAD === b.dateAD && a.time && a.time === b.time;
}

function ScreenshotUpload({ payments }) {
  const { savePayment } = useStore();
  const toast = useToast();
  const input = useRef(null);
  const [busy, setBusy] = useState('');

  async function add(files) {
    const list = [...files].filter((f) => /^image\//.test(f.type));
    if (!list.length) return;
    const { readPaymentScreenshot } = await import('../lib/bank/importers.js');
    const known = [...payments];
    let added = 0;
    let dupes = 0;
    let unread = 0;
    for (let i = 0; i < list.length; i++) {
      setBusy(`Reading screenshot ${i + 1} of ${list.length}`);
      try {
        const { image, imageHash, rawText, fields } = await readPaymentScreenshot(list[i]);
        const rec = { id: newId(), ...fields, image, imageHash, rawText, fileName: list[i].name, createdAt: new Date().toISOString() };
        if (known.some((p) => sameScreenshot(rec, p))) { dupes++; continue; }
        if (!(rec.amount > 0) || !rec.dateAD) unread++;
        known.push(await savePayment(rec));
        added++;
      } catch (err) {
        toast(`${list[i].name}: ${err.message || 'could not read it'}`, 'error');
      }
    }
    setBusy('');
    const parts = [`Added ${plural(added, 'screenshot')}`];
    if (dupes) parts.push(`${dupes} already added`);
    if (unread) parts.push(`${unread} need the amount or date filled in`);
    toast(`${parts.join('; ')}.`, unread ? 'error' : undefined);
  }

  const [dragging, dropProps] = useFileDrop((files) => !busy && add(files));
  return (
    <Card className={`p-4 transition ${dragging ? 'ring-2 ring-navy ring-offset-2' : ''}`} {...dropProps}>
      <h2 className="flex items-center gap-2 font-bold"><Smartphone className="size-5 text-navy" />Payment screenshots</h2>
      <p className="mt-0.5 text-sm text-slate-600">Success screens from Fonepay, eSewa, Khalti or your bank app. Pick several at once.</p>
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { const f = e.target.files; add(f ? [...f] : []); e.target.value = ''; }} />
      {busy ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-700"><LoaderCircle className="size-4 animate-spin" />{busy}…</p>
      ) : (
        <>
          <Button className="mt-3 w-full" variant="dark" icon={ImageUp} onClick={() => input.current?.click()}>{dragging ? 'Drop them here' : 'Add screenshots'}</Button>
          <p className="mt-1.5 hidden text-center text-xs text-slate-500 md:block">or drop several images on this box</p>
        </>
      )}
      {payments.length > 0 && <p className="mt-2 text-xs text-slate-500">{plural(payments.length, 'screenshot')} saved.</p>}
    </Card>
  );
}

function PaymentEditor({ payment, onClose }) {
  const { savePayment, deletePayment, profile } = useStore();
  const toast = useToast();
  const [p, setP] = useState({ ...payment, amount: payment.amount ?? '' });
  const set = (patch) => setP((x) => ({ ...x, ...patch }));
  async function save() {
    const amount = Number(p.amount);
    if (!(amount > 0)) { toast('Enter the amount paid.', 'error'); return; }
    if (!p.dateAD) { toast('Pick the payment date.', 'error'); return; }
    await savePayment({ ...p, amount, ref: String(p.ref || '').trim().toUpperCase(), refs: [...new Set([String(p.ref || '').trim().toUpperCase(), ...(payment.refs || [])].filter(Boolean))] });
    toast('Screenshot details saved.');
    onClose();
  }
  async function remove() {
    if (!window.confirm('Delete this screenshot?')) return;
    await deletePayment(p.id);
    onClose();
  }
  return (
    <Modal open onClose={onClose} title="Payment screenshot" size="xl" footer={<>
      <Button variant="danger" icon={Trash} onClick={remove} className="mr-auto">Delete</Button>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="dark" onClick={save}>Save</Button>
    </>}>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {p.image && <img src={p.image} alt="Payment screenshot" className="mx-auto max-h-[60dvh] rounded-lg border border-slate-200 object-contain" />}
        <div className="grid grid-cols-2 gap-3 self-start">
          <Field label={`Amount (${profile.region === 'Nepal' ? 'रु' : ''})`} htmlFor="pe-amt" className="col-span-2">
            <input id="pe-amt" inputMode="decimal" className="input num" value={p.amount} onChange={(e) => set({ amount: e.target.value })} />
          </Field>
          <Field label="Date" htmlFor="pe-date"><input id="pe-date" type="date" className="input" value={p.dateAD || ''} max={todayAD()} onChange={(e) => set({ dateAD: e.target.value })} /></Field>
          <Field label="Time" htmlFor="pe-time"><input id="pe-time" type="time" className="input" value={p.time || ''} onChange={(e) => set({ time: e.target.value })} /></Field>
          <Field label="Paid to" htmlFor="pe-to" className="col-span-2"><input id="pe-to" className="input" value={p.merchant || ''} onChange={(e) => set({ merchant: e.target.value })} /></Field>
          <Field label="Transaction ID" htmlFor="pe-ref" className="col-span-2" hint="Matching uses it when the bank prints it in the narration.">
            <input id="pe-ref" className="input font-mono" value={p.ref || ''} onChange={(e) => set({ ref: e.target.value })} />
          </Field>
          <div className="col-span-2">
            <Segmented value={p.direction || 'out'} onChange={(direction) => set({ direction })} options={[{ value: 'out', label: 'I paid' }, { value: 'in', label: 'I received' }]} />
          </div>
          {p.app && <p className="col-span-2 text-xs text-slate-500">Read as a {p.app} screen{p.status === 'failed' ? ' marked as failed' : ''}.</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- merged table ---------- */

function Sources({ x, compact }) {
  const chip = (on, Icon, label) => (
    <span title={on ? `${label}: found` : `${label}: not found`} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${on ? 'bg-emerald-50 text-emerald-800 ring-emerald-300' : 'bg-white text-slate-400 ring-slate-200'}`}>
      <Icon className="size-3" aria-hidden="true" />{compact ? <span className="sr-only">{label}{on ? '' : ' (not found)'}</span> : label}
    </span>
  );
  return (
    <span className={`inline-flex gap-1 ${compact ? '' : 'flex-wrap'}`}>
      {chip(x.bank, Landmark, 'Bank')}
      {/* Money in has no bill to find; a screenshot only when one was added. */}
      {(x.direction !== 'in' || x.payment) && chip(x.payment, Smartphone, 'Screenshot')}
      {x.direction !== 'in' && chip(x.expense, Receipt, 'Bill')}
    </span>
  );
}

/** Titles offered for a credit: ones you've given before, then the common ones. */
function useCreditTitles() {
  const { statements, money: m } = useStore();
  return useMemo(() => {
    const given = statements.flatMap((st) => st.rows.filter((r) => r.credit && r.source).map((r) => r.source));
    return [...new Set([...given.reverse(), ...sourceOptions(m)])];
  }, [statements, m]);
}

/** "Where did this money come from?": a title for a credited row, kept with the statement. */
function CreditTitle({ row }) {
  const { statements, saveStatement, money: m, setMoney } = useStore();
  const toast = useToast();
  const options = useCreditTitles();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const current = creditSource(row);
  function start() { setTitle(row.source || current); setOpen(true); }
  async function save() {
    const st = statements.find((x) => x.id === row.statementId);
    if (!st) { setOpen(false); return; }
    const value = title.trim().slice(0, 40);
    await saveStatement({ ...st, rows: st.rows.map((r) => (r.key === row.key ? { ...r, source: value } : r)) });
    // Already in Cash & bank: its entry takes the new title too.
    if ((m.entries || []).some((x) => x.bankKey === row.key)) setMoney((cur) => retitleCredit(cur, row.key, value));
    toast(value ? `Titled “${value}”.` : 'Title removed.');
    setOpen(false);
  }
  return (
    <>
      <button type="button" onClick={start} className="tap inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-navy hover:bg-blue-50" aria-label={current ? `Change where ${money(row.credit)} came from` : `Say where ${money(row.credit)} came from`}>
        <Pencil className="size-3" />{current ? 'Change' : 'Where from?'}
      </button>
      {open && (
        <Modal open size="md" title="Where did this money come from?" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="dark" onClick={save}>Save</Button></>}>
          <form onSubmit={(e) => { e.preventDefault(); save(); }}>
            <p className="mb-3 text-sm text-slate-600"><b className="num text-emerald-700">+{money(row.credit)}</b> on {formatAD(row.date)} · <span className="break-words">{row.description}</span></p>
            <label htmlFor="cr-title" className="label">Title</label>
            <input id="cr-title" list="cr-title-list" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} autoFocus autoComplete="off" placeholder="Salary, Ram paid back, from Dad…" />
            <datalist id="cr-title-list">{options.map((o) => <option key={o} value={o} />)}</datalist>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {options.slice(0, 8).map((o) => (
                <button key={o} type="button" onClick={() => setTitle(o)} className={`tap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${title === o ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}>{o}</button>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">“Cash deposit” means you put your own cash in: on the Money page it moves money from cash into this account instead of counting as new money.</p>
            <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>Save</button>
          </form>
        </Modal>
      )}
    </>
  );
}

function Details({ x }) {
  const { statements } = useStore();
  const source = x.bank && statements.find((s) => s.id === x.bank.statementId)?.bank;
  // Money in: its title (where it came from) leads, the bank's narration below it.
  if (x.direction === 'in' && x.bank) {
    const title = creditSource(x.bank);
    return (
      <div className="min-w-0">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1">
          <span className={`truncate font-semibold ${title ? 'text-slate-900' : 'italic text-slate-500'}`}>{title || 'Untitled money in'}</span>
          {title && !x.bank.source && <span className="text-xs text-slate-400">(guessed)</span>}
          <CreditTitle row={x.bank} />
        </p>
        <p className="truncate text-xs text-slate-500" title={x.bank.description}><span className="font-semibold text-slate-600">{source || 'Bank'}: </span>{x.bank.description || '—'}</p>
      </div>
    );
  }
  const lines = [];
  if (x.expense) lines.push(['Bill', `${x.expense.merchantName}${x.expense.billCode ? ` · ${x.expense.billCode}` : ''}`]);
  if (x.payment) lines.push(['Paid to', `${x.payment.merchant || '—'}${x.payment.app ? ` · ${x.payment.app}` : ''}${x.payment.ref ? ` · ${x.payment.ref}` : ''}`]);
  if (x.bank) lines.push([source || 'Bank', x.bank.description || '—']);
  return (
    <div className="min-w-0">
      {lines.map(([k, v], i) => (
        <p key={k} className={i === 0 ? 'truncate font-semibold text-slate-900' : 'truncate text-xs text-slate-500'} title={v}>
          {i > 0 && <span className="font-semibold text-slate-600">{k}: </span>}{v}
        </p>
      ))}
    </div>
  );
}

function Amount({ x, region }) {
  const isIn = x.direction === 'in';
  return (
    <span className={`num whitespace-nowrap font-semibold ${isIn ? 'text-emerald-700' : 'text-slate-900'}`}>
      {isIn ? '+' : ''}{money(x.amount, region)}
    </span>
  );
}

function LinkPicker({ entry, candidates, region, onPick, onClose }) {
  return (
    <Modal open onClose={onClose} title="Link to…" size="md">
      <p className="mb-3 text-sm text-slate-600">Same amount ({money(entry.amount, region)}) within a week of {formatAD(entry.date)}:</p>
      <div className="space-y-2">
        {candidates.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-navy hover:bg-slate-50">
            <span className="min-w-0">
              <span className="block text-xs text-slate-500">{formatAD(c.date)}{c.time ? ` · ${c.time}` : ''}</span>
              <Details x={c} />
              <span className="mt-1 block"><Sources x={c} /></span>
            </span>
            <Amount x={c} region={region} />
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- what you have now ---------- */

/** "Statement up to 15 Kartik", "Screenshots up to today", "Counted by you · 2 bills today". */
function freshness(a, { statements, payments, expenses, m, today }) {
  if (a.kind === 'cash') {
    const n = expenses.filter((e) => !e.isSample && e.billDateAD === today && potOf(e, m) === a.id).length;
    return `Counted by you${n ? ` · ${plural(n, 'bill')} today` : ''}`;
  }
  const mine = statements.filter((s) => accountForName(m, s.bank)?.id === a.id).map((s) => s.to).filter(Boolean).sort();
  const shots = payments.filter((p) => p.dateAD && accountForName(m, p.app)?.id === a.id).map((p) => p.dateAD).sort();
  const main = a.id === defaultAccountId(m) ? ' · Main' : '';
  if (shots.length && (!mine.length || shots.at(-1) > mine.at(-1))) return `Screenshots up to ${shots.at(-1) === today ? 'today' : shortBS(shots.at(-1))}${main}`;
  if (mine.length) return `Statement up to ${shortBS(mine.at(-1))}${main}`;
  return `Set by you ${shortBS(m.since)}${main}`;
}

const isAtm = (x) => Boolean(x.bank && !x.payment && !x.expense && x.direction === 'out' && /\b(ATM|WDL|WITHDRAWAL|CASH ?WD)\b/i.test(x.bank.description || ''));

const ICON_TONE = { cash: 'bg-sunken text-ink-2', bank: 'bg-navy-soft text-navy', wallet: 'bg-leaf-soft text-leaf' };

export function AccountsCard({ compact = false, onAddStatement }) {
  const { money: m, expenses, statements, payments, openSheet } = useStore();
  const now = useMemo(() => moneyNow(m, expenses), [m, expenses]);
  if (!now.ready) {
    return (
      <Card className="p-5">
        <p className="t-overline text-ink-3">What you have now</p>
        <p className="t-body mt-2 text-ink-2">Set what's in your cash, bank and wallets once. Every bill you save then comes off the account it was paid from.</p>
        <Button variant="primary" className="mt-4 w-full" icon={Plus} onClick={() => openSheet('accounts')}>Set your accounts</Button>
      </Card>
    );
  }
  const today = todayAD();
  const ctx = { statements, payments, expenses, m, today };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-overline text-ink-3">What you have now</p>
          <p className="t-money-xl num mt-1 font-nepali text-ink">{money(now.total)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" onClick={() => openSheet('moneyHistory')} className="tap rounded-full p-2 text-ink-2 hover:bg-sunken" aria-label="Money history" title="History"><History className="size-5" /></button>
          <button type="button" onClick={() => openSheet('accounts')} className="tap rounded-full p-2 text-ink-2 hover:bg-sunken" aria-label="Edit accounts" title="Edit accounts"><Pencil className="size-5" /></button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {now.accounts.map((a) => {
          const Icon = ACCOUNT_ICON[a.kind] || Landmark;
          return (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] ${ICON_TONE[a.kind] || ICON_TONE.bank}`}><Icon className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-semibold text-ink">{a.name}</span>
                {!compact && (
                  <span className="t-caption flex min-w-0 items-center gap-1.5 text-ink-3">
                    <span className="truncate">{freshness(a, ctx)}</span>
                    {onAddStatement && a.kind !== 'cash' && (
                      <button type="button" onClick={() => onAddStatement(a.name)} className="shrink-0 font-medium text-brand hover:underline" aria-label={`Upload a ${a.name} statement`}>· {/^(Statement|Screenshots)/.test(freshness(a, ctx)) ? 'Upload newer' : 'Upload statement'}</button>
                    )}
                  </span>
                )}
              </span>
              <span className={`num shrink-0 font-nepali text-[16px] font-semibold ${a.balance < 0 ? 'text-danger' : 'text-ink'}`}>{money(a.balance)}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function MoneyActions({ className = '' }) {
  const { openSheet, money: m } = useStore();
  const ready = Boolean(m.since);
  const go = (type) => openSheet(ready ? type : 'accounts');
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      <Button className="w-full" onClick={() => go('moneyIn')}>Money in</Button>
      <Button className="w-full" onClick={() => go('move')}>Move</Button>
      <Button className="w-full whitespace-nowrap px-2" onClick={() => openSheet('quickOut')} shortcut="Q">No-bill expense</Button>
    </div>
  );
}

/* ---------- bank rows ---------- */

/** The one status a row shows, and whether it needs a look (credits not counted yet do too). */
/** A transfer row's two accounts in Money (ids, or '' when that account isn't set up). */
function transferAccounts(x, m, statements) {
  const t = x.bank.transfer;
  const here = accountForName(m, statements.find((s) => s.id === x.bank.statementId)?.bank)?.id || '';
  const there = accountForName(m, t.other)?.id || '';
  return t.dir === 'out' ? { from: here, to: there } : { from: there, to: here };
}
const movedFor = (x, m) => (m.entries || []).some((e) => e.kind === 'move' && (e.bankKey === x.bank.key || (x.bank.transfer?.partner && e.bankKey === x.bank.transfer.partner)));

function rowStatus(x, { range, m, result }) {
  const note = needsLook(x, range);
  if (x.bank?.transfer) {
    const t = x.bank.transfer;
    const where = t.dir === 'out' ? `to ${t.other || 'your wallet'}` : `from ${t.other || 'your bank'}`;
    return movedFor(x, m)
      ? { tone: 'success', icon: ArrowLeftRight, label: `Moved ${where} · counted` }
      : { tone: 'info', icon: ArrowLeftRight, label: `Transfer ${where}`, title: 'Between your own accounts: not spending, not money in' };
  }
  if (x.direction === 'in' && x.bank) {
    const state = creditState(m, x.bank);
    if (state === 'ready') return { tone: 'info', icon: ArrowDownLeft, label: 'Money in · not counted yet', look: true };
    if (state === 'added') return { tone: 'success', icon: CircleCheck, label: 'Counted in Money' };
    if (state === 'before') return { tone: 'neutral', label: 'Before your start', title: "Dated before you set your accounts, so it's already in them" };
    return { tone: 'neutral', icon: ArrowDownLeft, label: 'Money in' };
  }
  if (x.expense && (x.bank || x.payment) && !note) return { tone: 'success', icon: Link2, label: `Matched${x.expense.billCode ? ` · ${x.expense.billCode}` : ''}`, matched: true };
  if (x.bank?.notBill && !x.expense && !x.payment) {
    return (m.entries || []).some((e) => e.bankKey === x.bank.key && e.kind === 'move')
      ? { tone: 'success', icon: ArrowLeftRight, label: 'Moved to cash' }
      : { tone: 'neutral', icon: X, label: 'Not a bill' };
  }
  if (note) {
    const fits = x.bank && !x.payment && !x.expense ? linkCandidates(x, result).filter((c) => c.expense || c.payment).length : 0;
    if (x.bank && !x.payment && !x.expense) {
      return fits
        ? { tone: 'warning', icon: TriangleAlert, label: `Unmatched · ${plural(fits, 'bill')} fit`, look: true, note, fits }
        : { tone: 'warning', icon: TriangleAlert, label: 'Missing bill', look: true, note };
    }
    if (!x.bank && x.expense && !x.payment) return { tone: 'warning', icon: TriangleAlert, label: 'Not on the statement', look: true, note };
    return { tone: 'warning', icon: TriangleAlert, label: note.split(':')[0], look: true, note };
  }
  if (x.payment && !x.expense && x.direction === 'out') return { tone: 'info', icon: Smartphone, label: x.bank ? 'Screenshot · no bill' : 'Screenshot' };
  return { tone: 'neutral', label: afterStatement(x, range) ? 'After the last statement' : 'On the statement' };
}

/** How many Money rows need a look: for the nav count. */
export function moneyLookCount({ bankRecon, money: m }) {
  const { result, range } = bankRecon;
  return visibleEntries(result.entries, range).filter((x) => rowStatus(x, { range, m, result }).look).length;
}

function rowAccount(x, statements) {
  if (x.bank) return statements.find((s) => s.id === x.bank.statementId)?.bank || 'Bank';
  if (x.payment) return x.payment.app || 'Screenshot';
  return x.expense?.paymentMethod === PAYMENT.DIGITAL ? 'QR / card bill' : 'Cash';
}

function RowCard({ x, st, actions, statements }) {
  const isIn = x.direction === 'in';
  const narration = x.bank?.description || x.payment?.merchant || x.expense?.merchantName || '—';
  const title = isIn && x.bank && !x.bank.transfer ? creditSource(x.bank) : '';
  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-caption text-ink-3">{shortBS(x.date)}{x.time ? ` · ${x.time}` : ''} · {rowAccount(x, statements)}</p>
          {title && <p className="t-body mt-0.5 font-semibold text-ink">{title}{!x.bank.source && <span className="t-caption font-normal text-ink-3"> (guessed)</span>}</p>}
          <p className="t-mono-s mt-0.5 break-words text-[13px] uppercase leading-[18px] text-ink">{narration}</p>
          {x.expense && x.bank && <p className="t-caption mt-0.5 truncate text-ink-2">Bill: {x.expense.merchantName}</p>}
        </div>
        <span className={`num shrink-0 font-nepali text-[16px] font-semibold ${isIn ? 'text-leaf' : 'text-ink'}`}>{isIn ? '+ ' : '− '}{money(x.amount)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Badge tone={st.tone} icon={st.icon} title={st.note || st.title}>{st.label}</Badge>
        {isIn && x.bank && !x.bank.transfer && <CreditTitle row={x.bank} />}
      </div>
      {actions}
    </li>
  );
}

export default function Money() {
  const { statements, payments, profile, reconOverrides, setReconOverrides, deleteStatement, saveStatement, clearBankData, openEditor, openSheet, bankRecon, money: m, setMoney } = useStore();
  const toast = useToast();
  const region = profile.region;
  const [uploading, setUploading] = useState(() => (window.location.hash.includes('?upload') ? { name: '' } : false));
  useEffect(() => { if (window.location.hash.includes('?upload')) window.history.replaceState(null, '', '#/money'); }, []);
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [linking, setLinking] = useState(null);
  const [more, setMore] = useState(40);

  const { result, range } = bankRecon;
  const shown = useMemo(() => visibleEntries(result.entries, range), [result, range]);
  const rows = useMemo(() => shown.map((x) => ({ x, st: rowStatus(x, { range, m, result }) })).reverse(), [shown, range, m, result]);
  const lookCount = rows.filter((r) => r.st.look).length;
  const [filter, setFilter] = useState(() => (lookCount ? 'look' : 'all'));
  const q = search.trim().toLowerCase();
  const list = rows.filter(({ x, st }) => {
    if (filter === 'look' && !st.look) return false;
    if (filter === 'out' && x.direction !== 'out') return false;
    if (filter === 'in' && x.direction !== 'in') return false;
    if (!q) return true;
    const hay = [x.bank?.description, x.bank && creditSource(x.bank), x.payment?.merchant, x.payment?.ref, x.expense?.merchantName, x.expense?.billCode, x.amount].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const matched = rows.filter((r) => r.st.matched);
  const rowCount = statements.reduce((t, s) => t + s.rows.length, 0);
  const skipped = statements.some((s) => s.overlapRemoved);

  // Credits: how much came in, and how much is counted in Money.
  const credits = rows.filter((r) => r.x.direction === 'in' && r.x.bank && !r.x.bank.transfer);
  const ready = credits.filter((r) => creditState(m, r.x.bank) === 'ready');
  const creditTotal = credits.reduce((t, r) => t + r.x.amount, 0);
  const accountOf = (row) => accountForName(m, statements.find((s) => s.id === row.statementId)?.bank)?.id;
  function addCredit(row) {
    const entry = entryFromCredit(row, accountOf(row), m);
    setMoney((cur) => addEntry(cur, entry));
    const name = accountsOf(m).find((a) => a.id === (entry.account || entry.to))?.name || 'your main account';
    toast(entry.kind === 'move' ? `Cash deposit: ${money(row.credit)} moved from cash to ${name}.` : `${money(row.credit)} added to ${name} (${entry.source}).`);
  }
  function addAllCredits() {
    setMoney((cur) => ready.reduce((acc, r) => addEntry(acc, entryFromCredit(r.x.bank, accountOf(r.x.bank), acc)), cur));
    toast(`${plural(ready.length, 'credit')} added (${money(ready.reduce((t, r) => t + r.x.amount, 0), region)}).`);
  }

  function unlink(x) {
    const nodes = new Set(x.nodes);
    setReconOverrides({
      links: reconOverrides.links.filter((l) => !l.some((n) => nodes.has(n))),
      unlinks: [...new Set([...reconOverrides.unlinks, ...unlinkPairs(x)])],
    });
    toast('Unlinked. They stay apart from now on.');
  }
  function link(x, c) {
    const nodes = [...x.nodes, ...c.nodes];
    const set = new Set(nodes);
    setReconOverrides({
      links: [...reconOverrides.links.filter((l) => !l.some((n) => set.has(n))), nodes],
      unlinks: reconOverrides.unlinks.filter((k) => !k.split('|').every((n) => set.has(n))),
    });
    setLinking(null);
    toast('Matched.');
  }
  function addBill(x) {
    const date = x.payment?.dateAD || x.bank?.date || todayAD();
    const e = blankExpense(region);
    const acct = x.bank && accountOf(x.bank);
    openEditor({
      ...e,
      merchantName: x.payment?.merchant || shopFromNarration(x.bank?.description),
      totalAmount: x.amount,
      billDateAD: date,
      billDateBS: adToBs(date) || '',
      paymentMethod: PAYMENT.DIGITAL,
      ...(acct ? { paidFrom: acct } : {}),
      source: 'bank', // no paper bill yet: a later scan of it can take this bill's place
      notes: [x.bank && `Bank: ${x.bank.description}`, x.payment?.ref && `Txn ${x.payment.ref}`].filter(Boolean).join(' · '),
    });
  }
  async function setNotBill(x, on, quiet = false) {
    const st = statements.find((s) => s.id === x.bank.statementId);
    if (!st) return;
    await saveStatement({ ...st, rows: st.rows.map((r) => (r.key === x.bank.key ? { ...r, notBill: on } : r)) });
    // Undo also takes back an ATM move made from this row.
    if (!on) setMoney((cur) => ({ ...cur, entries: (cur.entries || []).filter((e) => !(e.bankKey === x.bank.key && e.kind === 'move')) }));
    if (!quiet) toast(on ? 'Marked as not a bill: a transfer, top-up or fee.' : 'Back in Need a look.');
  }
  /** Marks a row as a transfer between your own accounts (true), never one (false). */
  async function setTransfer(x, on) {
    const st = statements.find((s) => s.id === x.bank.statementId);
    if (!st) return;
    await saveStatement({ ...st, rows: st.rows.map((r) => (r.key === x.bank.key ? { ...r, isTransfer: on } : r)) });
    if (!on) setMoney((cur) => ({ ...cur, entries: (cur.entries || []).filter((e) => !(e.kind === 'move' && e.bankKey === x.bank.key)) }));
    toast(on ? 'Marked as a transfer between your accounts: not spending, not money in.' : 'Not a transfer: it counts again.');
  }
  // A transfer counted in Money: the amount moves from one account to the other, once per pair.
  function countMove(x, from, to) {
    setMoney((cur) => addEntry(cur, { kind: 'move', from, to, amount: x.amount, date: x.bank.date, note: x.bank.description, bankKey: x.bank.key }));
    const name = (id) => accountsOf(m).find((a) => a.id === id)?.name || id;
    toast(`${money(x.amount)} moved from ${name(from)} to ${name(to)}.`);
  }
  // An ATM withdrawal isn't spending: the money moves from this account to cash in hand.
  async function atmToCash(x) {
    const from = accountOf(x.bank) || defaultAccountId(m);
    if (!(m.entries || []).some((e) => e.bankKey === x.bank.key)) {
      setMoney((cur) => addEntry(cur, { kind: 'move', from, to: cashAccountId(cur), amount: x.amount, date: x.bank.date, note: x.bank.description, bankKey: x.bank.key }));
    }
    await setNotBill(x, true, true);
    toast(`${money(x.amount)} moved to Cash in hand.`);
  }
  function exportCsv() {
    downloadBlob(new Blob([mergedCsv(list.map((r) => r.x).reverse(), range)], { type: 'text/csv' }), `billkhata_bank_${todayAD().replace(/-/g, '_')}.csv`);
  }
  async function removeStatement(s) {
    if (!window.confirm(`Remove the ${s.bank || 'bank'} statement (${formatAD(s.from)} – ${formatAD(s.to)}) and its ${s.rows.length} rows? Bills and screenshots stay.`)) return;
    await deleteStatement(s.id);
    toast('Statement removed.');
  }
  async function rename() {
    const s = statements.find((x) => x.id === renaming.id);
    if (s) await saveStatement({ ...s, bank: renaming.name.trim() });
    setRenaming(null);
  }
  async function clearAll() {
    if (!window.confirm('Delete every statement and payment screenshot in this browser? Bills stay.')) return;
    await clearBankData();
    toast('Bank data deleted.');
  }

  function actionsFor(x, st) {
    const out = [];
    const canLink = x.nodes.length < 3 && linkCandidates(x, result).length > 0;
    if (x.bank?.transfer) {
      const { from, to } = transferAccounts(x, m, statements);
      if (!movedFor(x, m) && m.since && x.bank.date >= m.since) {
        if (from && to && from !== to) out.push(<Button key="mv" icon={ArrowLeftRight} onClick={() => countMove(x, from, to)}>Count as move</Button>);
        else out.push(<span key="mv" className="t-caption text-ink-3">Add {x.bank.transfer.other || 'the other account'} under your accounts to count it</span>);
      }
      out.push(<Button key="nt" variant="ghost" icon={X} onClick={() => setTransfer(x, false)}>Not a transfer</Button>);
    } else if (x.direction === 'in' && x.bank) {
      const state = creditState(m, x.bank);
      if (state === 'ready') out.push(<Button key="add" icon={ArrowDownLeft} onClick={() => addCredit(x.bank)}>Add to Money</Button>);
      if (state === 'not-set') out.push(<Button key="set" variant="ghost" onClick={() => openSheet('accounts')}>Set your accounts</Button>);
    } else if (!x.expense && x.direction === 'out') {
      if (st.fits) {
        out.push(<Button key="match" variant="tonal" icon={Link2} onClick={() => setLinking(x)}>Match invoice</Button>);
      } else {
        if (!x.bank?.notBill) out.push(<Button key="attach" variant="tonal" icon={Plus} onClick={() => addBill(x)}>Attach bill</Button>);
        if (canLink) out.push(<Button key="match" icon={Link2} onClick={() => setLinking(x)}>Match invoice</Button>);
      }
      if (isAtm(x) && !x.bank.notBill && m.since && x.bank.date >= m.since) out.push(<Button key="atm" icon={ArrowLeftRight} onClick={() => atmToCash(x)}>Moved to cash</Button>);
      else if (x.bank && !x.payment && !x.bank.notBill) out.push(<Button key="nb" variant="ghost" icon={X} onClick={() => setNotBill(x, true)}>Not a bill</Button>);
      if (x.bank?.notBill) out.push(<Button key="undo" variant="ghost" icon={Undo2} onClick={() => setNotBill(x, false)}>Undo</Button>);
    }
    const icon = (label, I, onClick) => (
      <button key={label} type="button" onClick={onClick} title={label} aria-label={label} className="tap rounded-full p-2 text-ink-2 hover:bg-sunken hover:text-ink"><I className="size-[18px]" /></button>
    );
    const small = [
      x.bank && !x.bank.transfer && !x.expense && !x.payment && icon('Transfer between my own accounts', ArrowLeftRight, () => setTransfer(x, true)),
      x.expense && icon('Open bill', Receipt, () => openEditor(x.expense)),
      x.payment && icon('Screenshot', Smartphone, () => setEditing(x.payment)),
      x.nodes.length > 1 && icon('Unlink', Link2Off, () => unlink(x)),
    ].filter(Boolean);
    if (!out.length && !small.length) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {out}
        {small.length > 0 && <span className="ml-auto flex">{small}</span>}
      </div>
    );
  }

  const empty = !statements.length && !payments.length;
  const uploads = (
    <div className="grid gap-3 md:grid-cols-2">
      <StatementUpload statements={statements} defaultName={uploading?.name || ''} onSaved={() => { setUploading(false); setFilter('look'); }} />
      <ScreenshotUpload payments={payments} />
    </div>
  );
  return (
    <div>
      <h1 className="t-h-l mb-4 text-ink">Money</h1>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-3 lg:sticky lg:top-6">
          <AccountsCard />
          <MoneyActions />
          {/* Uploading a statement is this page's main job, so it's a big button, not a corner icon. */}
          <div>
            <Button variant="primary" size="lg" icon={FileUp} className="w-full" onClick={() => setUploading({ name: '' })}>Upload statement</Button>
            <p className="t-caption mt-1.5 text-center text-ink-3">Bank or wallet · PDF, Excel, CSV or screenshot · read on this device</p>
          </div>
          {credits.length > 0 && (
            <div className="t-label rounded-[14px] bg-leaf-soft px-3.5 py-3 text-ink">
              <p><span className="text-leaf">Credited</span> <b className="num font-nepali">{money(creditTotal, region)}</b> in {plural(credits.length, 'row')}</p>
              <p className="t-caption mt-0.5 text-ink-2">
                {Object.entries(credits.reduce((by, { x }) => { const k = creditSource(x.bank) || 'Untitled'; by[k] = (by[k] || 0) + x.amount; return by; }, {}))
                  .sort((a, b) => b[1] - a[1]).slice(0, 4)
                  .map(([k, v]) => `${k} ${money(v, region)}`).join(' · ')}
              </p>
              {ready.length > 0 && m.since && <Button size="sm" className="mt-2" icon={Plus} onClick={addAllCredits}>Add the rest ({ready.length})</Button>}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {empty ? (
            <>
              <h2 className="t-h-m mb-3 text-ink">Bank rows</h2>
              <Card className="mb-3">
                <EmptyState icon={Landmark} title="No statements yet">
                  Upload a bank or wallet statement and each row is matched with your bills and payment screenshots, so you can see what every payment was for.
                </EmptyState>
              </Card>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="t-h-m text-ink">Bank rows</h2>
                <span className="t-label num text-ink-3">{plural(statements.length, 'statement')} · {plural(rowCount, 'row')}</span>
              </div>
              <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
                <Chip selected={filter === 'look'} onClick={() => setFilter('look')}>Need a look · {lookCount}</Chip>
                <Chip selected={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
                <Chip selected={filter === 'out'} onClick={() => setFilter('out')}>Out</Chip>
                <Chip selected={filter === 'in'} onClick={() => setFilter('in')}>In</Chip>
              </div>
              {filter !== 'look' && (
                <div className="relative mt-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
                  <input data-search className="input pl-9" placeholder="Search narration, shop, ID, amount" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bank rows" />
                </div>
              )}

              {list.length ? (
                <ul className="mt-3 space-y-3">
                  {list.slice(0, more).map(({ x, st }) => <RowCard key={x.id} x={x} st={st} statements={statements} actions={actionsFor(x, st)} />)}
                </ul>
              ) : (
                <Card className="mt-3">
                  {filter === 'look'
                    ? <EmptyState icon={CircleCheck} title="Nothing needs a look">Every payment has its bill or screenshot.</EmptyState>
                    : <EmptyState icon={Search} title="No rows match">Try another filter or search.</EmptyState>}
                </Card>
              )}
              {list.length > more && <Button variant="ghost" className="mt-2 w-full" onClick={() => setMore((n) => n + 40)}>Show more ({list.length - more})</Button>}

              {filter === 'look' && matched.length > 0 && (
                <section className="mt-6">
                  <div className="flex items-baseline justify-between">
                    <h3 className="t-overline text-ink-3">Matched lately</h3>
                    <button type="button" onClick={() => setFilter('all')} className="t-label font-medium text-brand hover:underline">All {matched.length}</button>
                  </div>
                  <Card className="mt-2 divide-y divide-line px-4">
                    {matched.slice(0, 3).map(({ x, st }) => (
                      <div key={x.id} className="flex items-start justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="t-caption text-ink-3">{shortBS(x.date)} · {rowAccount(x, statements)}</p>
                          <p className="t-mono-s mt-0.5 break-words text-[13px] uppercase leading-[18px] text-ink">{x.bank?.description || x.payment?.merchant}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="num font-nepali text-[15px] font-semibold text-ink">− {money(x.amount)}</span>
                          <button type="button" onClick={() => openEditor(x.expense)}><Badge tone="success" icon={Link2}>{st.label}</Badge></button>
                        </div>
                      </div>
                    ))}
                  </Card>
                </section>
              )}

              {skipped && <p className="t-caption mt-4 flex items-center gap-1.5 text-ink-3"><CircleCheck className="size-4 text-leaf" />Rows already saved from older statements were skipped.</p>}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="ghost" icon={Download} onClick={exportCsv} disabled={!list.length}>Export CSV</Button>
              </div>
            </>
          )}
          <p className="t-caption mt-3 flex items-center gap-1.5 text-ink-3"><ShieldCheck className="size-3.5 text-leaf" />Statements and screenshots are read on this device. Only the last 4 digits of an account number are kept.</p>
        </div>
      </div>

      {uploading && (
        <Modal open size="xl" title={uploading.name ? `Upload a ${uploading.name} statement` : 'Upload a statement or screenshots'} subtitle="PDF, Excel, CSV or a screenshot. Read on this device." onClose={() => setUploading(false)}>
          {uploads}
          <details className="mt-4 rounded-[14px] border border-line px-4 py-3">
            <summary className="cursor-pointer text-[15px] font-medium text-ink">Where do I get my statement?</summary>
            <ul className="t-label mt-2 space-y-2 text-ink-2">
              <li><b className="text-ink">eSewa, Khalti, IME Pay:</b> in the app open the statement or transaction history, pick the dates and download it (PDF or Excel). A screenshot of the list works too.</li>
              <li><b className="text-ink">Banks:</b> in your mobile banking app open Accounts → Statement, pick the dates and download the PDF. Many banks also email a statement every month.</li>
              <li><b className="text-ink">Locked PDF?</b> BillKhata asks for the password (often your date of birth or part of the account number). It’s used once and never saved.</li>
              <li>Upload one each month: rows already saved from an earlier statement are skipped, so nothing is counted twice.</li>
            </ul>
          </details>
          {statements.length > 0 && (
            <section className="mt-5">
              <h3 className="t-overline text-ink-3">Your statements</h3>
              <ul className="mt-2 divide-y divide-line rounded-[14px] border border-line">
                {withoutOverlaps(statements).sort((a, b) => b.from.localeCompare(a.from)).map((s) => (
                  <li key={s.id} className="flex items-center gap-2 py-2 pl-3 pr-1">
                    <Landmark className="size-4 shrink-0 text-ink-3" />
                    <span className="t-label min-w-0 flex-1">
                      <b className="text-ink">{s.bank || 'Unnamed statement'}{s.account ? ` ••${s.account}` : ''}</b>
                      <span className="block text-ink-3">{shortDate(s.from)} – {formatAD(s.to)} · {s.rows.filter((r) => r.debit).length} out{s.rows.some((r) => r.credit) ? `, ${s.rows.filter((r) => r.credit).length} in` : ''}{s.overlapRemoved ? ` · ${s.overlapRemoved} counted once` : ''}</span>
                    </span>
                    {s.checks?.checked > 0 && s.checks.ok < s.checks.checked && <TriangleAlert className="size-4 text-warn" aria-label="Some amounts don't add up" />}
                    <button type="button" onClick={() => setRenaming({ id: s.id, name: s.bank || '' })} className="tap rounded-full p-2 text-ink-3 hover:bg-sunken hover:text-ink" aria-label={`Rename ${s.bank || 'this'} statement`}><Pencil className="size-4" /></button>
                    <button type="button" onClick={() => removeStatement(s)} className="tap rounded-full p-2 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${s.bank || ''} statement`}><Trash className="size-4" /></button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" icon={Trash} className="mt-2" onClick={clearAll}>Delete all bank data</Button>
            </section>
          )}
        </Modal>
      )}

      {renaming && (
        <Modal open size="md" title="Bank or wallet" onClose={() => setRenaming(null)}
          footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" onClick={rename}>Save</Button></>}>
          <form onSubmit={(e) => { e.preventDefault(); rename(); }}>
            <label htmlFor="rn-name" className="label">Which account is this statement from?</label>
            <AccountName id="rn-name" value={renaming.name} onChange={(name) => setRenaming((r) => ({ ...r, name }))} statements={statements} autoFocus />
          </form>
        </Modal>
      )}
      {editing && <PaymentEditor key={editing.id} payment={editing} onClose={() => setEditing(null)} />}
      {linking && <LinkPicker entry={linking} candidates={linkCandidates(linking, result)} region={region} onPick={(c) => link(linking, c)} onClose={() => setLinking(null)} />}
    </div>
  );
}
