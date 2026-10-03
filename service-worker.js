// Courtside — minimal app-shell service worker.
//
// Scope is deliberately narrow: it only ever caches the static shell files
// listed below (the page itself, the manifest, the icons). It never touches
// anything cross-origin — Firebase Auth, Firestore, Google Sign-In, Google
// Fonts — and never touches a non-GET request. That matters: a service
// worker that intercepts the Google sign-in redirect chain can silently
// break it, which is exactly the auth quirk Courtside has hit before on
// GitHub Pages. Firestore reads/writes already have their own offline
// handling in the app itself (see the localStorage cache + sync queue in
// index.html), so this worker doesn't need to — and shouldn't try to —
// cache any of that.
//
// Bump CACHE_NAME whenever you want to force every installed copy to pick
// up a clean cache on next load (not usually necessary — the network-first
// strategy below already means online users get the latest shell on every
// visit; this is just a manual escape hatch).
const CACHE_NAME = 'courtside-shell-v1';
const SHELL_FILES = [
  'index.html',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES.map((f) => new URL(f, self.location.href).toString())))
      .catch((e) => console.warn('Courtside SW: precache failed (offline on first install?)', e))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (Firebase, Google, fonts) — untouched, straight to network

  const isShellRequest = url.pathname.endsWith('/') || SHELL_FILES.some((f) => url.pathname.endsWith('/' + f));
  if (!isShellRequest) return; // anything else same-origin — untouched

  // Network-first: this is a single-file app that changes often, so an
  // online visitor should always get the current version. Offline visitors
  // fall back to whichever shell copy was cached last, so the app still
  // opens and existing data (cached separately by the app itself) still
  // shows.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || caches.match(new URL('index.html', self.location.href).toString()))
      )
  );
});
