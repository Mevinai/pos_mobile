const CACHE_VERSION = 'pos-mobile-v1';
const ASSET_CACHE = `assets-${CACHE_VERSION}`;

// Core assets to seed the cache. Keep minimal to avoid install failures.
const CORE_ASSETS = ['/', /* additional app shell routes may be added here */ ];

// Maximum number of entries to keep in the asset cache (prevents uncontrolled growth)
const MAX_ASSET_ENTRIES = 200;

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const removeCount = keys.length - maxEntries;
    for (let i = 0; i < removeCount; i++) {
      try { await cache.delete(keys[i]); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore trimming errors */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(ASSET_CACHE);
      // addAll can fail if any resource is unavailable; guard to keep install resilient
      try { await cache.addAll(CORE_ASSETS); } catch (e) { console.warn('sw_pos: core asset pre-cache failed', e); }
    } catch (e) { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      const deletions = keys
        .filter(k => k.startsWith('assets-') && k !== ASSET_CACHE)
        .map(k => caches.delete(k));
      await Promise.all(deletions);
    } catch (e) { /* ignore */ }
    await self.clients.claim();
  })());
});

// Strategy:
// - API calls: network-first, fallback to cache (rare). We don't generally cache POST.
// - Static/assets/GET: cache-first, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests in the service worker caching strategies
  if (request.method !== 'GET') return;

  const sameOrigin = url.origin === self.location.origin;
  const isAsset = sameOrigin && (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf')
  );
  const isAPI = url.pathname.startsWith('/api/') || url.pathname.includes('/method/');

  // Network-first for API calls (don't cache POSTs). Fallback to cache if offline.
  if (isAPI) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(request);
        return resp;
      } catch (e) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      }
    })());
    return;
  }

  // Cache-first for same-origin assets, but only cache successful responses
  if (isAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const resp = await fetch(request);
        if (resp && resp.ok) {
          try {
            const clone = resp.clone();
            const cache = await caches.open(ASSET_CACHE);
            await cache.put(request, clone);
            // keep cache trimmed
            trimCache(ASSET_CACHE, MAX_ASSET_ENTRIES).catch(() => {});
          } catch (e) { /* ignore caching errors */ }
        }
        return resp;
      } catch (e) {
        // fallback to cached if available
        if (cached) return cached;
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      }
    })());
    return;
  }

  // Navigation requests (HTML): try network then fallback to cache('/') or a minimal offline response
  if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(request);
        return resp;
      } catch (e) {
        const cachedShell = await caches.match('/');
        if (cachedShell) return cachedShell;
        return new Response('<h1>Offline</h1><p>The application is currently offline.</p>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          status: 503
        });
      }
    })());
    return;
  }
  // Other requests: let the browser handle them
});


