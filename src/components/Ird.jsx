// IRD lucky draw UI: eligibility panel, per-bill action, the Quick-Apply modal for cash bills,
// the coupon-only modal for Fonepay/QR/card bills, and the one-time helper setup.
import { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck, Bookmark, ChevronDown, CircleAlert, ClipboardList, Download, ExternalLink, Info, MousePointerClick, QrCode,
  Terminal, Ticket, TriangleAlert, UserRound,
} from 'lucide-react';
import { IRD_STATUS, PAYMENT } from '../lib/constants.js';
import { checkEligibility, COUPON_RE, getIrdStatus, isAutoEnrolled, portalFields, portalLink } from '../lib/ird.js';
import { appOrigin, bookmarklet, consoleScript, HELPER_VERSION, userscriptUrl } from '../lib/irdHelper.js';
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
      {result.eligible && isAutoEnrolled(expense) && (
        <p className="text-sm text-blue-900">Fonepay / QR / card payments are entered automatically by your bank or wallet. Don’t enroll it again — just save the coupon number from your app.</p>
      )}
      {result.eligible && !isAutoEnrolled(expense) && status === IRD_STATUS.NOT_APPLIED && (
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

/** The right IRD action for a bill: Apply (cash), Add coupon (QR/card), the saved coupon, or nothing. */
export function IrdAction({ expense, compact = false }) {
  const { openIrd } = useStore();
  const status = getIrdStatus(expense);
  if (status === IRD_STATUS.AUTO) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="inline-flex items-start gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-900 ring-1 ring-inset ring-blue-200">
          <QrCode className="mt-px size-3.5 shrink-0" />
          {compact ? 'Auto-entered via QR' : 'Auto-Entered via Payment Provider — Keep Physical Bill Safe!'}
        </span>
        <Button size="sm" icon={Ticket} onClick={() => openIrd(expense)}>Add coupon</Button>
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
      <button type="button" onClick={() => openIrd(expense)} title="Coupon saved" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 font-mono text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100">
        {isAutoEnrolled(expense) ? <QrCode className="size-3.5" /> : <BadgeCheck className="size-3.5" />}{expense.irdCoupon}
      </button>
    );
  }
  return null;
}

// React refuses javascript: URLs in JSX, so the bookmarklet href is set on the element.
function BookmarkletLink({ href, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.setAttribute('href', href);
  }, [href]);
  return (
    <a ref={ref} onClick={(e) => e.preventDefault()} draggable="true" title="Drag me to your bookmarks bar" className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border-2 border-dashed border-navy/50 bg-white px-3 py-1.5 text-sm font-bold text-navy">
      <Bookmark className="size-4" />{children}
    </a>
  );
}

