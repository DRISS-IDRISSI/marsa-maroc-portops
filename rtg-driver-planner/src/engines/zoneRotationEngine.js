// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des ZONES RTG (§7-8)
// Rotation A → B → C → D → E → F → G → H → A, mais UNIQUEMENT sur les journées
// effectivement travaillées : un jour REPOS/CONGÉ/MALADIE/ABSENCE/FORMATION/OFF
// ne fait pas avancer le pointeur de zone du conducteur (règle absolue §8).
// Dépend de PlanningEngine.getDailyStatus pour savoir quels jours ont été
// travaillés depuis la date de référence (config.rotationReferenceDate).
// ==========================================

const ZoneRotationEngine = {
  _cache: {},

  clearCache() {
    this._cache = {};
  },

  // Index de zone du conducteur à une date donnée, indépendamment de son statut ce
  // jour-là (avance uniquement sur les jours PRESENT rencontrés avant cette date).
  getZoneIndexForDate(driver, date, state, teams) {
    const zones = state.config.zones;
    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) return null;

    let zoneIdx = Math.max(0, zones.indexOf(driver.initialZone));
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const status = PlanningEngine.getDailyStatus(driver, cursor, state, teams);
      if (status === "PRESENT") zoneIdx = (zoneIdx + 1) % zones.length;
      cursor = RTGDate.addDays(cursor, 1);
    }
    return zoneIdx;
  },

  getZoneForDate(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const zones = state.config.zones;
    const zoneIdx = this.getZoneIndexForDate(driver, date, state, teams);
    const statusToday = PlanningEngine.getDailyStatus(driver, date, state, teams);
    const result = (zoneIdx !== null && statusToday === "PRESENT") ? zones[zoneIdx] : null;
    this._cache[key] = result;
    return result;
  },

  // Zone qu'aurait eue le conducteur ce jour-là s'il avait travaillé — utile pour le
  // remplacement, où on doit connaître la zone laissée vacante par un conducteur absent.
  getExpectedZoneForDate(driver, date, state, teams) {
    const zones = state.config.zones;
    const zoneIdx = this.getZoneIndexForDate(driver, date, state, teams);
    return zoneIdx !== null ? zones[zoneIdx] : null;
  }
};
