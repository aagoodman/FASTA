// --- FASTA service worker (safe + update-friendly) ---
const VERSION = 'fasta-v1.0.0';            // bump to force refresh
const STATIC_CACHE  = `static-${VERSION}`;
const RUNTIME_TILES = 'tiles-runtime';

// Precache the core app shell (no third-party tiles here)
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png',
  './icons/splash-1284x2778.png',
  // Leaflet (safe to cache)
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-image/leaflet-image.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(ASSETS))
  );
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

// simple helper to limit runtime cache size
async function trimCache(cacheName, maxEntries = 120) {
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
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put('./index.html', clone));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./offline.html')))
    );
    return;
  }

  // 2) Static assets we precached: cache-first
  if (ASSETS.some(a => url.href.endsWith(a.replace('./','')) || url.href === new URL(a, self.registration.scope).href || url.href === a)) {
    e.respondWith(caches.match(request).then(res => res || fetch(request)));
    return;
  }

  // 3) Map tiles (OpenStreetMap / Esri): runtime cache with cap
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
        // Opaque responses are okay; still cache to allow offline re-view
        cache.put(request, res.clone());
        trimCache(RUNTIME_TILES, 200);
        return res;
      } catch {
        // no tile available; just fail silently (map will show gaps)
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // 4) Default: network-first, fall back to cache if present
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
