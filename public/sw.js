// Service Worker for tidn PWA
// Caches app shell (JS, CSS, fonts) using stale-while-revalidate strategy

const CACHE_NAME = 'tidn-v1';

// App shell assets to precache on install
const PRECACHE_URLS = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Install: precache essential assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// Fetch: stale-while-revalidate for static assets, network-first for API/pages
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // Skip API routes and server actions (POST-based)
  if (url.pathname.startsWith('/api/')) return;

  // Static assets (JS, CSS, fonts, images): stale-while-revalidate
  if (isStaticAsset(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // HTML pages: network-first with cache fallback
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

/**
 * Check if a URL pathname is a static asset that benefits from caching.
 * Next.js hashes static assets so cache invalidation is built-in.
 */
function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.match(/\.(js|css|woff2?|ttf|otf|ico|png|jpg|jpeg|svg|webp)$/) !== null
  );
}

/**
 * Stale-while-revalidate: return cached version immediately,
 * fetch fresh version in background for next time.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/**
 * Network-first: try network, fall back to cache.
 * Caches successful responses for offline fallback.
 */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    return (
      cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
    );
  }
}
