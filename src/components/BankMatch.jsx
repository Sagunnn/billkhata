// On the bill form: what your bank statement and payment screenshots say about this bill.
// A bill scanned anywhere (Scan page, bill editor) is checked against them as soon as it has a
// total and a date, so you see "paid from Global IME ••0123 on 29 Oct" before you save it.
import { useMemo } from 'react';
import { CircleCheck, Landmark, Smartphone, TriangleAlert } from 'lucide-react';
import { PAYMENT } from '../lib/constants.js';
import { money } from '../lib/format.js';
import { formatAD } from '../lib/nepaliDate.js';
import { bankMatchFor } from '../lib/bank/reconcile.js';
import { useStore } from '../store.jsx';
import { Button } from './ui.jsx';

function Where({ x, statements, region }) {
  const st = x.bank && statements.find((s) => s.id === x.bank.statementId);
  return (
    <ul className="mt-1.5 space-y-1 text-xs">
      {x.bank && (
        <li className="flex gap-1.5"><Landmark className="mt-px size-3.5 shrink-0" />
          <span><b>{st?.bank || 'Bank'}{st?.account ? ` ••${st.account}` : ''}</b>, {formatAD(x.bank.date)}: {x.bank.description} <span className="num font-semibold">−{money(x.bank.debit, region)}</span></span>
        </li>
      )}
      {x.payment && (
        <li className="flex gap-1.5"><Smartphone className="mt-px size-3.5 shrink-0" />
          <span><b>{x.payment.app || 'Payment'} screenshot</b>, {formatAD(x.payment.dateAD)}{x.payment.time ? ` ${x.payment.time}` : ''}{x.payment.merchant ? ` to ${x.payment.merchant}` : ''}{x.payment.ref ? ` · ${x.payment.ref}` : ''}</span>
        </li>
      )}
    </ul>
  );
}

/**
 * @param bill the bill being checked (may not be saved yet)
 * @param onChange patch the bill
 * @param onUseFor optional: replace a photo-less bill (added from the Bank page) with this scan
 */
export function useBankMatch(bill) {
  const { statements, payments, expenses, reconOverrides } = useStore();
  const key = `${bill.id}|${bill.totalAmount}|${bill.billDateAD}|${bill.merchantName}|${bill.paymentMethod}`;
  return useMemo(
    () => (Number(bill.totalAmount) > 0 && bill.billDateAD ? bankMatchFor(bill, { statements, payments, expenses, overrides: reconOverrides }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, statements, payments, expenses, reconOverrides],
  );
}

/** The scan can replace a photo-less bill that holds its bank row (then it handles the duplicate warning too). */
export const canReplace = (m, bill, onUseFor) => Boolean(onUseFor && m?.taken && !m.taken.expense.receiptImage
  && !(bill.duplicateOverride || []).includes(m.taken.expense.id));

export function BankMatchCard({ bill, match: m, region, onChange, onUseFor }) {
  const { statements } = useStore();
  if (!m) return null;
  const digital = bill.paymentMethod === PAYMENT.DIGITAL;
  const setDigital = !digital && onChange && (
    <Button size="sm" variant="dark" onClick={() => onChange({ paymentMethod: PAYMENT.DIGITAL })}>Set “Paid by” to Digital QR / Card</Button>
  );

  if (m.entry) {
    return (
      <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-sm text-emerald-950">
        <p className="flex items-center gap-1.5 font-bold"><CircleCheck className="size-4" />
          {m.entry.bank && m.entry.payment ? 'Found in your bank statement and a payment screenshot' : m.entry.bank ? 'Found in your bank statement' : 'Found in a payment screenshot'}
        </p>
        <Where x={m.entry} statements={statements} region={region} />
        {m.entry.unsure && <p className="mt-1.5 text-xs text-amber-900">Another payment of the same amount fits too: check it on the Bank page.</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {setDigital}
          <a href="#/bank" className="text-xs font-semibold text-emerald-900 underline">Open Bank</a>
        </div>
      </div>
    );
  }

  if (m.taken) {
    const other = m.taken.expense;
    const replaceable = canReplace(m, bill, onUseFor);
    return (
      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-950">
        <p className="flex items-center gap-1.5 font-bold"><TriangleAlert className="size-4" />
          This payment already has a bill: [{other.billCode || 'saved'}] {other.merchantName} {money(other.totalAmount, region)}{replaceable ? ', with no photo' : ''}
        </p>
        <Where x={m.taken} statements={statements} region={region} />
        <p className="mt-1.5 text-xs">
          {replaceable
            ? 'It was added from the bank statement before you had the paper bill. Use this scan for it: its photo, items, PAN and bill number go onto that bill, so there is one bill, not two.'
            : 'If it is the same purchase, this scan is a duplicate.'}
        </p>
        {replaceable && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="dark" onClick={() => onUseFor(other)}>Use this scan for [{other.billCode || 'that bill'}]</Button>
            <Button size="sm" onClick={() => onChange({ duplicateOverride: [...new Set([...(bill.duplicateOverride || []), other.id])] })}>Keep both: it’s a different purchase</Button>
          </div>
        )}
      </div>
    );
  }

  if (m.missing) {
    return (
      <div role="status" className="rounded-xl border border-slate-300 bg-slate-50 p-3.5 text-sm text-slate-800">
        <p className="flex items-center gap-1.5 font-semibold"><Landmark className="size-4" />Not in your bank statement ({formatAD(m.range.from)} – {formatAD(m.range.to)})</p>
        <p className="mt-1 text-xs">Paid by QR or card but not found: check the amount and date, or it was paid from another account.</p>
      </div>
    );
  }
  return null;
}

/** "In bank" / "Screenshot" tag under a bill in the ledger. */
export function BankTag({ e }) {
  const { bankRecon, statements } = useStore();
  const x = bankRecon.byExpense.get(e.id);
  if (!x) return null;
  const source = x.bank && statements.find((st) => st.id === x.bank.statementId)?.bank;
  const where = source ? `In ${source}` : 'In bank';
  const label = x.bank && x.payment ? `${where} · screenshot` : x.bank ? (source ? where : 'In bank statement') : 'Payment screenshot';
  return (
    <a href="#/bank" className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:underline" title={x.bank?.description || x.payment?.merchant || ''}>
      <CircleCheck className="size-3.5" />{label}{x.bank ? ` · ${formatAD(x.bank.date)}` : ''}
    </a>
  );
}
