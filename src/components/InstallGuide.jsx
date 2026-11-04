// "Add to home screen": the browser's own Install button where it offers one, else the steps for
// this phone and browser (lib/install.js). The 'install' sheet, plus a dismissible card for Home.
import { useState } from 'react';
import { CircleCheck, Copy, Download, Smartphone, X } from 'lucide-react';
import { installHelp } from '../lib/install.js';
import { useInstallPrompt } from '../lib/offline.js';
import { copyText } from '../lib/format.js';
import { useStore } from '../store.jsx';
import { useToast } from './Toast.jsx';
import { Button, Modal } from './ui.jsx';
import { LogoMark } from './Brand.jsx';
import { useDownloadBackup } from './LocalFirst.jsx';

const HINT_KEY = 'billkhata_install_hint';
const SITE = 'https://expense.sagunpradhan.com.np';

export function InstallSheet({ onClose }) {
  const toast = useToast();
  const { installed, install } = useInstallPrompt();
  const help = installHelp(navigator.userAgent, { brave: Boolean(navigator.brave) });
  const { expenses } = useStore();
  const download = useDownloadBackup();
  const ownBills = expenses.filter((e) => !e.isSample).length;
  return (
    <Modal open size="md" title={installed ? 'Installed' : help.title} subtitle={installed ? '' : 'Opens like an app, full screen, and works offline'} onClose={onClose}>
      {installed ? (
        <p className="t-body flex items-center gap-2 text-ink-2"><CircleCheck className="size-5 text-leaf" />You’re using the installed app. Open BillKhata from its icon on your home screen.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-[14px] bg-sunken p-3">
            <LogoMark size={44} />
            <div className="min-w-0"><p className="t-body font-semibold text-ink">BillKhata</p><p className="t-caption text-ink-3">expense.sagunpradhan.com.np</p></div>
          </div>
          {install && (
            <>
              <Button variant="primary" size="lg" icon={Smartphone} className="w-full" onClick={async () => { await install(); onClose(); }}>Install app</Button>
              <p className="t-caption text-center text-ink-3">or by hand:</p>
            </>
          )}
          <ol className="space-y-3">
            {help.steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[14px] font-semibold text-brand">{i + 1}</span>
                <span className="t-body pt-0.5 text-ink">{s}</span>
              </li>
            ))}
          </ol>
          {help.note && <p className="t-caption text-ink-3">{help.note}</p>}
          {help.moveData && ownBills > 0 && (
            <div className="rounded-[14px] bg-marigold-soft p-3.5">
              <p className="t-body font-semibold text-ink">Bring your {ownBills === 1 ? 'bill' : `${ownBills} bills`} with you</p>
              <p className="t-label mt-1 text-ink-2">On iPhone the home-screen app keeps its own copy, apart from this browser. Download a backup first; then in the app, choose “Restore a backup” on the welcome (or Settings → Backup &amp; restore).</p>
              <Button className="mt-2" icon={Download} onClick={download}>Download backup</Button>
            </div>
          )}
          {(help.id === 'in-app' || help.id === 'brave-ios') && (
            <Button className="w-full" icon={Copy} onClick={async () => { await copyText(SITE); toast('Link copied. Paste it in your browser.'); }}>Copy the link</Button>
          )}
        </div>
      )}
    </Modal>
  );
}

/** A card on Home, on phones, until it's installed or closed. */
export function InstallCard() {
  const { openSheet } = useStore();
  const { installed } = useInstallPrompt();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HINT_KEY) === 'hidden'; } catch { return true; } });
  const phone = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
  if (installed || hidden || !phone) return null;
  const hide = () => { try { localStorage.setItem(HINT_KEY, 'hidden'); } catch { /* ignore */ } setHidden(true); };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5">
      <LogoMark size={40} />
      <button type="button" onClick={() => openSheet('install')} className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold text-ink">Add BillKhata to your home screen</span>
        <span className="t-caption block text-ink-3">Opens like an app and works offline · <span className="font-medium text-brand">Show me how</span></span>
      </button>
      <button type="button" onClick={hide} aria-label="Hide" className="tap rounded-full p-1.5 text-ink-3 hover:bg-sunken"><X className="size-4" /></button>
    </div>
  );
}
