// Bank: a statement PDF becomes a ledger, payment screenshots are read, and both are matched
// with your saved bills into one table. Everything stays in this browser.
import { useMemo, useRef, useState } from 'react';
import { CircleCheck, Download, FileUp, Pencil, ImageUp, Landmark, Link2, Link2Off, LoaderCircle, Lock, Plus, Receipt, Search, ShieldCheck, Smartphone, Trash, TriangleAlert } from 'lucide-react';
import { PAYMENT } from '../lib/constants.js';
import { blankExpense } from '../lib/expense.js';
import { downloadBlob, money } from '../lib/format.js';
import { adToBs, formatAD, todayAD } from '../lib/nepaliDate.js';
import { newId } from '../lib/db.js';
import { ACCOUNT_NAMES, bankRowKey } from '../lib/bank/statement.js';
import { overlapWith, withoutOverlaps } from '../lib/bank/overlap.js';
import { addEntry, creditSource, creditState, entryFromCredit, retitleCredit, sourceOptions } from '../lib/money.js';
import { afterStatement, linkCandidates, mergedCsv, needsLook, unlinkPairs, visibleEntries } from '../lib/bank/reconcile.js';
import { useStore } from '../store.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, EmptyState, Field, Modal, PageHeader, Segmented, useFileDrop } from '../components/ui.jsx';

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

