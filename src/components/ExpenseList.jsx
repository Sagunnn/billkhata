// Bills as a table (desktop) or cards (mobile), with photo, edit, delete and IRD actions.
import { Image as ImageIcon, PencilLine, Pencil, ScanLine, Sparkles, Trash } from 'lucide-react';
import { blankExpense } from '../lib/expense.js';
import { money } from '../lib/format.js';
import { getIrdStatus } from '../lib/ird.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { IrdAction } from './Ird.jsx';
import { BankTag } from './BankMatch.jsx';
import { useToast } from './Toast.jsx';
import { Button, EmptyState, StatusBadge } from './ui.jsx';

function useActions() {
  const { openEditor, openPhoto, removeExpense } = useStore();
  const toast = useToast();
  return {
    edit: openEditor,
    photo: openPhoto,
    remove: async (e) => {
      if (!window.confirm(`Delete the bill from ${e.merchantName || 'this shop'}? This cannot be undone.`)) return;
      await removeExpense(e.id);
      toast('Bill deleted.');
    },
  };
}

/** Trip bills (kept for the IRD draw, not counted as spending) and logged trip shares. */
function TripNote({ e }) {
  const tripId = e.tripId || e.tripShareOf;
  if (!tripId) return null;
  return (
    <a href={`#/trip/${encodeURIComponent(tripId)}`} className="mt-0.5 inline-block text-xs font-semibold text-navy hover:underline">
      {e.tripShareOf ? 'Trip share (your part of the trip)' : 'Trip bill · counted in your trip share'}
    </a>
  );
}

/** "Split · my share रु 520 · रु 1,630 to collect" under a split bill. */
function SplitNote({ e, region }) {
  return (
    <a href={`#/split-bill/${encodeURIComponent(e.id)}`} className="mt-0.5 inline-block text-xs font-semibold text-navy hover:underline">
      Split · my share {money(e.split.myShare, region)}{e.split.outstanding > 0 ? ` · ${money(e.split.outstanding, region)} to collect` : ' · settled'}
    </a>
  );
}

const CodeChip = ({ code }) => (
  <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-px align-middle font-mono text-[11px] font-bold text-slate-700 ring-1 ring-inset ring-slate-300" title="Voucher code">{code}</span>
);

function Thumb({ e, onClick }) {
  if (!e.receiptImage) {
    return <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400"><ImageIcon className="size-5" /></div>;
  }
  return (
    <button type="button" onClick={onClick} className="size-11 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50" aria-label={`View photo of ${e.merchantName} bill`}>
      <img src={e.receiptImage} alt="" className="size-full object-cover object-top" loading="lazy" />
    </button>
  );
}

/** The muted lines under a bill: "1 Nov 2026 · 15 Kartik 2083 · Groceries", then "Inv … · PAN …". */
function Meta({ e }) {
  const line = (parts) => parts.filter(Boolean).join(' · ');
  const ids = line([e.invoiceNumber && `Inv ${e.invoiceNumber}`, e.sellerPan && `PAN ${e.sellerPan}`]);
  return (
    <div className="num mt-0.5 text-[0.8rem] leading-snug text-slate-500">
      <div className="truncate">{line([formatAD(e.billDateAD), e.billDateBS && formatBS(e.billDateBS), e.category])}</div>
      {ids && <div className="truncate">{ids}</div>}
    </div>
  );
}

