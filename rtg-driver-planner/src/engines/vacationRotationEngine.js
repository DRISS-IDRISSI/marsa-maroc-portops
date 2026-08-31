// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des VACATIONS (§9-10)
// Règle métier ABSOLUE : chaque conducteur alterne individuellement entre ses
// deux vacations (V1/V2) jour après jour, à partir de driver.initialVacation
// (qui s'applique exactement à config.rotationReferenceDate) :
//   "Si le conducteur X est affecté 1ère vacation alors j+1 sera affecté
//    vacation 2, à part le changement de shift le lundi où il garde la même
//    affectation que le dimanche."
// Autrement dit l'alternance est gelée entre dimanche et lundi (le conducteur
// conserve le lundi la vacation qu'il avait le dimanche), et reprend
// normalement ensuite. Cette alternance est individuelle et INDÉPENDANTE de
// la présence des collègues d'équipe, du shift ou de toute charge de travail
// cible : elle ne doit jamais être recalculée à partir d'un groupe.
// ==========================================

const VacationRotationEngine = {
  _cache: {},

  clearCache() {
    this._cache = {};
  },

  getVacationForDate(driver, date, state) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._cache[key] = null; return null; }

    let toggles = 0;
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursor, 1);
      const freeze = state.config.exceptionDimancheLundi && RTGDate.isSunday(cursor) && RTGDate.isMonday(next);
      if (!freeze) toggles++;
      cursor = next;
    }

    const start = driver.initialVacation === "V2" ? 1 : 0;
    const result = (start + toggles) % 2 === 0 ? "V1" : "V2";
    this._cache[key] = result;
    return result;
  }
};
