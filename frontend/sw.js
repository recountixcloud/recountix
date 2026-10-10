/* Recountix performance service worker: cache static assets, refresh page HTML. */
const CACHE_NAME = 'recountix-assets-20261010-3';
const CORE = ['./', './index.html', './login.html', './dashboard.html', './manifest.json'];

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
      .then(keys => Promise.all(keys.filter(key => key.startsWith('recountix-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function sameOriginGet(request) {
  return request.method === 'GET' && new URL(request.url).origin === self.location.origin;
}
function isDocument(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}
function isStaticAsset(request) {
  return /\.(?:css|js|mjs|png|jpe?g|webp|svg|ico|woff2?|ttf|otf)$/i.test(new URL(request.url).pathname);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!sameOriginGet(request)) return;

  if (isDocument(request)) {
    // Keep pages fresh; use cached shell only when the network is unavailable.
    event.respondWith(fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(async () => {
      return (await caches.match(request)) || (await caches.match('./login.html')) || Response.error();
    }));
    return;
  }

  if (isStaticAsset(request)) {
    // CSS/JS/fonts/images load from cache first for quick page-to-page navigation.
    event.respondWith(caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(request);
      const refresh = fetch(request).then(response => {
        if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      });
      if (cached) {
        event.waitUntil(refresh.catch(() => {}));
        return cached;
      }
      return (await refresh.catch(() => null)) || Response.error();
    }));
  }
});
