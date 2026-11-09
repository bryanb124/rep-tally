// Keeps a copy of the app on the phone so it opens with no signal.
// The page itself is fetched fresh when there's a connection (so updates arrive),
// falling back to the saved copy if the network is slow or missing.
const CACHE = 'rep-tally-cache-v4';
const FILES = ['./', './index.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'];
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Only the page itself (opening the app), the icons and the manifest are served from the saved copy.
  // Anything else, such as the "Check for update" request, always goes to the network.
  if (req.mode !== 'navigate' && !/\.(png|json)$/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    // Network first (with a short wait), then the saved copy.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const fromNet = fetch(req, { cache: 'no-store' }).then(res => {   // skip the browser's 10-minute cache so updates show up right away
        if (res.ok) cache.put('./', res.clone());
        return res;
      });
      const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_WAIT_MS, null));
      try {
        const res = await Promise.race([fromNet, timeout]);
        if (res) return res;
      } catch {}
      const saved = await cache.match('./');
      if (saved) { e.waitUntil(fromNet.catch(() => {})); return saved; }
      return fromNet;
    })());
    return;
  }

  // Icons and manifest: saved copy first, refresh in the background.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(req, { ignoreSearch: true });
    const fromNet = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (saved) { e.waitUntil(fromNet.catch(() => {})); return saved; }
    return fromNet;
  })());
});
