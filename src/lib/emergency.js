// "Download my data" for when the app itself has a problem: reads every store straight from the
// device (no React state), builds a normal backup file and downloads it. Restores like any backup.
import * as db from './db.js';
import { buildBackup, backupFilename } from './backup.js';
import { downloadBlob } from './format.js';
import { backupExtras, loadProfile } from './profile.js';

const json = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } };
const safe = (p) => p.catch(() => []);

export async function downloadEverything() {
  const [expenses, trips, statements, payments] = await Promise.all([
    safe(db.getAllExpenses()), safe(db.getAllTrips()), safe(db.statementsTable.all()), safe(db.paymentsTable.all()),
  ]);
  let extras = null;
  try { extras = backupExtras(); } catch { /* keep going without them */ }
  const data = buildBackup(loadProfile(), expenses, trips, {
    statements, payments, reconOverrides: json('billkhata_recon', { links: [], unlinks: [] }), money: json('billkhata_money', null),
  }, extras);
  downloadBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), backupFilename());
  try { localStorage.setItem('billkhata_last_backup', new Date().toISOString()); } catch { /* ignore */ }
  return expenses.length;
}

/** A page that failed to load after an update (its file is gone from the server). */
export const isChunkError = (e) => /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch/i.test(String(e?.message || e));

/** Reload once for a missing page file (at most once a minute, so a real outage doesn't loop). */
export function reloadForUpdate(now = Date.now()) {
  try {
    const last = Number(sessionStorage.getItem('bk-chunk-reload') || 0);
    if (now - last < 60e3) return false;
    sessionStorage.setItem('bk-chunk-reload', String(now));
  } catch { return false; }
  window.location.reload();
  return true;
}
