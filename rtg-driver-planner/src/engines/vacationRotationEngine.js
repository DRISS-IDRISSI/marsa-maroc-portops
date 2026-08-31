// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des VACATIONS (§9-10)
// Règle métier ABSOLUE : chaque conducteur alterne individuellement entre ses
// deux vacations (V1/V2) jour après jour, à partir de driver.initialVacation
// (qui s'applique exactement à config.rotationReferenceDate) :
//   "Si le conducteur X est affecté 1ère vacation alors j+1 sera affecté
//    vacation 2, à part le changement de shift le lundi où il garde la même
//    affectation que le dimanche."
// Deux exceptions GÈLENT cette alternance (le conducteur garde la même
// vacation avant/après, sans "sauter" un cran) :
//   1. Entre dimanche et lundi (changement de shift).
//   2. De part et d'autre d'un jour de REPOS : si le conducteur est affecté
//      1ère vacation le jour j et repos le jour j+1, il reprendra la 1ère
//      vacation le jour j+2 — comme s'il avait conservé cette même vacation
//      pendant son repos. L'alternance réelle ne reprend qu'entre deux
//      journées de travail consécutives.
// Cette alternance est individuelle et INDÉPENDANTE de la présence des
// collègues d'équipe, du shift ou de toute charge de travail cible : elle ne
// doit jamais être recalculée à partir d'un groupe.
// ==========================================

const VacationRotationEngine = {
  _cache: {},
  _rawCache: {},

  clearCache() {
    this._cache = {};
    this._rawCache = {};
  },

  // Alternance calendaire "brute" (gelée seulement dimanche→lundi, sans
  // connaissance des repos). Utilisée UNIQUEMENT en interne par
  // RestDayEngine.getMandatorySundayOff pour grouper les conducteurs
  // disponibles par vacation le dimanche (§20) : cette étape fait elle-même
  // partie du calcul des repos, donc elle ne peut pas dépendre de la vacation
  // "réelle" (gelée par repos) sans provoquer une dépendance circulaire.
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

  // Un repos isolé gèle la transition qui y ENTRE et celle qui en SORT — les
  // deux gels s'annulent exactement les deux bascules qu'aurait produites une
  // alternance pure, donc la parité 2 jours plus tard retombe toujours juste
  // SAUF si ce repos tombe pile sur la frontière dimanche→lundi (le repos est
  // lui-même le dimanche, ou lui-même le lundi juste après) : dans ce cas,
  // l'une des deux transitions est de toute façon déjà gelée par le
  // changement de shift, donc geler l'AUTRE en plus créerait un décalage de
  // parité impair et permanent par rapport à l'alternance calendaire pure
  // (utilisée pour le plafond du dimanche, §20 — cf. getRawVacationForDate).
  // On suspend alors le gel "repos" pour ce jour précis et on laisse la seule
  // règle dimanche→lundi s'appliquer normalement.
  isRiskySundayMondayRepos(day, status, state) {
    if (status !== "REPOS" || !state.config.exceptionDimancheLundi) return false;
    const prev = RTGDate.addDays(day, -1);
    const next = RTGDate.addDays(day, 1);
    return (RTGDate.isSunday(day) && RTGDate.isMonday(next)) || (RTGDate.isMonday(day) && RTGDate.isSunday(prev));
  },

  // Vacation "réelle" (affichée) : alternance stricte gelée dimanche→lundi ET
  // de part et d'autre de tout jour de REPOS (hors le cas limite ci-dessus).
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
