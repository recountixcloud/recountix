const CACHE_NAME = 'recountix-network-first-20261008-1';
const CORE = [
  './',
  './index.html',
  './login.html',
  './dashboard.html',
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
      .then(keys => Promise.all(keys.map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function cacheable(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && request.method === 'GET';
}

self.addEventListener('fetch', event => {
  if (!cacheable(event.request)) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).then(response => {
      if (response && response.ok && event.request.url.startsWith(self.location.origin)) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request, { ignoreSearch: false })
        .then(cached => cached || caches.match(event.request, { ignoreSearch: true }))
        .then(cached => cached || caches.match('./login.html'));
    })
  );
});
