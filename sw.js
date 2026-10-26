// Działanie bez internetu: pliki aplikacji trzymane w pamięci podręcznej.
// Przy każdej nowej wersji zmień VERSION, żeby telefon pobrał nowe pliki.
const VERSION = "1.3.0";
const CACHE = `budzet-${VERSION}`;
const FILES = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/app.js", "js/db.js", "js/importer.js", "js/categorizer.js", "js/format.js", "js/store.js",
  "vendor/sql-wasm.js", "vendor/sql-wasm.wasm",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
