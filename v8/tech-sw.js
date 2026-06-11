// FleetPro RSA Tech — Service Worker
const CACHE = 'rsa-tech-v1';
const PRECACHE = ['tech.html', 'tech-manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for static
  const url = new URL(e.request.url);
  if (url.hostname.includes('supabase.co') || url.hostname.includes('cdn.jsdelivr')) {
    return; // let these go through normally
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
