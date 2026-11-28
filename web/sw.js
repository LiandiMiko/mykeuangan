const CACHE_NAME = 'mykeuangan-__BUILD_ID__';
// Gelombang 4 (R14): batas cache runtime — dulu setiap GET 200 disimpan
// tanpa batas dan kuota tidak pernah dicek. Sekarang entri dibatasi
// (tertua dihapus dulu) dan cache tidak diisi bila pemakaian sudah
// melewati 80% kuota storage.
const MAX_CACHE_ENTRIES = 200;

async function trimCache(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch (_) { /* abaikan */ }
}

async function cacheWithinQuota(cache, request, response) {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number' && typeof est.usage === 'number' && est.quota > 0 && est.usage / est.quota > 0.8) return;
    }
    await cache.put(request, response);
    await trimCache(cache, MAX_CACHE_ENTRIES);
  } catch (_) { /* abaikan */ }
}
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png'
  /* __VENDOR_ASSETS__ */
  /* __APP_ASSETS__ */
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
  if (!self.registration || !self.registration.active) {
    self.skipWaiting();
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (url.hostname.includes('supabase.co') ||
      url.hostname === 'generativelanguage.googleapis.com' ||
      url.hostname === 'api.coingecko.com' ||
      url.hostname === 'latest.currency-api.pages.dev' ||
      url.pathname.includes('currency-api') ||
      url.pathname.endsWith('/version.json')) {
    return;
  }

  const accept = event.request.headers.get('accept') || '';
  const isHtmlRequest = event.request.mode === 'navigate'
    || accept.includes('text/html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');

  if (isHtmlRequest) {
    // Gelombang 4 (R15): query string masuk ke kunci cache — dulu
    // /index.html?v=2 dan /index.html?v=3 berbagi satu kunci sehingga
    // versi baru tidak tersimpan/terbaca dengan benar. Fallback offline
    // tetap memakai kunci tanpa query ('./' / './index.html' yang
    // di-precache saat install).
    const htmlCacheKey = './index.html';
    const isMainAppHtml = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    const targetCacheKey = isMainAppHtml ? htmlCacheKey + url.search : url.pathname + url.search;
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cacheWithinQuota(cache, targetCacheKey, clone))
            );
          }
          return networkRes;
        })
        .catch(() => caches.match(targetCacheKey).then((hit) => hit || (isMainAppHtml ? caches.match('./') : caches.match(htmlCacheKey))))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200 && event.request.method === 'GET') {
            const clone = networkRes.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cacheWithinQuota(cache, event.request, clone))
            );
          }
          return networkRes;
        })
        .catch(() => cached || new Response('', { status: 503, statusText: 'Offline' }));

      if (cached) event.waitUntil(fetchPromise);
      return cached || fetchPromise;
    })
  );
});
