// Landing page for the portal helper's "Save to BillKhata": #/coupon/<billId>/<12-digit code>.
// Asks before saving, since any page could link here.
import { useState } from 'react';
import { BadgeCheck, CircleAlert, Ticket } from 'lucide-react';
import { COUPON_RE } from '../lib/ird.js';
import { money } from '../lib/format.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { useToast } from '../components/Toast.jsx';
import { Button, Card, EmptyState, PageHeader } from '../components/ui.jsx';

export default function CouponImport({ billId, code }) {
  const { expenses, saveExpense, profile } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const bill = expenses.find((e) => e.id === billId);
  const valid = COUPON_RE.test(code || '');
  const other = valid && expenses.find((e) => e.irdCoupon === code && e.id !== billId);

  async function save() {
    setBusy(true);
    await saveExpense({ ...bill, irdCoupon: code, irdAppliedAt: new Date().toISOString() });
    toast('Coupon saved. Bill marked as applied.');
    window.location.hash = '#/ledger';
  }

  if (!valid || !bill) {
    return (
      <Card>
        <EmptyState icon={CircleAlert} title={!valid ? 'That coupon link is not valid' : 'Bill not found in this browser'} action={<a href="#/ledger" className="font-semibold text-navy underline">Open the ledger</a>}>
          {!valid ? 'A prize coupon number has exactly 12 digits.' : 'The coupon came from a bill saved in another browser. Add it by hand from the bill’s IRD screen.'}
          {valid && <span className="mt-2 block font-mono text-base font-bold text-slate-900">{code}</span>}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Save prize coupon" subtitle="Sent from the IRD portal by the BillKhata helper" />
      <Card className="p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Coupon number</div>
        <div className="mt-1 font-mono text-3xl font-bold tracking-widest text-emerald-800">{code}</div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-semibold text-slate-900">{bill.merchantName}</div>
          <div className="text-slate-600">
            Bill {bill.invoiceNumber || '—'} · {formatBS(bill.billDateBS) || formatAD(bill.billDateAD)} · <span className="num">{money(bill.totalAmount, profile.region)}</span>
          </div>
        </div>
        {bill.irdCoupon && bill.irdCoupon !== code && (
          <p className="mt-3 flex gap-1.5 text-sm text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0" />This bill already has coupon {bill.irdCoupon}. Saving replaces it.</p>
        )}
        {other && (
          <p className="mt-3 flex gap-1.5 text-sm text-amber-900"><CircleAlert className="mt-0.5 size-4 shrink-0" />This coupon is also saved on {other.merchantName}’s bill.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { window.location.hash = '#/ledger'; }}>Cancel</Button>
          {bill.irdCoupon === code
            ? <Button variant="dark" icon={BadgeCheck} onClick={() => { window.location.hash = '#/ledger'; }}>Already saved</Button>
            : <Button variant="primary" icon={Ticket} onClick={save} disabled={busy}>Save coupon</Button>}
        </div>
      </Card>
    </div>
  );
}