/** One-time setup for the one-click portal fill. Used in the Quick-Apply modal and Settings. */
export function HelperSetup({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <MousePointerClick className="size-4 text-navy" />
        <span className="flex-1 text-sm font-bold text-slate-900">Set up one-click fill <span className="font-normal text-slate-500">(once per browser)</span></span>
        <ChevronDown className={`size-4 text-slate-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
          <div>
            <p className="font-semibold text-slate-900">Option A · Tampermonkey (recommended)</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>Install the free <a className="font-semibold text-navy underline" href="https://www.tampermonkey.net/" target="_blank" rel="noopener noreferrer">Tampermonkey</a> extension (Chrome, Edge, Firefox, Safari).</li>
              <li>Open the script below and press <b>Install</b>.</li>
              <li>From then on, <b>Open portal &amp; auto-fill</b> shows a BillKhata box on the portal. Click <b>Fill the form</b>.</li>
            </ol>
            <a href={userscriptUrl()} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800">
              <Download className="size-4" />Install userscript v{HELPER_VERSION}
            </a>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Option B · Bookmarklet (no extension)</p>
            <p className="mt-1">Drag this to your bookmarks bar. After <b>Open portal &amp; auto-fill</b>, click the bookmark on the portal and it fills the form straight away.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <BookmarkletLink href={bookmarklet()}>BillKhata → IRD</BookmarkletLink>
              <CopyButton value={bookmarklet()} label="Copy bookmarklet" />
            </div>
            <p className="mt-1 text-xs text-slate-500">On a phone: copy it, add any bookmark, then edit the bookmark’s URL and paste.</p>
          </div>
          <p className="flex gap-1.5 text-xs text-slate-500">
            <Info className="mt-px size-3.5 shrink-0" />
            The script runs only on prize.ird.gov.np. It types into the 8 form fields; you still do the security check and press submit. After you submit, it offers to save the coupon back here.
          </p>
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value, display, warn }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
        <div className={`truncate font-semibold ${value ? 'text-slate-900' : 'text-brand'}`}>{display ?? (value || 'Missing')}</div>
        {warn && <div className="text-xs text-amber-800">{warn}</div>}
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function CouponVault({ expense, onClose, help }) {
  const { saveExpense, expenses } = useStore();
  const toast = useToast();
  const [coupon, setCoupon] = useState(expense.irdCoupon || '');
  const [error, setError] = useState('');
  const dup = coupon && expenses.find((x) => x.id !== expense.id && x.irdCoupon === coupon);

  async function save() {
    const c = coupon.replace(/\D/g, '');
    if (!COUPON_RE.test(c)) {
      setError('The prize coupon number is exactly 12 digits.');
      return;
    }
    await saveExpense({ ...expense, irdCoupon: c, irdAppliedAt: new Date().toISOString() });
    toast('Coupon saved.');
    onClose();
  }

  return (
    <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4">
      <h3 className="flex items-center gap-2 font-bold text-emerald-950"><Ticket className="size-4" />Coupon vault</h3>
      {help && <p className="mt-1 text-sm text-emerald-950">{help}</p>}
      <Field label="12-digit prize coupon number" htmlFor="coupon" error={error || (dup ? `Already saved on ${dup.merchantName}'s bill.` : '')} className="mt-2">
        <div className="flex gap-2">
          <input
            id="coupon"
            inputMode="numeric"
            className={`input num font-mono text-lg tracking-widest ${error ? 'input-error' : ''}`}
            placeholder="000000000000"
            value={coupon}
            onChange={(e) => { setCoupon(e.target.value.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/\D/g, '').slice(0, 12)); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <Button variant="primary" icon={BadgeCheck} onClick={save} className="h-auto">Save</Button>
        </div>
      </Field>
      <p className="mt-2 flex gap-1.5 text-xs text-emerald-900"><Info className="mt-px size-3.5 shrink-0" />Kept with this bill, in backups and in PDF reports. Keep the paper bill: you need it to claim a prize.</p>
      {expense.irdCoupon && (
        <button
          type="button"
          className="mt-2 text-xs font-semibold text-brand underline"
          onClick={async () => { await saveExpense({ ...expense, irdCoupon: '', irdAppliedAt: null }); setCoupon(''); toast('Coupon removed.'); }}
        >
          Remove saved coupon
        </button>
      )}
    </div>
  );
}

/** Fonepay / QR / card bills: already in the draw, so only the coupon number is needed. */
function DigitalCouponModal({ expense, onClose }) {
  return (
    <Modal open onClose={onClose} title="Save your coupon number" size="md">
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl bg-blue-50 p-4 text-sm text-blue-950 ring-1 ring-inset ring-blue-200">
          <QrCode className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-bold">{expense.merchantName} · paid by {expense.paymentMethod === PAYMENT.DIGITAL ? 'Fonepay / QR / card' : expense.paymentMethod}</p>
            <p className="mt-1">Your bank or wallet has already entered this bill in the IRD draw, so there is no form to fill. <b>Don’t enroll it again on prize.ird.gov.np</b>: duplicate entries are disqualified.</p>
          </div>
        </div>
        <div className="text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Where to find the coupon number</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Open your banking or wallet app (Fonepay, eSewa, Khalti, mobile banking).</li>
            <li>Look in the transaction details, notifications, or the coupon / rewards section.</li>
            <li>It’s a 12-digit number. Paste or type it below.</li>
          </ul>
        </div>
        <CouponVault expense={expense} onClose={onClose} />
      </div>
    </Modal>
  );
}

function CashApplyModal({ expense: current, onClose }) {
  const { profile } = useStore();
  const fields = portalFields(current, profile);
  const profileReady = Object.keys(validateProfile(profile)).length === 0 && !isDemoProfile(profile);
  const billNumberChanged = current.invoiceNumber && fields.bill_number !== current.invoiceNumber.trim();
  const warnings = checkEligibility(current).warnings;

  const allText = [
    'Payment method: Cash',
    `Bill number: ${fields.bill_number}`,
    `Seller PAN: ${fields.seller_pan_no}`,
    `Bill date (BS): ${current.billDateBS || ''}`,
    `Bill date (AD): ${current.billDateAD || ''}`,
    `Billed total amount: ${fields.billed_total_amount}`,
    `Name: ${fields.name}`,
    `Mobile number: ${fields.mobile_number}`,
    `Address: ${fields.address}`,
  ].join('\n');

  return (
    <Modal open onClose={onClose} title="IRD Quick-Apply" size="xl" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
          <ol className="space-y-2 text-sm text-slate-700">
            {[
              <>Press <b>Open portal &amp; auto-fill</b>. The bill travels with the link.</>,
              <>On the portal, click <b>Fill the form</b> in the BillKhata box (or click your bookmarklet). All 8 fields fill in.</>,
              <>Complete the security check and press <b>Generate prize coupon</b>.</>,
              <>Press <b>Save to BillKhata</b> in the box, or paste the 12-digit coupon into the vault here.</>,
            ].map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          <a
            href={portalLink(current, profile, appOrigin())}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-center font-semibold text-white shadow-sm hover:bg-blue-900"
          >
            <ExternalLink className="size-[18px]" />Open portal &amp; auto-fill
          </a>
          <HelperSetup />
        </div>

        <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {warnings.map((w) => (
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
          <CouponVault expense={current} onClose={onClose} />
          <details className="card group px-4">
            <summary className="flex cursor-pointer items-center gap-2 py-3 text-sm font-bold text-slate-900">
              <ClipboardList className="size-4" />Copy fields by hand
              <ChevronDown className="ml-auto size-4 text-slate-500 transition group-open:rotate-180" />
            </summary>
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              <CopyRow label="Payment method" value="Cash" />
              <CopyRow label="Bill number" value={fields.bill_number} warn={billNumberChanged ? `Cleaned from “${current.invoiceNumber}”: the portal accepts only letters, digits and . / _ -` : ''} />
              <CopyRow label="Seller PAN number" value={fields.seller_pan_no} />
              <CopyRow label="Bill date (BS)" value={current.billDateBS} display={current.billDateBS ? `${current.billDateBS} · ${formatBS(current.billDateBS)}` : undefined} warn={current.billDateAD ? `AD ${formatAD(current.billDateAD)}` : ''} />
              <CopyRow label="Billed total amount" value={fields.billed_total_amount} />
              <CopyRow label="Name" value={fields.name} />
              <CopyRow label="Mobile number" value={fields.mobile_number} />
              <CopyRow label="Address" value={fields.address} />
              <div className="flex flex-wrap gap-2 py-3">
                <CopyButton value={allText} label="Copy all as text" icon={ClipboardList} />
                <CopyButton value={consoleScript(current, profile)} label="Copy console script" icon={Terminal} />
              </div>
              <p className="pb-3 text-xs text-slate-500">The console script fills the form when pasted into the browser’s developer console on prize.ird.gov.np, if you opened the portal some other way.</p>
            </div>
          </details>
        </div>
      </div>
    </Modal>
  );
}

export function IrdModal({ expense, onClose }) {
  const { expenses } = useStore();
  const current = expenses.find((x) => x.id === expense.id) || expense;
  return isAutoEnrolled(current)
    ? <DigitalCouponModal expense={current} onClose={onClose} />
    : <CashApplyModal expense={current} onClose={onClose} />;
}
