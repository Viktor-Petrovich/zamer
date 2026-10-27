const CACHE = "zamer-v5";
const FILES = ["./", "./index.html", "./app.js", "./pdf.js", "./config.js", "./icon-512-mask.png", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./form_p1.jpg", "./scheme_A.png", "./scheme_B.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
