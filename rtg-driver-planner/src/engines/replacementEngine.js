// ==========================================
// RTG DRIVER PLANNER — Moteur de remplacement (§27)
// Pour un conducteur absent à une date donnée, propose les conducteurs
// disponibles pour le remplacer : même équipe (donc même shift, un seul
// service par shift dans ce modèle), réellement présents ce jour-là, non
// déjà le conducteur remplacé.
// ==========================================

const ReplacementEngine = {
  // Statistiques du mois glissant (jusqu'à la date incluse) utilisées pour
  // départager les candidats : privilégier celui qui a le moins travaillé.
  getMonthStats(driver, isoDate, state) {
    const date = RTGDate.parseISO(isoDate);
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    const dim = RTGDate.daysInMonth(month, year);
    let joursTravailles = 0;
    let joursRepos = 0;
    let derniereAffectation = null;
    for (let d = 1; d <= dim; d++) {
      const day = RTGDate.makeDate(year, month, d);
      if (day.getTime() > date.getTime()) break;
      const status = PlanningEngine.getDailyStatus(driver, day, state, state.teams);
      if (status === "PRESENT") {
        joursTravailles++;
        derniereAffectation = RTGDate.toISO(day);
      } else if (status === "REPOS") {
        joursRepos++;
      }
    }
    return { joursTravailles, joursRepos, derniereAffectation };
  },

  getCandidates(isoDate, absentDriverId, state) {
    const absentDriver = state.drivers.find(d => d.id === absentDriverId);
    if (!absentDriver) return [];
    const date = RTGDate.parseISO(isoDate);

    return state.drivers
      .filter(d => d.actif !== false && d.id !== absentDriverId && d.teamId === absentDriver.teamId)
      .map(d => {
        const status = PlanningEngine.getDailyStatus(d, date, state, state.teams);
        const stats = this.getMonthStats(d, isoDate, state);
        return { driver: d, status: status, disponible: status === "PRESENT", joursTravailles: stats.joursTravailles, joursRepos: stats.joursRepos, derniereAffectation: stats.derniereAffectation };
      })
      .filter(c => c.disponible)
      .sort((a, b) => a.joursTravailles - b.joursTravailles);
  },

  // Construit l'override à appliquer au remplaçant : il garde son propre shift/vacation
  // (même équipe ⇒ même shift) mais reprend la zone du conducteur absent, pour que le
  // bloc ne reste pas sans conducteur affecté.
  buildOverride(isoDate, absentDriverId, replacementDriverId, state) {
    const date = RTGDate.parseISO(isoDate);
    const absentDriver = state.drivers.find(d => d.id === absentDriverId);
    const assignments = PlanningEngine.generateDailyAssignments(isoDate, state);
    const replacementAssignment = assignments.find(a => a.driverId === replacementDriverId);
    if (!absentDriver || !replacementAssignment) return null;
    // Zone laissée vacante par le conducteur absent (celle qu'il aurait eue s'il avait travaillé).
    const vacatedZone = ZoneRotationEngine.getExpectedZoneForDate(absentDriver, date, state, state.teams);
    return {
      status: "PRESENT",
      shift: replacementAssignment.shift,
      vacation: replacementAssignment.vacation,
      zone: vacatedZone || replacementAssignment.zone,
      startTime: replacementAssignment.startTime,
      endTime: replacementAssignment.endTime
    };
  }
};
