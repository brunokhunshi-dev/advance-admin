const CACHE_NAME = "advance-admin-v15";
const APP_SHELL = [
    "./",
    "./index.html",
    "./dashboard.html",
    "./visits.html",
    "./clients.html",
    "./team.html",
    "./styles.css",
    "./core.js",
    "./print-document.js",
    "./login.js",
    "./dashboard.js",
    "./visits.js",
    "./clients.js",
    "./team.js",
    "./team-active-filter.js",
    "./firebase-config.js",
    "./manifest.json",
    "./midia/logo-advancecheck.svg"
];

self.addEventListener("install", event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
    );
    self.clients.claim();
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request, {
            cache: request.destination === "style" || request.destination === "script" ? "no-store" : "default"
        }).then(async response => {
            if (!response.ok) return response;

            if (url.pathname.endsWith("/team.js")) {
                const source = await response.text();
                const patched = source.includes('import "./team-active-filter.js";')
                    ? source
                    : source + '\nimport "./team-active-filter.js";\n';
                const transformed = new Response(patched, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: {"Content-Type": "text/javascript; charset=utf-8"}
                });
                const cacheResponse = transformed.clone();
                event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, cacheResponse)).catch(error => console.warn("[Advance Admin SW] cache:", error)));
                return transformed;
            }

            const cacheResponse = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, cacheResponse)).catch(error => console.warn("[Advance Admin SW] cache:", error)));
            return response;
        }).catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
    );
});
