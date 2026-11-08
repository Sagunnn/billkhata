// "Saved on this device": where the bills live, whether the browser keeps them, how fresh the last
// backup is, and one-tap backup. Bills live only here, so these are the app's safety net.
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, ShieldCheck, WifiOff, X } from 'lucide-react';
import { useOnline, isInstalled } from '../lib/offline.js';
import { backupExtras } from '../lib/profile.js';
import { backupFilename, backupSize, backupStatus, buildBackup, changedSince } from '../lib/backup.js';
import { advice, askedLately, askToKeep, isIos, storageState } from '../lib/storageSafety.js';
import { bytes, downloadBlob } from '../lib/format.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button } from './ui.jsx';

export function useBackupStatus() {
  const { expenses, lastBackupAt } = useStore();
  const own = expenses.filter((e) => !e.isSample).length;
  return backupStatus(lastBackupAt, own, Date.now(), changedSince(expenses, lastBackupAt));
}

/** Whether the browser keeps the data, how much space it takes, and asking it to keep it. */
export function useStorageSafety() {
  const [state, setState] = useState(null);
  const refresh = useCallback(() => storageState().then(setState), []);
  useEffect(() => { refresh(); }, [refresh]);
  const keep = useCallback(async () => { const ok = await askToKeep(); await refresh(); return ok; }, [refresh]);
  const info = state ? advice({ ...state, ios: isIos(), installed: isInstalled() }) : null;
  return { state, info, keep, refresh };
}

/**
 * Once you have bills of your own, asks the browser to keep the site's data (at most once a day:
 * Chrome and Safari decide quietly, Firefox asks you once and remembers).
 */
export function useKeepStorage() {
  const { expenses } = useStore();
  const own = expenses.some((e) => !e.isSample);
  useEffect(() => {
    if (!own || askedLately()) return;
    storageState().then((s) => { if (s.supported && !s.persisted) askToKeep(); });
  }, [own]);
}

/** Downloads the JSON backup and remembers when. `photos: false` makes a small one without photos. */
export function useDownloadBackup() {
  const { profile, expenses, trips, statements, payments, reconOverrides, money, markBackedUp } = useStore();
  const toast = useToast();
  return ({ photos = true } = {}) => {
    const data = buildBackup(profile, expenses, trips, { statements, payments, reconOverrides, money }, backupExtras(), { photos });
    const name = photos ? backupFilename() : backupFilename().replace('.json', '_no_photos.json');
    downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), name);
    markBackedUp();
    toast(`Backup downloaded${photos ? '' : ' without photos'} (${expenses.length} bills, ${trips.length} trip${trips.length === 1 ? '' : 's'}). Keep it somewhere other than this phone: Google Drive, email, a computer.`);
  };
}

const BACKUP_HREF = '#/settings?backup';

/** "On this device" pill for the phone Home header. An amber dot: a backup is due, or the browser may clear the data. */
export function StorageIndicator() {
  const st = useBackupStatus();
  const { info } = useStorageSafety();
  const online = useOnline();
  const risk = info?.level === 'risk' && st.changed > 0;
  if (!online) {
    return (
      <a href="#/settings?offline" className="tap inline-flex items-center gap-1.5 rounded-full bg-sunken py-1.5 pl-2.5 pr-3 text-[13px] font-medium leading-4 text-ink-2"
        aria-label="Offline. Your bills are on this device, so the app keeps working." title="Offline: everything you add is saved on this device">
        <WifiOff className="size-3.5" aria-hidden="true" />Offline · all here
      </a>
    );
  }
  return (
    <a
      href={BACKUP_HREF}
      className="tap relative inline-flex items-center gap-1.5 rounded-full bg-leaf-soft py-1.5 pl-2.5 pr-3 text-[13px] font-medium leading-4 text-leaf"
      aria-label={`Saved only on this device. ${st.text}.${risk ? ` ${info.title}.` : ''} Open backup.`}
      title={risk ? `${st.text} · ${info.title}` : st.text}
    >
      <ShieldCheck className="size-3.5" aria-hidden="true" />
      On this device
      {(st.stale || risk) && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-marigold ring-2 ring-canvas" aria-hidden="true" />}
    </a>
  );
}

/** The sidebar card: saved on this device, last backup, space used, and Download backup. */
export function StorageNote() {
  const { expenses, trips, payments } = useStore();
  const st = useBackupStatus();
  const { state, info } = useStorageSafety();
  const download = useDownloadBackup();
  const own = expenses.some((e) => !e.isSample);
  const risk = own && info?.level === 'risk';
  const warn = st.stale || (risk && st.changed > 0);
  const size = state?.usage || backupSize(expenses, trips, payments);
  return (
    <div className={`rounded-[14px] p-3.5 ${warn ? 'bg-warn-soft' : 'bg-leaf-soft'}`}>
      <p className={`flex items-center gap-1.5 text-[14px] font-medium ${warn ? 'text-warn' : 'text-leaf'}`}>
        {risk ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}Saved on this device
      </p>
      <p className="mt-1 text-[12px] leading-4 text-ink-2">{st.text} · {expenses.length} bills, {bytes(size)}</p>
      {risk && <a href={BACKUP_HREF} className="mt-1 block text-[12px] leading-4 text-warn underline-offset-2 hover:underline">{info.title}</a>}
      <button type="button" onClick={() => download()} className={`mt-2 text-[14px] font-medium hover:underline ${warn ? 'text-warn' : 'text-leaf'}`}>Download backup</button>
    </div>
  );
}

const SNOOZE_KEY = 'billkhata_backup_snooze';
const snoozed = () => { try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0); } catch { return false; } };

