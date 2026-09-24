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
//
// Exception CC (confirmée par l'exploitant, GR BAHOUS) : la bascule
// dimanche→lundi ne gèle PAS systématiquement comme pour RTG — son gel dépend
// du changement de shift réellement en jeu (cycle S1→S3→S2→S1...) :
//   - S1→S3 : bascule normalement (change de vacation)
//   - S3→S2 : bascule normalement (change de vacation)
//   - S2→S1 : gèle (garde la même vacation)
// ==========================================

const VacationRotationEngine = {
  _cache: {},

  clearCache() {
    this._cache = {};
  },

  getVacationForDate(driver, date, state, team) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._cache[key] = null; return null; }

    let toggles = 0;
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursor, 1);
      let freeze = false;
      if (state.config.exceptionDimancheLundi && RTGDate.isSunday(cursor) && RTGDate.isMonday(next)) {
        if (team && team.typeEngin === "CC") {
          // CC : gel uniquement au changement de shift S2→S1 — S1→S3 et
          // S3→S2 basculent normalement (voir note d'en-tête).
          freeze = ShiftRotationEngine.getTeamShiftForDate(team, cursor, state.config) === "S2";
        } else {
          freeze = true;
        }
      }
      // Dimanche chômé (3ème shift) : la bascule samedi->dimanche est ELLE
      // AUSSI gelée, pour que le lundi reprenne exactement la même vacation
      // que le samedi (dernier jour réellement travaillé) — au lieu
      // d'hériter de celle, basculée une fois, du dimanche chômé. Ne
      // s'applique qu'à l'équipe effectivement en S3 ce dimanche-là ; pour
      // S1/S2 (dimanche normalement travaillé), seule la bascule
      // dimanche->lundi ci-dessus reste gelée, comportement inchangé.
      if (!freeze && team && state.config.offShift3Dimanche && RTGDate.isSunday(next)) {
        if (ShiftRotationEngine.getTeamShiftForDate(team, cursor, state.config) === "S3") freeze = true;
      }
      if (!freeze) toggles++;
      cursor = next;
    }

    const start = driver.initialVacation === "V2" ? 1 : 0;
    const result = (start + toggles) % 2 === 0 ? "V1" : "V2";
    this._cache[key] = result;
    return result;
  }
};
