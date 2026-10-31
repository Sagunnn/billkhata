// IndexedDB store for expenses. Receipt photos live here as compressed JPEG data URLs,
// which would quickly outgrow localStorage's ~5 MB.
import { openDB } from 'idb';

const DB_NAME = 'billkhata';
const STORE = 'expenses';
const TRIPS = 'trips';
const STATEMENTS = 'statements';
const PAYMENTS = 'payments';

let dbPromise;
function db() {
  // Version 2 adds the trips store, version 3 bank statements and payment screenshots. Each step
  // only creates what's missing, so upgrading keeps every saved bill.
  dbPromise ||= openDB(DB_NAME, 3, {
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
    },
  });
  return dbPromise;
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

export async function putExpense(expense) {
  await (await db()).put(STORE, expense);
  return expense;
}

export async function putMany(expenses) {
  const tx = (await db()).transaction(STORE, 'readwrite');
  await Promise.all([...expenses.map((e) => tx.store.put(e)), tx.done]);
}

export async function deleteExpense(id) {
  await (await db()).delete(STORE, id);
}

export async function deleteMany(ids) {
  const tx = (await db()).transaction(STORE, 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function clearExpenses() {
  await (await db()).clear(STORE);
}

export function newId() {
  return crypto.randomUUID?.() ?? `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
