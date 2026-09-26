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
    const correctedReposCount = {};
    // Un conducteur ayant AU MOINS un repos manuel ce mois-ci (case par case
    // ou import Excel du planning réel) voit tout le contrôle de quota
    // désactivé pour lui : contrairement au repos d'équilibrage V1/V2
    // (a.restCorrection, un bonus PONCTUEL au-dessus du quota normal, où
    // soustraire juste ce jour-là du décompte reste pertinent), un import
    // remplace la formule théorique par la réalité du terrain pour tout le
    // mois — soustraire seulement les jours manuels du décompte comparerait
    // le RESTE (repos auto uniquement) au quota complet, créant une fausse
    // anomalie dès qu'une bonne partie des repos réels vient de l'import.
    const hasManualRepos = {};
    state.drivers.forEach(d => { reposCount[d.id] = 0; correctedReposCount[d.id] = 0; });

    // Équipe "stagiaires" (ex. GR STAGIAIRE) : shift/vacation/zone n'y sont
    // JAMAIS calculés automatiquement (chaque stagiaire est affecté
    // manuellement, au jour le jour, au shift d'une équipe titulaire à
    // renforcer — cf. ccPosteRotationEngine.js, même détection à double
    // critère) — une affectation sans zone y est donc normale, pas une
    // anomalie à signaler tant qu'aucune saisie manuelle n'a été faite.
    const noRotationDriverIds = new Set();
    // Libellé de zone attendu, spécifique à la flotte du conducteur (les
    // zones RTG sont des lettres A-H, les postes CC sont P71/P72.../DTV/PARC
    // — voir zonesForFleet, data.js) : jamais "Zone A-H" pour un conducteur CC.
    const zoneLabelByDriverId = {};
    const ccDriverIds = new Set();
    state.drivers.forEach(d => {
      const team = state.teams.find(t => t.id === d.teamId);
      if (team && ((!team.shiftCycle || team.shiftCycle.length === 0) || /stagiaire/i.test(team.nom || ""))) {
        noRotationDriverIds.add(d.id);
      }
      const fleet = (team && team.typeEngin) || "RTG";
      if (fleet === "CC") ccDriverIds.add(d.id);
      const zones = zonesForFleet(state.config, fleet);
      zoneLabelByDriverId[d.id] = fleet === "RTG" ? `Zone ${zones[0]}-${zones[zones.length - 1]}` : "Poste QUAI ou PARC";
    });
    // "Jour de départ" CC (config.ccRotationReferenceDate) : avant cette
    // date, CcPosteRotationEngine ne calcule plus AUCUNE zone (demande
    // explicite de l'exploitant — ignorer tout avant ce point de départ),
    // donc une affectation CC sans zone y est normale, pas une anomalie.
    const ccRefDateIso = state.config.ccRotationReferenceDate || state.config.rotationReferenceDate;
    // Au-delà d'aujourd'hui, le poste QUAI/PARC CC est volontairement laissé
    // vide tant que le responsable de shift ne l'a pas saisi (voir
    // PlanningEngine.generateDailyAssignments) — ce n'est donc pas non plus
    // une anomalie à signaler.
    const todayIso = RTGDate.toISO(new Date());

    days.forEach(day => {
      day.assignments.forEach(a => {
        if (a.status === "REPOS") {
          reposCount[a.driverId] = (reposCount[a.driverId] || 0) + 1;
          if (a.restCorrection) correctedReposCount[a.driverId] = (correctedReposCount[a.driverId] || 0) + 1;
          if (a.source === "MANUAL") hasManualRepos[a.driverId] = true;
        }

        if (a.status === "PRESENT" && !noRotationDriverIds.has(a.driverId)) {
          if (!a.shift) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur sans shift", attendu: "Shift défini", trouve: "—" });
          if (!a.vacation) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur sans vacation", attendu: "V1 ou V2", trouve: "—" });
          const beforeCcJourDeDepart = ccDriverIds.has(a.driverId) && day.iso < ccRefDateIso;
          const ccZonePendingFuture = ccDriverIds.has(a.driverId) && day.iso > todayIso;
          if (!a.zone && !beforeCcJourDeDepart && !ccZonePendingFuture) anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Affectation sans zone", attendu: zoneLabelByDriverId[a.driverId] || "Zone définie", trouve: "—" });
        }

        if (a.status === "OFF" && (a.shift || a.vacation || a.zone)) {
          anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Shift 3 affecté un dimanche (devrait être OFF)", attendu: "OFF sans affectation", trouve: [a.shift, a.vacation, a.zone].filter(Boolean).join("/") });
        }

        if (a.status === "FERIE" && (a.shift || a.vacation || a.zone)) {
          anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur affecté un jour férié (devrait être chômé)", attendu: "Aucune affectation", trouve: [a.shift, a.vacation, a.zone].filter(Boolean).join("/") });
        }

        if (["CONGE", "MALADIE", "ABSENCE", "FORMATION", "DETACHEMENT"].indexOf(a.status) !== -1 && (a.shift || a.vacation || a.zone)) {
          anomalies.push({ date: day.iso, driverId: a.driverId, matricule: a.matricule, nom: a.nom, prenom: a.prenom, type: "Conducteur affecté pendant un(e) " + a.status.toLowerCase(), attendu: "Aucune affectation", trouve: [a.shift, a.vacation, a.zone].filter(Boolean).join("/") });
        }
      });
    });

    if (days.length > 0) {
      const first = RTGDate.parseISO(days[0].iso);
      const month = first.getUTCMonth() + 1;
      const year = first.getUTCFullYear();
      state.drivers.filter(d => d.actif !== false).forEach(d => {
        if (hasManualRepos[d.id]) return;
        const c = (reposCount[d.id] || 0) - (correctedReposCount[d.id] || 0);
        const absenceDays = RestDayEngine.countCongeDaysInMonth(d, month, year, state);
        const reduction = Math.floor(absenceDays / (state.config.reposReductionParJoursCongé || 5));
        const attendu = Math.max(0, state.config.reposMensuel - reduction);
        if (c !== attendu) {
          anomalies.push({ date: "—", driverId: d.id, matricule: d.matricule, nom: d.nom, prenom: d.prenom, type: "Nombre de repos différent du quota attendu", attendu: attendu, trouve: c });
        }
      });
    }

    return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
  }
};
