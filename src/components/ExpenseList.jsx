// Bills as a table (desktop) or cards (mobile), with photo, edit, delete and IRD actions.
import { Image as ImageIcon, Pencil, Trash } from 'lucide-react';
import { money } from '../lib/format.js';
import { getIrdStatus } from '../lib/ird.js';
import { formatAD, formatBS } from '../lib/nepaliDate.js';
import { useStore } from '../store.jsx';
import { IrdAction } from './Ird.jsx';
import { useToast } from './Toast.jsx';
import { StatusBadge } from './ui.jsx';

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

/** "Split · my share रु 520 · रु 1,630 to collect" under a split bill. */
function SplitNote({ e, region }) {
  return (
    <a href={`#/split-bill/${encodeURIComponent(e.id)}`} className="mt-0.5 inline-block text-xs font-semibold text-navy hover:underline">
      Split · my share {money(e.split.myShare, region)}{e.split.outstanding > 0 ? ` · ${money(e.split.outstanding, region)} to collect` : ' · settled'}
    </a>
  );
}

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

const IconBtn = ({ label, icon: Icon, onClick, danger }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} className={`rounded-md p-2 ${danger ? 'text-slate-500 hover:bg-red-50 hover:text-brand' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>
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
                <div className="truncate font-semibold text-slate-900">{e.merchantName || 'Untitled bill'}</div>
                <div className="text-xs text-slate-500">
                  {formatAD(e.billDateAD)}{e.billDateBS ? ` · ${formatBS(e.billDateBS)}` : ''} · {e.category}
                </div>
                {e.split && <SplitNote e={e} region={profile.region} />}
              </button>
              <div className="num shrink-0 text-right font-bold text-slate-900">{money(e.totalAmount, profile.region)}</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {e.isNepalBill && <IrdAction expense={e} compact />}
              {getIrdStatus(e) === 'Ineligible' && e.isNepalBill && <StatusBadge status="Ineligible" />}
              <span className="ml-auto flex">
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
                <div className="font-medium text-slate-900">{formatAD(e.billDateAD)}</div>
                <div className="num text-xs text-slate-500">{e.billDateBS ? `BS ${e.billDateBS}` : ''}</div>
              </td>
              <td className="max-w-[220px] px-2 py-2.5">
                <button type="button" onClick={() => a.edit(e)} className="block max-w-full truncate text-left font-semibold text-slate-900 hover:underline">{e.merchantName || 'Untitled bill'}</button>
                {e.split && <SplitNote e={e} region={profile.region} />}
                {e.notes && <div className="truncate text-xs text-slate-500">{e.notes}</div>}
              </td>
              <td className="px-2 py-2.5">
                <div className="num font-mono text-xs text-slate-800">{e.sellerPan || '—'}</div>
                <div className="truncate text-xs text-slate-500">{e.invoiceNumber || '—'}</div>
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
