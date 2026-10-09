// sw.js — Owner: P3.
//
// Service worker. Two jobs, both load-bearing:
//
//   1. The app shell must run with the radio off. That is the normal
//      operating condition, not an edge case.
//   2. The model files must be cached so the second run needs no network.
//      They are large, so they get their own cache and are never precached —
//      precaching a 40MB model would make first load look broken.
//
// Cache strategy:
//   - app shell: precache on install, serve cache-first
//   - model: cache-first, on demand, separate cache name
//   - everything else: network, no caching (fixtures are small and precached)

const VERSION = 'boses-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const MODEL_CACHE = `${VERSION}-model`;

// The shell. Fixtures are included because the demo must never wait on a
// network fetch — and `?fixture=1` is how we prove offline works.
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './captions.js',
  './sheet.js',
  './fixture.js',
  './engine-select.js',
  './manifest.webmanifest',
];

// The fixture JSON lives in lessons/, which is OUTSIDE this worker's default
// scope (/web/). Consequence, and it is a real one: precaching a path outside
// scope does nothing, because the worker never intercepts those requests and
// so never gets a chance to answer them from the cache. Offline fixture mode
// therefore depends on the host serving ONE of:
//
//   (a) `Service-Worker-Allowed: /` on sw.js, plus registration with
//       scope:'../'  — see registerServiceWorker() in index.html, which tries
//       this first and falls back if the host refuses; or
//   (b) the repo served with web/ as the document root and lessons/ copied
//       under it, making ./lessons/... in-scope.
//
// Until one of those holds, fixture mode still works online and via the normal
// HTTP cache, but NOT from a cold offline start. Verify at Checkpoint A
// (T3.5) with a hard reload in airplane mode, not by inspection.
// These entries are kept because they are correct under (a) and harmless
// under (b).
const FIXTURES = [
  '../lessons/fixtures/clean.fixture.json',
  '../lessons/fixtures/noisy.fixture.json',
  '../lessons/fixtures/taglish.fixture.json',
];

// Paths that hold model weights, matched separately so they land in the
// model cache and are never evicted when the shell changes.
const isModelAsset = (url) =>
  /\.(wasm|bin|onnx|json|ggml|gguf|m4s)$/i.test(url.pathname) &&
  /huggingface|transformers|whisper|models?\//i.test(url.href);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // addAll is atomic: one 404 and the whole install fails. Add
    // individually so a missing optional file cannot break the install.
    const missing = [];
    await Promise.all([...SHELL, ...FIXTURES].map(async (url) => {
      try {
        const res = await cache.add(new Request(url, { cache: 'reload' }));
        if (!res) missing.push(url);
      } catch (err) {
        missing.push(url);
        console.warn('[sw] asset not cached:', url, err);
      }
    }));
    // Missing entries are almost always another owner's module not merged yet
    // (asr.js, capture.js, store.js). Say so once, loudly, rather than
    // letting a half-cached shell look like a working offline app.
    if (missing.length) {
      console.info('[sw] cached shell without:', missing.join(', '));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, MODEL_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept cross-origin except model weights, which we do cache.
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin && !isModelAsset(url)) return;

  // Model weights: cache-first, and remember them once fetched.
  if (isModelAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(MODEL_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        // opaque responses still get cached; the browser replays them offline
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return new Response('model unavailable offline', {
          status: 504,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })());
    return;
  }

  // Same-origin navigations: cache-first on the shell so a cold, offline
  // launch works. Falls back to network, then to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(req);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('Boses is offline and not yet cached.', {
                 status: 503, headers: { 'Content-Type': 'text/plain' },
               });
      }
    })());
    return;
  }

  // Static assets: cache-first, populate on miss.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});

// Let the page trigger an immediate takeover instead of waiting for all tabs
// to close — useful during a demo when the reload is on a timer.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});