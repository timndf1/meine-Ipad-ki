const CACHE = 'meine-ki-shell-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE); await cache.addAll(SHELL); await self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('meine-ki-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // WebLLM manages its own model cache. Cache the app and CDN module graph here.
  if (url.origin !== self.location.origin && url.hostname !== 'cdn.jsdelivr.net') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request); if (cached) return cached;
    try {
      const response = await fetch(e.request);
      if (response.ok && response.type !== 'opaque') await cache.put(e.request, response.clone());
      return response;
    } catch (error) {
      if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw error;
    }
  })());
});
