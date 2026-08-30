// ==========================================
// RTG DRIVER PLANNER — Moteur des absences (congé / maladie / absence / formation)
// Détermine si une date donnée est couverte par un enregistrement figé.
// Ces journées ne doivent jamais être comptées comme REPOS (règle §12) ni
// faire avancer la rotation de zone (règle §8).
// ==========================================

const AbsenceEngine = {
  findRecord(records, driverId, isoDate) {
    return (records || []).find(r => r.driverId === driverId && isoDate >= r.dateDebut && isoDate <= r.dateFin);
  },

  // Retourne 'CONGE' | 'MALADIE' | 'ABSENCE' | 'FORMATION' | null
  getFixedStatus(driver, isoDate, state) {
    if (this.findRecord(state.conges, driver.id, isoDate)) return "CONGE";
    if (this.findRecord(state.maladies, driver.id, isoDate)) return "MALADIE";
    const abs = this.findRecord(state.absences, driver.id, isoDate);
    if (abs) return abs.type === "FORMATION" ? "FORMATION" : "ABSENCE";
    return null;
  }
};
