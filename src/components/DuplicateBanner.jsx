import { CopyX } from 'lucide-react';
import { money } from '../lib/format.js';
import { getIrdStatus } from '../lib/ird.js';
import { formatAD } from '../lib/nepaliDate.js';
import { Button } from './ui.jsx';

/** Banner for a bill that is already saved under another record (same seller PAN + bill number). */
export function DuplicateBanner({ duplicate, onOpen, region }) {
  if (!duplicate) return null;
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-brand/60 bg-red-50 p-4 text-sm text-red-950 sm:flex-row sm:items-center">
      <CopyX className="size-6 shrink-0 text-brand" />
      <div className="flex-1">
        <p className="font-bold">This bill is already saved in BillKhata.</p>
        <p className="mt-0.5">
          Same seller PAN and bill number as <b>{duplicate.merchantName || 'another bill'}</b> ({formatAD(duplicate.billDateAD)} · {money(duplicate.totalAmount, region)} · {getIrdStatus(duplicate)}).
          {' '}A bill can enter the draw only once (Operating Procedure 2083, Section 4(6)); a second entry can void the coupon. Auto-fill is blocked for this copy.
        </p>
      </div>
      {onOpen && <Button size="sm" variant="danger" onClick={() => onOpen(duplicate)}>Open that bill</Button>}
    </div>
  );
}
