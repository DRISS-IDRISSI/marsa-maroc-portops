// ==========================================
// RTG DRIVER PLANNER — Solde de congé annuel (§40)
// ==========================================
// Règle métier confirmée par l'exploitant : chaque conducteur acquiert 26
// jours ouvrables de congé par an. Un jour "ouvrable" ici = tout jour SAUF
// les jours fériés marocains (le dimanche est un jour travaillé pour les
// conducteurs RTG, donc il compte comme un jour ouvrable, contrairement à un
// décompte RH classique 6j/7).
//
// Le solde non consommé d'une année N est reportable sur l'année N+1, mais
// PAS au-delà (droit valable 2 ans maximum : l'année d'acquisition + l'année
// suivante). Un reliquat encore présent au 1er janvier N+2 est donc perdu.
//
// L'appli ne connaît pas l'historique RH antérieur à sa mise en service :
// driver.soldeReport / driver.soldeReportAnnee sont saisis manuellement UNE
// FOIS par un ADMIN/RESPONSABLE à partir des archives existantes — ils
// représentent le reliquat (hors droit normal de l'année) encore valable au
// début de l'année soldeReportAnnee. À partir de cette année de référence,
// le report se recalcule automatiquement d'une année sur l'autre en
// utilisant l'historique des congés déjà enregistrés dans l'appli.

const CONGE_DROIT_ANNUEL_JOURS = 26;

const CongeBalanceEngine = {
  DROIT_ANNUEL: CONGE_DROIT_ANNUEL_JOURS,

  // Nombre de jours ouvrables dans l'intervalle [dateDebut, dateFin] inclus
  // (tous les jours sauf les jours fériés — dimanche compté comme travaillé).
  countJoursOuvrables(dateDebut, dateFin, config) {
    const start = RTGDate.parseISO(dateDebut), end = RTGDate.parseISO(dateFin);
    let count = 0;
    for (let d = start; d.getTime() <= end.getTime(); d = RTGDate.addDays(d, 1)) {
      if (!HolidayEngine.getHoliday(RTGDate.toISO(d), config)) count++;
    }
    return count;
  },

  // Jours de congé (statut actif, cf. AbsenceEngine.activeConges) consommés
  // par ce conducteur durant l'année civile "year", en jours ouvrables.
  joursPrisAnnee(driver, year, state) {
    const debutAnnee = RTGDate.makeDate(year, 1, 1), finAnnee = RTGDate.makeDate(year, 12, 31);
    const conges = AbsenceEngine.activeConges(state).filter(c => c.driverId === driver.id);
    let total = 0;
    conges.forEach(c => {
      const cDebut = RTGDate.parseISO(c.dateDebut), cFin = RTGDate.parseISO(c.dateFin);
      const debut = cDebut.getTime() < debutAnnee.getTime() ? debutAnnee : cDebut;
      const fin = cFin.getTime() > finAnnee.getTime() ? finAnnee : cFin;
      if (debut.getTime() > fin.getTime()) return;
      total += this.countJoursOuvrables(RTGDate.toISO(debut), RTGDate.toISO(fin), state.config);
    });
    return total;
  },

  // Solde disponible d'un conducteur pour l'année "atYear" (par défaut
  // l'année en cours). Retourne null tant qu'aucun solde de référence n'a
  // été saisi (driver.soldeReportAnnee), ou si l'année demandée est
  // antérieure à cette référence — dans ce cas on ne peut rien affirmer.
  soldeDisponible(driver, state, atYear) {
    const year = atYear || new Date().getUTCFullYear();
    const baseYear = driver.soldeReportAnnee;
    if (!baseYear || year < baseYear) return null;

    // Fait avancer le report d'une année sur l'autre jusqu'à l'année visée :
    // seul le reliquat du DROIT ANNUEL de l'année précédente (pas son propre
    // report, déjà expiré s'il n'a pas été consommé) devient le report
    // utilisable l'année suivante.
    let report = driver.soldeReport || 0;
    for (let y = baseYear; y < year; y++) {
      const pris = this.joursPrisAnnee(driver, y, state);
      const consommeSurDroit = Math.max(0, pris - report);
      report = Math.max(0, CONGE_DROIT_ANNUEL_JOURS - consommeSurDroit);
    }

    const pris = this.joursPrisAnnee(driver, year, state);
    const disponible = Math.max(0, report + CONGE_DROIT_ANNUEL_JOURS - pris);
    return { annee: year, report: report, droit: CONGE_DROIT_ANNUEL_JOURS, pris: pris, disponible: disponible };
  }
};
