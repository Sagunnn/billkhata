// IndexedDB store for expenses. Receipt photos live here as compressed JPEG data URLs,
// which would quickly outgrow localStorage's ~5 MB.
import { openDB } from 'idb';

const DB_NAME = 'billkhata';
const STORE = 'expenses';

let dbPromise;
function db() {
  dbPromise ||= openDB(DB_NAME, 1, {
    upgrade(d) {
      const s = d.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('billDateAD', 'billDateAD');
    },
  });
  return dbPromise;
}

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
