/*
 * Pocketverse service worker — intentionally minimal.
 *
 * Pocketverse streams multi-GB files through the API into each user's own
 * storage, and every drive view is per-user and auth-gated. Caching any of that
 * would be wrong — it could serve one person's data to another, or show a stale
 * drive. So this worker exists mainly to make the app *installable* and to give
 * a friendly offline page. It caches ONLY:
 *   - the offline fallback page and app icons (precached below), and
 *   - Next's content-hashed, immutable build assets under /_next/static/.
 * It NEVER touches /api/*, file bytes, range requests, or navigations' HTML.
 *
 * Bump CACHE_VERSION to retire old caches on the next activation.
 */
const CACHE_VERSION = 'pv-v1';
const PRECACHE = `${CACHE_VERSION}-precache`;
const RUNTIME = `${CACHE_VERSION}-static`;
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([PRECACHE, RUNTIME]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only same-origin GETs are ever eligible for caching.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never intercept the API, range requests (downloads), or auth traffic.
  if (url.pathname.startsWith('/api/') || request.headers.has('range')) return;

  // Immutable, content-hashed build assets: cache-first (fast, safe to keep).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(RUNTIME).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ??
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Page navigations: network-first (always fresh, per-user), offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
