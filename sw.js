// --- FASTA service worker (safe + update-friendly) ---
// sw.js (top of file)
importScripts('./version.js');
// Use FASTA_CACHE for your cache/version key:
const VERSION = FASTA_CACHE; // e.g., 'fasta-v1.0.5'
const STATIC_CACHE  = `static-${VERSION}`;
const RUNTIME_TILES = 'tiles-runtime';

// Precache the core app shell (keep this list small & deterministic)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png',
  './icons/splash-1284x2778.png',
  // Leaflet libs (safe to cache)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-image/leaflet-image.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_TILES)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// small helper to cap runtime tile cache
async function trimCache(cacheName, maxEntries = 200) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  const extra = keys.length - maxEntries;
  for (let i = 0; i < extra; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 1) App navigation: network-first with offline fallback
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          // keep a fresh copy of index.html
          caches.open(STATIC_CACHE).then((c) => c.put('./index.html', res.clone()));
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then(r => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // 2) Static precached assets: cache-first
  if (
    ASSETS.some(a =>
      url.href === new URL(a, self.registration.scope).href ||
      url.href.endsWith(a.replace('./', '')) ||
      url.href === a
    )
  ) {
    e.respondWith(caches.match(request).then(res => res || fetch(request)));
    return;
  }

  // 3) Map tiles: runtime cache (limited), cache-first after first hit
  const isTile =
    url.hostname.endsWith('tile.openstreetmap.org') ||
    url.hostname.endsWith('arcgisonline.com');

  if (isTile) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME_TILES);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request, { mode: 'cors' });
        cache.put(request, res.clone());
        trimCache(RUNTIME_TILES, 200);
        return res;
      } catch {
        // fail silently on tiles
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // 4) Default: network-first with cache fallback
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
