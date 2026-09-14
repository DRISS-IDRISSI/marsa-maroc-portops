// ==========================================
// RTG DRIVER PLANNER — Moteur de planification (§19-22)
// Orchestre les autres moteurs : statut du jour, affectation journalière,
// génération du planning mensuel complet.
// ==========================================

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

    const holiday = HolidayEngine.getHoliday(iso, state.config);
    const holidayWorked = holiday && ExceptionEngine.hasWorked(state, driver.id, iso, "FERIE_TRAVAILLE");
    if (holiday && !holidayWorked) return "FERIE";

    const team = teams.find(t => t.id === driver.teamId);
    if (!team) return "ABSENCE";

    const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
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

    // Passe 1 : statut + shift/vacation/zone "naturels" (rotation individuelle),
    // avant toute affectation manuelle.
    const base = state.drivers.filter(d => d.actif !== false).map(driver => {
      const team = teams.find(t => t.id === driver.teamId);
      const status = this.getDailyStatus(driver, date, state, teams);

      let shift = null, vacation = null, zone = null, startTime = null, endTime = null;
      if (status === "PRESENT" && team) {
        shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        vacation = VacationRotationEngine.getVacationForDate(driver, date, state);
        zone = ZoneRotationEngine.getZoneForDate(driver, date, state, teams);
        const vacDefs = state.config.vacations[shift] || [];
        const vacDef = vacDefs.find(v => v.id === vacation);
        if (vacDef) { startTime = vacDef.start; endTime = vacDef.end; }
      }

      return { driver: driver, driverId: driver.id, team: team, status: status, shift: shift, vacation: vacation, zone: zone, startTime: startTime, endTime: endTime };
    });

    // Passe 1.5 (Shift 1 uniquement) : règle métier "les deux vacations doivent
    // être égales, ou à défaut V1 ne dépasse V2 que d'UN seul conducteur au
    // maximum" — décision explicite de l'exploitant : PAS de correction
    // automatique (pas de repos ajouté, pas de changement de vacation silencieux).
    // On se contente de SIGNALER (vacationBalanceAlert) le ou les conducteurs en
    // excédent en V1 : l'appli les met en évidence (couleur distincte) pour que
    // le responsable de shift lui demande, ce jour-là, de passer exceptionnellement
    // en V2 — une décision humaine, pas automatique.
    const byTeamS1 = {};
    base.forEach(b => {
      if (b.status !== "PRESENT" || b.shift !== "S1" || !b.vacation || !b.team) return;
      const g = (byTeamS1[b.team.id] = byTeamS1[b.team.id] || { V1: [], V2: [] });
      g[b.vacation].push(b);
    });
    Object.keys(byTeamS1).forEach(teamId => {
      const g = byTeamS1[teamId];
      const excess = g.V1.length - g.V2.length;
      if (excess <= 0) return;
      // Déterministe (par matricule) pour rester stable si on rafraîchit la page.
      const flagged = g.V1.slice().sort((a, b) => String(a.driver.matricule).localeCompare(String(b.driver.matricule))).slice(-excess);
      flagged.forEach(b => { b.vacationBalanceAlert = true; });
    });

    // Passe 2 : répartition équitable des zones par créneau (shift + vacation) —
    // zone A non prioritaire (vide si <8 présents, jamais doublée avant les autres
    // si 8 ou plus).
    const groups = {};
    base.forEach(b => {
      if (b.status !== "PRESENT" || !b.shift || !b.vacation) return;
      const key = b.shift + "_" + b.vacation;
      (groups[key] = groups[key] || []).push(b);
    });
    Object.keys(groups).forEach(key => {
      ZoneBalancingEngine.assignZonesForSlot(groups[key], state.config.zones);
    });

    // Passe 3 : applique les affectations manuelles par-dessus le résultat auto.
    return base.map(b => {
      const driver = b.driver, team = b.team;
      let shift = b.shift, vacation = b.vacation, zone = b.zone, startTime = b.startTime, endTime = b.endTime;
      let source = "AUTO";
      let finalStatus = b.status;
      const override = state.manualOverrides[isoDate + "_" + driver.id];
      if (override) {
        if (override.shift !== undefined) shift = override.shift;
        if (override.vacation !== undefined) vacation = override.vacation;
        if (override.zone !== undefined) zone = override.zone;
        if (override.status !== undefined) finalStatus = override.status;
        if (override.startTime !== undefined) startTime = override.startTime;
        if (override.endTime !== undefined) endTime = override.endTime;
        source = "MANUAL";
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
        createdAt: override && override.createdAt ? override.createdAt : null,
        updatedAt: override && override.updatedAt ? override.updatedAt : null
      };
    });
  },

  generateMonthlyPlanning(month, year, state) {
    RestDayEngine.clearCache();
    ZoneRotationEngine.clearCache();
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
