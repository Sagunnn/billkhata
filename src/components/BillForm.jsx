// The editable verification form for a bill. Used after a scan and when editing.
import { useEffect, useState } from 'react';
import { ImagePlus, Trash, ZoomIn } from 'lucide-react';
import { CATEGORIES, PAYMENT, PAYMENT_METHODS, REGIONS } from '../lib/constants.js';
import { adToBs, bsToAd, formatAD, formatBS, isValidBS, toAsciiDigits } from '../lib/nepaliDate.js';
import { Field, Toggle } from './ui.jsx';
import { EligibilityPanel } from './Ird.jsx';

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

export default function BillForm({ value: e, onChange, errors = {}, region, onPhoto, onRemovePhoto, onViewPhoto }) {
  const set = (k) => (ev) => onChange({ [k]: ev.target.value });
  const isNepal = region === REGIONS.NEPAL;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">
        <Field label="Shop / seller name" htmlFor="f-merchant" error={errors.merchantName}>
          <input id="f-merchant" className={`input ${errors.merchantName ? 'input-error' : ''}`} value={e.merchantName} onChange={set('merchantName')} placeholder="e.g. Annapurna Kirana Pasal" autoComplete="off" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Seller PAN / VAT" htmlFor="f-pan" error={errors.sellerPan} hint="9 digits, printed near “PAN” or “प्यान”">
            <input
              id="f-pan"
              inputMode="numeric"
              maxLength={9}
              className={`input num ${errors.sellerPan ? 'input-error' : ''}`}
              value={e.sellerPan}
              onChange={(ev) => onChange({ sellerPan: toAsciiDigits(ev.target.value).replace(/\D/g, '').slice(0, 9) })}
              placeholder="601234567"
            />
          </Field>
          <Field label="Bill / invoice no." htmlFor="f-inv">
            <input id="f-inv" className="input" maxLength={40} value={e.invoiceNumber} onChange={set('invoiceNumber')} placeholder="बिल नं" autoComplete="off" />
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

        <Field label="Notes" htmlFor="f-notes">
          <textarea id="f-notes" rows={2} className="input" value={e.notes || ''} onChange={set('notes')} placeholder="Optional" />
        </Field>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
          <Toggle id="f-nepal" checked={e.isNepalBill} onChange={(v) => onChange({ isNepalBill: v })} label="Nepal PAN/VAT bill" description="Turn on to check this bill for the IRD prize coupon draw." />
        </div>
      </div>

      <aside className="space-y-4">
        <div className="card overflow-hidden">
          {e.receiptImage ? (
            <>
              <button type="button" onClick={onViewPhoto} className="group relative block w-full bg-slate-100">
                <img src={e.receiptImage} alt="Bill photo" className="max-h-72 w-full object-contain" />
                <span className="absolute right-2 top-2 rounded-md bg-slate-900/70 p-1.5 text-white opacity-0 transition group-hover:opacity-100"><ZoomIn className="size-4" /></span>
              </button>
              <div className="flex gap-2 border-t border-slate-200 p-2">
                {onPhoto && <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ImagePlus className="size-4" />Replace<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} /></label>}
                {onRemovePhoto && <button type="button" onClick={onRemovePhoto} className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-semibold text-brand hover:bg-red-50"><Trash className="size-4" />Remove</button>}
              </div>
            </>
          ) : (
            onPhoto && (
              <label className="flex cursor-pointer flex-col items-center gap-2 px-4 py-8 text-center text-sm text-slate-600 hover:bg-slate-50">
                <ImagePlus className="size-6 text-slate-400" />
                <span className="font-semibold text-slate-800">Attach bill photo</span>
                <span className="text-xs">Kept as proof, compressed under 300 KB</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(ev) => onPhoto(ev.target.files?.[0])} />
              </label>
            )
          )}
        </div>
        <EligibilityPanel expense={e} />
      </aside>
    </div>
  );
}
