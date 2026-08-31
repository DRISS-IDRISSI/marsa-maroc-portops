// ==========================================
// RTG DRIVER PLANNER — Rotation du BLOC de vacation (§9-10)
// Règle métier : chaque conducteur appartient à un bloc fixe (défini par
// driver.initialVacation, d'après la liste officielle des conducteurs RTG par
// shift et vacation — les membres d'un même bloc ne se séparent JAMAIS, ils
// bougent toujours ensemble). Ce bloc bascule ENTIER, jour après jour, entre
// Vacation 1 et Vacation 2 : si le bloc est affecté V1 le jour j, il passe à V2
// le jour j+1. Deux exceptions GÈLENT cette bascule :
//   1. Entre dimanche et lundi (changement de shift) — s'applique au bloc
//      entier, jamais de désynchronisation.
//   2. De part et d'autre d'un jour de REPOS INDIVIDUEL : si un conducteur est
//      affecté 1ère vacation le jour j et repos le jour j+1, il reprendra la
//      1ère vacation le jour j+2 — comme s'il avait conservé cette même
//      vacation pendant son repos.
//
// Pour la règle 2, le jour qui suit un repos affiche TOUJOURS la même vacation
// que le jour qui précédait ce repos (calculée récursivement — donc correcte
// même si ce jour précédent était lui-même un jour "après repos"). C'est un
// correctif LOCAL : un jour qui n'est PAS immédiatement précédé d'un repos
// retombe directement sur la bascule brute du bloc (getRawVacationForDate),
// sans jamais hériter d'un éventuel écart des jours antérieurs — un conducteur
// ne peut donc jamais dériver durablement du reste de son bloc. Un repos
// isolé (le cas courant) ne change d'ailleurs rien à la bascule brute : deux
// bascules calendaires consécutives s'annulent déjà naturellement.
// ==========================================

const VacationRotationEngine = {
  _cache: {},
  _rawCache: {},

  clearCache() {
    this._cache = {};
    this._rawCache = {};
  },

  // Bascule calendaire "brute" du bloc (gelée seulement dimanche→lundi, sans
  // connaissance des repos individuels) : toujours identique pour tous les
  // membres d'un même bloc, jamais de dérive cumulative. Utilisée en interne
  // par RestDayEngine (passage 1 de getMandatorySundayOff, avant que les repos
  // du mois ne soient connus — évite une dépendance circulaire) ET comme socle
  // de getVacationForDate ci-dessous.
  getRawVacationForDate(driver, date, state) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._rawCache[key] !== undefined) return this._rawCache[key];

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._rawCache[key] = null; return null; }

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
    this._rawCache[key] = result;
    return result;
  },

  // Vacation "réelle" (affichée) : bascule quotidienne du bloc, gelée
  // dimanche→lundi, avec un correctif LOCAL et récursif quand la veille de
  // `date` était un repos pour ce conducteur (cf. commentaire d'en-tête).
  getVacationForDate(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._cache[key] = null; return null; }

    const prevDay = RTGDate.addDays(date, -1);
    if (prevDay.getTime() >= refDate.getTime()) {
      const prevStatus = PlanningEngine.getDailyStatus(driver, prevDay, state, teams);
      if (prevStatus === "REPOS") {
        const beforeRepos = RTGDate.addDays(prevDay, -1);
        const result = beforeRepos.getTime() < refDate.getTime()
          ? this.getRawVacationForDate(driver, date, state)
          : this.getVacationForDate(driver, beforeRepos, state, teams);
        this._cache[key] = result;
        return result;
      }
    }

    const result = this.getRawVacationForDate(driver, date, state);
    this._cache[key] = result;
    return result;
  }
};
