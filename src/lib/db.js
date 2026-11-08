// IndexedDB: bills, trips, bank statements and payment screenshots. A bill's full receipt photo
// (a compressed JPEG data URL, up to 300 KB) lives in its own store, `photos`, keyed by the bill's
// id; the bill keeps `hasPhoto`, `photoBytes` and a small `thumb` for lists. So loading the bills
// never loads every photo: a year of daily scans stays light. Photos load one at a time (getPhoto).
import { openDB } from 'idb';

const DB_NAME = 'billkhata';
const STORE = 'expenses';
const TRIPS = 'trips';
const STATEMENTS = 'statements';
const PAYMENTS = 'payments';
const PHOTOS = 'photos';

let dbPromise;
function db() {
  // Version 2 adds the trips store, 3 bank statements and payment screenshots, 4 bill photos.
  // Each step only creates what's missing, so upgrading keeps every saved bill.
  dbPromise ||= openDB(DB_NAME, 4, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const s = d.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('billDateAD', 'billDateAD');
      }
      if (oldVersion < 2 && !d.objectStoreNames.contains(TRIPS)) {
        d.createObjectStore(TRIPS, { keyPath: 'id' });
      }
      if (oldVersion < 3) {
        if (!d.objectStoreNames.contains(STATEMENTS)) d.createObjectStore(STATEMENTS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(PAYMENTS)) d.createObjectStore(PAYMENTS, { keyPath: 'id' });
      }
      if (oldVersion < 4 && !d.objectStoreNames.contains(PHOTOS)) d.createObjectStore(PHOTOS); // key: the bill's id
    },
    // A newer version opened in another tab: let it upgrade, and reload this one onto it.
    blocking() {
      dbPromise?.then((d) => d.close());
      dbPromise = null;
      try { window.location.reload(); } catch { /* not in a browser */ }
    },
  });
  return dbPromise;
}

/* ---------- photos ---------- */

/**
 * A bill as stored, and what to do with its photo: a new photo (data URL) moves to the photos
 * store; `receiptImage: null` (or '') removes it; no `receiptImage` at all leaves it as it is.
 * @returns {[object, string|null|undefined]} the record without the photo, and the photo / null (remove) / undefined (keep)
 */
export function splitPhoto(e) {
  const { receiptImage, ...rest } = e;
  if (typeof receiptImage === 'string' && receiptImage.startsWith('data:image/')) {
    return [{ ...rest, hasPhoto: true, photoBytes: receiptImage.length, ...(rest.thumb ? {} : { thumb: '' }) }, receiptImage];
  }
  if (receiptImage === null || receiptImage === '') return [{ ...rest, hasPhoto: false, photoBytes: 0, thumb: '' }, null];
  return [rest, undefined];
}

// The last few photos opened, so going back and forth doesn't read them again.
const cache = new Map();
const remember = (id, v) => { cache.delete(id); cache.set(id, v); while (cache.size > 12) cache.delete(cache.keys().next().value); };

/** A bill's full photo (data URL), or '' when it has none. */
export async function getPhoto(id) {
  if (!id) return '';
  if (cache.has(id)) return cache.get(id);
  const v = (await (await db()).get(PHOTOS, id)) || '';
  if (v) remember(id, v);
  return v;
}

async function writeBills(records, tx) {
  const bills = tx.objectStore(STORE);
  const photos = tx.objectStore(PHOTOS);
  const done = [];
  for (const e of records) {
    const [rec, photo] = splitPhoto(e);
    done.push(bills.put(rec));
    if (photo) { done.push(photos.put(photo, rec.id)); cache.delete(rec.id); }
    else if (photo === null) { done.push(photos.delete(rec.id)); cache.delete(rec.id); }
  }
  await Promise.all([...done, tx.done]);
}

/**
 * Moves photos still inside bill records (saved before version 4) to the photos store. Runs at
 * start; each bill moves in one transaction, so stopping halfway loses nothing and the next start
 * carries on. No image work, just moving data, so it's quick. Returns how many moved.
 */
export async function migratePhotos() {
  const d = await db();
  let moved = 0;
  for (const id of await d.getAllKeys(STORE)) {
    const e = await d.get(STORE, id);
    if (typeof e?.receiptImage !== 'string' || !e.receiptImage) continue;
    await writeBills([e], d.transaction([STORE, PHOTOS], 'readwrite'));
    moved++;
  }
  return moved;
}

/** Updates a few fields of a stored bill (thumb, imageHash) without touching anything else. */
export async function patchExpense(id, patch) {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const cur = await tx.store.get(id);
  if (cur) await tx.store.put({ ...cur, ...patch });
  await tx.done;
  return cur ? { ...cur, ...patch } : null;
}

export async function getAllTrips() {
  return (await db()).getAll(TRIPS);
}
export async function putTrip(trip) {
  await (await db()).put(TRIPS, trip);
  return trip;
}
export async function deleteTripRecord(id) {
  await (await db()).delete(TRIPS, id);
}
export async function putManyTrips(trips) {
  const tx = (await db()).transaction(TRIPS, 'readwrite');
  await Promise.all([...trips.map((t) => tx.store.put(t)), tx.done]);
}
export async function clearTrips() {
  await (await db()).clear(TRIPS);
}

/** Same operations for any store: statements and payments. */
export const table = (name) => ({
  all: async () => (await db()).getAll(name),
  put: async (rec) => { await (await db()).put(name, rec); return rec; },
  remove: async (id) => (await db()).delete(name, id),
  putMany: async (recs) => {
    const tx = (await db()).transaction(name, 'readwrite');
    await Promise.all([...recs.map((r) => tx.store.put(r)), tx.done]);
  },
  clear: async () => (await db()).clear(name),
});
export const statementsTable = table(STATEMENTS);
export const paymentsTable = table(PAYMENTS);

export async function getAllExpenses() {
  return (await db()).getAll(STORE);
}

/** Saves one bill (and its photo, see splitPhoto). Returns the record as stored. */
export async function putExpense(expense) {
  const [rec] = splitPhoto(expense);
  await writeBills([expense], (await db()).transaction([STORE, PHOTOS], 'readwrite'));
  return rec;
}

export async function putMany(expenses) {
  await writeBills(expenses, (await db()).transaction([STORE, PHOTOS], 'readwrite'));
}

export async function deleteExpense(id) {
  const tx = (await db()).transaction([STORE, PHOTOS], 'readwrite');
  cache.delete(id);
  await Promise.all([tx.objectStore(STORE).delete(id), tx.objectStore(PHOTOS).delete(id), tx.done]);
}

export async function deleteMany(ids) {
  const tx = (await db()).transaction([STORE, PHOTOS], 'readwrite');
  ids.forEach((id) => cache.delete(id));
  await Promise.all([...ids.flatMap((id) => [tx.objectStore(STORE).delete(id), tx.objectStore(PHOTOS).delete(id)]), tx.done]);
}

export async function clearExpenses() {
  const tx = (await db()).transaction([STORE, PHOTOS], 'readwrite');
  cache.clear();
  await Promise.all([tx.objectStore(STORE).clear(), tx.objectStore(PHOTOS).clear(), tx.done]);
}

export function newId() {
  return crypto.randomUUID?.() ?? `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
