// Offline: the service worker (built from src/sw-template.js), whether the app and the bill reader
// are on this device, the "Download for offline use" pack, the update prompt and the install prompt.
import { useEffect, useState } from 'react';

const ASSETS = 'bk-assets';
const OCR_CACHE = 'billkhata-ocr-models-v1';
// Bill reader sizes, downloaded by the OCR worker and kept in its own cache.
export const READER_MB = { latin: 7, nepali: 13 };

// A newer version, installed and waiting: the function that switches to it.
let pendingUpdate = null;
const updateListeners = new Set();
// A function kept as React state is wrapped, or setState would call it.
const onUpdate = (apply) => { pendingUpdate = apply; updateListeners.forEach((f) => f(() => apply)); };

/** The waiting update, as a function that applies it and reloads (or null). */
export function useUpdateReady() {
  const [apply, setApply] = useState(() => pendingUpdate);
  useEffect(() => { updateListeners.add(setApply); return () => updateListeners.delete(setApply); }, []);
  return apply && (() => { try { sessionStorage.setItem('bk-update', '1'); } catch { /* ignore */ } apply(); });
}

/** Registers the service worker (production builds only); an update waits for "Reload". */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const waiting = () => reg.waiting && navigator.serviceWorker.controller && onUpdate(() => reg.waiting.postMessage('skip-waiting'));
      waiting();
      reg.addEventListener('updatefound', () => {
        reg.installing?.addEventListener('statechange', waiting);
      });
      // A newer app took over (after "Reload"): load it.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded || !sessionStorage.getItem('bk-update')) return;
        reloaded = true;
        sessionStorage.removeItem('bk-update');
        window.location.reload();
      });
      // Check for a new version now and then while the app stays open.
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch { /* not supported here (private mode, file://) */ }
  });
}

/** True while the browser says there's a connection. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);
  return online;
}

async function manifest() {
  const res = await fetch('/offline-assets.json', { cache: 'no-cache' }).catch(() => null) || await caches.match('/offline-assets.json');
  return res && res.ok ? res.json() : null;
}

/** Whether the bill reader's models are on this device (English, and Nepali when asked). */
async function readerReady(nepali) {
  try {
    const keys = (await (await caches.open(OCR_CACHE)).keys()).map((r) => r.url);
    const has = (re) => keys.filter((u) => re.test(u)).length;
    return has(/PP-OCRv6_tiny|ppocrv6_tiny/) >= 3 && (!nepali || has(/devanagari|PP-OCRv5_mobile_det/) >= 3);
  } catch {
    return false;
  }
}

/**
 * What works offline right now.
 * @returns {{ supported, app, reader, pack: number, total: number, missing: number, mb: number }}
 *   app: the app opens offline; reader: bills can be read; pack: share of every file kept (0-1);
 *   mb: about how much "Download for offline use" still has to fetch
 */
export async function offlineStatus({ nepali = false } = {}) {
  const supported = 'serviceWorker' in navigator && 'caches' in window;
  if (!supported) return { supported, app: false, reader: false, pack: 0, total: 0, missing: 0, mb: 0 };
  const m = await manifest();
  const reader = await readerReady(nepali);
  if (!m) return { supported, app: Boolean(navigator.serviceWorker.controller), reader, pack: 0, total: 0, missing: 0, mb: 0 };
  const have = new Set((await Promise.all((await caches.keys()).filter((n) => n.startsWith('bk-')).map(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname)))).flat());
  const files = m.all.filter((f) => !f.startsWith('icons/') && f !== 'favicon.svg' && f !== 'manifest.webmanifest');
  const missing = files.filter((f) => !have.has(`/${f}`));
  const bytes = missing.reduce((t, f) => t + (m.bytes[f] || 0), 0);
  const coreMissing = m.core.filter((f) => f.startsWith('assets/') && !have.has(`/${f}`)).length;
  return {
    supported,
    app: Boolean(navigator.serviceWorker.controller) && coreMissing === 0,
    reader,
    pack: files.length ? (files.length - missing.length) / files.length : 0,
    total: files.length,
    missing: missing.length,
    mb: Math.round((bytes / 1e6 + (reader ? 0 : READER_MB.latin + (nepali ? READER_MB.nepali : 0))) * 10) / 10,
  };
}

/**
 * Keeps every file of the app on this device (statement reading, PDFs, reports, the reader's engine)
 * and downloads the bill reader's models, so all of it works offline.
 */
export async function downloadForOffline({ nepali = false, onProgress } = {}) {
  const m = await manifest();
  if (!m) throw new Error('Couldn’t get the list of files. Check the connection and try again.');
  const cache = await caches.open(ASSETS);
  const files = m.all.filter((f) => f.startsWith('assets/'));
  const total = files.reduce((t, f) => t + (m.bytes[f] || 0), 0) || 1;
  let done = 0;
  for (const f of files) {
    const url = `/${f}`;
    if (!(await caches.match(url))) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn’t download ${f} (${res.status}).`);
      await cache.put(url, res);
    }
    done += m.bytes[f] || 0;
    onProgress?.({ status: 'Saving the app on this device', progress: (done / total) * 0.6 });
  }
  onProgress?.({ status: 'Downloading the bill reader', progress: 0.65 });
  const { warmUp } = await import('./ocr/local.js');
  await warmUp({ nepali: false });
  if (nepali) {
    onProgress?.({ status: 'Downloading the Nepali bill reader', progress: 0.85 });
    await warmUp({ nepali: true });
  }
  if (!(await readerReady(nepali))) throw new Error('The app is saved, but the bill reader didn’t finish downloading. Try again on a steadier connection.');
  onProgress?.({ status: 'Done', progress: 1 });
}

// Chrome-like browsers offer installing once, early on: kept here so any screen can use it later.
let deferredPrompt = null;
const promptListeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; promptListeners.forEach((f) => f(e)); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; promptListeners.forEach((f) => f(null)); });
}
export const isInstalled = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

/** "Install app" where the browser offers it (Android, desktop Chrome / Edge); null elsewhere. */
export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(() => deferredPrompt);
  const [installed, setInstalled] = useState(isInstalled);
  useEffect(() => {
    const on = (e) => { setPrompt(e); if (!e) setInstalled(true); };
    promptListeners.add(on);
    return () => promptListeners.delete(on);
  }, []);
  return {
    installed,
    install: prompt ? async () => {
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') { deferredPrompt = null; setPrompt(null); setInstalled(true); }
    } : null,
  };
}
