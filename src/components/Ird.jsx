// IRD lucky draw UI: eligibility panel, the per-bill action, and the Quick-Apply modal.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck, Bookmark, CircleAlert, ClipboardList, ExternalLink, Info, QrCode, Terminal, Ticket, TriangleAlert, UserRound,
} from 'lucide-react';
import { IRD_PORTAL_URL, IRD_STATUS, PAYMENT } from '../lib/constants.js';
import { buildBookmarklet, buildFillScript, checkEligibility, COUPON_RE, getIrdStatus, portalFields } from '../lib/ird.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { validateProfile } from '../lib/profile.js';
import { isDemoProfile, useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, CopyButton, Field, Modal, StatusBadge } from './ui.jsx';

export function EligibilityPanel({ expense }) {
  const result = checkEligibility(expense);
  const status = getIrdStatus(expense);
  if (!expense.isNepalBill) return null;
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900">IRD lucky draw</h3>
        <StatusBadge status={status} />
      </div>
      {result.reasons.length > 0 && (
        <ul className="space-y-1.5 text-sm text-slate-700">
          {result.reasons.map((r) => <li key={r} className="flex gap-1.5"><CircleAlert className="mt-0.5 size-4 shrink-0 text-slate-500" />{r}</li>)}
        </ul>
      )}
      {result.eligible && expense.paymentMethod === PAYMENT.DIGITAL && (
        <p className="text-sm text-blue-900">Card/QR payments are entered automatically by your bank or wallet. Keep the physical bill safe.</p>
      )}
      {result.eligible && expense.paymentMethod !== PAYMENT.DIGITAL && status === IRD_STATUS.NOT_APPLIED && (
        <p className="text-sm text-slate-700">Eligible. Save the bill, then use <b>Apply to IRD Lucky Draw</b>.</p>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
          {result.warnings.map((w) => <li key={w} className="flex gap-1.5"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{w}</li>)}
        </ul>
      )}
    </div>
  );
}

/** The right IRD action for a bill: auto-entered badge, Apply button, coupon, or nothing. */
export function IrdAction({ expense, compact = false }) {
  const { openIrd } = useStore();
  const status = getIrdStatus(expense);
  if (status === IRD_STATUS.AUTO) {
    return (
      <span className="inline-flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-900 ring-1 ring-inset ring-blue-200">
        <QrCode className="mt-px size-3.5 shrink-0" />
        {compact ? 'Auto-entered via QR/Card' : 'Auto-Entered via Payment Provider — Keep Physical Bill Safe!'}
      </span>
    );
  }
  if (status === IRD_STATUS.NOT_APPLIED) {
    return (
      <Button variant="primary" size="sm" icon={Ticket} onClick={() => openIrd(expense)}>
        {compact ? 'Apply to IRD' : 'Apply to IRD Lucky Draw'}
      </Button>
    );
  }
  if (status === IRD_STATUS.APPLIED) {
    return (
      <button type="button" onClick={() => openIrd(expense)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-mono text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100">
        <BadgeCheck className="size-3.5" />{expense.irdCoupon}
      </button>
    );
  }
  return null;
}

// React refuses javascript: URLs in JSX, so the bookmarklet href is set on the element.
function BookmarkletLink({ href }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.setAttribute('href', href);
  }, [href]);
  return (
    <a ref={ref} onClick={(e) => e.preventDefault()} draggable="true" className="cursor-grab font-semibold text-navy underline">
      BillKhata IRD fill
    </a>
  );
}

function CopyRow({ label, value, display }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`truncate font-semibold text-slate-900 ${value ? '' : 'text-brand'}`}>{display ?? (value || 'Missing')}</div>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

