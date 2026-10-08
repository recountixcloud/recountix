const CACHE_NAME = 'recountix-fast-20261008-sidebar-2';
const CORE = [
  './',
  './index.html',
  './login.html',
  './dashboard.html',
  './css/recountix-2027.css',
  './css/boltise-dark.css',
  './css/sidebar-desktop-fix.css',
  './js/final-suite.js',
  './js/supabase.js',
  './js/utils.js',
  './js/db.js',
  './js/auth.js',
  './js/preferences.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(CORE.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(request) {
  const url = new URL(request.url);
  return /\.(?:css|js|png|jpg|jpeg|webp|svg|ico|woff2?|ttf)$/i.test(url.pathname);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(event.request)) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then(cached => cached || caches.match('./login.html')))
  );
});