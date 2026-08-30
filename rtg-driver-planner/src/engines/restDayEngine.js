// ==========================================
// RTG DRIVER PLANNER — Moteur des repos mensuels (règle §12)
// Génère automatiquement config.reposMensuel (6) jours de REPOS par conducteur
// et par mois, choisis parmi les jours qui ne sont ni déjà CONGÉ/MALADIE/ABSENCE
// ni un dimanche de shift 3 (OFF), ni un jour férié.
//
// Calculé équipe par équipe (pas conducteur par conducteur isolément) afin de
// pouvoir imposer un plafond du nombre de conducteurs en repos le même jour —
// sans ce plafond partagé, plusieurs conducteurs peuvent indépendamment choisir
// le même jour "idéal" (ex. un dimanche à faible charge) et vider l'équipe ce
// jour-là. Le placement privilégie quand même les jours à faible charge de
// travail (lundi/mardi, dimanche, samedi si shift 2 cette semaine-là) et évite
// le pic mercredi-vendredi, via config.restDayWeightByDow, tant que le plafond
// n'est pas atteint.
//
// Le quota de 6 repos est réduit d'un jour pour chaque tranche de
// config.reposReductionParJoursCongé (5) jours de CONGÉ pris dans le mois.
// ==========================================

const RestDayEngine = {
  _cache: {},
  _teamCache: {},

  clearCache() {
    this._cache = {};
    this._teamCache = {};
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

  getDayWeight(date, team, state) {
    const dow = RTGDate.dowMon0(date); // 0=Lundi ... 6=Dimanche
    const weights = state.config.restDayWeightByDow || [1, 1, 1, 1, 1, 1, 1];
    if (dow === 5 && team) {
      const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
      if (shift === "S2") return state.config.restDayWeightSaturdayShift2 || weights[5];
    }
    return weights[dow] || 1;
  },

  getCandidatesForDriver(driver, month, year, state, team) {
    const dim = RTGDate.daysInMonth(month, year);
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
    return candidates;
  },

  // Calcule les repos de TOUTE l'équipe en une passe, avec un plafond partagé du
  // nombre de conducteurs en repos le même jour civil.
  getTeamRestDays(team, month, year, state) {
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    if (this._teamCache[key]) return this._teamCache[key];

    const teamDrivers = state.drivers.filter(dr => dr.teamId === (team ? team.id : null) && dr.actif !== false);
    const N = teamDrivers.length || 1;
    // Plafond de conducteurs en repos le même jour : suffisamment large pour laisser
    // jouer la préférence des jours à faible charge, assez bas pour ne jamais vider
    // une part significative de l'équipe le même jour.
    const maxPerDay = Math.max(2, Math.ceil(N * 0.3));
    const dayUsage = {};
    const results = {};

    teamDrivers.forEach((driver, idxInTeam) => {
      const candidates = this.getCandidatesForDriver(driver, month, year, state, team);
      const congeDays = this.countCongeDaysInMonth(driver, month, year, state);
      const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
      const quota = Math.max(0, state.config.reposMensuel - reduction);
      const target = Math.min(quota, candidates.length);

      if (target <= 0) { results[driver.id] = []; return; }

      const spacing = candidates.length / target;
      const offset = Math.floor((idxInTeam / N) * candidates.length);
      const windowRadius = Math.max(1, Math.floor(spacing / 2));

      const chosen = [];
      const used = new Set();

      for (let k = 0; k < target; k++) {
        const basePos = Math.round(k * spacing);
        let best = null;
        for (let j = 0; j <= windowRadius; j++) {
          const deltas = j === 0 ? [0] : [-j, j];
          for (const dj of deltas) {
            const pos = ((offset + basePos + dj) % candidates.length + candidates.length) % candidates.length;
            const day = candidates[pos];
            if (used.has(day)) continue;
            if ((dayUsage[day] || 0) >= maxPerDay) continue;
            const weight = this.getDayWeight(RTGDate.makeDate(year, month, day), team, state);
            if (!best || weight > best.weight || (weight === best.weight && Math.abs(dj) < best.dist)) {
              best = { day: day, weight: weight, dist: Math.abs(dj) };
            }
          }
        }
        if (!best) {
          // Repli : rien de disponible dans la fenêtre (plafond atteint partout autour) —
          // recherche linéaire du premier jour candidat encore sous le plafond.
          let pos = (offset + basePos) % candidates.length;
          let tries = 0;
          let found = null;
          while (tries < candidates.length) {
            const day = candidates[pos];
            if (!used.has(day) && (dayUsage[day] || 0) < maxPerDay) { found = day; break; }
            pos = (pos + 1) % candidates.length;
            tries++;
          }
          best = { day: found !== null ? found : candidates[pos] };
        }
        used.add(best.day);
        dayUsage[best.day] = (dayUsage[best.day] || 0) + 1;
        chosen.push(best.day);
      }

      results[driver.id] = chosen.sort((a, b) => a - b);
    });

    this._teamCache[key] = results;
    return results;
  },

  getRestDaysForMonth(driver, month, year, state, teams) {
    const key = driver.id + "_" + year + "_" + month;
    if (this._cache[key]) return this._cache[key];

    const team = teams.find(t => t.id === driver.teamId);
    const teamResults = this.getTeamRestDays(team, month, year, state);
    const result = teamResults[driver.id] || [];
    this._cache[key] = result;
    return result;
  }
};
