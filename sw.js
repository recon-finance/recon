// RECON service worker: lets the latest brief be read offline (e.g. on the Tube).
const V = 'recon-v2';
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(['./']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (/^\/(api\/admin|confirm|unsubscribe)/.test(u.pathname)) return;
  const live = /\/(api\/(stories|rates|trackrecord)|data\/[a-z]+\.json)$/.test(u.pathname);   // live server API or static data files
  if (live) { // network first, fall back to the last cached brief
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; }).catch(() => caches.match(r)));
  } else if (r.mode === 'navigate' || /\/(index\.html)?$/.test(u.pathname)) { // the page itself: network first, so a new version shows immediately (cache only for offline)
    e.respondWith(fetch(r).then(res => { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); return res; }).catch(() => caches.match(r)));
  } else { // other static files: stale-while-revalidate
    e.respondWith(caches.match(r).then(hit => {
      const net = fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(V).then(x => x.put(r, c)); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
