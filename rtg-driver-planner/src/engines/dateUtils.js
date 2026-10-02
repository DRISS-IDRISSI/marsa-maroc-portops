// ==========================================
// RTG DRIVER PLANNER — Utilitaires de date (UTC, indépendants du fuseau horaire)
// ==========================================

const RTGDate = {
  MS_DAY: 86400000,

  parseISO(s) {
    const parts = s.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  },

  toISO(date) {
    return date.toISOString().slice(0, 10);
  },

  makeDate(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day));
  },

  addDays(date, n) {
    return new Date(date.getTime() + n * this.MS_DAY);
  },

  daysInMonth(month, year) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  },

  // Lundi = 0 ... Dimanche = 6
  dowMon0(date) {
    const d = date.getUTCDay();
    return d === 0 ? 6 : d - 1;
  },

  isSunday(date) {
    return date.getUTCDay() === 0;
  },

  isMonday(date) {
    return date.getUTCDay() === 1;
  },

  startOfWeekMonday(date) {
    return this.addDays(date, -this.dowMon0(date));
  },

  diffDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / this.MS_DAY);
  },

  formatFr(date) {
    return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  }
};
