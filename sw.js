// 자세 인식 모델·실행 파일만 기기에 저장해 두 번째부터 바로 시작 (앱 코드는 항상 새로 받음).
// 주소에 버전이 들어 있어 내용이 바뀌지 않는 파일만 저장한다.
const CACHE = 'formcheck-model-v1';
const KEEP = [/cdn\.jsdelivr\.net\/npm\/@mediapipe\/tasks-vision@[\d.]+\//, /storage\.googleapis\.com\/mediapipe-models\//];
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET' || !KEEP.some((r) => r.test(url))) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(url);
    if (hit) return hit;
    const res = await fetch(e.request);
    if (res.ok) c.put(url, res.clone());
    return res;
  }));
});
