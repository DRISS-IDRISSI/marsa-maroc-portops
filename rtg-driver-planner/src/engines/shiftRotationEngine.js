// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des SHIFTS (par équipe, hebdomadaire)
// Règle : S1 → S3 → S2 → S1 ... cycle de 3 semaines, calé sur une semaine de
// référence (config.referenceWeekStart) — jamais sur le 1er jour du mois, afin
// que le cycle reste continu d'un mois à l'autre.
// ==========================================

const ShiftRotationEngine = {
  getTeamShiftForDate(team, date, config) {
    const cycle = team.shiftCycle && team.shiftCycle.length ? team.shiftCycle : config.shiftRotationCycleDefault;
    const refWeek = RTGDate.startOfWeekMonday(RTGDate.parseISO(config.referenceWeekStart));
    const targetWeek = RTGDate.startOfWeekMonday(date);
    const diffWeeks = Math.floor(RTGDate.diffDays(refWeek, targetWeek) / 7);
    const len = cycle.length;
    const idx = ((diffWeeks % len) + len) % len;
    return cycle[idx];
  }
};
