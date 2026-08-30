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

  // ---------- Conducteurs (§28) ----------

  function isMatriculeTaken(matricule, excludeDriverId) {
    return state.drivers.some(d => d.matricule === matricule && d.id !== excludeDriverId);
  }

  function addDriver(input) {
    const team = state.teams.find(t => t.id === input.teamId);
    const driver = {
      id: input.teamId + "_" + input.matricule,
      matricule: input.matricule,
      nom: input.nom,
      prenom: input.prenom,
      teamId: input.teamId,
      initialShift: team ? team.shiftCycle[0] : null,
      initialZone: input.initialZone || state.config.zones[0],
      initialVacation: input.initialVacation || "V1",
      statut: "PRESENT",
      dateEntree: input.dateEntree || RTGDate.toISO(new Date()),
      dateSortie: null,
      observation: input.observation || "",
      actif: true
    };
    set(s => Object.assign({}, s, { drivers: [...s.drivers, driver] }));
    addAuditEntry({ driverId: driver.id, matricule: driver.matricule, action: "Création conducteur", details: driver.nom + " " + driver.prenom + " — " + (team ? team.nom : driver.teamId) });
    return driver;
  }

  function updateDriver(driverId, patch) {
    let before = null;
    set(s => {
      before = s.drivers.find(d => d.id === driverId);
      return Object.assign({}, s, { drivers: s.drivers.map(d => d.id === driverId ? Object.assign({}, d, patch) : d) });
    });
    if (before) {
      addAuditEntry({ driverId: driverId, matricule: before.matricule, action: "Modification conducteur", details: Object.keys(patch).map(k => k + ": " + before[k] + " → " + patch[k]).join(", ") });
    }
  }

  function setDriverActive(driverId, actif) {
    updateDriver(driverId, { actif: actif, dateSortie: actif ? null : RTGDate.toISO(new Date()) });
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: actif ? "Réactivation conducteur" : "Désactivation conducteur", details: "" });
  }

  // ---------- Congés / Maladies / Absences (§13-15) — API générique ----------

  function addRecord(listKey, input, auditAction) {
    const record = Object.assign({
      id: listKey + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      createdAt: new Date().toISOString(),
      utilisateur: "Responsable Exploitation"
    }, input);
    set(s => Object.assign({}, s, { [listKey]: [...s[listKey], record] }));
    const d = state.drivers.find(dr => dr.id === input.driverId);
    addAuditEntry({ driverId: input.driverId, matricule: d ? d.matricule : "", action: auditAction, details: input.dateDebut + " → " + input.dateFin + (input.commentaire ? " (" + input.commentaire + ")" : "") });
    return record;
  }

  function updateRecord(listKey, id, patch, auditAction) {
    set(s => Object.assign({}, s, { [listKey]: s[listKey].map(r => r.id === id ? Object.assign({}, r, patch) : r) }));
    const r = state[listKey].find(rec => rec.id === id);
    if (r) {
      const d = state.drivers.find(dr => dr.id === r.driverId);
      addAuditEntry({ driverId: r.driverId, matricule: d ? d.matricule : "", action: auditAction, details: "" });
    }
  }

  function deleteRecord(listKey, id, auditAction) {
    const r = state[listKey].find(rec => rec.id === id);
    set(s => Object.assign({}, s, { [listKey]: s[listKey].filter(rec => rec.id !== id) }));
    if (r) {
      const d = state.drivers.find(dr => dr.id === r.driverId);
      addAuditEntry({ driverId: r.driverId, matricule: d ? d.matricule : "", action: auditAction, details: r.dateDebut + " → " + r.dateFin });
    }
  }

  function addConge(input) { return addRecord("conges", input, "Ajout congé"); }
  function updateConge(id, patch) { return updateRecord("conges", id, patch, "Modification congé"); }
  function deleteConge(id) { return deleteRecord("conges", id, "Suppression congé"); }

  function addMaladie(input) { return addRecord("maladies", input, "Ajout maladie"); }
  function updateMaladie(id, patch) { return updateRecord("maladies", id, patch, "Modification maladie"); }
  function deleteMaladie(id) { return deleteRecord("maladies", id, "Suppression maladie"); }

  function addAbsence(input) { return addRecord("absences", input, input.type === "FORMATION" ? "Ajout formation" : "Ajout absence"); }
  function updateAbsence(id, patch) { return updateRecord("absences", id, patch, "Modification absence/formation"); }
  function deleteAbsence(id) { return deleteRecord("absences", id, "Suppression absence/formation"); }

  // ---------- Affectations manuelles / remplacement (§26-27) ----------

  function setManualOverride(isoDate, driverId, override, auditAction, auditDetails) {
    const key = isoDate + "_" + driverId;
    set(s => Object.assign({}, s, {
      manualOverrides: Object.assign({}, s.manualOverrides, {
        [key]: Object.assign({}, override, { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      })
    }));
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: auditAction || "Modification affectation", details: isoDate + (auditDetails ? " — " + auditDetails : "") });
  }

  return {
    get, set, subscribe, addAuditEntry, resetToSeed,
    isMatriculeTaken, addDriver, updateDriver, setDriverActive,
    addConge, updateConge, deleteConge,
    addMaladie, updateMaladie, deleteMaladie,
    addAbsence, updateAbsence, deleteAbsence,
    setManualOverride
  };
})();
