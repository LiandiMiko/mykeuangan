const CACHE_NAME = 'mykeuangan-__BUILD_ID__';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png'
  /* __VENDOR_ASSETS__ */
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

  if (url.hostname.includes('supabase.co') || url.hostname === 'generativelanguage.googleapis.com') {
    return;
  }

  const accept = event.request.headers.get('accept') || '';
  const isHtmlRequest = event.request.mode === 'navigate'
    || accept.includes('text/html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('/index.html');

  if (isHtmlRequest) {
    const htmlCacheKey = './index.html';
    const isMainAppHtml = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    const targetCacheKey = isMainAppHtml ? htmlCacheKey : url.pathname;
    event.respondWith(
      fetch(event.request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(targetCacheKey, clone))
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
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
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