const IconBtn = ({ label, icon: Icon, onClick, danger }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} className={`tap inline-flex items-center justify-center rounded-md p-2 ${danger ? 'text-slate-500 hover:bg-red-50 hover:text-brand' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
    <Icon className="size-4" />
  </button>
);

export function ExpenseCards({ list }) {
  const { profile } = useStore();
  const a = useActions();
  return (
    <ul className="divide-y divide-slate-100">
      {list.map((e) => (
        <li key={e.id} className="flex gap-3 px-4 py-3">
          <Thumb e={e} onClick={() => a.photo(e)} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => a.edit(e)} className="min-w-0 text-left">
                <div className="truncate font-semibold text-slate-900">{e.billCode && <CodeChip code={e.billCode} />}{e.merchantName || 'Untitled bill'}</div>
                <Meta e={e} />
              </button>
              <div className="num shrink-0 text-right text-[15px] font-bold text-slate-900">{money(e.totalAmount, profile.region)}</div>
            </div>
            {e.split && <SplitNote e={e} region={profile.region} />}
            <TripNote e={e} />
            <BankTag e={e} />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {e.isNepalBill && <IrdAction expense={e} compact />}
              {getIrdStatus(e) === 'Ineligible' && e.isNepalBill && <StatusBadge status="Ineligible" />}
              <span className="-mr-2 ml-auto flex">
                <IconBtn label="Edit" icon={Pencil} onClick={() => a.edit(e)} />
                <IconBtn label="Delete" icon={Trash} onClick={() => a.remove(e)} danger />
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ExpenseTable({ list }) {
  const { profile } = useStore();
  const a = useActions();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-4 py-3" />
            <th className="px-2 py-3">Date</th>
            <th className="px-2 py-3">Merchant</th>
            <th className="px-2 py-3">PAN / Invoice</th>
            <th className="px-2 py-3">Category · Paid by</th>
            <th className="px-2 py-3 text-right">Amount</th>
            <th className="px-2 py-3">IRD draw</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((e) => (
            <tr key={e.id} className="align-middle hover:bg-slate-50/70">
              <td className="py-2.5 pl-4 pr-2"><Thumb e={e} onClick={() => a.photo(e)} /></td>
              <td className="whitespace-nowrap px-2 py-2.5">
                <div className="num font-medium text-slate-900">{formatAD(e.billDateAD)}</div>
                <div className="num text-xs text-slate-500">{e.billDateBS ? `BS ${e.billDateBS}` : ''}</div>
              </td>
              <td className="max-w-[220px] px-2 py-2.5">
                <button type="button" onClick={() => a.edit(e)} className="block max-w-full truncate text-left font-semibold text-slate-900 hover:underline">{e.billCode && <CodeChip code={e.billCode} />}{e.merchantName || 'Untitled bill'}</button>
                {e.split && <SplitNote e={e} region={profile.region} />}
                <TripNote e={e} />
                <div><BankTag e={e} /></div>
                {e.notes && <div className="truncate text-xs text-slate-500">{e.notes}</div>}
              </td>
              <td className="px-2 py-2.5">
                <div className="font-mono text-xs text-slate-800">{e.sellerPan || '—'}</div>
                <div className="num max-w-[140px] truncate text-xs text-slate-500">{e.invoiceNumber || '—'}</div>
              </td>
              <td className="px-2 py-2.5">
                <div className="text-slate-800">{e.category}</div>
                <div className="text-xs text-slate-500">{e.paymentMethod}</div>
              </td>
              <td className="num whitespace-nowrap px-2 py-2.5 text-right font-bold text-slate-900">
                {money(e.totalAmount, profile.region)}
                {e.vatAmount ? <div className="text-xs font-normal text-slate-500">VAT {money(e.vatAmount, profile.region, { symbol: false })}</div> : null}
              </td>
              <td className="px-2 py-2.5">
                {e.isNepalBill ? (
                  <div className="flex flex-col items-start gap-1">
                    {getIrdStatus(e) === 'Ineligible' ? <StatusBadge status="Ineligible" /> : <IrdAction expense={e} compact />}
                  </div>
                ) : <span className="text-xs text-slate-400">Not a Nepal bill</span>}
              </td>
              <td className="whitespace-nowrap py-2.5 pl-2 pr-4 text-right">
                <IconBtn label="Edit" icon={Pencil} onClick={() => a.edit(e)} />
                <IconBtn label="Delete" icon={Trash} onClick={() => a.remove(e)} danger />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Cards below md, table at md and up. */
export function ExpenseList({ list }) {
  return (
    <>
      <div className="md:hidden"><ExpenseCards list={list} /></div>
      <div className="hidden md:block"><ExpenseTable list={list} /></div>
    </>
  );
}

/** No bills at all yet: what to do first. */
export function NoBillsYet() {
  const { loadSamples, openEditor, profile } = useStore();
  const toast = useToast();
  return (
    <EmptyState
      icon={ScanLine}
      title="No bills yet"
      action={(
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          <a href="#/scan" className="tap inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark">
            <ScanLine className="size-[18px]" />Scan a bill
          </a>
          <Button icon={PencilLine} onClick={() => openEditor(blankExpense(profile.region))}>Add by hand</Button>
          <Button variant="ghost" icon={Sparkles} onClick={async () => { await loadSamples(); toast('Sample bills added. Remove them any time in Settings.'); }}>Load sample bills</Button>
        </div>
      )}
    >
      Take a photo of a paper bill and BillKhata reads the shop, PAN, date and total for you. It stays on this device.
    </EmptyState>
  );
}
