// ==========================================
// RTG DRIVER PLANNER — Rotation du BLOC de vacation (§9-10)
// Règle métier : chaque conducteur appartient à un bloc fixe (défini par
// driver.initialVacation, d'après la liste officielle des conducteurs RTG par
// shift et vacation — les membres d'un même bloc ne se séparent JAMAIS, ils
// bougent toujours ensemble). Ce bloc bascule ENTIER, jour après jour, entre
// Vacation 1 et Vacation 2 : si le bloc est affecté V1 le jour j, il passe à V2
// le jour j+1, SAUF entre dimanche et lundi où il garde la même vacation
// (changement de shift). driver.initialVacation fixe uniquement la vacation du
// bloc du conducteur à rotationReferenceDate — pas sa vacation permanente.
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
