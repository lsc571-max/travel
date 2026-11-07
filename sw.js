// 앱 화면 파일을 저장해 두었다가, 인터넷이 약할 때도 앱이 열리게 합니다.
// 번역 서버 요청은 저장하지 않습니다.
const CACHE = 'travel-interpreter-claude-L3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 새 버전을 먼저 받아 보고, 안 되면 저장해 둔 화면을 씁니다.
  e.respondWith(
    // L3: 휴대폰·브라우저에 남은 옛 파일(최대 10분)을 쓰지 않고 항상 서버에 새 버전이 있는지 확인
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
