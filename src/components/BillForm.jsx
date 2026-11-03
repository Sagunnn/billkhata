// The editable verification form for a bill. Used after a scan and when editing.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Banknote, ChevronDown, ChevronRight, ChevronUp, CircleAlert, CircleCheck, ImagePlus, Info, ListPlus, Pencil, PenLine, QrCode, ReceiptText, Sparkle, Store, Trash, TriangleAlert } from 'lucide-react';
import { CATEGORIES, PAYMENT, REGIONS } from '../lib/constants.js';
import { lookupMerchant, merchantDirectory } from '../lib/merchants.js';
import { makeItem } from '../lib/splitter.js';
import { assignBillCode } from '../lib/billCode.js';
import { money } from '../lib/format.js';
import { adToBs, bsToAd, formatAD, formatBS, isValidBS, toAsciiDigits } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { Button, Chip, Field, Notice, Segmented, StageBadge, Toggle } from './ui.jsx';
import { BILL_AREAS, joinBoxes } from '../lib/ocr/locate.js';
import { accountsOf, defaultAccountId } from '../lib/money.js';
import { CATEGORY_SHORT } from '../lib/categoryIcons.js';
import { ReceiptViewer } from './ReceiptViewer.jsx';
import { billStage } from '../lib/expense.js';
import { EligibilityPanel } from './Ird.jsx';
import { CrossReferenceCard } from './CrossReference.jsx';
import { BankMatchCard, canReplace, useBankMatch } from './BankMatch.jsx';
import { crossReferenceBill } from '../lib/dedupe.js';
import { itemsMatchTotal } from '../lib/ocr/index.js';

const DEFAULT_CATEGORY = CATEGORIES.at(-1);

/**
 * Where a field's value came from (Figma: Check the details): read from the bill (dashed), edited
 * by you, checked by the VAT maths or its format, or not sure. Nothing for a bill typed by hand.
 */
function provenance(key, value, read, checked) {
  if (checked) return 'checked';
  if (!read) return '';
  const was = read[key];
  if (was === undefined || was === null || was === '') return '';
  return String(was) === String(value ?? '') ? 'read' : 'edited';
}

const PROV = {
  read: ['text-navy', Sparkle, 'Read from bill'],
  edited: ['text-navy', Pencil, 'Edited'],
  checked: ['text-leaf', CircleCheck, 'Checked'],
  unsure: ['text-warn', TriangleAlert, 'Not sure'],
};

/** `compact`: a half-width field on a phone, where only the icon and a word fit. */
function ProvLabel({ htmlFor, children, state, compact = false }) {
  const [tone, Icon, text] = PROV[state] || [];
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <label htmlFor={htmlFor} className="truncate text-[14px] font-medium leading-[18px] text-ink-2">{children}</label>
      {state && (
        <span className={`inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-4 ${tone}`} title={text}>
          <Icon className="size-3.5" />{compact ? <><span className="sm:hidden">{text.split(' ')[0]}</span><span className="hidden sm:inline">{text}</span></> : text}
        </span>
      )}
    </div>
  );
}

const inputState = (state, error) => (error ? 'input-error' : state === 'read' ? 'input-read' : state === 'unsure' ? 'input-unsure' : '');

function Hint({ id, error, children, tone = 'text-ink-3' }) {
  if (error) return <p id={id} className="mt-1 flex items-center gap-1 text-[12px] font-medium leading-4 text-danger"><CircleAlert className="size-3.5" />{error}</p>;
  return children ? <p id={id} className={`mt-1 text-[12px] leading-4 ${tone}`}>{children}</p> : null;
}

