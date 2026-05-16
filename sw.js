/* Meteo Nordica - cache shell per uso offline */
const CACHE = 'meteo-nordica-shell-v9';
const NETWORK_FIRST = ['./index.html', './app.js', './style.css'];
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        for (const u of ASSETS) {
          try {
            await cache.add(u);
          } catch (_) {}
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin === location.origin) {
    const isShell = NETWORK_FIRST.some((p) => {
      const name = p.replace('./', '');
      return url.pathname.endsWith(name) || url.pathname.endsWith(`/${name}`);
    });

    if (isShell) {
      event.respondWith(
        fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(request).then((c) => c || caches.match('./index.html')))
      );
      return;
    }

    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).catch(() => caches.match('./index.html')))
    );
    return;
  }

  if (url.hostname === 'api.open-meteo.com' || url.hostname === 'geocoding-api.open-meteo.com') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
