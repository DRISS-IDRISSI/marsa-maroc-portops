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

  // Un congé saisi directement par un responsable est VALIDE dès sa
  // création (valeur par défaut côté base). Une demande envoyée par un
  // conducteur (§38) entre en EN_ATTENTE et n'a AUCUN effet sur le planning
  // tant qu'elle n'a pas été validée par un Responsable — sinon un
  // conducteur pourrait s'auto-décréter en congé avant toute approbation.
  activeConges(state) {
    return (state.conges || []).filter(c => c.statut !== "EN_ATTENTE" && c.statut !== "REFUSE");
  },

  // Retourne 'CONGE' | 'MALADIE' | 'ABSENCE' | 'FORMATION' | null
  getFixedStatus(driver, isoDate, state) {
    if (this.findRecord(this.activeConges(state), driver.id, isoDate)) return "CONGE";
    if (this.findRecord(state.maladies, driver.id, isoDate)) return "MALADIE";
    const abs = this.findRecord(state.absences, driver.id, isoDate);
    if (abs) return abs.type === "FORMATION" ? "FORMATION" : "ABSENCE";
    return null;
  }
};
