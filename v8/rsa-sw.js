// RSA Warroom — Service Worker (install-only, no offline caching of dynamic data)
const CACHE = 'rsa-warroom-v1';
const PRECACHE = ['rsa.html', 'rsa-manifest.json', 'logo.jpg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

// Network first always — RSA needs live data
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase') || url.hostname.includes('unpkg') || url.hostname.includes('fonts')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
