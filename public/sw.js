// Service worker: caches only static, public build assets. It never touches cross-origin requests
// (Supabase API / Storage / Edge Functions, Google Fonts, Gemini) nor any non-GET request.
const CACHE = 'aires-static-v2'
const SHELL = '/index.html'
const STATIC = [/^\/assets\//, /^\/icon-.*\.png$/, /^\/apple-touch-icon\.png$/, /^\/favicon\.png$/, /^\/manifest\.webmanifest$/]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // Never touch authenticated or ranged requests (documents, signed downloads, API calls)
  if (req.headers.has('authorization') || req.headers.has('range')) return

  // Page navigations: network first, cached shell only when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(SHELL, copy)) }
      return res
    }).catch(() => caches.match(SHELL).then(r => r || Response.error())))
    return
  }

  // Hashed build assets and icons: cache first.
  if (STATIC.some(re => re.test(url.pathname))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
      return res
    })))
  }
})

// Web Push: new client messages for the agency. Shows the notification and syncs the app icon badge (works on iOS too once permission is granted).
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { /* plain text payload */ }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title || 'Aires y Destinos', {
      body: d.body || 'Tienes un mensaje nuevo', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'aires-message', renotify: true, data: { url: d.url || '/solicitudes' },
    })
    if (typeof d.unread === 'number' && self.navigator.setAppBadge) {
      try { await (d.unread > 0 ? self.navigator.setAppBadge(d.unread) : self.navigator.clearAppBadge()) } catch { /* badge not supported */ }
    }
  })())
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/solicitudes', self.location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin))
    if (open) return open.focus().then(c => (c && 'navigate' in c ? c.navigate(url) : undefined))
    return self.clients.openWindow(url)
  }))
})
