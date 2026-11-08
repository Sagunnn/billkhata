// A scan in progress, kept on this device while you check it, so a phone call, the camera or the
// phone closing the app doesn't lose it: "Finish your bill from 2 min ago". Its own small database
// (one record), apart from the bills. Cleared when the bill is saved or the scan is discarded.
import { openDB } from 'idb';

const MAX_AGE = 7 * 864e5;
let dbp;
const db = () => (dbp ||= openDB('billkhata-drafts', 1, { upgrade(d) { d.createObjectStore('drafts'); } }));
const changed = () => { try { window.dispatchEvent(new Event('billkhata-draft')); } catch { /* not in a browser */ } };

/** The unfinished scan: { draft, rawText, lastRead, forTrip, forSplit, at }, or null (none, or over a week old). */
export async function loadScanDraft(now = Date.now()) {
  try {
    const v = await (await db()).get('drafts', 'scan');
    if (!v?.draft || now - Date.parse(v.at) > MAX_AGE) return null;
    return v;
  } catch { return null; }
}

export async function saveScanDraft(v) {
  try { await (await db()).put('drafts', { ...v, at: new Date().toISOString() }, 'scan'); changed(); } catch { /* storage full or blocked */ }
}

export async function clearScanDraft() {
  try { await (await db()).delete('drafts', 'scan'); changed(); } catch { /* ignore */ }
}

/** "2 min ago", "3 hours ago", "yesterday". */
export function draftAge(at, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(at)) / 60e3));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
