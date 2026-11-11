// Сервіс-воркер: гра відкривається й без мережі.
// Свої файли - спершу з мережі (щоб оновлення приходили одразу), без мережі - з кешу.
// Шрифти Google - з кешу, бо вони не змінюються. Запити до посередника ntfy.sh не чіпаємо.
const CACHE = 'trofei-455e30603b6e';
const FONTS = 'fonts-trofei';
const FILES = ["./","./index.html","./app.js?v=455e30603b6e","./worker.js?v=455e30603b6e","./online.js?v=455e30603b6e","./cloud.js?v=455e30603b6e","./share.js?v=455e30603b6e","./native.js?v=455e30603b6e","./cloud-config.js?v=455e30603b6e","./privacy.html","./terms.html","./delete-account.html","./licenses.html","./OFL.txt","./LICENSE-APACHE-2.0.txt","./supabase.js?v=455e30603b6e","./supabase-LICENSE.txt","./core.js?v=455e30603b6e","./eval.js?v=455e30603b6e","./engine.js?v=455e30603b6e","./levels.js?v=455e30603b6e","./history.js?v=455e30603b6e","./human.js?v=455e30603b6e","./bookkey.js?v=455e30603b6e","./book.js?v=455e30603b6e","./archivo-latin.woff2","./install.js?v=455e30603b6e","./manifest.webmanifest","./favicon.ico","./favicon-48.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./icon-1024.png","./icon-maskable-1024.png","./apple-touch-icon.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('trofei-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // саму сторінку завжди перепитуємо в сервера (повз кеш браузера) - так оновлення приходять одразу
    const page = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    e.respondWith((page ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req))
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      c.put(req, res.clone());
      return res;
    }));
  }
});
