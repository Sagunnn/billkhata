// The empty ledger: scan, quick expense, or try the sample bills.
import { ScanLine, Sparkles, Zap } from 'lucide-react';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, EmptyState } from './ui.jsx';

export function NoBillsYet() {
  const { loadSamples, openSheet } = useStore();
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
          <Button icon={Zap} onClick={() => openSheet('quickOut')}>Quick expense</Button>
          <Button variant="ghost" icon={Sparkles} onClick={async () => { await loadSamples(); toast('Sample bills added. Remove them any time in Settings.'); }}>Load sample bills</Button>
        </div>
      )}
    >
      Take a photo of a paper bill and BillKhata reads the shop, PAN, date and total for you. It stays on this device.
    </EmptyState>
  );
}