export function IrdModal({ expense, onClose }) {
  const { profile, saveExpense, expenses } = useStore();
  const toast = useToast();
  const current = expenses.find((x) => x.id === expense.id) || expense;
  const [coupon, setCoupon] = useState(current.irdCoupon || '');
  const [couponError, setCouponError] = useState('');
  const fields = portalFields(current, profile);
  const profileErrors = validateProfile(profile);
  const profileReady = Object.keys(profileErrors).length === 0 && !isDemoProfile(profile);
  const bookmarklet = useMemo(() => buildBookmarklet(current, profile), [current, profile]);
  const script = useMemo(() => buildFillScript(current, profile), [current, profile]);
  const dup = coupon && expenses.find((x) => x.id !== current.id && x.irdCoupon === coupon);

  const allText = [
    `Payment method: Cash`,
    `Bill number: ${fields.bill_number}`,
    `Seller PAN: ${fields.seller_pan_no}`,
    `Bill date (BS): ${current.billDateBS || ''}`,
    `Bill date (AD): ${current.billDateAD || ''}`,
    `Billed total amount: ${fields.billed_total_amount}`,
    `Name: ${fields.name}`,
    `Mobile number: ${fields.mobile_number}`,
    `Address: ${fields.address}`,
  ].join('\n');

  async function saveCoupon() {
    const c = coupon.replace(/\D/g, '');
    if (!COUPON_RE.test(c)) {
      setCouponError('The prize coupon number is exactly 12 digits.');
      return;
    }
    await saveExpense({ ...current, irdCoupon: c, irdAppliedAt: new Date().toISOString() });
    toast('Coupon saved. Bill marked as applied.');
    onClose();
  }

  async function clearCoupon() {
    await saveExpense({ ...current, irdCoupon: '', irdAppliedAt: null });
    setCoupon('');
    toast('Coupon removed.');
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="IRD Quick-Apply"
      size="xl"
      footer={(
        <>
          {current.irdCoupon && <Button variant="danger" onClick={clearCoupon}>Remove coupon</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={BadgeCheck} onClick={saveCoupon}>Save coupon</Button>
        </>
      )}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="lg:col-start-1 lg:row-start-1">
          <ol className="mb-4 space-y-2 text-sm text-slate-700">
            {[
              <>Open the IRD portal and choose <b>Cash</b> as the payment method.</>,
              <>Fill the form: run the <b>auto-fill bookmarklet</b>, or copy each field below.</>,
              <>Pick the <b>bill date</b> in the portal’s calendar: {formatBS(current.billDateBS) || '—'} BS ({formatAD(current.billDateAD)}).</>,
              <>Complete the security check and press <b>Generate Prize Coupon</b>.</>,
              <>Paste the 12-digit coupon number into the vault on this page.</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>

          <a href={IRD_PORTAL_URL} target="_blank" rel="noopener noreferrer" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-center font-semibold text-white shadow-sm hover:bg-blue-900">
            <ExternalLink className="size-[18px]" />Open prize.ird.gov.np Registration Portal
          </a>

        </div>

        <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {checkEligibility(current).warnings.map((w) => (
            <div key={w} className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />{w}
            </div>
          ))}
          {!profileReady && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <UserRound className="mt-0.5 size-4 shrink-0" />
              <span>
                {isDemoProfile(profile) ? 'You are using the demo profile. ' : ''}
                Add your real name, mobile number and address in <a href="#/settings" onClick={onClose} className="font-semibold underline">Settings</a> before applying.
              </span>
            </div>
          )}
          <div className="card divide-y divide-slate-100 px-4">
            <div className="py-2 text-xs font-bold uppercase tracking-wide text-navy">Bill details</div>
            <CopyRow label="Payment method" value="Cash" />
            <CopyRow label="Bill number" value={fields.bill_number} />
            <CopyRow label="Seller PAN number" value={fields.seller_pan_no} />
            <CopyRow label="Bill date (BS)" value={current.billDateBS} display={current.billDateBS ? `${current.billDateBS} · ${formatBS(current.billDateBS)}` : undefined} />
            <CopyRow label="Billed total amount" value={fields.billed_total_amount} />
            <div className="py-2 text-xs font-bold uppercase tracking-wide text-navy">Payer details</div>
            <CopyRow label="Name" value={fields.name} />
            <CopyRow label="Mobile number" value={fields.mobile_number} />
            <CopyRow label="Address" value={fields.address} />
          </div>

          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4">
            <h3 className="flex items-center gap-2 font-bold text-emerald-950"><Ticket className="size-4" />Coupon vault</h3>
            <Field label="12-digit prize coupon number" htmlFor="coupon" error={couponError || (dup ? `Already saved on ${dup.merchantName}'s bill.` : '')} className="mt-2">
              <input
                id="coupon"
                inputMode="numeric"
                maxLength={14}
                className={`input num font-mono text-lg tracking-widest ${couponError ? 'input-error' : ''}`}
                placeholder="000000000000"
                value={coupon}
                onChange={(e) => { setCoupon(e.target.value.replace(/\D/g, '').slice(0, 12)); setCouponError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && saveCoupon()}
              />
            </Field>
            <p className="mt-2 flex gap-1.5 text-xs text-emerald-900"><Info className="mt-px size-3.5 shrink-0" />Saved with this bill and included in backups and PDF reports. Keep the paper bill: you need it to claim a prize.</p>
          </div>
        </div>

        <div className="self-start rounded-xl border border-slate-200 bg-slate-50 p-4 lg:col-start-1 lg:row-start-2">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Bookmark className="size-4" />Auto-fill helper</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            The portal blocks other websites from sending the form for you, and asks for a human security check, so BillKhata fills the form in your own tab instead.
            On desktop, copy the bookmarklet, save it as a bookmark’s URL, then click the bookmark on the portal. Or paste the console script into the browser’s developer console there.
            It only types into the visible fields. You still pick the date, pass the security check and press submit yourself.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={bookmarklet} label="Copy bookmarklet" icon={Bookmark} variant="dark" />
            <CopyButton value={script} label="Copy console script" icon={Terminal} />
            <CopyButton value={allText} label="Copy all as text" icon={ClipboardList} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Or drag this link to your bookmarks bar: <BookmarkletLink href={bookmarklet} />
          </p>
        </div>
      </div>
    </Modal>
  );
}
