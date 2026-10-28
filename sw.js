const CACHE = "zamer-v33";
const FILES = ["./", "./index.html", "./app.js", "./pdf.js", "./config.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./icon-512-mask.png", "./form_p1.jpg", "./scheme_A.png", "./scheme_B.png"];
self.addEventListener("install", e => {
  // config.js может отсутствовать: не даём одной ошибке сломать установку
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Сначала сеть (всегда свежая версия), без сети берём из кэша
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || !r.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(r, { cache: "no-cache" }).then(res => {
    if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match("./index.html"))));
});
