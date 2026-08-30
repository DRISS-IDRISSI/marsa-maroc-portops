// ==========================================
// RTG DRIVER PLANNER — Moteur des absences (congé / maladie / absence)
// Détermine si une date donnée est couverte par un enregistrement figé.
// Ces journées ne doivent jamais être comptées comme REPOS (règle §12) ni
// faire avancer la rotation de zone (règle §8).
// ==========================================

const AbsenceEngine = {
  findRecord(records, driverId, isoDate) {
    return (records || []).find(r => r.driverId === driverId && isoDate >= r.dateDebut && isoDate <= r.dateFin);
  },

  // Retourne 'CONGE' | 'MALADIE' | 'ABSENCE' | null
  getFixedStatus(driver, isoDate, state) {
    if (this.findRecord(state.conges, driver.id, isoDate)) return "CONGE";
    if (this.findRecord(state.maladies, driver.id, isoDate)) return "MALADIE";
    if (this.findRecord(state.absences, driver.id, isoDate)) return "ABSENCE";
    return null;
  }
};
