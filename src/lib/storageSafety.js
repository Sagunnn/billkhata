// Keeping bills safe on this device. Browsers may clear a site's data on their own: Chrome when the
// disk runs low (unless the site's storage is "persistent"), Safari when a site isn't opened for
// 7 days (unless it's added to the Home Screen). This asks for persistent storage, says how safe
// the data is, and how much space it takes. advice() is pure (tests/storageSafety.test.js).

const ASKED_KEY = 'billkhata_persist_asked';

const store = () => (typeof navigator !== 'undefined' ? navigator.storage : undefined);

/** { supported, persisted, usage, quota } (bytes; 0 when the browser doesn't say). */
export async function storageState() {
  const s = store();
  if (!s?.persisted) return { supported: false, persisted: false, usage: 0, quota: 0 };
  const [persisted, est] = await Promise.all([s.persisted().catch(() => false), s.estimate?.().catch(() => null)]);
  return { supported: true, persisted: Boolean(persisted), usage: est?.usage || 0, quota: est?.quota || 0 };
}

/** Asks the browser to keep this site's data. Chrome and Safari decide quietly; Firefox asks you. */
export async function askToKeep() {
  try {
    localStorage.setItem(ASKED_KEY, new Date().toISOString());
  } catch { /* storage blocked */ }
  try { return Boolean(await store()?.persist?.()); } catch { return false; }
}

/** Asked in the last day already (so Firefox's question isn't repeated on every visit). */
export function askedLately(now = Date.now()) {
  try {
    const t = Date.parse(localStorage.getItem(ASKED_KEY) || '');
    return Number.isFinite(t) && now - t < 864e5;
  } catch { return true; }
}

export const isIos = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') => /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile\//.test(ua));

/**
 * How safe the bills are here, in plain words.
 * @returns {{ level: 'safe'|'risk'|'unknown', title: string, text: string, action: 'install'|'keep'|null }}
 */
export function advice({ supported, persisted, ios = false, installed = false }) {
  if (persisted) return { level: 'safe', title: 'Kept safe by the browser', text: 'It won’t clear your bills on its own. A backup file still protects you if the phone is lost.', action: null };
  if (ios && installed) return { level: 'safe', title: 'Home Screen app', text: 'Safari doesn’t clear a Home Screen app’s data on its own. A backup file still protects you if the phone is lost.', action: null };
  if (ios) {
    return {
      level: 'risk', title: 'Safari may clear your bills',
      text: 'Safari deletes a website’s data when it isn’t opened for 7 days. Add BillKhata to your Home Screen to keep it, and download backups.',
      action: 'install',
    };
  }
  if (!supported) return { level: 'unknown', title: 'Saved in this browser', text: 'This browser doesn’t say whether it keeps site data. Download a backup now and then.', action: null };
  return {
    level: 'risk', title: 'The browser may clear your bills',
    text: 'When the phone runs low on space, the browser can delete website data. Ask it to keep BillKhata’s, and download backups.',
    action: 'keep',
  };
}
