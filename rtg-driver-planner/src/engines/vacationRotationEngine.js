// ==========================================
// RTG DRIVER PLANNER — Rotation du BLOC de vacation (§9-10)
// Règle métier : chaque conducteur appartient à un bloc fixe (défini par
// driver.initialVacation, d'après la liste officielle des conducteurs RTG par
// shift et vacation — les membres d'un même bloc ne se séparent JAMAIS, ils
// bougent toujours ensemble). Ce bloc bascule ENTIER, jour après jour, entre
// Vacation 1 et Vacation 2 : si le bloc est affecté V1 le jour j, il passe à V2
// le jour j+1. Deux exceptions GÈLENT cette bascule (le conducteur garde la
// même vacation avant/après, sans "sauter" un cran) :
//   1. Entre dimanche et lundi (changement de shift).
//   2. De part et d'autre d'un jour de REPOS INDIVIDUEL : si un conducteur est
//      affecté 1ère vacation le jour j et repos le jour j+1, il reprendra la
//      1ère vacation le jour j+2 — comme s'il avait conservé cette même
//      vacation pendant son repos. Cette propriété est déjà vraie
//      mathématiquement dans le cas général (deux bascules calendaires
//      consécutives s'annulent), SAUF si ce repos tombe pile sur la frontière
//      dimanche→lundi (le repos est lui-même le dimanche, ou lui-même le lundi
//      juste après) : l'une des deux transitions est alors déjà gelée par le
//      changement de shift, donc geler l'autre en plus créerait un décalage
//      permanent de ce seul conducteur par rapport au reste de son bloc (et
//      casserait le plafond du dimanche, §20) — on suspend alors le gel
//      "repos" pour ce jour précis, cf. isRiskySundayMondayRepos.
// ==========================================

const VacationRotationEngine = {
  _cache: {},
  _rawCache: {},

  clearCache() {
    this._cache = {};
    this._rawCache = {};
  },

  // Bascule calendaire "brute" du bloc (gelée seulement dimanche→lundi, sans
  // connaissance des repos individuels). Utilisée UNIQUEMENT en interne par
  // RestDayEngine.getMandatorySundayOff pour grouper les conducteurs
  // disponibles par vacation le dimanche (§20) : cette étape fait elle-même
  // partie du calcul des repos, donc elle ne peut pas dépendre de la vacation
  // "réelle" (gelée par repos individuel) sans provoquer une dépendance
  // circulaire.
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

  isRiskySundayMondayRepos(day, status, state) {
    if (status !== "REPOS" || !state.config.exceptionDimancheLundi) return false;
    const prev = RTGDate.addDays(day, -1);
    const next = RTGDate.addDays(day, 1);
    return (RTGDate.isSunday(day) && RTGDate.isMonday(next)) || (RTGDate.isMonday(day) && RTGDate.isSunday(prev));
  },

  // Vacation "réelle" (affichée) : bascule quotidienne du bloc, gelée
  // dimanche→lundi ET de part et d'autre de tout jour de REPOS individuel
  // (hors le cas limite dimanche/lundi ci-dessus).
  getVacationForDate(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._cache[key] = null; return null; }

    let toggles = 0;
    let cursor = refDate;
    let cursorStatus = PlanningEngine.getDailyStatus(driver, cursor, state, teams);
    let isFirstStep = true;
    while (cursor.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursor, 1);
      const nextStatus = PlanningEngine.getDailyStatus(driver, next, state, teams);
      const sundayMondayFreeze = state.config.exceptionDimancheLundi && RTGDate.isSunday(cursor) && RTGDate.isMonday(next);
      // Exception à la toute première transition depuis rotationReferenceDate : il
      // n'existe pas de transition "précédente" à geler symétriquement si la
      // référence elle-même tombe un jour de repos pour ce conducteur, donc son
      // statut ce jour-là est ignoré pour cette unique transition (la vacation de
      // référence est de toute façon fixée par convention à driver.initialVacation).
      const cursorReposFreeze = !isFirstStep && cursorStatus === "REPOS" && !this.isRiskySundayMondayRepos(cursor, cursorStatus, state);
      const nextReposFreeze = nextStatus === "REPOS" && !this.isRiskySundayMondayRepos(next, nextStatus, state);
      const reposFreeze = cursorReposFreeze || nextReposFreeze;
      if (!sundayMondayFreeze && !reposFreeze) toggles++;
      cursor = next;
      cursorStatus = nextStatus;
      isFirstStep = false;
    }

    const start = driver.initialVacation === "V2" ? 1 : 0;
    const result = (start + toggles) % 2 === 0 ? "V1" : "V2";
    this._cache[key] = result;
    return result;
  }
};
