// App state: expenses (IndexedDB), profile and settings (localStorage), and the
// shared modals (bill editor, IRD apply, photo viewer).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from './lib/db.js';
import { finalizeExpense } from './lib/expense.js';
import { assignBillCode, ensureBillCodes, tripInitials } from './lib/billCode.js';
import { imageHash } from './lib/image.js';
import { flag, hasProfile, loadProfile, loadSettings, saveProfile, saveSettings } from './lib/profile.js';
import { buildSampleExpenses, DEMO_PROFILE } from './lib/sample.js';

const StoreContext = createContext(null);

/** Gives every stored bill a valid, unique voucher code; saves only the ones that changed. */
async function deleteSampleBills() {
  const ids = (await db.getAllExpenses()).filter((e) => e.isSample).map((e) => e.id);
  if (ids.length) await db.deleteMany(ids);
  return ids.length;
}

/** Photo hashes for bills saved before duplicate checks existed. Returns the new list, or null. */
async function backfillImageHashes() {
  try {
    const missing = (await db.getAllExpenses()).filter((e) => e.receiptImage && !e.imageHash);
    if (!missing.length) return null;
    for (const e of missing) e.imageHash = await imageHash(e.receiptImage).catch(() => '');
    await db.putMany(missing.filter((e) => e.imageHash));
    return db.getAllExpenses();
  } catch {
    return null;
  }
}

async function syncBillCodes() {
  const changed = ensureBillCodes(await db.getAllExpenses(), await db.getAllTrips());
  if (changed.length) await db.putMany(changed);
  return db.getAllExpenses();
}

export function StoreProvider({ children }) {
  const [expenses, setExpenses] = useState([]);
  const [trips, setTrips] = useState([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [profile, setProfileState] = useState(loadProfile);
  const [settings, setSettingsState] = useState(loadSettings);
  const [modal, setModal] = useState(null); // { type: 'editor'|'ird'|'photo', expense }
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        // First visit: load demo bills (and a demo profile) so every flow can be tried.
        const viewingSharedSplit = /^#\/split\/[A-Za-z0-9_-]+$/.test(window.location.hash);
        if (!flag('seeded') && !viewingSharedSplit) {
          flag('seeded', true);
          if ((await db.getAllExpenses()).length === 0) await db.putMany(await buildSampleExpenses());
          if (!hasProfile()) {
            saveProfile(DEMO_PROFILE);
            setProfileState(loadProfile());
          }
        }
        // Real details saved: the demo bills have done their job (unless loaded again on purpose).
        if (hasProfile() && !isDemoProfile(loadProfile()) && !flag('keepSamples')) await deleteSampleBills();
        setExpenses(await syncBillCodes()); // backfills codes for bills saved before codes existed
        setTrips(await db.getAllTrips());
        backfillImageHashes().then((list) => list && setExpenses(list));
      } catch (err) {
        setLoadError(err?.message || 'This browser blocked local storage (private mode?).');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const saveExpense = useCallback(async (e) => {
    const clean = finalizeExpense(e);
    clean.billCode = assignBillCode(clean, await db.getAllExpenses(), await db.getAllTrips());
    // Perceptual photo hash for duplicate checks (cleared when the photo is removed or replaced).
    if (!clean.receiptImage) clean.imageHash = '';
    else if (!clean.imageHash) clean.imageHash = await imageHash(clean.receiptImage).catch(() => '');
    await db.putExpense(clean);
    setExpenses((list) => [clean, ...list.filter((x) => x.id !== clean.id)]);
    return clean;
  }, []);

  const removeExpense = useCallback(async (id) => {
    await db.deleteExpense(id);
    setExpenses((list) => list.filter((x) => x.id !== id));
  }, []);

  const replaceAll = useCallback(async (list) => {
    await db.clearExpenses();
    await db.putMany(list);
    setExpenses(await syncBillCodes());
  }, []);

  /** Adds bills whose id is not already stored. Returns how many were added. */
  const mergeExpenses = useCallback(async (list) => {
    const have = new Set((await db.getAllExpenses()).map((e) => e.id));
    const fresh = list.filter((e) => !have.has(e.id));
    await db.putMany(fresh);
    setExpenses(await syncBillCodes()); // a bill from another device may reuse a code
    return fresh.length;
  }, []);

  const removeSamples = useCallback(async () => {
    flag('keepSamples', false);
    const n = await deleteSampleBills();
    setExpenses(await db.getAllExpenses());
    return n;
  }, []);

  const loadSamples = useCallback(async () => {
    flag('keepSamples', true); // loaded on purpose: don't remove them automatically
    await db.putMany(await buildSampleExpenses());
    setExpenses(await syncBillCodes());
  }, []);

  const saveTrip = useCallback(async (t) => {
    const clean = { ...t, updatedAt: new Date().toISOString() };
    const before = (await db.getAllTrips()).find((x) => x.id === clean.id);
    await db.putTrip(clean);
    setTrips((list) => [clean, ...list.filter((x) => x.id !== clean.id)]);
    // Trip bills are coded by the trip's initials; renaming the trip re-codes them.
    if (before && tripInitials(before.name) !== tripInitials(clean.name)) setExpenses(await syncBillCodes());
    return clean;
  }, []);

  const deleteTrip = useCallback(async (id) => {
    await db.deleteTripRecord(id);
    setTrips((list) => list.filter((x) => x.id !== id));
  }, []);

  const replaceAllTrips = useCallback(async (list) => {
    await db.clearTrips();
    await db.putManyTrips(list);
    setTrips(await db.getAllTrips());
    setExpenses(await syncBillCodes());
  }, []);

  /** Adds trips whose id is not already stored. Returns how many were added. */
  const mergeTrips = useCallback(async (list) => {
    const have = new Set((await db.getAllTrips()).map((t) => t.id));
    const fresh = list.filter((t) => !have.has(t.id));
    await db.putManyTrips(fresh);
    setTrips(await db.getAllTrips());
    setExpenses(await syncBillCodes());
    return fresh.length;
  }, []);

  /** Saves the profile. Real details replace the demo profile, so the sample bills go too. Returns how many were removed. */
  const setProfile = useCallback(async (p) => {
    saveProfile(p);
    setProfileState(loadProfile());
    if (isDemoProfile(p) || flag('keepSamples')) return 0;
    const n = await deleteSampleBills();
    if (n) setExpenses(await db.getAllExpenses());
    return n;
  }, []);

  const setSettings = useCallback((s) => {
    saveSettings(s);
    setSettingsState(loadSettings());
  }, []);

  const value = useMemo(() => ({
    ready, loadError, expenses, profile, settings,
    saveExpense, removeExpense, replaceAll, mergeExpenses, removeSamples, loadSamples,
    trips, saveTrip, deleteTrip, replaceAllTrips, mergeTrips,
    setProfile, setSettings,
    modal,
    openEditor: (expense) => setModal({ type: 'editor', expense }),
    openIrd: (expense) => setModal({ type: 'ird', expense }),
    openPhoto: (expense) => setModal({ type: 'photo', expense }),
    closeModal: () => setModal(null),
  }), [ready, loadError, expenses, profile, settings, modal, saveExpense, removeExpense, replaceAll, mergeExpenses, removeSamples, loadSamples, trips, saveTrip, deleteTrip, replaceAllTrips, mergeTrips, setProfile, setSettings]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export const isDemoProfile = (p) => p.fullName === DEMO_PROFILE.fullName && p.phone === DEMO_PROFILE.phone;