/** Date (BS) with its AD date under it; the AD date can be picked instead. */
function DateField({ ad, bs, onChange, error, state }) {
  const [bsDraft, setBsDraft] = useState(bs || '');
  const [pickAd, setPickAd] = useState(false);
  useEffect(() => setBsDraft(bs || ''), [bs]);
  const bsError = bsDraft && !isValidBS(bsDraft) ? 'Use YYYY-MM-DD, e.g. 2083-07-12' : '';
  return (
    <div>
      <ProvLabel htmlFor="f-bs" state={state} compact>Date (BS)</ProvLabel>
      <input
        id="f-bs"
        inputMode="numeric"
        placeholder="2083-07-12"
        className={`input num ${inputState(state, bsError || error)}`}
        value={bsDraft}
        aria-describedby="f-bs-hint"
        onChange={(e) => {
          const v = toAsciiDigits(e.target.value).replace(/[^\d-]/g, '').slice(0, 10);
          setBsDraft(v);
          if (isValidBS(v)) onChange({ billDateBS: v, billDateAD: bsToAd(v) });
        }}
      />
      <Hint id="f-bs-hint" error={bsError || error}>
        {isValidBS(bsDraft) && <>{formatBS(bsDraft)} · </>}
        {ad ? <>= {formatAD(ad)} AD </> : null}
        <button type="button" className="font-medium text-navy hover:underline" onClick={() => setPickAd((v) => !v)}>{pickAd ? 'done' : 'pick AD date'}</button>
      </Hint>
      {pickAd && (
        <input id="f-ad" type="date" aria-label="Bill date (AD)" className="input mt-2" value={ad || ''}
          onChange={(e) => onChange({ billDateAD: e.target.value, billDateBS: adToBs(e.target.value) || '' })} />
      )}
    </div>
  );
}

