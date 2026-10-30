// App state: expenses (IndexedDB), profile and settings (localStorage), and the
// shared modals (bill editor, IRD apply, photo viewer).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from './lib/db.js';
import { finalizeExpense } from './lib/expense.js';
import { flag, hasProfile, loadProfile, loadSettings, saveProfile, saveSettings } from './lib/profile.js';
import { buildSampleExpenses, DEMO_PROFILE } from './lib/sample.js';

const StoreContext = createContext(null);

export function StoreProvider({ children }) {
  const [expenses, setExpenses] = useState([]);
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
        setExpenses(await db.getAllExpenses());
      } catch (err) {
        setLoadError(err?.message || 'This browser blocked local storage (private mode?).');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const saveExpense = useCallback(async (e) => {
    const clean = finalizeExpense(e);
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
    setExpenses(await db.getAllExpenses());
  }, []);

  /** Adds bills whose id is not already stored. Returns how many were added. */
  const mergeExpenses = useCallback(async (list) => {
    const have = new Set((await db.getAllExpenses()).map((e) => e.id));
    const fresh = list.filter((e) => !have.has(e.id));
    await db.putMany(fresh);
    setExpenses(await db.getAllExpenses());
    return fresh.length;
  }, []);

  const removeSamples = useCallback(async () => {
    const ids = (await db.getAllExpenses()).filter((e) => e.isSample).map((e) => e.id);
    await db.deleteMany(ids);
    setExpenses(await db.getAllExpenses());
    return ids.length;
  }, []);

  const loadSamples = useCallback(async () => {
    await db.putMany(await buildSampleExpenses());
    setExpenses(await db.getAllExpenses());
  }, []);

  const setProfile = useCallback((p) => {
    saveProfile(p);
    setProfileState(loadProfile());
  }, []);

  const setSettings = useCallback((s) => {
    saveSettings(s);
    setSettingsState(loadSettings());
  }, []);

  const value = useMemo(() => ({
    ready, loadError, expenses, profile, settings,
    saveExpense, removeExpense, replaceAll, mergeExpenses, removeSamples, loadSamples,
    setProfile, setSettings,
    modal,
    openEditor: (expense) => setModal({ type: 'editor', expense }),
    openIrd: (expense) => setModal({ type: 'ird', expense }),
    openPhoto: (expense) => setModal({ type: 'photo', expense }),
    closeModal: () => setModal(null),
  }), [ready, loadError, expenses, profile, settings, modal, saveExpense, removeExpense, replaceAll, mergeExpenses, removeSamples, loadSamples, setProfile, setSettings]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  return useContext(StoreContext);
}

export const isDemoProfile = (p) => p.fullName === DEMO_PROFILE.fullName && p.phone === DEMO_PROFILE.phone;
