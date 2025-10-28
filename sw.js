const CACHE_NAME = 'gokuro-cache-v5.2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/modal-styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/images/icons/icon-192.png',
  '/images/icons/icon-512.png',
  '/images/icons/favicon-16x16.png',
  '/images/icons/favicon-32x32.png',
  '/images/all-letters-used.jpg',
  '/images/completed-puzzle.jpg',
  '/images/day-selectors.jpg',
  '/images/double-letter.jpg',
  '/images/grid-selectors.jpg',
  '/images/grid-vowels.jpg',
  '/images/letter-count.jpg',
  '/images/letter-tray.jpg',
  '/images/letter-value.jpg',
  '/images/play-grid.jpg',
  '/images/row-column-totals.jpg',
  '/images/target-green.jpg',
  '/images/target-pink.jpg',
  '/images/ticked-grid-selector.jpg',
  '/images/timer-started.jpg',
  '/images/social-share-image.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request);
    })
  );
});

