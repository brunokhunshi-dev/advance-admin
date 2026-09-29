const CACHE_NAME = "advance-admin-v4";
const APP_SHELL = [
    "./",
    "./index.html",
    "./dashboard.html",
    "./visits.html",
    "./clients.html",
    "./team.html",
    "./reports.html",
    "./styles.css",
    "./core.js",
    "./login.js",
    "./dashboard.js",
    "./visits.js",
    "./clients.js",
    "./team.js",
    "./reports.js",
    "./firebase-config.js",
    "./manifest.json",
    "./midia/logo-advancecheck.svg"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request).then(response => {
            if (!response.ok) return response;
            const cacheResponse = response.clone();

            event.waitUntil(
                caches.open(CACHE_NAME)
                    .then(cache => cache.put(request, cacheResponse))
                    .catch(error => console.warn("[Advance Admin SW] cache:", error))
            );

            return response;
        }).catch(() =>
            caches.match(request).then(cached => cached || caches.match("./index.html"))
        )
    );
});