/** Saved shops matching what's typed: name words or PAN digits. Empty: your most-used shops. */
function shopMatches(shops, query) {
  const q = query.trim().toLowerCase();
  const byUse = [...shops].sort((a, b) => b.count - a.count);
  if (!q) return byUse.slice(0, 6);
  const digits = q.replace(/\D/g, '');
  const scored = [];
  for (const m of byUse) {
    const name = m.merchantName.toLowerCase();
    if (name === q) continue; // already typed in full
    let score = 0;
    if (name.startsWith(q)) score = 3;
    else if (name.split(/[\s.&-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1;
    else if (digits.length >= 3 && m.sellerPan.startsWith(digits)) score = 2;
    if (score) scored.push([score, m]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 6).map(([, m]) => m);
}

/**
 * Shop name with suggestions from the shops you've saved before. A real list instead of a
 * <datalist>, which phones (iPhone especially) barely show. Picking one fills its PAN and category.
 */
function ShopInput({ value, onChange, onPick, shops, error, read }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closing = useRef(0);
  const list = useMemo(() => shopMatches(shops, value || ''), [shops, value]);
  const show = open && list.length > 0;
  const pick = (m) => { onPick(m); setOpen(false); setActive(-1); };
  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(list.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter' && show && active >= 0) { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape' && show) { e.preventDefault(); setOpen(false); }
  }
  return (
    <div className="relative">
      <input
        id="f-merchant"
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && active >= 0 ? `${id}-${active}` : undefined}
        className={`input ${error ? 'input-error' : read ? 'input-read' : ''}`}
        value={value}
        onChange={(ev) => { onChange(ev.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => { clearTimeout(closing.current); setOpen(true); }}
        onBlur={() => { closing.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={onKeyDown}
        placeholder="e.g. Annapurna Kirana Pasal"
        autoComplete="off"
        enterKeyHint="next"
      />
      {show && (
        <ul id={`${id}-list`} role="listbox" aria-label="Saved shops" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-[12px] border border-line bg-raised py-1 shadow-lg">
          {!value?.trim() && <li className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400" role="presentation">Your shops</li>}
          {list.map((m, i) => (
            <li
              key={`${m.sellerPan}|${m.merchantName}`}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(m)}
              className={`tap flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{m.merchantName}</span>
                <span className="num block truncate text-xs text-slate-500">{[m.sellerPan && `PAN ${m.sellerPan}`, m.category].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="num shrink-0 text-xs text-slate-400">{m.count} bill{m.count === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Seller PAN: digits only, a live "7 of 9" count, and "Not sure" while a read one is short. */
function PanField({ value, error, onChange, knownShop, state }) {
  const n = String(value || '').length;
  const done = n === 9;
  const shown = done ? state : n > 0 ? 'unsure' : state;
  const hint = done
    ? (knownShop ? `Saved shop · ${knownShop}` : '9 digits')
    : n > 0 ? `${n} of 9 digits` : '9 digits, printed near “PAN” or “प्यान”';
  return (
    <div>
      <ProvLabel htmlFor="f-pan" state={shown}>Seller PAN</ProvLabel>
      <input
        id="f-pan"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="next"
        maxLength={9}
        pattern="\d{9}"
        aria-invalid={error ? true : undefined}
        aria-describedby="f-pan-hint"
        className={`input font-mono tracking-[0.12em] ${inputState(shown, error)}`}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        placeholder="601234567"
      />
      <Hint id="f-pan-hint" error={error} tone={!done && n > 0 ? 'text-warn' : 'text-ink-3'}>{hint}</Hint>
    </div>
  );
}

const PANEL_KEY = 'billkhata_photo_panel';
function readPanel() {
  try { return localStorage.getItem(PANEL_KEY) !== 'closed'; } catch { return true; }
}

/**
 * Phones: the bill photo sticks to the top while you scroll through the fields, so each one can be
 * checked against the paper. "Fold photo" shrinks it to a strip when it's in the way.
 */
function MobilePhoto({ src, onViewPhoto, onPhoto, onRemovePhoto, focus, marks }) {
  const [open, setOpen] = useState(readPanel);
  const toggle = () => {
    setOpen((v) => {
      try { localStorage.setItem(PANEL_KEY, v ? 'closed' : 'open'); } catch { /* ignore */ }
      return !v;
    });
  };
  return (
    <div className="sticky-top sticky z-20 -mx-4 bg-sunken lg:hidden">
      {open
        ? <ReceiptViewer src={src} onExpand={onViewPhoto} focus={focus} marks={marks} className="photo-typing h-[26dvh] max-h-64 min-h-40" />
        : <button type="button" onClick={toggle} className="flex h-14 w-full items-center gap-3 px-4 text-left"><img src={src} alt="" className="size-10 rounded object-cover object-top" /><span className="t-label text-ink-2">Bill photo · tap to show</span></button>}
      <div className="hide-typing pointer-events-none absolute inset-x-3 top-2 flex items-center justify-between">
        {open && <button type="button" onClick={toggle} aria-expanded={open} className="tap pointer-events-auto inline-flex h-8 items-center gap-1 rounded-full bg-raised px-3 text-[13px] font-medium text-ink shadow-md"><ChevronUp className="size-4" />Fold photo</button>}
        <span className="pointer-events-auto ml-auto flex gap-1.5">
          {onPhoto && (
            <label className="tap flex size-8 cursor-pointer items-center justify-center rounded-full bg-raised text-ink shadow-md" title="Replace photo">
              <ImagePlus className="size-4" /><span className="sr-only">Replace photo</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} />
            </label>
          )}
          {onRemovePhoto && <button type="button" onClick={onRemovePhoto} className="tap flex size-8 items-center justify-center rounded-full bg-raised text-ink-2 shadow-md hover:text-danger" aria-label="Remove photo"><Trash className="size-4" /></button>}
        </span>
      </div>
    </div>
  );
}

/** The item rows read from the bill. Used by Split Khata and Trip Khata; fix them here once. */
function LineItems({ items = [], total, onChange }) {
  const [open, setOpen] = useState(false);
  const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const billTotal = Number(total) || 0;
  // Items usually add up to the total, or a bit under it (VAT, service charge on top).
  const gap = items.length && billTotal > 0 ? Math.round((billTotal - sum) * 100) / 100 : 0;
  const offBy = items.length > 0 && billTotal > 0 && !itemsMatchTotal(items, billTotal);
  const set = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <div className="card rounded-2xl">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <ReceiptText className="size-5 shrink-0 text-ink-2" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{items.length ? `${items.length} item${items.length === 1 ? '' : 's'} read from the bill` : 'Items'}</span>
          <span className={`t-caption block ${offBy ? 'text-warn' : 'text-ink-3'}`}>{items.length ? `Add up to ${money(sum)}${offBy ? (gap > 0 ? ` · ${money(gap)} missing` : ` · ${money(-gap)} too much`) : ''} · tap to fix or split by item` : 'Add them if you’ll split this bill by item'}</span>
        </span>
        <ChevronDown className={`size-5 shrink-0 text-ink-3 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {offBy && <p role="status" className="t-caption rounded-lg bg-warn-soft px-2.5 py-2 text-warn">Items add up to {money(sum)}, the bill total is {money(billTotal)}. Check for a missed or misread item.</p>}
          {items.map((it) => (
            <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_44px_84px_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_56px_96px_auto] sm:gap-2">
              <input className="input py-2" value={it.name} onChange={(e) => set(it.id, { name: e.target.value })} aria-label="Item name" placeholder="Item" />
              <input className="input num py-2" inputMode="numeric" value={it.qty} onChange={(e) => { const qty = Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1); set(it.id, { qty, price: Math.round(((Number(it.amount) || 0) / qty) * 100) / 100 }); }} aria-label="Quantity" />
              <input className="input num py-2" inputMode="decimal" value={it.amount} onChange={(e) => { const amount = e.target.value.replace(/[^\d.]/g, ''); set(it.id, { amount, price: Math.round(((Number(amount) || 0) / it.qty) * 100) / 100 }); }} aria-label="Amount" />
              <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} className="rounded-lg p-2 text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`Delete ${it.name}`}><Trash className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => onChange([...items, makeItem({ name: '', amount: 0 })])} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-brand"><ListPlus className="size-4" />Add item</button>
        </div>
      )}
    </div>
  );
}

/** "Write KT1-07 on bill": the voucher code, with why it matters. */
function WriteOnBill({ code, saved }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="tap inline-flex h-9 items-center gap-2 rounded-[10px] border border-dashed border-ink-2 bg-surface px-3 text-[13px] text-ink-2">
        <PenLine className="size-4" />Write <b className="font-mono text-[14px] font-semibold tracking-[0.3px] text-ink">{code}</b> on bill<Info className="size-3.5 text-ink-3" />
      </button>
      {open && (
        <div role="dialog" className="absolute left-0 top-full z-30 mt-2 w-72 rounded-[14px] bg-ink p-3.5 text-[13px] leading-[18px] text-ink-inverse shadow-lg">
          Write <b className="font-mono">{code}</b> on the paper bill with a pen. It matches the bill to this entry and your PDF report, so you can find the paper one if it wins the lucky draw.{saved ? '' : ' The code is kept when you save.'}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 block font-medium underline">Got it</button>
        </div>
      )}
    </div>
  );
}

const PAY_OPTIONS = [
  { value: PAYMENT.CASH, label: 'Cash', icon: Banknote },
  { value: PAYMENT.DIGITAL, label: 'QR / Card', icon: QrCode },
  { value: PAYMENT.CBMS, label: 'CBMS' },
];

/**
 * The phone steps. `fields`: what a Save error in it points to; `boxes`: what's boxed on the photo;
 * `area`: where to look on a photo with no word boxes.
 */
const STEPS = [
  { label: 'Shop', next: 'Shop', fields: ['merchantName', 'sellerPan'], boxes: ['merchantName', 'sellerPan'], area: 'shop', hint: 'Check the shop name and PAN against the top of the bill.' },
  { label: 'Bill', next: 'Bill no. & date', fields: ['invoiceNumber', 'billDateAD'], boxes: ['invoiceNumber', 'billDate'], area: 'bill', hint: 'The bill number and date, as printed.' },
  { label: 'Amount', next: 'Amount', fields: ['totalAmount', 'vatAmount'], boxes: ['totalAmount', 'vatAmount'], area: 'amount', hint: 'The total you paid, and the VAT if it’s shown.' },
  { label: 'More', next: 'Paid by & category', fields: [], boxes: ['lineItems'], area: '', hint: 'Save any time: the other steps keep what you typed.' },
];
// Field ids → the box to show on the photo while that field is being edited.
const FIELD_OF = { 'f-merchant': 'merchantName', 'f-pan': 'sellerPan', 'f-inv': 'invoiceNumber', 'f-bs': 'billDate', 'f-ad': 'billDate', 'f-total': 'totalAmount', 'f-vat': 'vatAmount' };

function useMediaQuery(q) {
  const get = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(q).matches);
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return undefined;
    const ch = () => setOn(mq.matches);
    mq.addEventListener('change', ch);
    return () => mq.removeEventListener('change', ch);
  }, [q]);
  return on;
}

export default function BillForm({ value: e, onChange, errors = {}, region, onPhoto, onRemovePhoto, onViewPhoto, onDiscard, discardLabel, onUseFor, read = null, boxes = null }) {
  const { expenses, trips, openEditor, money: m } = useStore();
  const [allCats, setAllCats] = useState(false);
  const saved = expenses.some((x) => x.id === e.id);
  const code = assignBillCode(e, expenses, trips);
  const set = (k) => (ev) => onChange({ [k]: ev.target.value });
  const isNepal = region === REGIONS.NEPAL;
  // Live cross-reference against saved bills: bill number, item sequence and photo.
  const allMatches = useMemo(() => crossReferenceBill(e, expenses), [e, expenses]);
  const bankMatch = useBankMatch(e);
  // A photo-less bill added from the bank statement: the bank card offers to put this scan on it,
  // so the duplicate warning about that same bill would only repeat it.
  const replacing = canReplace(bankMatch, e, onUseFor) ? bankMatch.taken.expense.id : '';
  const matches = replacing ? allMatches.filter((m) => m.bill.id !== replacing) : allMatches;
  const shops = useMemo(() => merchantDirectory(expenses.filter((b) => b.id !== e.id)), [expenses, e.id]);
  const memory = lookupMerchant(e, expenses);
  const memoryDiffers = memory && (memory.merchantName !== e.merchantName || memory.category !== e.category || (memory.sellerPan && memory.sellerPan !== e.sellerPan));

  // Typing a known shop name fills its PAN, and its category if none was picked yet.
  function changeMerchant(name) {
    const patch = { merchantName: name };
    const hit = lookupMerchant({ id: e.id, merchantName: name }, expenses);
    if (hit) {
      if (!/^\d{9}$/.test(e.sellerPan || '') && hit.sellerPan) patch.sellerPan = hit.sellerPan;
      if (e.category === DEFAULT_CATEGORY) patch.category = hit.category;
    }
    onChange(patch);
  }

  // A complete PAN of a known shop fills its name (if empty) and category (if still the default).
  function changePan(raw) {
    const pan = toAsciiDigits(raw).replace(/\D/g, '').slice(0, 9);
    const patch = { sellerPan: pan };
    const hit = pan.length === 9 && lookupMerchant({ id: e.id, sellerPan: pan }, expenses);
    if (hit) {
      if (!String(e.merchantName || '').trim()) patch.merchantName = hit.merchantName;
      if (e.category === DEFAULT_CATEGORY) patch.category = hit.category;
    }
    onChange(patch);
  }

  // What the scan read, to mark each field: read from the bill, edited by you, or checked.
  const vat = read?.vatCheck && Math.abs(Number(e.totalAmount) - read.vatCheck.total) <= 1.5 ? read.vatCheck : null;
  const prov = (k, checked = false) => provenance(k, e[k], read, checked);
  const banks = accountsOf(m).filter((a) => a.kind !== 'cash');
  const mainBank = defaultAccountId(m);
  const cats = allCats ? CATEGORIES : [...new Set([e.category, ...CATEGORIES.slice(0, 5)])];
  const vatHint = vat ? `13% of ${money(vat.subtotal)}` : Number(e.vatAmount) > 0 && Number(e.totalAmount) > 0 ? `${money(Number(e.totalAmount) - Number(e.vatAmount))} before VAT` : 'Optional';

  // Phones and tablets: the form in four short steps, the photo zoomed to what each step is about.
  const stepped = useMediaQuery('(max-width: 1023px)');
  const [step, setStep] = useState(0);
  const [active, setActive] = useState(''); // the field being edited, to box it on the photo
  const top = useRef(null);
  const go = (n) => { setStep(n); setActive(''); top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  // Save found a problem: open the step that has it.
  useEffect(() => {
    const first = STEPS.findIndex((st) => st.fields.some((k) => errors[k]));
    if (first >= 0) setStep(first);
  }, [errors]);

  const panShort = /^\d{1,8}$/.test(String(e.sellerPan || ''));
  const MARKS = {
    merchantName: { label: 'Shop' },
    sellerPan: { label: panShort ? `Seller PAN · ${String(e.sellerPan).length} of 9` : 'Seller PAN', tone: panShort ? 'unsure' : 'read' },
    invoiceNumber: { label: 'Bill no.' },
    billDate: { label: 'Date' },
    totalAmount: { label: 'Total' },
    vatAmount: { label: 'VAT' },
    lineItems: { label: 'Items' },
  };
  const markFor = (k) => (boxes?.[k] ? { box: boxes[k], label: MARKS[k].label, tone: MARKS[k].tone || 'read' } : null);
  const activeKey = FIELD_OF[active] || '';
  let marks;
  let focus;
  if (stepped) {
    marks = (activeKey ? [activeKey] : STEPS[step].boxes).map(markFor).filter(Boolean);
    focus = (activeKey && boxes?.[activeKey]) || joinBoxes(STEPS[step].boxes.map((k) => boxes?.[k])) || BILL_AREAS[STEPS[step].area] || null;
  } else {
    marks = activeKey ? [markFor(activeKey)].filter(Boolean) : [];
    focus = (activeKey && boxes?.[activeKey]) || null;
  }
  const stepState = STEPS.map((st) => (st.fields.some((k) => errors[k]) ? 'error' : st.fields.some((k) => k === 'sellerPan' && panShort) ? 'unsure' : ''));

  const shopBlock = (
    <div>
      <ProvLabel htmlFor="f-merchant" state={prov('merchantName')}>Shop name</ProvLabel>
      <ShopInput
        value={e.merchantName}
        onChange={changeMerchant}
        shops={shops}
        error={errors.merchantName}
        read={prov('merchantName') === 'read'}
        onPick={(x) => onChange({
          merchantName: x.merchantName,
          ...(x.sellerPan && !/^\d{9}$/.test(e.sellerPan || '') ? { sellerPan: x.sellerPan } : {}),
          ...(e.category === DEFAULT_CATEGORY ? { category: x.category } : {}),
        })}
      />
      <Hint error={errors.merchantName}>{memory && !memoryDiffers ? `Saved shop${memory.count > 1 ? ` · ${memory.count} bills` : ''}` : ''}</Hint>
      {memoryDiffers && (
        <div className="t-caption mt-1.5 flex flex-wrap items-center gap-2 rounded-[10px] bg-sunken px-2.5 py-1.5 text-ink-2">
          <Store className="size-3.5" />
          <span>Seen before{memory.matchedBy === 'pan' ? ' (same PAN)' : ''}: <b className="text-ink">{memory.merchantName}</b> · {memory.category}{memory.count > 1 ? ` · ${memory.count} bills` : ''}</span>
          <button type="button" className="ml-auto font-medium text-brand underline"
            onClick={() => onChange({ merchantName: memory.merchantName, category: memory.category, ...(memory.sellerPan ? { sellerPan: memory.sellerPan } : {}) })}>
            Use these
          </button>
        </div>
      )}
    </div>
  );
  const panBlock = (
    <PanField value={e.sellerPan} error={errors.sellerPan} onChange={changePan} state={prov('sellerPan', false)}
      knownShop={/^\d{9}$/.test(e.sellerPan || '') && memory?.matchedBy === 'pan' ? memory.merchantName : ''} />
  );
  const billBlock = (
    <div className={`grid gap-3 ${stepped ? '' : 'grid-cols-2'}`}>
      <div>
        <ProvLabel htmlFor="f-inv" state={prov('invoiceNumber')} compact={!stepped}>Bill no.</ProvLabel>
        <input id="f-inv" className={`input font-mono ${inputState(prov('invoiceNumber'))}`} maxLength={40} value={e.invoiceNumber} onChange={set('invoiceNumber')} placeholder="बिल नं" autoComplete="off" />
      </div>
      <DateField ad={e.billDateAD} bs={e.billDateBS} error={errors.billDateAD} onChange={onChange} state={prov('billDateBS')} />
    </div>
  );
  const amountBlock = (
    <div className={`grid gap-3 ${stepped ? '' : 'grid-cols-2'}`}>
      <div>
        <ProvLabel htmlFor="f-total" state={vat ? 'checked' : prov('totalAmount')} compact={!stepped}>Total{isNepal ? ' (रु)' : ''}</ProvLabel>
        <input id="f-total" inputMode="decimal" className={`input num text-[17px] font-semibold ${inputState(vat ? '' : prov('totalAmount'), errors.totalAmount)}`} value={e.totalAmount ?? ''} onChange={(ev) => onChange({ totalAmount: toAsciiDigits(ev.target.value).replace(/[^\d.]/g, '') })} placeholder="0.00" />
        <Hint error={errors.totalAmount}>{vat ? 'Matches the sum' : ''}</Hint>
      </div>
      <div>
        <ProvLabel htmlFor="f-vat" state={vat && Math.abs(Number(e.vatAmount) - vat.vat) <= 1 ? 'checked' : prov('vatAmount')} compact={!stepped}>VAT 13%{isNepal ? ' (रु)' : ''}</ProvLabel>
        <input id="f-vat" inputMode="decimal" className={`input num ${inputState(vat ? '' : prov('vatAmount'), errors.vatAmount)}`} value={e.vatAmount ?? ''} onChange={(ev) => onChange({ vatAmount: toAsciiDigits(ev.target.value).replace(/[^\d.]/g, '') })} placeholder="0.00" />
        <Hint error={errors.vatAmount}>{vatHint}</Hint>
      </div>
    </div>
  );
  const moreBlock = (
    <>
      <div>
        <p className="label">Paid by</p>
        <Segmented value={e.paymentMethod} onChange={(paymentMethod) => onChange({ paymentMethod, ...(paymentMethod !== PAYMENT.DIGITAL ? { paidFrom: '' } : {}) })} options={PAY_OPTIONS} className="w-full" />
        <Hint>{e.paymentMethod === PAYMENT.DIGITAL ? 'Fonepay, eSewa, Khalti, mobile banking or card: entered in the IRD draw for you.' : ''}</Hint>
        {e.paymentMethod === PAYMENT.DIGITAL && m.since && banks.length > 1 && (
          <fieldset className="mt-3">
            <legend className="label">Paid from</legend>
            <div className="flex flex-wrap gap-2">
              {banks.map((a) => (
                <Chip key={a.id} selected={(e.paidFrom || mainBank) === a.id} onClick={() => onChange({ paidFrom: a.id === mainBank ? '' : a.id })}>{a.name}</Chip>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      <fieldset>
        <legend className="label">Category</legend>
        <div className="flex flex-wrap gap-2">
          {cats.map((c) => <Chip key={c} selected={e.category === c} onClick={() => onChange({ category: c })}>{CATEGORY_SHORT[c] || c}</Chip>)}
          {!allCats && CATEGORIES.length > cats.length && <button type="button" className="chip tap" onClick={() => setAllCats(true)}>{CATEGORIES.length - cats.length} more</button>}
        </div>
      </fieldset>

      <LineItems items={e.lineItems || []} total={e.totalAmount} onChange={(lineItems) => onChange({ lineItems })} />

      <Field label="Notes" htmlFor="f-notes">
        <textarea id="f-notes" rows={2} className="input" value={e.notes || ''} onChange={set('notes')} placeholder="Optional" />
      </Field>

      <div className="card space-y-4 rounded-2xl p-4">
        <Toggle id="f-nepal" checked={e.isNepalBill} onChange={(v) => onChange({ isNepalBill: v })} label="Nepal PAN/VAT bill" description="Counts for VAT and the lucky draw" />
        {(e.isEstimate || isNepal) && (
          <Toggle id="f-estimate" checked={Boolean(e.isEstimate)} onChange={(v) => onChange({ isEstimate: v })} label="Estimate slip" description="Not a tax bill. Kept, but not entered in the draw" />
        )}
        {e.isEstimate && <Notice tone="warning">The IRD draw needs the shop’s PAN/VAT bill: ask for it and scan that one instead.</Notice>}
      </div>
    </>
  );
  const attachPhoto = onPhoto && !e.receiptImage && (
    <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed px-4 py-8 text-center text-[14px] text-ink-2 hover:bg-sunken">
      <ImagePlus className="size-6 text-ink-3" />
      <span className="font-semibold text-ink">Attach bill photo</span>
      <span className="t-caption">Kept as proof, compressed under 300 KB</span>
      <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} />
    </label>
  );
  const cards = (
    <>
      <CrossReferenceCard
        matches={matches}
        bill={e}
        region={region}
        codeForThis={code}
        onView={openEditor}
        onDiscard={onDiscard}
        discardLabel={discardLabel}
        onOverride={(id, on) => onChange({ duplicateOverride: on ? [...new Set([...(e.duplicateOverride || []), id])] : (e.duplicateOverride || []).filter((x) => x !== id) })}
      />
      <BankMatchCard bill={e} match={bankMatch} region={region} onChange={onChange} onUseFor={onUseFor} />
      <div className="flex flex-wrap items-center gap-2">
        <WriteOnBill code={code} saved={saved} />
        <StageBadge stage={billStage(e, saved)} />
      </div>
    </>
  );
  const track = (ev) => { if (FIELD_OF[ev.target.id]) setActive(ev.target.id); };

  if (stepped) {
    const st = STEPS[step];
    return (
      <div className="space-y-4" onFocusCapture={track}>
        {e.receiptImage && <MobilePhoto src={e.receiptImage} onViewPhoto={onViewPhoto} onPhoto={onPhoto} onRemovePhoto={onRemovePhoto} focus={focus} marks={marks} />}
        <div ref={top} className="scroll-mt-[calc(var(--header-h)+16rem)]" />
        <div role="tablist" aria-label="Parts of the bill" className="grid grid-cols-4 gap-1 rounded-[14px] bg-sunken p-1">
          {STEPS.map((x, i) => (
            <button key={x.label} type="button" role="tab" aria-selected={step === i} onClick={() => go(i)}
              className={`tap relative rounded-[10px] py-2 text-[13px] font-medium ${step === i ? 'bg-raised text-ink shadow-sm' : 'text-ink-2'}`}>
              {x.label}
              {stepState[i] && <span className={`absolute right-1.5 top-1.5 size-2 rounded-full ${stepState[i] === 'error' ? 'bg-danger' : 'bg-warn'}`} aria-label={stepState[i] === 'error' ? 'has a problem' : 'check this'} />}
            </button>
          ))}
        </div>
        <p className="t-caption -mt-2 px-1 text-ink-3">{st.hint}</p>
        {step === 0 && <>{cards}{shopBlock}{panBlock}</>}
        {step === 1 && billBlock}
        {step === 2 && amountBlock}
        {step === 3 && <>{moreBlock}<EligibilityPanel expense={e} />{attachPhoto}</>}
        {step < STEPS.length - 1 && (
          <Button className="w-full" icon={ChevronRight} onClick={() => go(step + 1)}>Next: {STEPS[step + 1].next}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4" onFocusCapture={track}>
    {cards}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,42%)]">
      <div className="space-y-4">
        {shopBlock}
        {panBlock}
        {billBlock}
        {amountBlock}
        {moreBlock}
      </div>

      {/* The aside is as tall as the form, so the photo can stay in view while you scroll. */}
      <aside className="space-y-4">
        <EligibilityPanel expense={e} />
        {e.receiptImage ? (
          <div className="card sticky-top sticky overflow-hidden">
            <ReceiptViewer src={e.receiptImage} onExpand={onViewPhoto} focus={focus} marks={marks} className="h-[min(58dvh,560px)] bg-sunken" />
            <div className="flex gap-2 border-t border-line p-2">
              {onPhoto && <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg py-1.5 text-[14px] font-medium text-ink hover:bg-sunken"><ImagePlus className="size-4" />Replace<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} /></label>}
              {onRemovePhoto && <button type="button" onClick={onRemovePhoto} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[14px] font-medium text-danger hover:bg-danger-soft"><Trash className="size-4" />Remove</button>}
            </div>
            {boxes && Object.keys(boxes).length > 0 && <p className="t-caption border-t border-line px-3 py-2 text-center text-ink-3">Click a field to find it on the bill</p>}
          </div>
        ) : attachPhoto}
      </aside>
    </div>
    </div>
  );
}
