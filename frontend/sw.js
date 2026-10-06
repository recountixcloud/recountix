const CACHE_NAME = 'recountix-preferences-20261002';
const CORE = [
  './backup.html','./css/recountix-2027.css','./css/style.css','./css/final-suite.css','./css/business-pro.css',
  './js/supabase.js','./js/permissions.js','./js/utils.js','./js/db.js','./js/auth.js',
  './js/preferences.js','./js/offline-backup.js','./js/backup.js','./assets/logo.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    Promise.allSettled(CORE.map(url => cache.add(new Request(url, { cache: 'reload' }))))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      return (await caches.match('./backup.html')) ||
        new Response('Offline. Open Offline Backup after one successful online visit.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }));
});
