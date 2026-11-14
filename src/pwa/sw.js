/* Service Worker di Ruota Party.
 *
 * Questo file è un TEMPLATE: in build, vite.config.js (serviceWorkerPlugin) sostituisce i
 * segnaposto di PRECACHE (lista reale dei file) e VERSION (hash del bundle), poi lo emette
 * come dist/sw.js. In dev il SW non viene registrato.
 *
 * Strategie:
 *  - install:   precache dell'app shell (HTML, JS/CSS con hash, manifest, icone)
 *  - navigate:  network-first (deploy nuovi visibili subito), fallback alla shell in cache
 *  - asset:     cache-first (i file hanno hash nel nome, sono immutabili)
 *  - cross-origin (signaling PeerJS, STUN...): mai intercettato
 *
 * Aggiornamenti: il nuovo SW NON fa skipWaiting da solo, per non cambiare i chunk sotto i piedi
 * di una partita in corso. La pagina mostra "Aggiorna" e manda {type:'SKIP_WAITING'}.
 */
const VERSION = '__SW_VERSION__';
const CACHE = `ruota-party-${VERSION}`;
const PRECACHE = self.__PRECACHE_MANIFEST;
const SHELL_URL = new URL('./', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((path) => new Request(new URL(path, self.registration.scope), { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('ruota-party-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirstShell(request) {
  try {
    const response = await fetchWithTimeout(request, 4000);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    // Offline o rete lenta: la shell in cache (ignora ?room=XXXX ecc.)
    const cached = (await caches.match(SHELL_URL)) || (await caches.match(request, { ignoreSearch: true }));
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (r) => (clearTimeout(timer), resolve(r)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}
