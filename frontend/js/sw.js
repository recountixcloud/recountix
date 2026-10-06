// Bump this on every deploy so old caches get wiped automatically.
const CACHE = 'bk-rm-v16-sidebar-click-v8';

// Only truly static assets that rarely change go here.
const ASSETS = ['./css/style.css', './assets/logo.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for HTML and JS: always try to get the latest app logic.
// Falls back to cache only when offline. Static assets stay cache-first.
self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isAppCode = url.includes('.html') || url.includes('.js') || url.includes('.css');

  if (isAppCode) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then(r => r || caches.match('./login.html')))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request))
    );
  }
});