/**
 * Home reminder when a backup is due: "12 bills aren't in a backup yet". Later hides it for 3 days.
 * On iPhone Safari (not the Home Screen app) it also says Safari may clear the data.
 */
export function BackupReminder() {
  const st = useBackupStatus();
  const { info } = useStorageSafety();
  const { openSheet } = useStore();
  const download = useDownloadBackup();
  const [hidden, setHidden] = useState(snoozed);
  if (hidden || !st.nudge) return null;
  const later = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 3 * 864e5)); } catch { /* ignore */ } setHidden(true); };
  const n = st.changed;
  return (
    <div className="relative rounded-[16px] bg-warn-soft px-4 py-3.5" role="status">
      <button type="button" onClick={later} className="tap absolute right-1.5 top-1.5 rounded-full p-2 text-ink-3 hover:text-ink" aria-label="Remind me later"><X className="size-4" /></button>
      <p className="flex items-center gap-2 pr-8 text-[15px] font-semibold text-ink"><ShieldAlert className="size-5 shrink-0 text-warn" />{n} bill{n === 1 ? ' isn’t' : 's aren’t'} in a backup yet</p>
      <p className="t-caption mt-1 text-ink-2">
        They’re only on this phone. A backup file keeps them if the phone is lost{info?.action === 'install' ? ' or Safari clears its data (it does after 7 days without a visit)' : ' or the browser clears its data'}.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => download()}>Download backup</Button>
        {info?.action === 'install' && <Button size="sm" onClick={() => openSheet('install')}>Add to Home Screen</Button>}
        <Button size="sm" variant="ghost" onClick={later}>Later</Button>
      </div>
    </div>
  );
}

/** Settings: how safe the bills are here, space used, and the one fix (keep them, or install). */
export function StorageSafetyRow() {
  const { info, state, keep } = useStorageSafety();
  const { openSheet } = useStore();
  const toast = useToast();
  if (!info) return null;
  const ask = async () => {
    const ok = await keep();
    toast(ok ? 'The browser will keep your bills.' : 'The browser said no for now. It often agrees once BillKhata is installed or used more; keep downloading backups.', ok ? 'success' : 'error');
  };
  const tone = info.level === 'safe' ? 'bg-emerald-50 text-emerald-950 ring-emerald-200' : info.level === 'risk' ? 'bg-amber-50 text-amber-950 ring-amber-200' : 'bg-slate-50 text-slate-800 ring-slate-200';
  return (
    <div className={`mb-3 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${tone}`}>
      <p className="flex items-center gap-1.5 font-semibold">{info.level === 'safe' ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}{info.title}</p>
      <p className="mt-0.5 text-xs">{info.text}{state?.usage ? ` Using ${bytes(state.usage)} on this device.` : ''}</p>
      {info.action === 'keep' && <Button size="sm" className="mt-2" icon={ShieldCheck} onClick={ask}>Keep my bills safe</Button>}
      {info.action === 'install' && <Button size="sm" className="mt-2" onClick={() => openSheet('install')}>Add to Home Screen</Button>}
    </div>
  );
}
