// "Saved on this device": where the bills live, and how fresh the last backup file is.
import { ShieldCheck } from 'lucide-react';
import { backupStatus } from '../lib/backup.js';
import { useStore } from '../store.jsx';

function useBackupStatus() {
  const { expenses, lastBackupAt } = useStore();
  const own = expenses.filter((e) => !e.isSample).length;
  return backupStatus(lastBackupAt, own);
}

const BACKUP_HREF = '#/settings?backup';

/** Small pill for the mobile header. An amber dot means no backup in the last two weeks. */
export function StorageIndicator() {
  const st = useBackupStatus();
  return (
    <a
      href={BACKUP_HREF}
      className="tap relative inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-inset ring-emerald-200"
      aria-label={`Saved only on this device. ${st.text}. Open backup.`}
      title={st.text}
    >
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      On this device
      {st.stale && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-white" aria-hidden="true" />}
    </a>
  );
}

/** The sidebar's note: where bills are kept and when they were last backed up. */
export function StorageNote() {
  const st = useBackupStatus();
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
      <p className="flex items-center gap-1.5 font-semibold text-slate-800"><ShieldCheck className="size-4 text-emerald-700" />Saved on this device</p>
      <p className="mt-1">Your bills never leave this browser.</p>
      <a href={BACKUP_HREF} className={`mt-1.5 flex items-center gap-1.5 font-semibold ${st.stale ? 'text-amber-800' : 'text-slate-700'} hover:underline`}>
        <span className={`size-2 rounded-full ${st.stale ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden="true" />
        {st.text}{st.stale ? ': back up now' : ''}
      </a>
    </div>
  );
}
