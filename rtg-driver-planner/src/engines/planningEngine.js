// ==========================================
// RTG DRIVER PLANNER — Moteur de planification (§19-22)
// Orchestre les autres moteurs : statut du jour, affectation journalière,
// génération du planning mensuel complet.
// ==========================================

const FIXED_ABSENCE_STATUSES = ["CONGE", "MALADIE", "ABSENCE", "FORMATION"];

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
      if (status === "PRESENT" && team) {
        shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        vacation = VacationRotationEngine.getVacationForDate(driver, date, state, team);
        zone = ZoneRotationEngine.getZoneForDate(driver, date, state, teams);
        const vacDefs = state.config.vacations[shift] || [];
        const vacDef = vacDefs.find(v => v.id === vacation);
        if (vacDef) { startTime = vacDef.start; endTime = vacDef.end; }
        if (shift === "S1" || shift === "S3") {
          vacationBalanceAlert = RestDayEngine.hasVacationBalanceAlert(driver, month, year, state, teams, dom);
        }
      } else if (status === "REPOS") {
        restCorrection = RestDayEngine.isVacationBalanceCorrection(driver, month, year, state, teams, dom) ? "equilibrage_V1_V2" : null;
      }

      return { driver: driver, driverId: driver.id, team: team, status: status, shift: shift, vacation: vacation, zone: zone, startTime: startTime, endTime: endTime, vacationBalanceAlert: vacationBalanceAlert, restCorrection: restCorrection };
    });

    // Passe 2 : répartition équitable des zones par créneau (shift + vacation) —
    // zone A non prioritaire (vide si <8 présents, jamais doublée avant les autres
    // si 8 ou plus). Ne concerne que la flotte CC : pour la flotte RTG, la Passe 1
    // (ZoneRotationEngine.getZoneForDate) a déjà fait cette répartition en interne,
    // via la simulation en cascade jour par jour (§ voir zoneRotationEngine.js) —
    // la refaire ici la fausserait (elle prendrait la zone déjà équilibrée comme
    // "naturelle" et la redoublerait/redistribuerait une seconde fois).
    const groups = {};
    // Groupé aussi par flotte (RTG/CC — § module Chariots Cavalier) : deux
    // équipes de flottes différentes peuvent partager le même shift/vacation
    // (labels globaux), mais leurs conducteurs ne doivent jamais être
    // mélangés dans la même répartition de zones (listes de zones distinctes).
    base.forEach(b => {
      if (b.status !== "PRESENT" || !b.shift || !b.vacation) return;
      const fleet = (b.team && b.team.typeEngin) || "RTG";
      if (fleet === "RTG") return;
      const key = fleet + "_" + b.shift + "_" + b.vacation;
      (groups[key] = groups[key] || []).push(b);
    });
    Object.keys(groups).forEach(key => {
      const fleet = key.split("_")[0];
      ZoneBalancingEngine.assignZonesForSlot(groups[key], zonesForFleet(state.config, fleet));
    });

    // Passe 3 : applique les affectations manuelles par-dessus le résultat auto —
    // SAUF si le statut de base est un enregistrement figé (congé/maladie/
    // absence/formation, via AbsenceEngine). Une affectation manuelle laissée
    // par un import antérieur (ex. import Excel) ne doit jamais masquer un
    // congé/maladie saisi après coup sur la même date : le figé gagne toujours.
    return base.map(b => {
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
