// Recountix service worker - fast cache with safe app updates.
const CACHE = 'recountix-fast-v4';
const CORE_ASSETS = [
  './css/style.css',
  './css/final-suite.css',
  './css/redesign-2026.css',
  './css/saas-2026.css',
  './js/supabase.js',
  './js/utils.js',
  './js/db.js',
  './js/auth.js',
  './js/app.js',
  './js/final-suite.js',
  './assets/logo.png',
  './assets/recountix-logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' }))).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

function isAppAsset(url) {
  return /\.(css|js)(\?|$)/.test(url.pathname);
}

function isStaticAsset(url) {
  return /\.(png|jpg|jpeg|webp|gif|svg|ico|woff2?)(\?|$)/.test(url.pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isHtmlRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./login.html')))
    );
    return;
  }

  if (isAppAsset(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const refresh = fetch(request).then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return response;
        }).catch(() => cached);
        return cached || refresh;
      })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      }))
    );
  }
});
