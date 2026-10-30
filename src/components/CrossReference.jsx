// Cross-Reference Alert Card: shown on the bill form when this bill looks like one already saved.
import { useState } from 'react';
import { Eye, Trash } from 'lucide-react';
import { money } from '../lib/format.js';
import { findEarlierInvoiceDuplicate } from '../lib/dedupe.js';
import { formatAD } from '../lib/nepaliDate.js';
import { Button, Modal } from './ui.jsx';

/** Matches that still need a decision: earlier bills this one copies, not yet overridden. */
export const unresolvedMatches = (matches, bill) => matches.filter((m) => m.earlier && !(bill.duplicateOverride || []).includes(m.bill.id));

const LEVEL_LABEL = { exact: 'Same bill number', ocr: 'Bill number look-alike', items: 'Same item sequence', image: 'Same photo', 'same-day': 'Same shop, total and day' };

function Photo({ src, label, onOpen }) {
  if (!src) return <span className="text-xs text-slate-400">No photo</span>;
  return (
    <button type="button" onClick={() => onOpen(src, label)} className="block overflow-hidden rounded border border-slate-200 bg-white" aria-label={`View ${label}`}>
      <img src={src} alt={label} className="h-20 w-16 object-cover object-top" />
    </button>
  );
}

export function CrossReferenceCard({ matches, bill, region, codeForThis, onView, onDiscard, discardLabel = 'Discard duplicate scan', onOverride }) {
  const [zoom, setZoom] = useState(null);
  if (!matches.length) return null;
  const [top] = matches;
  const other = top.bill;
  const isCopy = top.earlier;
  const overridden = (bill.duplicateOverride || []).includes(other.id);
  const sameInvoiceForIrd = Boolean(findEarlierInvoiceDuplicate(bill, [other]));
  const items = (b) => (b.lineItems || []).length;
  const rows = [
    ['Code', codeForThis || '—', other.billCode || '—'],
    ['Date', `${formatAD(bill.billDateAD)}${bill.billDateBS ? ` · ${bill.billDateBS}` : ''}`, `${formatAD(other.billDateAD)}${other.billDateBS ? ` · ${other.billDateBS}` : ''}`],
    ['Shop', bill.merchantName || '—', other.merchantName || '—'],
    ['Seller PAN', bill.sellerPan || '—', other.sellerPan || '—'],
    ['Bill no.', bill.invoiceNumber || '—', other.invoiceNumber || '—'],
    ['Total', money(bill.totalAmount, region), money(other.totalAmount, region)],
    ['Items', items(bill) ? `${items(bill)} items` : '—', items(other) ? `${items(other)} items` : '—'],
  ];

  return (
    <div role="alert" className={`rounded-xl border-2 p-4 text-sm ${isCopy && !overridden ? 'border-amber-400 bg-amber-50 text-amber-950' : 'border-slate-300 bg-slate-50 text-slate-800'}`}>
      <p className="font-bold">
        {isCopy
          ? <span>⚠️ Cross-Reference Match: Already logged as [{other.billCode || 'no code'}] on {other.billDateBS || other.billDateAD}</span>
          : <span>A later bill [{other.billCode || 'no code'}] looks like a copy of this one</span>}
      </p>
      <ul className="mt-2 space-y-1 pl-7">
        {top.reasons.map((r) => <li key={r} className="list-disc">{r}</li>)}
      </ul>
      {matches.length > 1 && (
        <p className="mt-1 pl-7 text-xs">
          Also similar: {matches.slice(1).map((m) => `[${m.bill.billCode || m.bill.merchantName}] (${LEVEL_LABEL[m.level]})`).join(', ')}
        </p>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 font-semibold text-slate-600">
            <tr><th className="px-2 py-1.5" /><th className="px-2 py-1.5">This bill</th><th className="px-2 py-1.5">Already saved</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {rows.map(([k, a, b]) => (
              <tr key={k}><td className="px-2 py-1.5 font-semibold text-slate-500">{k}</td><td className={`px-2 py-1.5 ${a === b ? 'font-semibold text-amber-900' : ''}`}>{a}</td><td className={`px-2 py-1.5 ${a === b ? 'font-semibold text-amber-900' : ''}`}>{b}</td></tr>
            ))}
            <tr>
              <td className="px-2 py-1.5 font-semibold text-slate-500">Photo</td>
              <td className="px-2 py-1.5"><Photo src={bill.receiptImage} label="this bill" onOpen={(s, l) => setZoom({ s, l })} /></td>
              <td className="px-2 py-1.5"><Photo src={other.receiptImage} label={`bill ${other.billCode || ''}`} onOpen={(s, l) => setZoom({ s, l })} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {onView && <Button size="sm" icon={Eye} onClick={() => onView(other)}>View existing bill [{other.billCode || 'saved'}]</Button>}
        {isCopy && onDiscard && <Button size="sm" variant="danger" icon={Trash} onClick={onDiscard}>{discardLabel}</Button>}
        {isCopy && onOverride && (
          <Button size="sm" variant={overridden ? 'dark' : 'outline'} aria-pressed={overridden} onClick={() => onOverride(other.id, !overridden)}>
            {overridden ? '✓ Saving anyway (override)' : 'Save Anyway (Override)'}
          </Button>
        )}
      </div>
      {isCopy && overridden && (
        <p className="mt-2 text-xs">
          This bill will be saved as a separate bill.{sameInvoiceForIrd ? ' Because it has the same seller PAN and bill number, IRD auto-fill stays blocked for it: a bill can enter the draw only once.' : ''}
        </p>
      )}
      {zoom && (
        <Modal open onClose={() => setZoom(null)} title={zoom.l} size="lg">
          <img src={zoom.s} alt={zoom.l} className="mx-auto max-h-[70dvh] object-contain" />
        </Modal>
      )}
    </div>
  );
}
