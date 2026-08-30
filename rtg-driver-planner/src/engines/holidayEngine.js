// ==========================================
// RTG DRIVER PLANNER — Jours fériés (affichage uniquement)
// Aucun impact sur les repos ni les affectations, cf. config.holidays.
// ==========================================

const HolidayEngine = {
  getHoliday(isoDate, config) {
    return (config.holidays || []).find(h => h.date === isoDate) || null;
  }
};
