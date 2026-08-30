// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des VACATIONS (§9-10 + charge de travail)
// Les conducteurs PRÉSENTS d'une équipe, pour le shift du jour, sont répartis entre
// V1 et V2 selon le ratio de charge de travail du shift (config.vacationRatioByShift) :
// ex. Shift 1 = 10% V1 / 20% V2 → sur les présents, ~1/3 en V1 et ~2/3 en V2.
// La répartition tourne équitablement d'un jour à l'autre (curseur commun, gelé du
// dimanche au lundi comme l'exigeait l'ancienne règle d'exception) afin qu'un même
// conducteur ne reste pas toujours dans le même groupe.
// ==========================================

const VacationRotationEngine = {
  _cache: {},
  _presentCache: {},

  clearCache() {
    this._cache = {};
    this._presentCache = {};
  },

  // Nombre de jours "actifs" écoulés depuis la référence, gelé entre dimanche et
  // lundi — sert de curseur de rotation commun à toutes les équipes.
  getDayCursor(date, state) {
    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    let cursor = 0;
    let cursorDate = refDate;
    while (cursorDate.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursorDate, 1);
      const freeze = state.config.exceptionDimancheLundi && RTGDate.isSunday(cursorDate) && RTGDate.isMonday(next);
      if (!freeze) cursor++;
      cursorDate = next;
    }
    return cursor;
  },

  // Liste ordonnée (ordre du roster) des conducteurs de l'équipe réellement présents ce jour-là.
  getPresentTeammates(team, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = team.id + "_" + iso;
    if (this._presentCache[key]) return this._presentCache[key];
    const list = state.drivers
      .filter(d => d.teamId === team.id && d.actif !== false)
      .filter(d => PlanningEngine.getDailyStatus(d, date, state, teams) === "PRESENT");
    this._presentCache[key] = list;
    return list;
  },

  getVacationForDate(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const team = teams.find(t => t.id === driver.teamId);
    if (!team) { this._cache[key] = null; return null; }

    const present = this.getPresentTeammates(team, date, state, teams);
    const idx = present.indexOf(driver);
    if (idx === -1) { this._cache[key] = null; return null; }

    const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
    const ratio = (state.config.vacationRatioByShift && state.config.vacationRatioByShift[shift]) || { V1: 1, V2: 1 };
    const n = present.length;
    const nV1 = Math.round(n * ratio.V1 / (ratio.V1 + ratio.V2));

    const cursor = this.getDayCursor(date, state);
    const rotatedIdx = (idx + cursor) % n;
    const result = rotatedIdx < nV1 ? "V1" : "V2";

    this._cache[key] = result;
    return result;
  }
};
