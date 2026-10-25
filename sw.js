// Service Worker：缓存整个 App 壳，离线可用。
// 策略：
//   - training-plan.json：网络优先（改了 overrides 当次打开就生效），离线再用缓存。
//   - 其他同源 GET：先用缓存响应，同时后台取新版本更新缓存（stale-while-revalidate），
//     这样离线能打开，联网时下一次打开自动拿到新代码。
// 缓存 key 一律去掉 query / hash，避免 ?date= 之类的测试参数污染缓存。
const CACHE = 'workout-shell-v24';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './schedule.js',
  './dom.js',
  './workout.js',
  './train-view.js',
  './db.js',
  './history.js',
  './history-view.js',
  './progression.js',
  './activity.js',
  './activity-view.js',
  './plan-store.js',
  './plan-edit.js',
  './plan-view.js',
  './units.js',
  './settings.js',
  './device.js',
  './backup.js',
  './settings-view.js',
  './training-plan.json',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' 绕过浏览器 HTTP 缓存，保证新版本壳文件是真的从服务器拿的
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  url.search = '';
  url.hash = '';
  const key = url.href;

  if (url.pathname.endsWith('/training-plan.json')) {
    event.respondWith(networkFirst(req, key));
  } else {
    event.respondWith(staleWhileRevalidate(event, req, key));
  }
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(key);
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(event, req, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key);
  const network = fetch(req, { cache: 'no-cache' })
    .then(async (res) => {
      if (res && res.ok) await cache.put(key, res.clone());
      return res;
    })
    .catch(() => undefined);
  // 已经用缓存响应后，后台更新期间不让浏览器提前杀掉 SW
  event.waitUntil(network);
  if (cached) return cached;
  const res = await network;
  if (res) return res;
  if (req.mode === 'navigate') return cache.match(new URL('./index.html', self.location.href).href);
  return Response.error();
}
