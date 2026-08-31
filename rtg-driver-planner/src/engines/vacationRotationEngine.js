// ==========================================
// RTG DRIVER PLANNER — Vacation FIXE du conducteur (§9-10)
// Règle métier (mise à jour d'après la liste officielle des conducteurs RTG par
// shift et vacation) : chaque conducteur appartient en PERMANENCE à un seul bloc,
// V1 OU V2, jamais les deux. Chaque vacation travaille en bloc — les conducteurs
// d'un même bloc ne se séparent jamais, il n'y a plus d'alternance quotidienne
// individuelle entre V1 et V2. La vacation d'un conducteur est donc simplement
// driver.initialVacation, fixée une fois pour toutes (indépendante de la date, de
// la présence, du shift ou de toute charge de travail).
// ==========================================

const VacationRotationEngine = {
  getVacationForDate(driver) {
    return driver.initialVacation || null;
  }
};
