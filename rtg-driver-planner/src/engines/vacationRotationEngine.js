// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des VACATIONS (§9-10)
// Rotation normale : V1 → V2 → V1 → V2 ... par jour calendaire (ne saute PAS
// les jours non travaillés, contrairement à la zone).
// Exception obligatoire : entre dimanche et lundi, la vacation ne bascule pas
// (le conducteur conserve la même vacation le lundi que le dimanche).
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
    if (date.getTime() < refDate.getTime()) {
      this._cache[key] = null;
      return null;
    }

    let vac = driver.initialVacation;
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursor, 1);
      const skipToggle = state.config.exceptionDimancheLundi && RTGDate.isSunday(cursor) && RTGDate.isMonday(next);
      if (!skipToggle) {
        vac = vac === "V1" ? "V2" : "V1";
      }
      cursor = next;
    }

    this._cache[key] = vac;
    return vac;
  }
};
