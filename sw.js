const CACHE_NAME = "advance-admin-v1";
const APP_SHELL = ["./","./index.html","./styles.css","./app.js","./firebase-config.js","./manifest.json","./midia/logo-advancecheck.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
    if (e.request.method !== "GET") return;
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;
    e.respondWith(fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, r.clone()));
        return r;
    }).catch(() => caches.match(e.request).then(c => c || caches.match("./index.html"))));
});
