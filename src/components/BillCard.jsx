// A bill in a list (Figma: Components → Bill card; Desktop 1 → Recent bills table): thumb, shop,
// date and category, amount and how it was paid, the voucher code and one IRD status badge.
import { useEffect, useState } from 'react';
import { ChevronRight, Map, QrCode, ReceiptText, Ticket, Users, X, Zap, BadgeCheck } from 'lucide-react';
import { IRD_STATUS, PAYMENT } from '../lib/constants.js';
import { money } from '../lib/format.js';
import { checkEligibility, formatCoupon, getIrdStatus, isAutoEnrolled } from '../lib/ird.js';
import { accountsOf, defaultAccountId } from '../lib/money.js';
import { addDaysAD, shortBS, todayAD } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { Badge } from './ui.jsx';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday", "Fri" within the week, else the AD day ("31 Oct"). */
export function relativeDay(ad, today = todayAD()) {
  if (!ad) return '';
  const d = new Date(`${ad}T00:00:00Z`);
  const plain = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (!today) return plain;
  if (ad === today) return 'Today';
  if (ad === addDaysAD(today, -1)) return 'Yesterday';
  if (ad > addDaysAD(today, -7) && ad < today) return WEEKDAYS[d.getUTCDay()];
  return plain;
}

/** Short reason a bill can't go in the draw ("no PAN"). */
function ineligibleWhy(e) {
  const r = checkEligibility(e).reasons.join(' ');
  if (/PAN/.test(r)) return 'no PAN';
  if (/estimate/i.test(r)) return 'estimate';
  if (/at least/.test(r)) return 'under रु 100';
  if (/excluded/.test(r)) return 'excluded';
  if (/future/.test(r)) return 'future date';
  return '';
}

/** The one badge a bill shows, and what tapping it does ('ird' opens the IRD sheet). */
export function billBadge(e) {
  if (e.quick) return { tone: 'neutral', label: 'Quick cash out' };
  if (e.tripShareOf) return { tone: 'neutral', icon: Map, label: 'Trip share' };
  if (e.split && !e.isNepalBill) return { tone: 'neutral', icon: Users, label: 'Split · my share' };
  if (!e.isNepalBill) return null;
  const s = getIrdStatus(e);
  if (s === IRD_STATUS.NOT_APPLIED) return { tone: 'brand', icon: Ticket, label: 'Apply to IRD', action: 'ird' };
  if (s === IRD_STATUS.AUTO) return { tone: 'info', icon: Zap, label: 'Auto-entered via QR', action: 'ird', title: 'Entered by your bank or wallet. Add the coupon number when it comes.' };
  if (s === IRD_STATUS.APPLIED) return { tone: 'success', icon: isAutoEnrolled(e) ? QrCode : BadgeCheck, label: `Coupon ${formatCoupon(e.irdCoupon)}`, action: 'ird' };
  if (e.split) return { tone: 'neutral', icon: Users, label: 'Split · my share' };
  const why = ineligibleWhy(e);
  return { tone: 'neutral', icon: X, label: `Not eligible${why ? ` · ${why}` : ''}` };
}

/** "Cash", "eSewa", "Fonepay QR", or "My share of रु 1,130" for a split. */
export function payLabel(e, m) {
  if (e.split) return `My share of ${money(e.totalAmount)}`;
  if (e.paymentMethod === PAYMENT.CASH) return 'Cash';
  if (e.paymentMethod === PAYMENT.CBMS) return 'CBMS';
  const accounts = accountsOf(m);
  const acct = accounts.find((a) => a.id === (e.paidFrom || (accounts.length ? defaultAccountId(m) : '')));
  return acct && acct.kind !== 'cash' && acct.id !== 'bank' ? acct.name : 'QR / card';
}

/** The amount that's yours: your share of a split, else the bill. */
const shownAmount = (e) => (e.split ? e.split.myShare : e.totalAmount);

function Thumb({ e }) {
  return e.receiptImage
    ? <img src={e.receiptImage} alt="" loading="lazy" className="h-[52px] w-11 shrink-0 rounded-lg border border-line object-cover object-top" />
    : <span className="flex h-[52px] w-11 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-3"><ReceiptText className="size-5" /></span>;
}

function BillBadge({ e }) {
  const { openIrd } = useStore();
  const b = billBadge(e);
  if (!b) return null;
  const badge = <Badge tone={b.tone} icon={b.icon} title={b.title}>{b.label}</Badge>;
  return b.action === 'ird'
    ? <button type="button" className="tap relative z-10 rounded-full" onClick={(ev) => { ev.stopPropagation(); openIrd(e); }} aria-label={`${b.label}: ${e.merchantName}`}>{badge}</button>
    : badge;
}

