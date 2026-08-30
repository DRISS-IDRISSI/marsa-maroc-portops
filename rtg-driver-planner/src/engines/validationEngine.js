// ==========================================
// RTG DRIVER PLANNER — Moteur de validation / détection de conflits (§25)
// Phase 1 : sous-ensemble de règles vérifiables sans historique inter-mois
// (shift 3 dimanche, affectation incomplète, nombre de repos). Les règles liées
// au remplacement / double affectation manuelle seront étendues en phase 2-3.
// ==========================================

const ValidationEngine = {
  validateMonth(days, state) {
    const anomalies = [];
    const reposCount = {};
    state.drivers.forEach(d => { reposCount[d.id] = 0; });

    days.forEach(day => {
      day.assignments.forEach(a => {
        if (a.status === "REPOS") {
          reposCount[a.driverId] = (reposCount[a.driverId] || 0) + 1;
        }

        if (a.status === "PRESENT") {
          if (!a.shift) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur sans shift", attendu: "Shift défini", trouve: "—" });
          if (!a.vacation) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur sans vacation", attendu: "V1 ou V2", trouve: "—" });
          if (!a.zone) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Affectation sans zone", attendu: "Zone A-H", trouve: "—" });
        }

        if (a.status === "OFF" && (a.shift || a.vacation || a.zone)) {
          anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Shift 3 affecté un dimanche (devrait être OFF)", attendu: "OFF sans affectation", trouve: [a.shift, a.vacation, a.zone].filter(Boolean).join("/") });
        }

        if (["CONGE", "MALADIE", "ABSENCE", "FORMATION"].indexOf(a.status) !== -1 && (a.shift || a.vacation || a.zone)) {
          anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur affecté pendant un(e) " + a.status.toLowerCase(), attendu: "Aucune affectation", trouve: [a.shift, a.vacation, a.zone].filter(Boolean).join("/") });
        }
      });
    });

    if (days.length > 0) {
      const first = RTGDate.parseISO(days[0].iso);
      const month = first.getUTCMonth() + 1;
      const year = first.getUTCFullYear();
      state.drivers.filter(d => d.actif !== false).forEach(d => {
        const c = reposCount[d.id] || 0;
        const congeDays = RestDayEngine.countCongeDaysInMonth(d, month, year, state);
        const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
        const attendu = Math.max(0, state.config.reposMensuel - reduction);
        if (c !== attendu) {
          anomalies.push({ date: "—", driverId: d.id, matricule: d.matricule, nom: d.nom, prenom: d.prenom, type: "Nombre de repos différent du quota attendu", attendu: attendu, trouve: c });
        }
      });
    }

    return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
  }
};
