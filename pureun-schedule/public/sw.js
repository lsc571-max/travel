// 푸른 교수 일정관리 서비스워커 — 앱 화면만 저장한다. Google 로그인·캘린더 요청은 절대 저장하지 않는다.
const VERSION = 'V1';
const CACHE = `pureun-schedule-${VERSION}`;
const SHELL = ['./', './index.html', './theme.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pureun-schedule-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // 외부(구글) 요청은 관여하지 않음
  if (url.pathname.endsWith('/version.json')) return; // 최신 버전 확인은 항상 네트워크
  if (req.mode === 'navigate') {
    // 화면: 네트워크 우선, 오프라인이면 저장본
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }
  // 정적 파일(이름에 해시 포함): 저장본 우선
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
