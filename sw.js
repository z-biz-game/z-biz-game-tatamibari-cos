// 离线缓存：**网络优先，失败才退回缓存**（same-origin 的每一个子资源）。
//
// 为什么不是"缓存优先"：这一份代码是发到 GitHub Pages 上的，缓存优先意味着我改一个 bug
// 之后玩家要等到 SW 缓存过期才看得到——对一个还在修的产品，那等于"更新了但没更新"。
// 所以每条请求都先出网，拿到响应就顺手刷新缓存；只有**真失败**（离线、断网、超时）
// 才把上一次成功存下的那份交出去。这是行为，不是注释：
//   · 命中网络 ⇒ put 进 CACHE_ASSETS（下一次离线才有东西可退）；
//   · 网络抛错 ⇒ caches.match；还没有缓存就照实让请求失败（不返回假页面）。
//
// 缓存名带版本：CACHE_VERSION 一变，activate 阶段就把旧版本的缓存全删掉，
// 于是磁盘上不会堆着几份再也没人读的旧代码。
//
// file:// 下这个文件根本不会被注册（见 js/main.js::registerServiceWorker 那条协议判断），
// 所以这里不需要再为它写第二套分支。

const CACHE_VERSION = 'tatamibari-v2';
const CACHE_ASSETS = `${CACHE_VERSION}-assets`;
const CACHE_PAGE = `${CACHE_VERSION}-page`;

// 这一份清单是**盘上真实存在的文件**：漏一个就是离线时少一个模块（JS 是 ES module，
// 少一个 import 目标整页白屏）。tools/ 与 electron/ 不进缓存：它们不是页面运行期要取的。
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/game.css',
  './js/main.js',
  './js/audio.js',
  './js/store.js',
  './js/engine/counter.js',
  './js/engine/generate.js',
  './js/engine/pencil.js',
  './js/engine/rules.js',
  './js/engine/tiling.js',
  './js/engine/validate.js',
  './js/render/board.js',
  './js/render/fx.js',
  './js/ui/game.js',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './assets/og-cover.png',
  './assets/sprites/dust-burst.png',
  './assets/textures/tatami-weave.png',
  './assets/textures/tatami-weave-light.png',
  './assets/ui/sound-on.png',
  './assets/ui/sound-off.png',
  './assets/ui/fullscreen.png',
  './assets/ui/pause.png',
  './assets/ui/resume.png',
  './assets/ui/restart.png',
  './assets/ui/motion.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_ASSETS);
    // 逐个 add：一条 404 不该让整次安装失败（清单漂了要能在 console 里看见具体哪条，而不是"装不上"）
    const results = await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn(`[sw] 预缓存没拿到的路径（清单与磁盘漂了？）：${failed.join(' ')}`);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // 只管同源：第三方（字体、统计）走缓存就是把别人的内容冻结在我这边。
  if (url.origin !== self.location.origin) return;
  // 带 query/hash 的请求（?daily=1 这类）不当导航处理，但照样走"网络优先"这条路。
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_PAGE);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        const hit = (await caches.match('./index.html')) || (await caches.match(req));
        // 离线且缓存里也没有：宁可 rejected，也不返回一张假页面骗过判据
        if (!hit) throw new Error('offline and no cached shell');
        return hit;
      }
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type !== 'opaque') {
        const cache = await caches.open(CACHE_ASSETS);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      const hit = await caches.match(req);
      if (!hit) throw new Error(`offline and nothing cached for ${url.pathname}`);
      return hit;
    }
  })());
});
