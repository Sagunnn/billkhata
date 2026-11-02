// "Saved on this device": where the bills live, how fresh the last backup is, and one-tap backup.
import { ShieldCheck } from 'lucide-react';
import { backupFilename, backupStatus, buildBackup } from '../lib/backup.js';
import { bytes, downloadBlob } from '../lib/format.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';

function useBackupStatus() {
  const { expenses, lastBackupAt } = useStore();
  const own = expenses.filter((e) => !e.isSample).length;
  return backupStatus(lastBackupAt, own);
}

/** Downloads the JSON backup (bills, photos, trips, bank data, money) and remembers when. */
export function useDownloadBackup() {
  const { profile, expenses, trips, statements, payments, reconOverrides, money, markBackedUp } = useStore();
  const toast = useToast();
  return () => {
    const data = buildBackup(profile, expenses, trips, { statements, payments, reconOverrides, money });
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), backupFilename());
    markBackedUp();
    toast(`Backup downloaded (${expenses.length} bills, ${trips.length} trip${trips.length === 1 ? '' : 's'}).`);
  };
}

const BACKUP_HREF = '#/settings?backup';

/** "On this device" pill for the phone Home header. An amber dot means no backup in two weeks. */
export function StorageIndicator() {
  const st = useBackupStatus();
  return (
    <a
      href={BACKUP_HREF}
      className="tap relative inline-flex items-center gap-1.5 rounded-full bg-leaf-soft py-1.5 pl-2.5 pr-3 text-[13px] font-medium leading-4 text-leaf"
      aria-label={`Saved only on this device. ${st.text}. Open backup.`}
      title={st.text}
    >
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      On this device
      {st.stale && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-marigold ring-2 ring-canvas" aria-hidden="true" />}
    </a>
  );
}

/** The sidebar card: saved on this device, last backup, size, and Download backup. */
export function StorageNote() {
  const { expenses } = useStore();
  const st = useBackupStatus();
  const download = useDownloadBackup();
  const size = new Blob([JSON.stringify(expenses)]).size;
  return (
    <div className={`rounded-[14px] p-3.5 ${st.stale ? 'bg-warn-soft' : 'bg-leaf-soft'}`}>
      <p className={`flex items-center gap-1.5 text-[14px] font-medium ${st.stale ? 'text-warn' : 'text-leaf'}`}><ShieldCheck className="size-4" />Saved on this device</p>
      <p className="mt-1 text-[12px] leading-4 text-ink-2">{st.text} · {expenses.length} bills, {bytes(size)}</p>
      <button type="button" onClick={download} className={`mt-2 text-[14px] font-medium hover:underline ${st.stale ? 'text-warn' : 'text-leaf'}`}>Download backup</button>
    </div>
  );
}
