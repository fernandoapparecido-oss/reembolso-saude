// Service worker mínimo (PWA instalável + shell offline).
// __BUILD__ é carimbado no deploy → cache novo a cada versão.
// Regra de ouro: só intercepta GET do MESMO domínio. Chamadas ao Google
// (login, Sheets, Drive, iframe de preview) passam DIRETO, sem cache.
const CACHE = 'reembolso-__BUILD__';
const CORE = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google/API: não intercepta

  if (req.mode === 'navigate') {
    // HTML: rede primeiro (pega atualizações), cache como reserva offline.
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return r; })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Assets com ?v= são imutáveis → cache primeiro, senão rede (e guarda).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    })),
  );
});
