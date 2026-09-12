// ==========================================
// RTG DRIVER PLANNER — Service worker (PWA)
// Pré-cache le "app shell" (fichiers propres à l'appli, même origine) à
// l'installation, puis pour CHAQUE requête : sert le cache immédiatement si
// disponible (affichage instantané) tout en revalidant en arrière-plan, et
// se rabat sur le cache si le réseau échoue (utilisation hors-ligne, y
// compris pour les bibliothèques CDN mises en cache au premier chargement).
// ==========================================

const CACHE_NAME = "rtg-planner-v1";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "src/data.js",
  "src/store.js",
  "src/engines/dateUtils.js",
  "src/engines/shiftRotationEngine.js",
  "src/engines/absenceEngine.js",
  "src/engines/exceptionEngine.js",
  "src/engines/restDayEngine.js",
  "src/engines/vacationRotationEngine.js",
  "src/engines/zoneRotationEngine.js",
  "src/engines/zoneBalancingEngine.js",
  "src/engines/planningEngine.js",
  "src/engines/validationEngine.js",
  "src/engines/replacementEngine.js",
  "src/engines/holidayEngine.js",
  "src/components.js",
  "src/pages.js",
  "src/pages2.js",
  "src/app.js"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
