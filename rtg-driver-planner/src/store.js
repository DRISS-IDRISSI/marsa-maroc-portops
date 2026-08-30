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
      const seed = rtgCloneSeed();
      if (parsed.dataVersion !== seed.dataVersion) {
        // Le roster/la référence a changé depuis la dernière visite (nouvelle liste de
        // conducteurs, matricules corrigés...) : les anciennes données en cache ne
        // correspondent plus (elles référencent d'anciens IDs de conducteurs), donc on
        // repart du nouveau seed plutôt que de les fusionner.
        rtgPersist(seed);
        return seed;
      }
      // Même version : on fusionne pour ne pas perdre les modifications manuelles de
      // l'utilisateur (congés/repos édités, etc.) tout en complétant les clés que le
      // seed aurait pu ajouter depuis.
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
