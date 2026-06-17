// Trace & Hunter — Service Worker (network-first, install shell for offline fallback)
const CACHE = 'trace-hunter-v1';
const PRECACHE = [
  'trace-hunter.html',
  'trace-hunter-manifest.json',
  '../logo.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first: always try live data; fall back to cache for shell assets only
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Pass through Supabase, CDN, maps — never cache these
  if (
    url.hostname.includes('supabase') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('openstreetmap') ||
    url.hostname.includes('tile') ||
    url.hostname.includes('leaflet') ||
    url.protocol === 'chrome-extension:'
  ) return;

  e.respondWith(
    fetch(e.request)
      .catch(() => caches.match(e.request))
  );
});
