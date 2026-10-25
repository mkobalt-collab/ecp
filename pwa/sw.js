const VERSION = 'v1';
const CACHE = `ecp-${VERSION}`;
// Ścieżki względne (działa pod podścieżką GitHub Pages). Każdy plik ładowany przez aplikację musi tu być.
const PRECACHE = [
  './', 'index.html', 'styles.css', 'config.js', 'manifest.webmanifest',
  'js/app.js', 'js/api.js', 'js/store.js', 'js/sync.js', 'js/ui.js', 'js/pdf.js',
  'js/views/godziny.js', 'js/views/urlop.js', 'js/views/wyjscia.js', 'js/views/wpisy.js', 'js/views/panel.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  // cache:'reload' omija cache HTTP (GitHub Pages max-age=600) — nowa VERSION nie zapisze starych plików
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ecp-') && k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
