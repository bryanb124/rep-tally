// Keeps a copy of the app on the phone so it opens with no signal.
// The page is fetched fresh when there's a connection (so updates arrive) and falls back to the saved copy.
// Styles and code carry the version in their address, so a new page never runs with an old app.js.
const VERSION = '2026.11.10.2';
const CACHE = 'rep-tally-' + VERSION;
const FILES = ['./', `app.css?v=${VERSION}`, `app.js?v=${VERSION}`, 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {                 // opening the app: network first (up to 3 s), then the saved copy
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const fromNet = fetch(req, { cache: 'no-store' }).then(res => { if (res.ok) cache.put('./', res.clone()); return res; });
      const res = await Promise.race([fromNet, new Promise(r => setTimeout(r, 3000, null))]).catch(() => null);
      if (res) return res;
      const saved = await cache.match('./');
      if (saved) { e.waitUntil(fromNet.catch(() => {})); return saved; }
      return fromNet;
    })());
    return;
  }

  // App files: the saved copy first. Anything else (such as the "Check for update" request) always goes to the network.
  if (!/\.(css|js|png|json)$/.test(url.pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req, { ignoreSearch: /\.(png|json)$/.test(url.pathname) });
    if (saved) return saved;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