/** Meta line: "16 Kartik · Today · Food & Dining", or with the PAN in the ledger. */
export function billMeta(e, { pan = false } = {}) {
  // In the ledger the day is the group heading, so the line gives the AD date and the PAN instead.
  const date = pan ? relativeDay(e.billDateAD, '') : [shortBS(e.billDateAD), relativeDay(e.billDateAD)];
  const extra = e.split ? `Split ${(e.split.members || []).filter((x) => !x.out).length || 2} ways` : pan && (e.sellerPan ? `PAN ${e.sellerPan}` : e.isNepalBill && 'No PAN');
  return [date, e.category, extra].flat().filter(Boolean).join(' · ');
}

export function BillCard({ e, pan = false }) {
  const { openEditor, money: m } = useStore();
  return (
    <li className="card relative flex flex-col gap-2.5 rounded-2xl p-3.5 transition hover:border-line-strong">
      <div className="flex gap-3">
        <Thumb e={e} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => openEditor(e)} className="text-left after:absolute after:inset-0 after:rounded-2xl">
            <span className="line-clamp-2 text-[15px] font-semibold leading-[22px] text-ink">{e.merchantName || 'Untitled bill'}</span>
          </button>
          <p className="t-caption text-ink-3">{billMeta(e, { pan })}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num font-nepali text-[15px] font-semibold leading-[22px] text-ink">{money(shownAmount(e))}</p>
          <p className="t-caption max-w-[9rem] truncate text-ink-3">{payLabel(e, m)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {e.billCode && <span className="stamp">{e.billCode}</span>}
        <BillBadge e={e} />
        <ChevronRight className="ml-auto size-5 shrink-0 text-ink-3" aria-hidden="true" />
      </div>
    </li>
  );
}

export function BillCards({ list, pan }) {
  return <ul className="space-y-2.5">{list.map((e) => <BillCard key={e.id} e={e} pan={pan} />)}</ul>;
}

/**
 * J / K move through the list and ↵ opens the bill (desktop). Off while typing or with a sheet open.
 * @returns {[number, (i: number) => void]}
 */
export function useListKeys(list) {
  const { openEditor, modal } = useStore();
  const [sel, setSel] = useState(-1);
  useEffect(() => {
    const onKey = (ev) => {
      if (modal || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = ev.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      if (ev.key === 'Enter' && t && /^(button|a)$/i.test(t.tagName)) return; // ↵ on a focused button is its own
      if (ev.key === 'j' || ev.key === 'J') { ev.preventDefault(); setSel((i) => Math.min(list.length - 1, i + 1)); }
      else if (ev.key === 'k' || ev.key === 'K') { ev.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
      else if (ev.key === 'Enter' && list[sel]) { ev.preventDefault(); openEditor(list[sel]); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list, sel, modal, openEditor]);
  useEffect(() => {
    if (sel >= 0) document.querySelector(`[data-bill-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  return [sel, setSel];
}

/** Desktop table: code, shop, IRD, amount. J / K / ↵ work on it. */
export function BillTable({ list, pan = false }) {
  const { openEditor, money: m } = useStore();
  const [sel, setSel] = useListKeys(list);
  return (
    <table className="w-full table-fixed text-left">
      <thead className="bg-sunken">
        <tr className="t-overline text-ink-3">
          <th className="w-[120px] py-2.5 pl-5 pr-2 font-semibold">Code</th>
          <th className="px-2 py-2.5 font-semibold">Shop</th>
          <th className="w-[230px] px-2 py-2.5 font-semibold">IRD</th>
          <th className="w-[130px] py-2.5 pl-2 pr-5 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {list.map((e, i) => (
          <tr key={e.id} data-bill-row={i} onClick={() => openEditor(e)} onMouseEnter={() => setSel(i)}
            className={`cursor-pointer border-t border-line align-middle transition ${sel === i ? 'bg-navy-soft shadow-[inset_3px_0_0_var(--bk-navy)]' : 'hover:bg-sunken/60'}`}>
            <td className="py-3 pl-5 pr-2">{e.billCode ? <span className="stamp">{e.billCode}</span> : <span className="text-ink-3">—</span>}</td>
            <td className="px-2 py-3">
              <p className="line-clamp-2 text-[15px] font-medium leading-5 text-ink">{e.merchantName || 'Untitled bill'}</p>
              <p className="t-caption truncate text-ink-3">{billMeta(e, { pan })} · {payLabel(e, m)}</p>
            </td>
            <td className="truncate px-2 py-3"><BillBadge e={e} /></td>
            <td className="num whitespace-nowrap py-3 pl-2 pr-5 text-right font-nepali text-[15px] font-semibold text-ink">{money(shownAmount(e))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
