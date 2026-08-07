/* =========================================================
   云团子 Service Worker
   ----------------------------------------------------------
   设计目标：
   - 离线可用：把核心外壳（HTML/CSS/JS/图标/manifest）预缓存，
     断网时也能打开。
   - 不碰外部 API：智谱等跨域请求一律放行，不缓存、不拦截
     （别人的接口不能瞎存，而且离线也没意义）。
   - 声音/大文件按需缓存：用户播过的白噪音会被存下来，下次离线也能听；
     没播过的不预先下载，避免首次打开很慢。
   - 缓存键用 pathname（忽略 ?v= 查询），发版时改 CACHE_NAME 即可整体换新。
   ========================================================= */

const CACHE_NAME = 'yztz-static-v15';
const RUNTIME_CACHE = 'yztz-runtime-v1';

/* 预缓存：应用外壳。这些是首次安装就要拿到的文件，体积都不大。
   注意路径都是相对根（/），Cloudflare Pages 部署在根域名时直接可用。 */
const PRECACHE_URLS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'favicon-32.png',
];

/* 把请求归一成缓存键：只保留同源 pathname，去掉 ?v=xxx 这类查询。
   这样 style.css?v=24 和 style.css?v=25 在缓存里是同一个 key，
   配合发版时改 CACHE_NAME 就能干净地整体替换。 */
function cacheKeyFor(request) {
  const u = new URL(request.url);
  // 只接管同源请求；跨域的直接返回完整 url 让上层跳过
  if (u.origin !== self.location.origin) return null;
  return u.pathname;
}

/* ---------- 安装：预缓存外壳 ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 用 addAll：任一失败会让整个安装失败，所以这里都是必须的核心文件
    await cache.addAll(PRECACHE_URLS);
    // 装好就立刻接管，不用等老 SW 释放
    await self.skipWaiting();
  })());
});

/* ---------- 激活：清掉旧缓存，立刻控制客户端 ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    // 切到新 SW 后立刻接管所有页面，避免用户还要刷新两次
    await self.clients.claim();
    // 通知所有页面：新版本已就绪，刷新一次就能拿到最新内容
    const allClients = await self.clients.matchAll({ type: 'window' });
    allClients.forEach(c => c.postMessage('reload-for-update'));
  })());
});

/* ---------- 请求拦截 ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理 GET。POST（比如将来发留言）不缓存。
  if (req.method !== 'GET') return;

  const key = cacheKeyFor(req);
  // 跨域请求（智谱 API、外部音乐链接等）直接放行，交给浏览器
  if (!key) return;

  // 导航请求（打开页面）：网络优先，拿不到就用缓存的 index.html 兜底
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        // 用归一 key 存一份，离线时能顶上
        cache.put(key, fresh.clone()).catch(() => {});
        return fresh;
      } catch (e) {
        const cached = await caches.match(key) || await caches.match('index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // 静态资源（CSS/JS/图标/声音）：网络优先，每次都拿最新版，拿不到才用缓存兜底
  // 这样发版后用户刷新一次就能看到新内容，不用手动清 Service Worker
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      // 拿到新版就更新缓存
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        cache.put(key, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (e) {
      // 离线兜底：用缓存
      const cached = await caches.match(key);
      if (cached) return cached;
      return Response.error();
    }
  })());
});

/* ---------- 收到“有新版本”消息时主动更新 ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