function StatementUpload({ statements, onSaved }) {
  const { saveStatement } = useStore();
  const toast = useToast();
  const input = useRef(null);
  const [state, setState] = useState({ step: 'idle' }); // idle | reading | password | preview
  const [password, setPassword] = useState('');

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
      {step === 'preview' && <StatementPreview st={state.st} statements={statements} onSave={save} onCancel={() => setState({ step: 'idle' })} />}
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

function StatementPreview({ st, statements, onSave, onCancel }) {
  const { profile } = useStore();
  const [name, setName] = useState(st.bank || '');
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
            <p className="mt-3 text-xs text-slate-500">“Cash deposit” means you put your own cash in: in Cash &amp; bank it moves money from cash to bank instead of counting as new money.</p>
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

/**
 * On a credited statement row: put it into Cash & bank with one tap (once). A cash deposit moves
 * cash into the bank; anything else is money in, source guessed from the narration.
 */
function CreditToMoney({ row, compact }) {
  const { money: m, setMoney } = useStore();
  const toast = useToast();
  const state = creditState(m, row);
  if (state === 'added') return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-emerald-800"><CircleCheck className="size-3.5" />In Cash &amp; bank</span>;
  if (state === 'before') return <span className="whitespace-nowrap text-xs text-slate-500" title="Dated before you set your Cash & bank amounts, so it's already in them">Before your start</span>;
  if (state === 'not-set') return <a href="#/" className="whitespace-nowrap text-xs font-semibold text-navy underline" title="Set your cash and bank amounts on the Dashboard first">Set up Cash &amp; bank</a>;
  return (
    <Button size="sm" variant={compact ? 'outline' : 'outline'} icon={Plus} onClick={() => {
      const entry = entryFromCredit(row);
      setMoney((cur) => addEntry(cur, entry));
      toast(entry.kind === 'move' ? `Cash deposit: ${money(row.credit)} moved from cash to bank.` : `${money(row.credit)} added to Bank & wallets (${entry.source}).`);
    }}>Add to Cash &amp; bank</Button>
  );
}

/** Row buttons. `compact` (the desktop table) shows icons with tooltips, except "Add bill". */
function RowActions({ x, onAddBill, onLink, onUnlink, onScreenshot, canLink, compact }) {
  const { openEditor } = useStore();
  const act = (label, icon, onClick) => (compact
    ? <button type="button" onClick={onClick} title={label} aria-label={label} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900">{(() => { const I = icon; return <I className="size-[18px]" />; })()}</button>
    : <Button size="sm" variant="ghost" icon={icon} onClick={onClick}>{label}</Button>);
  return (
    <span className={`flex items-center justify-end gap-1 ${compact ? '' : 'flex-wrap'}`}>
      {!x.expense && x.direction === 'out' && <Button size="sm" icon={Plus} onClick={() => onAddBill(x)}>Add bill</Button>}
      {x.direction === 'in' && x.bank && <CreditToMoney row={x.bank} compact={compact} />}
      {x.expense && act('Open bill', Receipt, () => openEditor(x.expense))}
      {x.payment && act('Screenshot', Smartphone, () => onScreenshot(x.payment))}
      {canLink && act('Link to…', Link2, () => onLink(x))}
      {x.nodes.length > 1 && act('Unlink', Link2Off, () => onUnlink(x))}
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

export default function Bank() {
  const { statements, payments, profile, reconOverrides, setReconOverrides, deleteStatement, saveStatement, clearBankData, openEditor, bankRecon, money: cashBank, setMoney } = useStore();
  const [renaming, setRenaming] = useState(null); // { id, name }
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [linking, setLinking] = useState(null);
  const region = profile.region;

  const { result, range } = bankRecon;
  const shown = useMemo(() => visibleEntries(result.entries, range), [result, range]);
  const look = shown.filter((x) => needsLook(x, range));
  const q = search.trim().toLowerCase();
  const list = shown.filter((x) => {
    if (filter === 'look' && !needsLook(x, range)) return false;
    if (filter === 'out' && x.direction !== 'out') return false;
    if (filter === 'in' && x.direction !== 'in') return false;
    if (!q) return true;
    const hay = [x.bank?.description, x.bank && creditSource(x.bank), x.payment?.merchant, x.payment?.ref, x.expense?.merchantName, x.expense?.billCode, x.amount].join(' ').toLowerCase();
    return hay.includes(q);
  });
  const totals = list.reduce((t, x) => { if (x.bank || x.payment) t[x.direction] += x.amount; return t; }, { in: 0, out: 0 });
  // Money in from the statements: how much, and how much of it is already in Cash & bank.
  const credits = shown.filter((x) => x.direction === 'in' && x.bank);
  const creditTotal = credits.reduce((t, x) => t + x.amount, 0);
  const creditStates = credits.map((x) => ({ x, state: creditState(cashBank, x.bank) }));
  const addedTotal = creditStates.filter((c) => c.state === 'added').reduce((t, c) => t + c.x.amount, 0);
  const ready = creditStates.filter((c) => c.state === 'ready');
  function addAllCredits() {
    setMoney((cur) => ready.reduce((m, c) => addEntry(m, entryFromCredit(c.x.bank)), cur));
    toast(`${plural(ready.length, 'credit')} added to Cash & bank (${money(ready.reduce((t, c) => t + c.x.amount, 0), region)}).`);
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
    toast('Linked.');
  }
  function addBill(x) {
    const date = x.payment?.dateAD || x.bank?.date || todayAD();
    const e = blankExpense(region);
    openEditor({
      ...e,
      merchantName: x.payment?.merchant || shopFromNarration(x.bank?.description),
      totalAmount: x.amount,
      billDateAD: date,
      billDateBS: adToBs(date) || '',
      paymentMethod: PAYMENT.DIGITAL,
      source: 'bank', // no paper bill yet: a later scan of it can take this bill's place
      notes: [x.bank && `Bank: ${x.bank.description}`, x.payment?.ref && `Txn ${x.payment.ref}`].filter(Boolean).join(' · '),
    });
  }
  function exportCsv() {
    downloadBlob(new Blob([mergedCsv(list, range)], { type: 'text/csv' }), `billkhata_bank_${todayAD().replace(/-/g, '_')}.csv`);
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

  const empty = !statements.length && !payments.length;
  return (
    <div>
      <PageHeader
        title="Bank"
        subtitle="Your statement as a ledger: spending matched with screenshots and bills, money in ready for Cash & bank"
        actions={!empty && <Button icon={Download} onClick={exportCsv} disabled={!list.length}>Export CSV</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <StatementUpload statements={statements} />
        <ScreenshotUpload payments={payments} />
      </div>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-slate-500"><ShieldCheck className="size-3.5 text-emerald-700" />Statements and screenshots are read on this device and stored only in this browser. Only the last 4 digits of an account number are kept.</p>

      {statements.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {withoutOverlaps(statements).sort((a, b) => a.from.localeCompare(b.from)).map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm">
              <Landmark className="size-4 text-slate-500" />
              <span><b>{s.bank || 'Unnamed statement'}{s.account ? ` ••${s.account}` : ''}</b> <span className="text-slate-600">{shortDate(s.from)} – {formatAD(s.to)} · {s.rows.filter((r) => r.debit).length} expenses{s.rows.some((r) => r.credit) ? `, ${s.rows.filter((r) => r.credit).length} in` : ''}{s.overlapRemoved ? ` (${s.overlapRemoved} also in an earlier statement, counted once)` : ''}</span></span>
              {s.checks?.checked > 0 && s.checks.ok < s.checks.checked && <TriangleAlert className="size-4 text-amber-600" aria-label="Some amounts don't add up" />}
              <button type="button" onClick={() => setRenaming({ id: s.id, name: s.bank || '' })} className="tap rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-800" aria-label={`Rename ${s.bank || 'this'} statement`}><Pencil className="size-4" /></button>
              <button type="button" onClick={() => removeStatement(s)} className="tap rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand" aria-label={`Remove ${s.bank || ''} statement`}><Trash className="size-4" /></button>
            </span>
          ))}
        </div>
      )}

      {renaming && (
        <Modal
          open
          size="md"
          title="Bank or wallet"
          onClose={() => setRenaming(null)}
          footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="dark" onClick={rename}>Save</Button></>}
        >
          <form onSubmit={(e) => { e.preventDefault(); rename(); }}>
            <label htmlFor="rn-name" className="label">Which account is this statement from?</label>
            <AccountName id="rn-name" value={renaming.name} onChange={(name) => setRenaming((r) => ({ ...r, name }))} statements={statements} autoFocus />
          </form>
        </Modal>
      )}

      {empty ? (
        <Card className="mt-4">
          <EmptyState icon={Landmark} title="Nothing here yet">
            Upload a statement to see it as a ledger. Add the screenshots of payments you made and every row is matched with its screenshot and bill, so you can see what each bank payment was for.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Money in" value={money(creditTotal, region)} good onClick={() => setFilter('in')} className="col-span-2 sm:col-span-1" />
            <Stat label="Bank expenses" value={result.stats.bankRows} />
            <Stat label="With screenshot" value={result.stats.withPayment} />
            <Stat label="With bill" value={result.stats.withBill} />
            <Stat label="Need a look" value={look.length} warn={look.length > 0} onClick={() => setFilter('look')} />
          </div>

          <Card className="mt-4 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={filter} onChange={setFilter} className="overflow-x-auto" options={[
                { value: 'all', label: 'All' },
                { value: 'look', label: `Need a look${look.length ? ` (${look.length})` : ''}` },
                { value: 'out', label: 'Out' },
                { value: 'in', label: 'In' },
              ]} />
              <div className="relative min-w-[160px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input className="input py-2 pl-9" placeholder="Search narration, shop, ID, amount" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the bank ledger" />
              </div>
            </div>
            <p className="mt-2 px-1 text-sm text-slate-600">
              {plural(list.length, 'row')} · out <b className="num text-slate-900">{money(totals.out, region)}</b> · in <b className="num text-emerald-700">{money(totals.in, region)}</b>
            </p>
            {filter === 'in' && credits.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950 ring-1 ring-inset ring-emerald-200">
                <span>Credited <b className="num">{money(creditTotal, region)}</b> in {plural(credits.length, 'row')}</span>
                <span className="text-emerald-800">·</span>
                <span><b className="num">{money(addedTotal, region)}</b> in Cash &amp; bank</span>
                <span className="basis-full text-xs text-emerald-900">
                  {Object.entries(credits.reduce((by, x) => { const k = creditSource(x.bank) || 'Untitled'; by[k] = (by[k] || 0) + x.amount; return by; }, {}))
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => `${k} ${money(v, region)}`).join(' · ')}
                </span>
                {creditStates.some((c) => c.state === 'before') && <span className="text-xs text-emerald-800">(rows before your start are already in your amounts)</span>}
                {ready.length > 0 && <Button size="sm" variant="outline" icon={Plus} className="ml-auto" onClick={addAllCredits}>Add the rest ({ready.length})</Button>}
                {!cashBank.since && <a href="#/" className="ml-auto text-xs font-semibold text-navy underline">Set up Cash &amp; bank to track it</a>}
              </div>
            )}
          </Card>

          <Card className="mt-3 overflow-hidden">
            {list.length ? (
              <>
                <table className="hidden w-full text-sm md:table">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-2 py-2.5">Details</th>
                      <th className="px-2 py-2.5">Found in</th>
                      <th className="px-2 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x) => {
                      const note = needsLook(x, range);
                      return (
                        <tr key={x.id} className="border-t border-slate-100 align-top">
                          <td className="whitespace-nowrap px-4 py-3">
                            <span className="block font-medium">{formatAD(x.date)}</span>
                            <span className="block text-xs text-slate-500">{x.time}{x.postedDate && x.postedDate !== x.date ? `${x.time ? ' · ' : ''}posted ${shortDate(x.postedDate)}` : ''}</span>
                          </td>
                          <td className="max-w-[26rem] px-2 py-3">
                            <Details x={x} />
                            {note && <Note text={note} />}
                            {!note && afterStatement(x, range) && <p className="mt-1 text-xs text-slate-500">After the last statement</p>}
                          </td>
                          <td className="px-2 py-3"><Sources x={x} compact /></td>
                          <td className="px-2 py-3 text-right"><Amount x={x} region={region} /></td>
                          <td className="whitespace-nowrap px-4 py-2">
                            <RowActions compact x={x} onAddBill={addBill} onLink={setLinking} onUnlink={unlink} onScreenshot={setEditing} canLink={x.nodes.length < 3 && linkCandidates(x, result).length > 0} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <ul className="divide-y divide-slate-100 md:hidden">
                  {list.map((x) => {
                    const note = needsLook(x, range);
                    return (
                      <li key={x.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs text-slate-500">{formatAD(x.date)}{x.time ? ` · ${x.time}` : ''}</span>
                          <Amount x={x} region={region} />
                        </div>
                        <Details x={x} />
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <Sources x={x} />
                        </div>
                        {note && <Note text={note} />}
                        <div className="mt-2">
                          <RowActions x={x} onAddBill={addBill} onLink={setLinking} onUnlink={unlink} onScreenshot={setEditing} canLink={x.nodes.length < 3 && linkCandidates(x, result).length > 0} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <EmptyState icon={Search} title="No rows match">Try another filter or search.</EmptyState>
            )}
          </Card>
          <div className="mt-4 text-right">
            <Button size="sm" variant="ghost" icon={Trash} onClick={clearAll}>Delete all bank data</Button>
          </div>
        </>
      )}

      {editing && <PaymentEditor key={editing.id} payment={editing} onClose={() => setEditing(null)} />}
      {linking && <LinkPicker entry={linking} candidates={linkCandidates(linking, result)} region={region} onPick={(c) => link(linking, c)} onClose={() => setLinking(null)} />}
    </div>
  );
}

function Stat({ label, value, warn, good, onClick, className = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`card min-w-0 px-3 py-2.5 text-left ${onClick ? 'hover:border-slate-300' : ''} ${className}`}>
      <span className="block text-xs font-semibold text-slate-500">{label}</span>
      <span className={`num block truncate text-xl font-bold ${warn ? 'text-amber-700' : good ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</span>
    </Tag>
  );
}

function Note({ text }) {
  return <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><TriangleAlert className="size-3.5 shrink-0" />{text}</p>;
}
