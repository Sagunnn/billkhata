// The editable verification form for a bill. Used after a scan and when editing.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, CircleCheck, ImagePlus, ListPlus, Store, Trash } from 'lucide-react';
import { CATEGORIES, PAYMENT, PAYMENT_METHODS, REGIONS } from '../lib/constants.js';
import { lookupMerchant, merchantDirectory } from '../lib/merchants.js';
import { makeItem } from '../lib/splitter.js';
import { assignBillCode } from '../lib/billCode.js';
import { money } from '../lib/format.js';
import { adToBs, bsToAd, formatAD, formatBS, isValidBS, toAsciiDigits } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { Field, StageBadge, Toggle } from './ui.jsx';
import { ReceiptViewer } from './ReceiptViewer.jsx';
import { billStage } from '../lib/expense.js';
import { EligibilityPanel } from './Ird.jsx';
import { CrossReferenceCard } from './CrossReference.jsx';
import { BankMatchCard, canReplace, useBankMatch } from './BankMatch.jsx';
import { crossReferenceBill } from '../lib/dedupe.js';
import { itemsMatchTotal } from '../lib/ocr/index.js';

const DEFAULT_CATEGORY = CATEGORIES.at(-1);

function DateFields({ ad, bs, onChange, error }) {
  const [bsDraft, setBsDraft] = useState(bs || '');
  useEffect(() => setBsDraft(bs || ''), [bs]);
  const bsError = bsDraft && !isValidBS(bsDraft) ? 'Use YYYY-MM-DD, e.g. 2083-07-12' : '';

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Bill date (AD)" htmlFor="f-ad" error={error} hint={ad ? formatAD(ad) : ''}>
        <input
          id="f-ad"
          type="date"
          className={`input ${error ? 'input-error' : ''}`}
          value={ad || ''}
          onChange={(e) => onChange({ billDateAD: e.target.value, billDateBS: adToBs(e.target.value) || '' })}
        />
      </Field>
      <Field label="Bill date (BS)" htmlFor="f-bs" error={bsError} hint={isValidBS(bsDraft) ? formatBS(bsDraft) : 'वि.सं. YYYY-MM-DD'}>
        <input
          id="f-bs"
          inputMode="numeric"
          placeholder="2083-07-12"
          className={`input num ${bsError ? 'input-error' : ''}`}
          value={bsDraft}
          onChange={(e) => {
            const v = toAsciiDigits(e.target.value).replace(/[^\d-]/g, '').slice(0, 10);
            setBsDraft(v);
            if (isValidBS(v)) onChange({ billDateBS: v, billDateAD: bsToAd(v) });
          }}
        />
      </Field>
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
function ShopInput({ value, onChange, onPick, shops, error }) {
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
        className={`input ${error ? 'input-error' : ''}`}
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
        <ul id={`${id}-list`} role="listbox" aria-label="Saved shops" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
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

/** Seller PAN: digits only, a live "6 of 9" count, and a check mark once all 9 are in. */
function PanField({ value, error, onChange, knownShop }) {
  const n = String(value || '').length;
  const done = n === 9;
  const hint = done
    ? <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><CircleCheck className="size-3.5" />9 digits{knownShop ? ` · ${knownShop}` : ''}</span>
    : n > 0
      ? <span className="num font-medium text-amber-700">{n} of 9 digits</span>
      : '9 digits, printed near “PAN” or “प्यान”';
  return (
    <Field label="Seller PAN / VAT" htmlFor="f-pan" error={error} hint={hint}>
      <div className="relative">
        <input
          id="f-pan"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="next"
          maxLength={9}
          pattern="\d{9}"
          aria-invalid={error ? true : undefined}
          aria-describedby="f-pan-hint"
          className={`input pr-9 font-mono tracking-[0.12em] ${error ? 'input-error' : done ? 'input-ok' : ''}`}
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          placeholder="601234567"
        />
        {done && !error && <CircleCheck className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-emerald-600" aria-hidden="true" />}
      </div>
    </Field>
  );
}

const PANEL_KEY = 'billkhata_photo_panel';
function readPanel() {
  try { return localStorage.getItem(PANEL_KEY) !== 'closed'; } catch { return true; }
}

/**
 * Phones: the bill photo sticks under the header while you scroll through the fields, so each
 * one can be checked against the paper. It folds away to a thin bar when it's in the way.
 */
function MobilePhoto({ src, onViewPhoto, onPhoto, onRemovePhoto }) {
  const [open, setOpen] = useState(readPanel);
  const toggle = () => {
    setOpen((v) => {
      try { localStorage.setItem(PANEL_KEY, v ? 'closed' : 'open'); } catch { /* ignore */ }
      return !v;
    });
  };
  return (
    <div className="sticky-top sticky z-20 -mx-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-md shadow-slate-900/5 backdrop-blur lg:hidden">
      <div className="flex items-center gap-1">
        <button type="button" onClick={toggle} aria-expanded={open} className="tap flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left">
          {!open && <img src={src} alt="" className="size-8 shrink-0 rounded object-cover object-top" />}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">Bill photo</span>
            <span className="block truncate text-xs text-slate-500">{open ? 'Check each field against it' : 'Tap to show while you check'}</span>
          </span>
          <ChevronDown className={`ml-auto size-4 shrink-0 text-slate-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {onPhoto && (
          <label className="tap flex cursor-pointer items-center justify-center rounded-lg px-2 text-slate-600 hover:bg-slate-100" title="Replace photo">
            <ImagePlus className="size-4" /><span className="sr-only">Replace photo</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} />
          </label>
        )}
        {onRemovePhoto && (
          <button type="button" onClick={onRemovePhoto} className="tap flex items-center justify-center rounded-lg px-2 text-slate-500 hover:bg-red-50 hover:text-brand" aria-label="Remove photo">
            <Trash className="size-4" />
          </button>
        )}
      </div>
      {open && <ReceiptViewer src={src} onExpand={onViewPhoto} className="mt-1.5 h-[26dvh] max-h-64 min-h-36 rounded-lg" />}
    </div>
  );
}

/** The item rows read from the bill. Used by Split Khata and Trip Khata; fix them here once. */
function LineItems({ items = [], total, onChange }) {
  const sum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const billTotal = Number(total) || 0;
  // Items usually add up to the total, or a bit under it (VAT, service charge on top).
  const gap = items.length && billTotal > 0 ? Math.round((billTotal - sum) * 100) / 100 : 0;
  const offBy = items.length > 0 && billTotal > 0 && !itemsMatchTotal(items, billTotal);
  const set = (id, patch) => onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  return (
    <details className="rounded-lg border border-slate-200" open={items.length > 0}>
      <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-slate-800">
        Items read from the bill ({items.length}){items.length ? ` · ${money(sum)}` : ''}
      </summary>
      <div className="space-y-2 border-t border-slate-200 p-3">
        {!items.length && <p className="text-xs text-slate-500">No item rows were found. Add them here if you’ll split this bill, or skip it.</p>}
        {offBy && (
          <p role="status" className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
            Items add up to {money(sum)}, the bill total is {money(billTotal)}{gap > 0 ? `: ${money(gap)} is missing` : `: ${money(-gap)} too much`}. Check for a missed or misread item.
          </p>
        )}
        {items.map((it) => (
          <div key={it.id} className="grid grid-cols-[minmax(0,1fr)_44px_84px_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_56px_96px_auto] sm:gap-2">
            <input className="input py-1.5" value={it.name} onChange={(e) => set(it.id, { name: e.target.value })} aria-label="Item name" placeholder="Item" />
            <input className="input num py-1.5" inputMode="numeric" value={it.qty} onChange={(e) => { const qty = Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1); set(it.id, { qty, price: Math.round(((Number(it.amount) || 0) / qty) * 100) / 100 }); }} aria-label="Quantity" />
            <input className="input num py-1.5" inputMode="decimal" value={it.amount} onChange={(e) => { const amount = e.target.value.replace(/[^\d.]/g, ''); set(it.id, { amount, price: Math.round(((Number(amount) || 0) / it.qty) * 100) / 100 }); }} aria-label="Amount" />
            <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-brand" aria-label={`Delete ${it.name}`}><Trash className="size-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...items, makeItem({ name: '', amount: 0 })])} className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy"><ListPlus className="size-4" />Add item</button>
      </div>
    </details>
  );
}

export default function BillForm({ value: e, onChange, errors = {}, region, onPhoto, onRemovePhoto, onViewPhoto, onDiscard, discardLabel, onUseFor }) {
  const { expenses, trips, openEditor } = useStore();
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

  return (
    <div className="space-y-4">
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
    {e.receiptImage && <MobilePhoto src={e.receiptImage} onViewPhoto={onViewPhoto} onPhoto={onPhoto} onRemovePhoto={onRemovePhoto} />}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-md bg-slate-900 px-2 py-0.5 font-mono font-bold tracking-wide text-white" title="Voucher code">{code}</span>
      <span className="min-w-0 flex-1 text-xs text-slate-500">
        {saved ? 'Voucher code' : 'Voucher code it gets when saved'}. Write it on the paper bill so it matches your PDF report.
      </span>
      <StageBadge stage={billStage(e, saved)} />
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,42%)]">
      <div className="space-y-4">
        <Field label="Shop / seller name" htmlFor="f-merchant" error={errors.merchantName}>
          <ShopInput
            value={e.merchantName}
            onChange={changeMerchant}
            shops={shops}
            error={errors.merchantName}
            onPick={(m) => onChange({
              merchantName: m.merchantName,
              ...(m.sellerPan && !/^\d{9}$/.test(e.sellerPan || '') ? { sellerPan: m.sellerPan } : {}),
              ...(e.category === DEFAULT_CATEGORY ? { category: m.category } : {}),
            })}
          />
          {memoryDiffers && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
              <Store className="size-3.5 text-slate-500" />
              <span>Seen before{memory.matchedBy === 'pan' ? ' (same PAN)' : ''}: <b>{memory.merchantName}</b> · {memory.category}{memory.count > 1 ? ` · ${memory.count} bills` : ''}</span>
              <button
                type="button"
                className="ml-auto font-semibold text-navy underline"
                onClick={() => onChange({ merchantName: memory.merchantName, category: memory.category, ...(memory.sellerPan ? { sellerPan: memory.sellerPan } : {}) })}
              >
                Use these
              </button>
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <PanField value={e.sellerPan} error={errors.sellerPan} onChange={changePan} knownShop={/^\d{9}$/.test(e.sellerPan || '') && memory?.matchedBy === 'pan' ? memory.merchantName : ''} />
          <Field label="Bill / invoice no." htmlFor="f-inv">
            <input id="f-inv" className="input font-mono" maxLength={40} value={e.invoiceNumber} onChange={set('invoiceNumber')} placeholder="बिल नं" autoComplete="off" />
          </Field>
        </div>

        <DateFields ad={e.billDateAD} bs={e.billDateBS} error={errors.billDateAD} onChange={onChange} />

        <div className="grid grid-cols-2 gap-3">
          <Field label={`Total amount${isNepal ? ' (रु)' : ''}`} htmlFor="f-total" error={errors.totalAmount}>
            <input id="f-total" inputMode="decimal" className={`input num text-lg font-semibold ${errors.totalAmount ? 'input-error' : ''}`} value={e.totalAmount ?? ''} onChange={(ev) => onChange({ totalAmount: toAsciiDigits(ev.target.value).replace(/[^\d.]/g, '') })} placeholder="0.00" />
          </Field>
          <Field label="VAT amount (13%)" htmlFor="f-vat" error={errors.vatAmount} hint="Optional">
            <input id="f-vat" inputMode="decimal" className={`input num ${errors.vatAmount ? 'input-error' : ''}`} value={e.vatAmount ?? ''} onChange={(ev) => onChange({ vatAmount: toAsciiDigits(ev.target.value).replace(/[^\d.]/g, '') })} placeholder="0.00" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid by" htmlFor="f-pay" hint={e.paymentMethod === PAYMENT.DIGITAL ? 'Fonepay, eSewa, Khalti, mobile banking QR or card: entered in the IRD draw automatically.' : ''}>
            <select id="f-pay" className="input" value={e.paymentMethod} onChange={set('paymentMethod')}>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p === PAYMENT.DIGITAL ? 'Digital QR / Card (Fonepay, eSewa…)' : p}</option>)}
            </select>
          </Field>
          <Field label="Category" htmlFor="f-cat">
            <select id="f-cat" className="input" value={e.category} onChange={set('category')}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <LineItems items={e.lineItems || []} total={e.totalAmount} onChange={(lineItems) => onChange({ lineItems })} />

        <Field label="Notes" htmlFor="f-notes">
          <textarea id="f-notes" rows={2} className="input" value={e.notes || ''} onChange={set('notes')} placeholder="Optional" />
        </Field>

        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <Toggle id="f-nepal" checked={e.isNepalBill} onChange={(v) => onChange({ isNepalBill: v })} label="Nepal PAN/VAT bill" description="Turn on to check this bill for the IRD prize coupon draw." />
          {(e.isEstimate || isNepal) && (
            <Toggle id="f-estimate" checked={Boolean(e.isEstimate)} onChange={(v) => onChange({ isEstimate: v })} label="Estimate, not a tax bill" description="Slips marked “Estimate” or “not a valid bill” can’t enter the IRD draw. Still saved as an expense." />
          )}
          {e.isEstimate && (
            <p role="status" className="rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              This is an estimate. The IRD draw needs the shop’s PAN/VAT bill: ask for it and scan that one instead (it will have a PAN and a bill number).
            </p>
          )}
        </div>
      </div>

      {/* The aside is as tall as the form, so the photo can stay in view while you scroll. */}
      <aside className="space-y-4">
        <EligibilityPanel expense={e} />
        {e.receiptImage ? (
          // Phones show the photo in the sticky panel above the form instead.
          <div className="card sticky-top hidden overflow-hidden lg:sticky lg:block">
            <ReceiptViewer src={e.receiptImage} onExpand={onViewPhoto} className="h-[min(58dvh,560px)]" />
            <div className="flex gap-2 border-t border-slate-200 p-2">
              {onPhoto && <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ImagePlus className="size-4" />Replace<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} /></label>}
              {onRemovePhoto && <button type="button" onClick={onRemovePhoto} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-brand hover:bg-red-50"><Trash className="size-4" />Remove</button>}
            </div>
          </div>
        ) : (
          onPhoto && (
            <label className="card flex cursor-pointer flex-col items-center gap-2 px-4 py-8 text-center text-sm text-slate-600 hover:bg-slate-50">
              <ImagePlus className="size-6 text-slate-400" />
              <span className="font-semibold text-slate-800">Attach bill photo</span>
              <span className="text-xs">Kept as proof, compressed under 300 KB</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} />
            </label>
          )
        )}
      </aside>
    </div>
    </div>
  );
}
