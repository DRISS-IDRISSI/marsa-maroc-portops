// ==========================================
// RTG DRIVER PLANNER — Moteur de planification (§19-22)
// Orchestre les autres moteurs : statut du jour, affectation journalière,
// génération du planning mensuel complet.
// ==========================================

const FIXED_ABSENCE_STATUSES = ["CONGE", "MALADIE", "ABSENCE", "FORMATION", "DETACHEMENT"];

const PlanningEngine = {
  // Statut d'un conducteur à une date donnée, AVANT toute modification manuelle.
  // Ordre de priorité : congé/maladie/absence/formation figés > jour férié (chômé
  // pour tous, SAUF pour ce conducteur s'il a un enregistrement "jour férié
  // travaillé" — §29) > OFF shift3 dimanche (idem, sauf "3ème shift dimanche") >
  // repos généré > présent. Un jour férié/dimanche-S3 travaillé ne peut jamais
  // coïncider avec un repos généré (RestDayEngine exclut déjà ces jours-là des
  // candidats de repos, pour tout le monde), donc pas de conflit de priorité
  // possible entre ce cas et le repos.
  getDailyStatus(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);

    const fixed = AbsenceEngine.getFixedStatus(driver, iso, state);
    if (fixed) return fixed;

    const team = teams.find(t => t.id === driver.teamId);
    if (!team) return "ABSENCE";

    const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);

    const holiday = HolidayEngine.getEffectiveHoliday(date, team, state.config);
    const holidayWorked = holiday && ExceptionEngine.hasWorked(state, driver.id, iso, "FERIE_TRAVAILLE");
    if (holiday && !holidayWorked) return "FERIE";

    const sundayS3Off = state.config.offShift3Dimanche && shift === "S3" && RTGDate.isSunday(date);
    const sundayWorked = sundayS3Off && ExceptionEngine.hasWorked(state, driver.id, iso, "DIMANCHE_S3");
    if (sundayS3Off && !sundayWorked) return "OFF";

    if (holidayWorked || sundayWorked) return "PRESENT";

    const restDays = RestDayEngine.getRestDaysForMonth(driver, date.getUTCMonth() + 1, date.getUTCFullYear(), state, teams);
    if (restDays.indexOf(date.getUTCDate()) !== -1) return "REPOS";

    return "PRESENT";
  },

  generateDailyAssignments(isoDate, state) {
    const date = RTGDate.parseISO(isoDate);
    const teams = state.teams;
    // Flotte CC : au-delà d'aujourd'hui, le poste QUAI/PARC n'est jamais
    // affiché tant que le responsable de shift ne l'a pas saisi lui-même sur
    // le terrain (demande explicite de l'exploitant, §"L'AFFECTATION DE
    // DEMAIN, LES ZONES DOIVENT ETRE VIDE") — CcPosteRotationEngine continue
    // de gérer la rotation (vacation/ordre de passage) jour après jour, seul
    // le champ zone affiché est effacé plus bas si aucune saisie manuelle
    // n'existe pour ce jour-là.
    const todayIso = RTGDate.toISO(new Date());

    // Passe 1 : statut + shift/vacation/zone "naturels" (rotation individuelle),
    // avant toute affectation manuelle. Le rééquilibrage V1/V2 (Shift 1 et
    // Shift 3 — règle métier : les deux vacations doivent être égales, ou à
    // défaut l'une ne dépasse l'autre que d'UN SEUL conducteur, toléré et
    // signalé) est calculé UNE FOIS pour tout le mois dans RestDayEngine (voir
    // son en-tête) plutôt que jour par jour ici, pour que les décisions restent
    // cohérentes sur tout le mois (repos exceptionnels jamais dupliqués pour un
    // même conducteur, jamais 2 jours consécutifs) — ici on ne fait QUE lire ce
    // résultat déjà calculé.
    const month = date.getUTCMonth() + 1, year = date.getUTCFullYear(), dom = date.getUTCDate();
    const base = state.drivers.filter(d => d.actif !== false).map(driver => {
      const team = teams.find(t => t.id === driver.teamId);
      const status = this.getDailyStatus(driver, date, state, teams);

      let shift = null, vacation = null, zone = null, startTime = null, endTime = null;
      let vacationBalanceAlert = false, restCorrection = null;
      // Équipe "stagiaires" (pas de rotation fixe, cf. isNoRotationTeam
      // pages2.js / CcPosteRotationEngine._ccDrivers, même détection à
      // double critère) : shift/vacation/zone ne sont JAMAIS calculés
      // automatiquement pour eux — ils travaillent la journée complète et
      // sont affectés au jour le jour, au shift qui a besoin de renfort,
      // selon le terrain (jamais une rotation individuelle fictive). Seule
      // une correction manuelle (ou un import du planning réel) renseigne
      // ces valeurs — voir AssignmentEditModal (sélecteur de shift dédié).
      const isNoRotationTeam = team && ((!team.shiftCycle || team.shiftCycle.length === 0) || /stagiaire|\bcdi\b/i.test(team.nom || ""));
      const fleet = (team && team.typeEngin) || "RTG";
      const hasVacation = fleetHasVacation(fleet);
      if (status === "PRESENT" && team && !isNoRotationTeam) {
        shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        zone = ZoneRotationEngine.getZoneForDate(driver, date, state, teams);
        if (hasVacation) {
          vacation = VacationRotationEngine.getVacationForDate(driver, date, state, team);
          const vacDefs = state.config.vacations[shift] || [];
          const vacDef = vacDefs.find(v => v.id === vacation);
          if (vacDef) { startTime = vacDef.start; endTime = vacDef.end; }
          if (shift === "S1" || shift === "S3") {
            vacationBalanceAlert = RestDayEngine.hasVacationBalanceAlert(driver, month, year, state, teams, dom);
          }
        } else {
          // Pas de vacation (CER) : même convention "V1+V2" (journée
          // complète) que les stagiaires, pour que ces affectations restent
          // regroupées correctement sur Affectation du jour (bloc V1+V2 à
          // part, pages.js) au lieu de disparaître silencieusement (elles ne
          // correspondraient à aucune vacation V1/V2 de 4h).
          vacation = "V1+V2";
          const shiftDef = (state.config.shifts || []).find(s => s.id === shift);
          if (shiftDef) { startTime = shiftDef.start; endTime = shiftDef.end; }
        }
      } else if (status === "REPOS") {
        restCorrection = RestDayEngine.isVacationBalanceCorrection(driver, month, year, state, teams, dom) ? "equilibrage_V1_V2" : null;
      }

      return { driver: driver, driverId: driver.id, team: team, status: status, shift: shift, vacation: vacation, zone: zone, startTime: startTime, endTime: endTime, vacationBalanceAlert: vacationBalanceAlert, restCorrection: restCorrection, isNoRotationTeam: isNoRotationTeam };
    });

    // Passe 2 : applique les affectations manuelles par-dessus le résultat auto —
    // SAUF si le statut de base est un enregistrement figé (congé/maladie/
    // absence/formation, via AbsenceEngine). Une affectation manuelle laissée
    // par un import antérieur (ex. import Excel) ne doit jamais masquer un
    // congé/maladie saisi après coup sur la même date : le figé gagne toujours.
    const results = base.map(b => {
      const driver = b.driver, team = b.team;
      let shift = b.shift, vacation = b.vacation, zone = b.zone, startTime = b.startTime, endTime = b.endTime;
      let source = "AUTO";
      let finalStatus = b.status;
      const isFixedAbsence = FIXED_ABSENCE_STATUSES.indexOf(b.status) !== -1;
      const override = isFixedAbsence ? null : state.manualOverrides[isoDate + "_" + driver.id];
      if (override) {
        if (override.shift !== undefined) shift = override.shift;
        if (override.vacation !== undefined) vacation = override.vacation;
        if (override.zone !== undefined) zone = override.zone;
        if (override.status !== undefined) finalStatus = override.status;
        if (override.startTime !== undefined) startTime = override.startTime;
        if (override.endTime !== undefined) endTime = override.endTime;
        source = "MANUAL";
      }

      // Flotte sans vacation (CER, § data.js fleetHasVacation) : toujours
      // "V1+V2" pour un conducteur PRESENT, quelle que soit la source
      // (auto OU affectation manuelle/import, ex. shift S1/S2 saisi pour un
      // CDI) — sans ce filet, une affectation manuelle qui ne renseigne pas
      // explicitement `vacation` (cas des imports shift-only) laisse ce
      // champ à null, et ce conducteur disparaît silencieusement du groupe
      // "Effectif"/V1+V2 (Affectation du jour, pages.js) qui ne reconnaît
      // que la valeur "V1+V2" — jamais null.
      if (finalStatus === "PRESENT" && team && !fleetHasVacation(team.typeEngin || "RTG")) {
        vacation = "V1+V2";
      }

      // Filet équivalent pour le SHIFT d'un titulaire (équipe à rotation
      // réelle, pas isNoRotationTeam) : b.shift n'est calculé en Passe 1 que
      // si le statut NATUREL (avant correction) était déjà PRESENT ce
      // jour-là (cf. plus haut). Une correction manuelle qui repasse un
      // conducteur en repos naturel à PRESENT sans préciser elle-même le
      // shift (cas vécu : migration_029_cer_affectation_28_09.sql) laissait
      // donc `shift` à null — ce conducteur ne correspondait alors plus à
      // aucun onglet Shift 1/2/3 sur Affectation du jour et disparaissait
      // silencieusement de tous. On retombe ici sur le shift normal de son
      // équipe ce jour-là (même calcul que la Passe 1, juste non conditionné
      // au statut naturel).
      if (finalStatus === "PRESENT" && !shift && team && !b.isNoRotationTeam) {
        shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
      }

      // Un import Excel en masse (RTG_IMPORT_OVERRIDE_MOTIF) a pu figer une
      // zone CC générique (parfois reprise du mauvais modèle de postes,
      // constaté sur GR BAHOUS/GR HOUSSAM), jamais réévaluée depuis — ce
      // n'est jamais une "réalité" à afficher telle quelle pour la flotte CC,
      // quel que soit le jour (pas seulement les jours futurs) : on retombe
      // sur la valeur AUTO calculée par CcPosteRotationEngine (b.zone), qui
      // reflète désormais correctement les postes propres à chaque équipe et
      // la rotation réelle jour après jour (voir aussi ccPosteRotationEngine.js,
      // qui ignore ce même import pour calculer l'ordre de la file). Les
      // stagiaires/CDI (isNoRotationTeam) suivent la même règle même si leur
      // équipe n'a pas typeEngin="CC"/"CER" renseigné : ce sont toujours des
      // conducteurs à file d'attente (postes QUAI/PARC), jamais des zones RTG A-H.
      const isQueueBasedContext = !!(team && (team.typeEngin === "CC" || team.typeEngin === "CER" || b.isNoRotationTeam));
      const zoneFromImport = !!(override && override.zone !== undefined && override.motif === RTG_IMPORT_OVERRIDE_MOTIF);
      if (zoneFromImport && isQueueBasedContext) {
        zone = b.zone;
      }

      // Pour aujourd'hui ou un jour futur, seule une correction manuelle ad
      // hoc (via la case cliquable) compte comme "le responsable a renseigné
      // la zone" — la prédiction automatique du poste QUAI n'est jamais
      // affichée telle quelle, même le jour même : elle n'est qu'une
      // simulation interne servant à calculer l'ORDRE de la file (voir
      // ccPosteRotationEngine.js), jamais une décision à afficher tant que
      // le responsable ne l'a pas saisie lui-même sur le terrain (demande
      // explicite de l'exploitant après un cas observé où un poste
      // apparaissait déjà rempli le jour même sans qu'il l'ait saisi).
      // Plutôt qu'une case vide, le poste par défaut affiché est PARC — au
      // responsable de shift de le remplacer par le poste réel, jour après
      // jour. Seuls les jours PASSÉS (< aujourd'hui) gardent la valeur AUTO
      // telle quelle, comme registre historique déjà vérifié — mais cette
      // restriction ne vaut QUE pour une équipe avec une vraie rotation
      // automatique (b.zone y reflète un historique déjà simulé). Une équipe
      // stagiaire (isNoRotationTeam) n'a JAMAIS de zone automatique, à
      // aucune date (b.zone y est toujours null, cf. Passe 1) : sans ce
      // filet, une case vide/blanche apparaissait (au lieu de "PARC") dès
      // que la date de l'affectation (import ou jour même) tombait avant
      // "aujourd'hui" par calcul (ex. shift de nuit à cheval sur minuit) —
      // demande explicite de l'exploitant : "je veux que ça soit
      // automatique d'affecter les stagiaires au PARC par défaut".
      // CDI (CER) : dès que le responsable a renseigné une affectation
      // (shift + éventuellement zone) pour un jour, la file CDI (§
      // cerPosteRotationEngine.js, CerCdiRotationEngine) en tient compte
      // pour générer automatiquement la zone SUGGÉRÉE des jours suivants
      // (cycle MAERSK/MSC/COSCO) — demande explicite de l'exploitant :
      // "une fois le jour J renseigné, l'appli génère la rotation du jour
      // J+1 et ainsi de suite". Reste une SUGGESTION par défaut, jamais
      // figée : le responsable peut toujours la corriger manuellement (et
      // c'est le seul moyen d'envoyer un CDI au quai, en cas de sous-
      // effectif titulaires). Les stagiaires CC gardent le simple défaut
      // "PARC" (inchangé, pas de file de rotation pour eux).
      const isCerCdi = b.isNoRotationTeam && team && team.typeEngin === "CER";
      const zoneManuallySet = !!(override && override.zone !== undefined && !zoneFromImport);
      if (!zoneManuallySet && finalStatus === "PRESENT" && isQueueBasedContext && (b.isNoRotationTeam || isoDate >= todayIso)) {
        zone = isCerCdi ? (ZoneRotationEngine.getExpectedZoneForDate(driver, date, state, teams) || "PARC") : "PARC";
      }

      return {
        id: isoDate + "_" + driver.id,
        date: isoDate,
        driverId: driver.id,
        matricule: driver.matricule,
        nom: driver.nom,
        prenom: driver.prenom,
        teamId: driver.teamId,
        teamNom: team ? team.nom : "",
        shift: shift,
        vacation: vacation,
        startTime: startTime,
        endTime: endTime,
        zone: zone,
        status: finalStatus,
        source: source,
        vacationBalanceAlert: override ? false : !!b.vacationBalanceAlert,
        restCorrection: override ? null : (b.restCorrection || null),
        createdAt: override && override.createdAt ? override.createdAt : null,
        updatedAt: override && override.updatedAt ? override.updatedAt : null
      };
    });

    // Une fois les postes quai saisis à la main pour certains titulaires CER
    // ce jour-là, les autres restent au "PARC" générique — demande explicite
    // de l'exploitant : les répartir automatiquement sur MAERSK/MSC/COSCO en
    // cycle plutôt que de tout laisser à "PARC", PAR ÉQUIPE (chaque équipe
    // tourne indépendamment), dans l'ordre de la file de rotation
    // (CerPosteRotationEngine) pour que le cycle reste cohérent jour après
    // jour. Le poste quai lui-même reste une saisie manuelle, inchangée —
    // seul ce reliquat "PARC" est concerné, jamais une prédiction de poste
    // quai affichée automatiquement (règle explicite ci-dessus).
    const cerParcGroups = {};
    results.forEach(r => {
      if (r.status !== "PRESENT" || r.zone !== "PARC") return;
      const team = teams.find(t => t.id === r.teamId);
      if (!team || team.typeEngin !== "CER" || /\bcdi\b/i.test(team.nom || "")) return;
      (cerParcGroups[r.teamId] = cerParcGroups[r.teamId] || []).push(r);
    });
    const cerParcCycle = ["MAERSK", "MSC", "COSCO"];
    Object.keys(cerParcGroups).forEach(teamId => {
      const group = cerParcGroups[teamId].slice().sort((a, b) => {
        const da = state.drivers.find(d => d.id === a.driverId), db = state.drivers.find(d => d.id === b.driverId);
        const ra = da ? CerPosteRotationEngine.getRankForDate(da, date, state, teams) : null;
        const rb = db ? CerPosteRotationEngine.getRankForDate(db, date, state, teams) : null;
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return ra - rb;
      });
      group.forEach((r, idx) => { r.zone = cerParcCycle[idx % cerParcCycle.length]; });
    });

    return results;
  },

  generateMonthlyPlanning(month, year, state) {
    RestDayEngine.clearCache();
    ZoneRotationEngine.clearCache();
    CcPosteRotationEngine.clearCache();
    CerPosteRotationEngine.clearCache();
    VacationRotationEngine.clearCache();

    const dim = RTGDate.daysInMonth(month, year);
    const days = [];
    for (let d = 1; d <= dim; d++) {
      const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
      days.push({ day: d, iso: iso, assignments: this.generateDailyAssignments(iso, state) });
    }

    const validation = ValidationEngine.validateMonth(days, state);
    return { month: month, year: year, days: days, validation: validation };
  }
};
