// BillKhata service worker: the app opens and works with no connection. Built by vite.config.js
// (offlinePlugin), which fills in the version and this build's files. Data never passes through here:
// bills live in IndexedDB, and the OCR models in their own cache (paddle.worker.js).
//   - Pages (navigations): the network first, so updates arrive; offline, the saved app.
//   - /assets/* (hashed, never change): from the cache, else fetched once and kept.
//   - Other files of this site (icons, manifest): the cache, refreshed in the background.
/* eslint-disable no-restricted-globals */
const VERSION = '__VERSION__';
const CORE = __CORE__; // what the app needs to open: index.html, the main JS and CSS, fonts, icons
const ALL = __ALL__; // every file of this build (Settings → Download for offline use)
const APP = `bk-app-${VERSION}`;
const ASSETS = 'bk-assets';
const OWN = new Set(ALL.map((f) => `/${f}`));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP);
    await app.addAll(['/', ...CORE.map((f) => `/${f}`)].map((u) => new Request(u, { cache: 'reload' })));
    // The first install takes over straight away; an update waits until the page says to.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('bk-app-') && name !== APP) await caches.delete(name);
    }
    // Files from older builds are gone from the site too: drop them.
    const assets = await caches.open(ASSETS);
    for (const req of await assets.keys()) {
      if (!OWN.has(new URL(req.url).pathname)) await assets.delete(req);
    }
    await self.clients.claim();
  })());
});

async function fromCacheOrNetwork(request, cacheName) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(cacheName)).put(request, res.clone());
  return res;
}

async function page(request) {
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ]);
    if (res.ok) (await caches.open(APP)).put('/', res.clone());
    return res;
  } catch {
    return (await caches.match('/', { cacheName: APP })) || (await caches.match('/')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // the OCR models, vision APIs, the IRD site
  if (request.mode === 'navigate') { event.respondWith(page(request)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(fromCacheOrNetwork(request, ASSETS)); return; }
  if (url.pathname === '/sw.js') return;
  event.respondWith((async () => {
    const hit = await caches.match(request);
    const fresh = fetch(request).then(async (res) => {
      if (res.ok) (await caches.open(APP)).put(request, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await fresh) || Response.error();
  })());
});
