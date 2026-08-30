// ==========================================
// RTG DRIVER PLANNER — Store (persistance localStorage)
// Le projet n'a pas de backend : ce module est la seule source de vérité
// pour les données RTG (conducteurs, équipes, congés, maladies, historique,
// modifications manuelles). Il expose une API get/set/subscribe simple afin
// de pouvoir être remplacé plus tard par un vrai backend sans changer les
// moteurs métier ni les pages qui consomment RTGStore.get().
// ==========================================

const RTG_STORAGE_KEY = "rtg_planner_data_v1";

function rtgCloneSeed() {
  return JSON.parse(JSON.stringify(RTG_SEED));
}

function rtgLoadInitialState() {
  try {
    const raw = localStorage.getItem(RTG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Complète les clés manquantes si le seed a évolué depuis la dernière visite.
      const seed = rtgCloneSeed();
      return Object.assign(seed, parsed);
    }
  } catch (e) {
    console.warn("RTGStore: lecture localStorage impossible, réinitialisation.", e);
  }
  const seeded = rtgCloneSeed();
  rtgPersist(seeded);
  return seeded;
}

function rtgPersist(state) {
  try {
    localStorage.setItem(RTG_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("RTGStore: écriture localStorage impossible.", e);
  }
}

const RTGStore = (function () {
  let state = rtgLoadInitialState();
  let listeners = [];

  function get() {
    return state;
  }

  function set(updater) {
    state = typeof updater === "function" ? updater(state) : updater;
    rtgPersist(state);
    listeners.slice().forEach(fn => fn(state));
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(f => f !== fn);
    };
  }

  function addAuditEntry(entry) {
    set(s => Object.assign({}, s, {
      auditLog: [Object.assign({
        id: "audit_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
        date: new Date().toISOString(),
        utilisateur: "Responsable Exploitation"
      }, entry), ...s.auditLog]
    }));
  }

  function resetToSeed() {
    try { localStorage.removeItem(RTG_STORAGE_KEY); } catch (e) {}
    state = rtgLoadInitialState();
    listeners.slice().forEach(fn => fn(state));
  }

  return { get, set, subscribe, addAuditEntry, resetToSeed };
})();
