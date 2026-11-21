// Сервіс-воркер: гра відкривається й без мережі.
// Свої файли - спершу з мережі (щоб оновлення приходили одразу), без мережі - з кешу.
// Шрифти Google - з кешу, бо вони не змінюються. Запити до посередника ntfy.sh не чіпаємо.
const CACHE = 'trofei-0d51ed286ba3';
const FONTS = 'fonts-trofei';
const FILES = ["./","./index.html","./en/index.html","./app.js?v=0d51ed286ba3","./worker.js?v=0d51ed286ba3","./online.js?v=0d51ed286ba3","./cloud.js?v=0d51ed286ba3","./share.js?v=0d51ed286ba3","./native.js?v=0d51ed286ba3","./cloud-config.js?v=0d51ed286ba3","./privacy.html","./terms.html","./delete-account.html","./licenses.html","./i18n.js?v=0d51ed286ba3","./lang-en.js?v=0d51ed286ba3","./en/privacy.html","./en/terms.html","./en/delete-account.html","./en/licenses.html","./OFL.txt","./LICENSE-APACHE-2.0.txt","./supabase.js?v=0d51ed286ba3","./supabase-LICENSE.txt","./core.js?v=0d51ed286ba3","./eval.js?v=0d51ed286ba3","./engine.js?v=0d51ed286ba3","./levels.js?v=0d51ed286ba3","./history.js?v=0d51ed286ba3","./human.js?v=0d51ed286ba3","./bookkey.js?v=0d51ed286ba3","./book.js?v=0d51ed286ba3","./archivo-latin.woff2","./install.js?v=0d51ed286ba3","./manifest.webmanifest","./google-play-badge.png","./google-play-badge-en.png","./og-uk.png","./og-en.png","./favicon.ico","./favicon-48.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./icon-1024.png","./icon-maskable-1024.png","./apple-touch-icon.png"];

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
      // без мережі - зі сховища; сторінки, якої там немає, - головна сторінка тією ж мовою
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(url.pathname.startsWith('/en/') ? './en/index.html' : './index.html'))));
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
