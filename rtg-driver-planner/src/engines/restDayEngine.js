// ==========================================
// RTG DRIVER PLANNER — Moteur des repos mensuels (règle §12)
// Génère automatiquement config.reposMensuel (6) jours de REPOS par conducteur
// et par mois, choisis parmi les jours qui ne sont ni déjà CONGÉ/MALADIE/ABSENCE
// ni un dimanche de shift 3 (OFF). La répartition est décalée par conducteur au
// sein de son équipe pour éviter que tout le monde se repose le même jour et
// vider une vacation/équipe. Résultat 100% modifiable manuellement (phase 2).
//
// Le quota de 6 repos est réduit d'un jour pour chaque tranche de
// config.reposReductionParJoursCongé (5) jours de CONGÉ pris dans le mois.
// ==========================================

const RestDayEngine = {
  _cache: {},

  clearCache() {
    this._cache = {};
  },

  countCongeDaysInMonth(driver, month, year, state) {
    const dim = RTGDate.daysInMonth(month, year);
    let count = 0;
    for (let d = 1; d <= dim; d++) {
      const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
      if (AbsenceEngine.findRecord(state.conges, driver.id, iso)) count++;
    }
    return count;
  },

  getRestDaysForMonth(driver, month, year, state, teams) {
    const key = driver.id + "_" + year + "_" + month;
    if (this._cache[key]) return this._cache[key];

    const dim = RTGDate.daysInMonth(month, year);
    const team = teams.find(t => t.id === driver.teamId);
    const candidates = [];

    for (let d = 1; d <= dim; d++) {
      const date = RTGDate.makeDate(year, month, d);
      const iso = RTGDate.toISO(date);
      if (AbsenceEngine.getFixedStatus(driver, iso, state)) continue;
      if (HolidayEngine.getHoliday(iso, state.config)) continue;
      if (team) {
        const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        if (state.config.offShift3Dimanche && shift === "S3" && RTGDate.isSunday(date)) continue;
      }
      candidates.push(d);
    }

    const congeDays = this.countCongeDaysInMonth(driver, month, year, state);
    const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
    const quota = Math.max(0, state.config.reposMensuel - reduction);
    const target = Math.min(quota, candidates.length);
    if (target <= 0) {
      this._cache[key] = [];
      return [];
    }

    const spacing = candidates.length / target;
    // Décalage propre à CHAQUE conducteur (pas seulement à target=6 groupes) : sans ça,
    // idxInTeam % target ne produit que `target` décalages distincts, donc plusieurs
    // conducteurs d'une même équipe de ~25 se retrouvent avec des jours de repos
    // identiques et peuvent finir en repos tous ensemble le même jour.
    const teamDrivers = state.drivers.filter(dr => dr.teamId === driver.teamId && dr.actif !== false);
    const idxInTeam = Math.max(0, teamDrivers.findIndex(dr => dr.id === driver.id));
    const teamSize = teamDrivers.length || 1;
    const offset = Math.floor((idxInTeam / teamSize) * candidates.length);

    const chosen = [];
    const used = new Set();
    for (let k = 0; k < target; k++) {
      let pos = (offset + Math.round(k * spacing)) % candidates.length;
      let tries = 0;
      while (used.has(candidates[pos]) && tries < candidates.length) {
        pos = (pos + 1) % candidates.length;
        tries++;
      }
      used.add(candidates[pos]);
      chosen.push(candidates[pos]);
    }

    const result = chosen.sort((a, b) => a - b);
    this._cache[key] = result;
    return result;
  }
};
