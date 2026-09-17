// ==========================================
// RTG DRIVER PLANNER — Jours fériés (affichage uniquement)
// Aucun impact sur les repos ni les affectations, cf. config.holidays.
// ==========================================

const HolidayEngine = {
  getHoliday(isoDate, config) {
    return (config.holidays || []).find(h => h.date === isoDate) || null;
  },

  // Jour férié "effectif" pour une équipe donnée à une date donnée : le jour
  // férié lui-même, OU la veille si l'équipe est en 3ème shift ce jour-là —
  // le poste de nuit (23h-07h) commence la veille et se termine le jour même
  // du férié, donc cette veille est elle aussi chômée pour cette équipe
  // (règle métier confirmée par l'exploitant, ex. GR AZZAM/31 octobre).
  getEffectiveHoliday(date, team, config) {
    const iso = RTGDate.toISO(date);
    const direct = this.getHoliday(iso, config);
    if (direct) return direct;
    if (!team) return null;
    const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, config);
    if (shift !== "S3") return null;
    const tomorrowIso = RTGDate.toISO(RTGDate.addDays(date, 1));
    return this.getHoliday(tomorrowIso, config);
  }
};
