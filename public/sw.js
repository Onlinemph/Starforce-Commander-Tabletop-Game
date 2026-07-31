/*
 * StarForce Commander — offline support.
 *
 * The game is a static page with a rules engine that runs entirely in the
 * browser, so once loaded it needs nothing from the network. This worker
 * makes that literal:
 *
 *   - Hashed build assets (/assets/…) never change under the same name, so
 *     they are served cache-first and kept forever.
 *   - Everything else — the page itself above all — goes network-first, so a
 *     new deploy is picked up on the next online visit, with the cache as
 *     the offline fallback.
 *
 * No precache manifest: the cache fills as the app loads, which for a
 * single-page game is one visit.
 */
const CACHE = 'sfc-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(async () => {
        const hit = await caches.match(request)
        if (hit) return hit
        // A navigation while offline falls back to the cached app shell.
        const shell = await caches.match(new URL('./index.html', self.registration.scope).href)
        return shell ?? Response.error()
      }),
  )
})
