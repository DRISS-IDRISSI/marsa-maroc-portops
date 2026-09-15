// ==========================================
// RTG DRIVER PLANNER — Moteur des heures exceptionnelles (§29)
// Doublage / jour férié travaillé / 3ème shift dimanche (nécessité de service).
// Même forme de recherche que AbsenceEngine (dateDebut = dateFin ici, un seul
// jour par enregistrement) : sert à PlanningEngine pour annuler, pour LE
// conducteur concerné uniquement, le statut FERIE/OFF normalement appliqué à
// tous ce jour-là, et au Rapport RH pour agréger les heures du mois.
// ==========================================

const ExceptionEngine = {
  find(state, driverId, isoDate, type) {
    return (state.heuresExceptionnelles || []).find(r => r.driverId === driverId && r.type === type && isoDate >= r.dateDebut && isoDate <= r.dateFin);
  },

  hasWorked(state, driverId, isoDate, type) {
    return !!this.find(state, driverId, isoDate, type);
  }
};
