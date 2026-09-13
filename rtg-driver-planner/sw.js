// ==========================================
// RTG DRIVER PLANNER — Service worker (PWA)
// Pré-cache le "app shell" (fichiers propres à l'appli, même origine) à
// l'installation, puis pour CHAQUE requête : tente le RÉSEAU en premier
// (pour toujours servir le code déployé le plus récent) et ne se rabat sur
// le cache qu'en cas d'échec réseau (utilisation hors-ligne).
//
// IMPORTANT (corrige un bug de perte de données) : la version précédente
// servait TOUJOURS le cache en premier ("stale-while-revalidate"), donc un
// navigateur resté sur une ancienne version de l'app pouvait continuer à
// tourner indéfiniment avec un ancien src/data.js. Si son dataVersion ne
// correspondait plus à celui écrit dans localStorage par une version plus
// récente (ou vice-versa selon l'onglet/l'appareil), RTGStore réinitialisait
// TOUTES les données locales (congés, utilisateurs créés, etc.) au prochain
// chargement — voir rtgLoadInitialState() dans src/store.js. Servir le
// réseau en premier élimine ce risque : tant que l'utilisateur est en ligne,
// il exécute toujours le code (et donc le dataVersion) réellement déployé.
const CACHE_NAME = "rtg-planner-v2";

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/marsa-maroc-logo.png",
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
    fetch(event.request).then(response => {
      if (response && (response.ok || response.type === "opaque")) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
