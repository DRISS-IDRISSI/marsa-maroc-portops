// ==========================================
// RTG DRIVER PLANNER — Edge Function : envoi quotidien de l'Affectation du jour
// ==========================================
// Déclenchée par un job pg_cron (voir migration_007_cron_affectation_email.sql)
// chaque jour à 06h00 (heure du Maroc). Calcule l'affectation du jour EN
// COURS (mêmes moteurs que l'appli — copiés ci-dessous tels quels depuis
// src/engines/*.js, aucun n'a de dépendance navigateur, voir leur en-tête
// respectif) et l'envoie par email :
//   - à chaque RESPONSABLE_SHIFT actif (avec un email renseigné,
//     profiles.email) : UNIQUEMENT les conducteurs de SA propre équipe,
//     en PIÈCE JOINTE PDF (1 fichier — son shift du jour) ;
//   - à chaque RESPONSABLE et ADMIN actif (avec un email renseigné) :
//     TOUTES les équipes, en PIÈCE JOINTE PDF (3 fichiers — un par shift).
//
// Les PDF reproduisent la même structure que le rapport "Affectation du
// jour" exporté depuis l'appli (§ ShiftBlockPrintable/PrintHeader,
// pages.js) : en-tête TC3PC, une section par VACATION (V1/V2) avec son
// tableau Mat/Nom/Prénom/Vacation/Zone, lignes alternées, section OFF
// (Shift 3 dimanche) si concernée — générés ici en PDF VECTORIEL (pdf-lib),
// PAS par capture d'écran (html2canvas, utilisé par l'appli, dépend d'un
// vrai navigateur, indisponible en Edge Function). Rendu net à toute
// résolution, mais sans le logo graphique TC3PC (texte seul) : éviter une
// dépendance réseau supplémentaire (récupération de l'image) qui
// ferait échouer tout l'envoi si elle échoue.
//
// Le corps de l'email reste un tableau HTML simple (aperçu rapide dans la
// boîte de réception) — les PDF joints sont la version faisant référence.
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut,
// automatiquement disponibles ici. Réutilise GMAIL_USER / GMAIL_APP_PASSWORD
// (déjà configurés pour send-conge-email) — aucun nouveau secret à ajouter.
//
// DÉPLOIEMENT (Dashboard Supabase, comme send-conge-email/request-password-reset) :
//   Edge Functions > Create a new function > "daily-affectation-email" >
//   coller ce fichier > Deploy. Puis exécuter
//   migration_007_cron_affectation_email.sql pour programmer l'appel
//   quotidien à 06h00.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GMAIL_USER = Deno.env.get("GMAIL_USER");
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

// ==========================================
// RTG_CONFIG — copié tel quel depuis src/data.js (config métier statique,
// ne change presque jamais — voir son en-tête).
// ==========================================
const RTG_CONFIG = {
  nbEquipes: 3,
  shifts: [
    { id: "S1", label: "Shift 1", start: "07:00", end: "15:00" },
    { id: "S2", label: "Shift 2", start: "15:00", end: "23:00" },
    { id: "S3", label: "Shift 3", start: "23:00", end: "07:00" }
  ],
  vacations: {
    S1: [{ id: "V1", start: "07:00", end: "11:00" }, { id: "V2", start: "11:00", end: "15:00" }],
    S2: [{ id: "V1", start: "15:00", end: "19:00" }, { id: "V2", start: "19:00", end: "23:00" }],
    S3: [{ id: "V1", start: "23:00", end: "03:00" }, { id: "V2", start: "03:00", end: "07:00" }]
  },
  zones: ["A", "B", "C", "D", "E", "F", "G", "H"],
  vacationCycle: ["V1", "V2"],
  reposMensuel: 6,
  reposReductionParJoursCongé: 5,
  restDayWeightByDow: [1, 1, 1, 1, 1, 2, 4],
  restDayWeightSaturdayShift2: 4,
  restDayWeightByShift: { S1: 1, S2: 0.75, S3: 1 },
  restDayLabelBiasByShift: {
    S1: { V1: 13, V2: 17 },
    S2: { V1: 20, V2: 20 },
    S3: { V1: 18, V2: 12 }
  },
  sundayVacationCap: 6,
  restDayMinSaturday: 4,
  restDayMinSunday: 5,
  restDayShift3Present: {
    V1: { min: 8, max: 9 },
    V2: { min: 5, max: 7 }
  },
  offShift3Dimanche: true,
  exceptionDimancheLundi: true,
  shiftRotationCycleDefault: ["S1", "S3", "S2"],
  referenceWeekStart: "2026-07-27",
  rotationReferenceDate: "2026-08-01",
  reposReferenceDate: "2026-10-01",
  holidays: [
    { date: "2026-01-01", label: "Jour de l'An" },
    { date: "2026-01-11", label: "Manifeste de l'Indépendance" },
    { date: "2026-01-14", label: "Nouvel An Amazigh (Yennayer)" },
    { date: "2026-03-20", label: "Aïd al-Fitr (1er jour)" },
    { date: "2026-03-21", label: "Aïd al-Fitr (2e jour)" },
    { date: "2026-05-01", label: "Fête du Travail" },
    { date: "2026-05-27", label: "Aïd al-Adha (1er jour)" },
    { date: "2026-05-28", label: "Aïd al-Adha (2e jour)" },
    { date: "2026-06-17", label: "1er Moharram (Nouvel An Hégire)" },
    { date: "2026-07-30", label: "Fête du Trône" },
    { date: "2026-08-14", label: "Récupération d'Oued Ed-Dahab" },
    { date: "2026-08-20", label: "Révolution du Roi et du Peuple" },
    { date: "2026-08-21", label: "Fête de la Jeunesse" },
    { date: "2026-08-26", label: "Aïd al-Mawlid" },
    { date: "2026-10-31", label: "Fête de l'Unité" },
    { date: "2026-11-06", label: "Anniversaire de la Marche Verte" },
    { date: "2026-11-18", label: "Fête de l'Indépendance" }
  ]
};

// ==========================================
// Moteurs de planification — copiés tels quels depuis src/engines/*.js.
// Aucun ne touche window/document/localStorage (vérifié) : ce sont des
// fonctions pures opérant uniquement sur l'objet `state` construit plus bas
// depuis Supabase — portables sans adaptation entre le navigateur et Deno.
// L'ORDRE de déclaration ci-dessous n'a pas d'importance (les références
// croisées, ex. PlanningEngine -> HolidayEngine, sont dans des CORPS de
// méthode exécutés seulement au moment de l'appel, jamais à la déclaration).
// ==========================================

// ---------- dateUtils.js ----------
const RTGDate = {
  MS_DAY: 86400000,
  parseISO(s: string) {
    const parts = s.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  },
  toISO(date: Date) {
    return date.toISOString().slice(0, 10);
  },
  makeDate(year: number, month: number, day: number) {
    return new Date(Date.UTC(year, month - 1, day));
  },
  addDays(date: Date, n: number) {
    return new Date(date.getTime() + n * this.MS_DAY);
  },
  daysInMonth(month: number, year: number) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  },
  dowMon0(date: Date) {
    const d = date.getUTCDay();
    return d === 0 ? 6 : d - 1;
  },
  isSunday(date: Date) {
    return date.getUTCDay() === 0;
  },
  isMonday(date: Date) {
    return date.getUTCDay() === 1;
  },
  startOfWeekMonday(date: Date) {
    return this.addDays(date, -this.dowMon0(date));
  },
  diffDays(a: Date, b: Date) {
    return Math.round((b.getTime() - a.getTime()) / this.MS_DAY);
  }
};

// ---------- shiftRotationEngine.js ----------
const ShiftRotationEngine = {
  getTeamShiftForDate(team: any, date: Date, config: any) {
    const cycle = team.shiftCycle && team.shiftCycle.length ? team.shiftCycle : config.shiftRotationCycleDefault;
    const refWeek = RTGDate.startOfWeekMonday(RTGDate.parseISO(config.referenceWeekStart));
    const targetWeek = RTGDate.startOfWeekMonday(date);
    const diffWeeks = Math.floor(RTGDate.diffDays(refWeek, targetWeek) / 7);
    const len = cycle.length;
    const idx = ((diffWeeks % len) + len) % len;
    return cycle[idx];
  }
};

// ---------- absenceEngine.js ----------
const AbsenceEngine = {
  findRecord(records: any[], driverId: string, isoDate: string) {
    return (records || []).find(r => r.driverId === driverId && isoDate >= r.dateDebut && isoDate <= r.dateFin);
  },
  activeConges(state: any) {
    return (state.conges || []).filter((c: any) => c.statut !== "EN_ATTENTE" && c.statut !== "REFUSE");
  },
  getFixedStatus(driver: any, isoDate: string, state: any) {
    if (this.findRecord(this.activeConges(state), driver.id, isoDate)) return "CONGE";
    if (this.findRecord(state.maladies, driver.id, isoDate)) return "MALADIE";
    const abs = this.findRecord(state.absences, driver.id, isoDate);
    if (abs) return abs.type === "FORMATION" ? "FORMATION" : "ABSENCE";
    return null;
  }
};

// ---------- exceptionEngine.js ----------
const ExceptionEngine = {
  find(state: any, driverId: string, isoDate: string, type: string) {
    return (state.heuresExceptionnelles || []).find((r: any) => r.driverId === driverId && r.type === type && isoDate >= r.dateDebut && isoDate <= r.dateFin);
  },
  hasWorked(state: any, driverId: string, isoDate: string, type: string) {
    return !!this.find(state, driverId, isoDate, type);
  }
};

// ---------- holidayEngine.js ----------
const HolidayEngine = {
  getHoliday(isoDate: string, config: any) {
    return (config.holidays || []).find((h: any) => h.date === isoDate) || null;
  },
  getEffectiveHoliday(date: Date, team: any, config: any) {
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

// ---------- vacationRotationEngine.js ----------
const VacationRotationEngine = {
  _cache: {} as Record<string, any>,
  clearCache() { this._cache = {}; },
  getVacationForDate(driver: any, date: Date, state: any, team?: any) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];
    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) { this._cache[key] = null; return null; }
    let toggles = 0;
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const next = RTGDate.addDays(cursor, 1);
      let freeze = state.config.exceptionDimancheLundi && RTGDate.isSunday(cursor) && RTGDate.isMonday(next);
      // Dimanche chômé (3ème shift) : geler aussi samedi->dimanche, pour que
      // le lundi reprenne la vacation du samedi (dernier jour travaillé) —
      // sans effet pour S1/S2 (dimanche travaillé normalement).
      if (!freeze && team && state.config.offShift3Dimanche && RTGDate.isSunday(next)) {
        if (ShiftRotationEngine.getTeamShiftForDate(team, cursor, state.config) === "S3") freeze = true;
      }
      if (!freeze) toggles++;
      cursor = next;
    }
    const start = driver.initialVacation === "V2" ? 1 : 0;
    const result = (start + toggles) % 2 === 0 ? "V1" : "V2";
    this._cache[key] = result;
    return result;
  }
};

// ---------- planningEngine.js (déclaré avant ZoneRotationEngine car ce
// dernier appelle PlanningEngine.getDailyStatus — sans effet réel puisque
// tous les appels ont lieu dans des corps de méthode, jamais à la
// déclaration, mais gardé dans cet ordre pour rester lisible). ----------
const FIXED_ABSENCE_STATUSES = ["CONGE", "MALADIE", "ABSENCE", "FORMATION"];

const PlanningEngine = {
  getDailyStatus(driver: any, date: Date, state: any, teams: any[]) {
    const iso = RTGDate.toISO(date);
    const fixed = AbsenceEngine.getFixedStatus(driver, iso, state);
    if (fixed) return fixed;
    const team = teams.find(t => t.id === driver.teamId);
    if (!team) return "ABSENCE";
    const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
    const holiday = HolidayEngine.getEffectiveHoliday(date, team, state.config);
    const holidayWorked = holiday && ExceptionEngine.hasWorked(state, driver.id, iso, "FERIE_TRAVAILLE");
    if (holiday && !holidayWorked) return "FERIE";
    const sundayS3Off = state.config.offShift3Dimanche && shift === "S3" && RTGDate.isSunday(date);
    const sundayWorked = sundayS3Off && ExceptionEngine.hasWorked(state, driver.id, iso, "DIMANCHE_S3");
    if (sundayS3Off && !sundayWorked) return "OFF";
    if (holidayWorked || sundayWorked) return "PRESENT";
    const restDays = RestDayEngine.getRestDaysForMonth(driver, date.getUTCMonth() + 1, date.getUTCFullYear(), state, teams);
    if (restDays.indexOf(date.getUTCDate()) !== -1) return "REPOS";
    return "PRESENT";
  },

  generateDailyAssignments(isoDate: string, state: any) {
    const date = RTGDate.parseISO(isoDate);
    const teams = state.teams;
    const month = date.getUTCMonth() + 1, year = date.getUTCFullYear(), dom = date.getUTCDate();
    const base = state.drivers.filter((d: any) => d.actif !== false).map((driver: any) => {
      const team = teams.find((t: any) => t.id === driver.teamId);
      const status = this.getDailyStatus(driver, date, state, teams);
      let shift = null, vacation = null, zone = null, startTime = null, endTime = null;
      let vacationBalanceAlert = false, restCorrection = null;
      if (status === "PRESENT" && team) {
        shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        vacation = VacationRotationEngine.getVacationForDate(driver, date, state, team);
        zone = ZoneRotationEngine.getZoneForDate(driver, date, state, teams);
        const vacDefs = state.config.vacations[shift] || [];
        const vacDef = vacDefs.find((v: any) => v.id === vacation);
        if (vacDef) { startTime = vacDef.start; endTime = vacDef.end; }
        if (shift === "S1" || shift === "S3") {
          vacationBalanceAlert = RestDayEngine.hasVacationBalanceAlert(driver, month, year, state, teams, dom);
        }
      } else if (status === "REPOS") {
        restCorrection = RestDayEngine.isVacationBalanceCorrection(driver, month, year, state, teams, dom) ? "equilibrage_V1_V2" : null;
      }
      return { driver, driverId: driver.id, team, status, shift, vacation, zone, startTime, endTime, vacationBalanceAlert, restCorrection };
    });

    const groups: Record<string, any[]> = {};
    base.forEach((b: any) => {
      if (b.status !== "PRESENT" || !b.shift || !b.vacation) return;
      const key = b.shift + "_" + b.vacation;
      (groups[key] = groups[key] || []).push(b);
    });
    Object.keys(groups).forEach(key => {
      ZoneBalancingEngine.assignZonesForSlot(groups[key], state.config.zones);
    });

    return base.map((b: any) => {
      const driver = b.driver, team = b.team;
      let shift = b.shift, vacation = b.vacation, zone = b.zone, startTime = b.startTime, endTime = b.endTime;
      let source = "AUTO";
      let finalStatus = b.status;
      const isFixedAbsence = FIXED_ABSENCE_STATUSES.indexOf(b.status) !== -1;
      const override = isFixedAbsence ? null : state.manualOverrides[isoDate + "_" + driver.id];
      if (override) {
        if (override.shift !== undefined) shift = override.shift;
        if (override.vacation !== undefined) vacation = override.vacation;
        if (override.zone !== undefined) zone = override.zone;
        if (override.status !== undefined) finalStatus = override.status;
        if (override.startTime !== undefined) startTime = override.startTime;
        if (override.endTime !== undefined) endTime = override.endTime;
        source = "MANUAL";
      }
      return {
        id: isoDate + "_" + driver.id, date: isoDate, driverId: driver.id, matricule: driver.matricule,
        nom: driver.nom, prenom: driver.prenom, teamId: driver.teamId, teamNom: team ? team.nom : "",
        shift, vacation, startTime, endTime, zone, status: finalStatus, source,
        vacationBalanceAlert: override ? false : !!b.vacationBalanceAlert,
        restCorrection: override ? null : (b.restCorrection || null)
      };
    });
  }
};

// ---------- zoneRotationEngine.js ----------
const ZoneRotationEngine = {
  _cache: {} as Record<string, any>,
  clearCache() { this._cache = {}; },
  getZoneIndexForDate(driver: any, date: Date, state: any, teams: any[]) {
    const zones = state.config.zones;
    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    if (date.getTime() < refDate.getTime()) return null;
    let zoneIdx = Math.max(0, zones.indexOf(driver.initialZone));
    let cursor = refDate;
    while (cursor.getTime() < date.getTime()) {
      const status = PlanningEngine.getDailyStatus(driver, cursor, state, teams);
      if (status === "PRESENT") zoneIdx = (zoneIdx + 1) % zones.length;
      cursor = RTGDate.addDays(cursor, 1);
    }
    return zoneIdx;
  },
  getZoneForDate(driver: any, date: Date, state: any, teams: any[]) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];
    const zones = state.config.zones;
    const zoneIdx = this.getZoneIndexForDate(driver, date, state, teams);
    const statusToday = PlanningEngine.getDailyStatus(driver, date, state, teams);
    const result = (zoneIdx !== null && statusToday === "PRESENT") ? zones[zoneIdx] : null;
    this._cache[key] = result;
    return result;
  }
};

// ---------- zoneBalancingEngine.js ----------
const DOUBLING_ORDER = ["C", "D", "B", "E", "F", "G", "H"];
const ZoneBalancingEngine = {
  assignZonesForSlot(entries: any[], zoneList: string[]) {
    if (!zoneList || zoneList.length === 0 || entries.length === 0) return;
    const n = entries.length;
    const others = zoneList.slice(1);
    const ordered = entries.slice().sort((a, b) => {
      const za = zoneList.indexOf(a.zone);
      const zb = zoneList.indexOf(b.zone);
      if (za !== zb) return za - zb;
      return String(a.driverId).localeCompare(String(b.driverId));
    });
    if (n < 8) {
      if (others.length === 0) return;
      ordered.forEach((e, i) => { e.zone = others[i % others.length]; });
      return;
    }
    const base = Math.floor(n / zoneList.length);
    const remainder = n % zoneList.length;
    const doublingOrder = DOUBLING_ORDER.filter(z => others.indexOf(z) !== -1)
      .concat(others.filter(z => DOUBLING_ORDER.indexOf(z) === -1));
    let idx = 0;
    for (let r = 0; r < base && idx < n; r++) {
      for (let z = 0; z < zoneList.length && idx < n; z++) {
        ordered[idx].zone = zoneList[z];
        idx++;
      }
    }
    for (let r = 0; r < remainder && idx < n; r++) {
      ordered[idx].zone = doublingOrder[r % doublingOrder.length];
      idx++;
    }
    const countByZone: Record<string, number> = {};
    ordered.forEach(e => { countByZone[e.zone] = (countByZone[e.zone] || 0) + 1; });
    const seenByZone: Record<string, number> = {};
    ordered.forEach(e => {
      if (countByZone[e.zone] > 1) {
        seenByZone[e.zone] = (seenByZone[e.zone] || 0) + 1;
        e.zone = String(seenByZone[e.zone]).padStart(2, "0") + e.zone;
      }
    });
  }
};

// ---------- restDayEngine.js (copié à l'identique — voir son en-tête pour
// le détail des règles métier) ----------
const LABEL_BIAS_EXPONENT = 2;
const RestDayEngine: any = {
  _cache: {} as Record<string, any>,
  _teamCache: {} as Record<string, any>,
  _extraCache: {} as Record<string, any>,
  _pointerCache: {} as Record<string, any>,

  clearCache() {
    this._cache = {};
    this._teamCache = {};
    this._extraCache = {};
    this._pointerCache = {};
  },

  countCongeDaysInMonth(driver: any, month: number, year: number, state: any) {
    const dim = RTGDate.daysInMonth(month, year);
    let count = 0;
    for (let d = 1; d <= dim; d++) {
      const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
      if (AbsenceEngine.getFixedStatus(driver, iso, state)) count++;
    }
    return count;
  },

  getCandidatesForDriver(driver: any, month: number, year: number, state: any, team: any) {
    const dim = RTGDate.daysInMonth(month, year);
    const candidates: number[] = [];
    for (let d = 1; d <= dim; d++) {
      const date = RTGDate.makeDate(year, month, d);
      const iso = RTGDate.toISO(date);
      if (AbsenceEngine.getFixedStatus(driver, iso, state)) continue;
      if (state.manualOverrides[iso + "_" + driver.id]) continue;
      if (HolidayEngine.getEffectiveHoliday(date, team, state.config)) continue;
      if (team) {
        const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        if (state.config.offShift3Dimanche && shift === "S3" && RTGDate.isSunday(date)) continue;
      }
      candidates.push(d);
    }
    return candidates;
  },

  getTeamRestDays(team: any, month: number, year: number, state: any) {
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    if (this._teamCache[key]) return this._teamCache[key];

    const teamDrivers = state.drivers
      .filter((dr: any) => dr.teamId === (team ? team.id : null) && dr.actif !== false)
      .slice()
      .sort((a: any, b: any) => {
        const oa = a.ordreAffichage, ob = b.ordreAffichage;
        if (oa == null && ob == null) return 0;
        if (oa == null) return 1;
        if (ob == null) return -1;
        return oa - ob;
      });
    const N = teamDrivers.length || 1;
    const dim = RTGDate.daysInMonth(month, year);
    const results: Record<string, number[]> = {};

    const groupSizes: any = { V1: 0, V2: 0 };
    teamDrivers.forEach((dr: any) => {
      if (dr.initialVacation === "V1" || dr.initialVacation === "V2") groupSizes[dr.initialVacation]++;
    });
    const maxPerDayByGroup: any = {
      V1: Math.max(2, Math.ceil(groupSizes.V1 * 0.3)),
      V2: Math.max(2, Math.ceil(groupSizes.V2 * 0.3))
    };
    const minSaturdayByGroup: any = {
      V1: Math.min(groupSizes.V1, state.config.restDayMinSaturday || 0),
      V2: Math.min(groupSizes.V2, state.config.restDayMinSaturday || 0)
    };
    const minSundayByGroup: any = {
      V1: Math.min(groupSizes.V1, state.config.restDayMinSunday || 0),
      V2: Math.min(groupSizes.V2, state.config.restDayMinSunday || 0)
    };
    const sundayCeilingByGroup: any = {
      V1: Math.max(maxPerDayByGroup.V1, groupSizes.V1 - (state.config.sundayVacationCap || 6), minSundayByGroup.V1),
      V2: Math.max(maxPerDayByGroup.V2, groupSizes.V2 - (state.config.sundayVacationCap || 6), minSundayByGroup.V2)
    };
    const saturdayCeilingByGroup: any = {
      V1: Math.max(maxPerDayByGroup.V1, minSaturdayByGroup.V1),
      V2: Math.max(maxPerDayByGroup.V2, minSaturdayByGroup.V2)
    };
    const dayShift: Record<number, string> = {};
    if (team) {
      for (let d = 1; d <= dim; d++) {
        dayShift[d] = ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.makeDate(year, month, d), state.config);
      }
    }
    const isSundayS1S2Day = (d: number) => {
      if (!team || d < 1 || d > dim) return false;
      const date = RTGDate.makeDate(year, month, d);
      if (!RTGDate.isSunday(date)) return false;
      const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
      return shift === "S1" || shift === "S2";
    };
    const isSaturdayDay = (d: number) => !!(team && d >= 1 && d <= dim && RTGDate.dowMon0(RTGDate.makeDate(year, month, d)) === 5);
    const shift3PresentCfg = state.config.restDayShift3Present || {};
    const shift3BoundsByGroup: any = {};
    ["V1", "V2"].forEach(g => {
      const cfg = shift3PresentCfg[g];
      if (!cfg || typeof cfg.min !== "number" || typeof cfg.max !== "number") return;
      shift3BoundsByGroup[g] = {
        floor: Math.max(0, groupSizes[g] - cfg.max),
        ceiling: Math.max(0, groupSizes[g] - cfg.min)
      };
    });
    const isShift3Day = (d: number) => !!(team && d >= 1 && d <= dim && dayShift[d] === "S3");
    const capForGroup = (group: string, day: number | null) => {
      let cap = maxPerDayByGroup[group] !== undefined ? maxPerDayByGroup[group] : Math.max(2, Math.ceil(N * 0.3));
      if (day == null) return cap;
      if (isSundayS1S2Day(day) && sundayCeilingByGroup[group] !== undefined) cap = sundayCeilingByGroup[group];
      else if (isSaturdayDay(day) && saturdayCeilingByGroup[group] !== undefined) cap = saturdayCeilingByGroup[group];
      const s3 = isShift3Day(day) ? shift3BoundsByGroup[group] : null;
      if (s3) cap = Math.max(s3.floor, Math.min(cap, s3.ceiling));
      return cap;
    };
    const minRestForDay = (group: string, day: number) => {
      let min = 0;
      if (isSundayS1S2Day(day)) min = minSundayByGroup[group] || 0;
      else if (isSaturdayDay(day)) min = minSaturdayByGroup[group] || 0;
      const s3 = isShift3Day(day) ? shift3BoundsByGroup[group] : null;
      if (s3) min = Math.max(min, s3.floor);
      return Math.min(min, capForGroup(group, day));
    };
    const dayUsage: any = { V1: {}, V2: {} };
    const usageAt = (group: string, day: number) => (dayUsage[group] && dayUsage[group][day]) || 0;
    const bumpUsage = (group: string, day: number) => {
      if (!dayUsage[group]) return;
      dayUsage[group][day] = (dayUsage[group][day] || 0) + 1;
    };

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthLastDay = RTGDate.daysInMonth(prevMonth, prevYear);
    const historyEnabled = !!team && RTGDate.parseISO(state.config.reposReferenceDate || state.config.rotationReferenceDate).getTime() < RTGDate.makeDate(prevYear, prevMonth, prevMonthLastDay).getTime();

    const manualRestByDriver: Record<string, Set<number>> = {};
    teamDrivers.forEach((driver: any) => {
      const set = new Set<number>();
      for (let d = 1; d <= dim; d++) {
        const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
        const ov = state.manualOverrides[iso + "_" + driver.id];
        if (ov && ov.status === "REPOS") set.add(d);
      }
      manualRestByDriver[driver.id] = set;
    });

    teamDrivers.forEach((driver: any) => {
      const group = driver.initialVacation;
      manualRestByDriver[driver.id].forEach(d => { bumpUsage(group, d); });
    });

    const prevMonthRestByDriver: Record<string, boolean> = {};
    if (historyEnabled) {
      teamDrivers.forEach((driver: any) => {
        const prevDays = this.getRestDaysForMonth(driver, prevMonth, prevYear, state, state.teams);
        prevMonthRestByDriver[driver.id] = prevDays.indexOf(prevMonthLastDay) !== -1;
      });
    }

    const shiftRuns: { shift: string; days: number[] }[] = [];
    if (team) {
      for (let d = 1; d <= dim; d++) {
        const last = shiftRuns[shiftRuns.length - 1];
        if (last && last.shift === dayShift[d]) last.days.push(d);
        else shiftRuns.push({ shift: dayShift[d], days: [d] });
      }
    }
    const shiftWeights = state.config.restDayWeightByShift || { S1: 1, S2: 1, S3: 1 };
    const labelBiasByShift = state.config.restDayLabelBiasByShift || {};

    const isAutoOffDay = (d: number) => !!(team && d >= 1 && d <= dim && dayShift[d] === "S3"
      && state.config.offShift3Dimanche && RTGDate.isSunday(RTGDate.makeDate(year, month, d)));
    const adjacentDaysFor = (day: number) => {
      const days = [day - 1, day + 1];
      if (isAutoOffDay(day - 1)) days.push(day - 2);
      if (isAutoOffDay(day + 1)) days.push(day + 2);
      return days;
    };
    const blockedByAdjacency = (used: Set<number>, day: number) => adjacentDaysFor(day).some(d => used.has(d));

    const distributeByWeight = (total: number, groups: any[]) => {
      const shares: Record<string, number> = {};
      let totalWeighted = 0;
      groups.forEach(g => { g.weighted = g.days.length * (g.weight || 0); totalWeighted += g.weighted; });
      if (totalWeighted <= 0) {
        groups.forEach(g => { shares[g.key] = 0; });
        return shares;
      }
      const base = Math.floor(total / groups.length);
      let allocated = 0;
      const remainders: any[] = [];
      groups.forEach(g => {
        const floor = Math.min(base, g.days.length);
        shares[g.key] = floor;
        allocated += floor;
        const raw = total * g.weighted / totalWeighted;
        remainders.push({ key: g.key, rem: raw - floor, cap: g.days.length });
      });
      let leftover = total - allocated;
      remainders.sort((a, b) => b.rem - a.rem);
      while (leftover > 0) {
        const r = remainders.find(r => shares[r.key] < r.cap);
        if (!r) break;
        shares[r.key]++;
        leftover--;
        remainders.splice(remainders.indexOf(r), 1);
        remainders.push(r);
      }
      return shares;
    };

    const splitDemandAcrossDays = (total: number, days: number[], weightForDay: (d: number) => number, minForDay?: (d: number) => number) => {
      const weights = days.map(weightForDay);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const shares: Record<number, number> = {};
      days.forEach(d => { shares[d] = 0; });
      if (total <= 0) return shares;

      let reserved = 0;
      if (minForDay) {
        const mins = days.map(d => Math.max(0, minForDay(d) || 0));
        const totalMin = mins.reduce((a, b) => a + b, 0);
        if (totalMin > 0 && totalMin <= total) {
          days.forEach((d, i) => { shares[d] += mins[i]; });
          reserved = totalMin;
        } else if (totalMin > total) {
          let allocated = 0;
          const minRemainders: any[] = [];
          days.forEach((d, i) => {
            const raw = total * mins[i] / totalMin;
            const floor = Math.floor(raw);
            shares[d] += floor;
            allocated += floor;
            minRemainders.push({ day: d, rem: raw - floor });
          });
          let minLeftover = total - allocated;
          minRemainders.sort((a, b) => b.rem - a.rem);
          let mIdx = 0;
          while (minLeftover > 0 && minRemainders.length > 0) {
            shares[minRemainders[mIdx % minRemainders.length].day]++;
            minLeftover--;
            mIdx++;
          }
          reserved = total;
        }
      }
      const remaining = total - reserved;
      if (remaining <= 0 || totalWeight <= 0) return shares;

      let allocated = 0;
      const remainders: any[] = [];
      days.forEach((d, i) => {
        const raw = remaining * weights[i] / totalWeight;
        const floor = Math.floor(raw);
        shares[d] += floor;
        allocated += floor;
        remainders.push({ day: d, rem: raw - floor });
      });
      let leftover = remaining - allocated;
      remainders.sort((a, b) => b.rem - a.rem);
      let idx = 0;
      while (leftover > 0 && remainders.length > 0) {
        shares[remainders[idx % remainders.length].day]++;
        leftover--;
        idx++;
      }
      return shares;
    };

    const driverState: Record<string, any> = {};
    teamDrivers.forEach((driver: any) => {
      const candidates = this.getCandidatesForDriver(driver, month, year, state, team);
      const congeDays = this.countCongeDaysInMonth(driver, month, year, state);
      const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
      const quota = Math.max(0, state.config.reposMensuel - reduction);

      const chosen: number[] = [];
      const used = new Set<number>();
      manualRestByDriver[driver.id].forEach(d => { chosen.push(d); used.add(d); });
      if (prevMonthRestByDriver[driver.id]) used.add(0);

      const remainingQuota = Math.max(0, Math.min(quota, candidates.length) - chosen.length);

      const needsByBucket: Record<string, number> = {};
      if (team && remainingQuota > 0) {
        const usedSet = used;
        const occBuckets = shiftRuns.map((run, idx) => ({
          key: "occ" + idx,
          days: run.days.filter(d => !usedSet.has(d)),
          weight: shiftWeights[run.shift] || 1
        }));
        const shares = distributeByWeight(remainingQuota, occBuckets);
        occBuckets.forEach(b => {
          if (shares[b.key] > 0) needsByBucket[b.key] = shares[b.key];
        });
      }

      driverState[driver.id] = { driver, chosen, used, remainingQuota, needsByBucket, candidateSet: new Set(candidates) };
    });

    if (!team) {
      teamDrivers.forEach((driver: any) => {
        const st = driverState[driver.id];
        let need = st.remainingQuota;
        if (need <= 0) return;
        const candidates = this.getCandidatesForDriver(driver, month, year, state, team).filter((d: number) => !st.used.has(d));
        for (const day of candidates) {
          if (need <= 0) break;
          if (blockedByAdjacency(st.used, day)) continue;
          st.chosen.push(day);
          st.used.add(day);
          need--;
        }
      });
    } else {
      const blockDrivers: any = { V1: [], V2: [] };
      teamDrivers.forEach((driver: any) => {
        if (driver.initialVacation === "V1" || driver.initialVacation === "V2") {
          blockDrivers[driver.initialVacation].push(driver);
        }
      });

      const labelForBlock: any = { V1: {}, V2: {} };
      ["V1", "V2"].forEach(block => {
        const blockStub = { id: "__block_" + block, initialVacation: block };
        for (let d = 1; d <= dim; d++) {
          labelForBlock[block][d] = VacationRotationEngine.getVacationForDate(blockStub, RTGDate.makeDate(year, month, d), state, team);
        }
      });

      const dowWeightFor = (day: number) => {
        const dow = RTGDate.dowMon0(RTGDate.makeDate(year, month, day));
        if (dow === 5 && dayShift[day] === "S2" && state.config.restDayWeightSaturdayShift2) {
          return state.config.restDayWeightSaturdayShift2;
        }
        const arr = state.config.restDayWeightByDow;
        return (arr && arr[dow]) || 1;
      };
      const dayWeightForBlock = (block: string, day: number) => {
        let weight = dowWeightFor(day);
        const shift = dayShift[day];
        const ratio = shift && labelBiasByShift[shift];
        if (ratio && ratio.V1 > 0 && ratio.V2 > 0) {
          const label = labelForBlock[block] && labelForBlock[block][day];
          if (label === "V1" || label === "V2") weight *= 1 / Math.pow(ratio[label], LABEL_BIAS_EXPONENT);
        }
        return weight;
      };

      ["V1", "V2"].forEach(block => {
        const blockList = blockDrivers[block];
        const M = blockList.length || 1;
        const pointerCacheKey = "esc_" + (team ? team.id : "none") + "_" + block;
        const prevPointer = historyEnabled ? this._pointerCache[pointerCacheKey + "_" + prevYear + "_" + prevMonth] : undefined;
        let pointer = (typeof prevPointer === "number") ? prevPointer % M : 0;

        shiftRuns.forEach((run, idx) => {
          const bucketKey = "occ" + idx;
          const needing = blockList.filter((dr: any) => (driverState[dr.id].needsByBucket[bucketKey] || 0) > 0);
          const totalDemand = needing.reduce((sum: number, dr: any) => sum + driverState[dr.id].needsByBucket[bucketKey], 0);
          if (totalDemand === 0) return;
          const openDays = run.days.filter(d => usageAt(block, d) < capForGroup(block, d));
          const dayShares = splitDemandAcrossDays(totalDemand, openDays.length > 0 ? openDays : run.days, d => dayWeightForBlock(block, d), d => minRestForDay(block, d));

          let placed = 0;
          run.days.forEach(day => {
            let capLeft = Math.min(dayShares[day] || 0, Math.max(0, capForGroup(block, day) - usageAt(block, day)));
            let tries = 0;
            while (capLeft > 0 && tries < M) {
              const dr = blockList[pointer];
              pointer = (pointer + 1) % M;
              tries++;
              const st = driverState[dr.id];
              if (st.remainingQuota <= 0 || !st.candidateSet.has(day) || st.used.has(day)
                  || blockedByAdjacency(st.used, day)) continue;
              st.chosen.push(day);
              st.used.add(day);
              bumpUsage(block, day);
              if (st.needsByBucket[bucketKey] > 0) st.needsByBucket[bucketKey]--;
              st.remainingQuota--;
              capLeft--;
              placed++;
            }
          });

          let shortfall = totalDemand - placed;
          let attempts = 0;
          while (shortfall > 0 && attempts < M * 2) {
            const dr = blockList[pointer];
            pointer = (pointer + 1) % M;
            attempts++;
            const st = driverState[dr.id];
            if (st.remainingQuota <= 0) continue;
            const eligibleDays = run.days.filter(d => st.candidateSet.has(d) && !st.used.has(d) && !blockedByAdjacency(st.used, d) && usageAt(block, d) < capForGroup(block, d));
            if (eligibleDays.length === 0) continue;
            const day = eligibleDays.reduce((best, d) => usageAt(block, d) < usageAt(block, best) ? d : best);
            st.chosen.push(day);
            st.used.add(day);
            bumpUsage(block, day);
            if (st.needsByBucket[bucketKey] > 0) st.needsByBucket[bucketKey]--;
            st.remainingQuota--;
            shortfall--;
          }
        });

        this._pointerCache[pointerCacheKey + "_" + year + "_" + month] = pointer;
      });

      teamDrivers.forEach((driver: any) => {
        const st = driverState[driver.id];
        let need = st.remainingQuota;
        if (need <= 0) return;
        const candidates = this.getCandidatesForDriver(driver, month, year, state, team).filter((d: number) => !st.used.has(d));
        const group = driver.initialVacation;
        const place = (day: number) => {
          st.chosen.push(day); st.used.add(day);
          bumpUsage(group, day);
          need--;
        };
        for (const day of candidates) {
          if (need <= 0) break;
          if (blockedByAdjacency(st.used, day)) continue;
          if (usageAt(group, day) >= capForGroup(group, day)) continue;
          place(day);
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if (blockedByAdjacency(st.used, day)) continue;
            if (usageAt(group, day) >= capForGroup(group, day)) continue;
            place(day);
          }
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if (usageAt(group, day) >= capForGroup(group, day)) continue;
            place(day);
          }
        }
      });
    }

    teamDrivers.forEach((driver: any) => {
      results[driver.id] = driverState[driver.id].chosen.sort((a: number, b: number) => a - b);
    });

    this._teamCache[key] = results;
    this._extraCache[key] = { corrections: {}, flags: {} };
    return results;
  },

  isVacationBalanceCorrection(driver: any, month: number, year: number, state: any, teams: any[], day: number) {
    const team = teams.find((t: any) => t.id === driver.teamId);
    this.getTeamRestDays(team, month, year, state);
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    const extra = this._extraCache[key];
    return !!(extra && extra.corrections[driver.id + "_" + day]);
  },

  hasVacationBalanceAlert(driver: any, month: number, year: number, state: any, teams: any[], day: number) {
    const team = teams.find((t: any) => t.id === driver.teamId);
    this.getTeamRestDays(team, month, year, state);
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    const extra = this._extraCache[key];
    return !!(extra && extra.flags[driver.id + "_" + day]);
  },

  getRestDaysForMonth(driver: any, month: number, year: number, state: any, teams: any[]) {
    const key = driver.id + "_" + year + "_" + month;
    if (this._cache[key]) return this._cache[key];
    const team = teams.find((t: any) => t.id === driver.teamId);
    const teamResults = this.getTeamRestDays(team, month, year, state);
    const result = teamResults[driver.id] || [];
    this._cache[key] = result;
    return result;
  }
};

// ==========================================
// Reconstruction de "state" depuis Supabase (accès admin, service_role) —
// mêmes noms de champs que mapDriverRow/mapTeamRow/mapRecordRow/... côté
// frontend (store.js), pour que les moteurs ci-dessus s'y retrouvent
// exactement comme dans l'appli.
// ==========================================
function mapDriverRow(r: any) {
  return {
    id: r.id, matricule: r.matricule, nom: r.nom, prenom: r.prenom, teamId: r.team_id,
    initialZone: r.initial_zone, initialVacation: r.initial_vacation,
    actif: r.actif, ordreAffichage: r.ordre_affichage
  };
}
function mapTeamRow(r: any) { return { id: r.id, nom: r.nom, shiftCycle: r.shift_cycle }; }
function mapRecordRow(r: any) { return { id: r.id, driverId: r.driver_id, dateDebut: r.date_debut, dateFin: r.date_fin, type: r.type }; }
function mapHeureRow(r: any) { return { id: r.id, driverId: r.driver_id, dateDebut: r.date_debut, dateFin: r.date_fin, type: r.type }; }
function mapOverrideRow(r: any) { return { shift: r.shift, vacation: r.vacation, zone: r.zone, status: r.status, startTime: r.start_time, endTime: r.end_time }; }

async function loadState(admin: any) {
  const [teamsRes, driversRes, congesRes, maladiesRes, absencesRes, heuresRes, overridesRes] = await Promise.all([
    admin.from("teams").select("*"),
    admin.from("drivers").select("*").eq("actif", true),
    admin.from("conges").select("*"),
    admin.from("maladies").select("*"),
    admin.from("absences").select("*"),
    admin.from("heures_exceptionnelles").select("*"),
    admin.from("manual_overrides").select("*")
  ]);

  const manualOverrides: Record<string, any> = {};
  (overridesRes.data || []).forEach((r: any) => { manualOverrides[r.date + "_" + r.driver_id] = mapOverrideRow(r); });

  return {
    config: RTG_CONFIG,
    teams: (teamsRes.data || []).map(mapTeamRow),
    drivers: (driversRes.data || []).map(mapDriverRow),
    conges: (congesRes.data || []).map((r: any) => Object.assign(mapRecordRow(r), { statut: r.statut || "VALIDE" })),
    maladies: (maladiesRes.data || []).map(mapRecordRow),
    absences: (absencesRes.data || []).map(mapRecordRow),
    heuresExceptionnelles: (heuresRes.data || []).map(mapHeureRow),
    manualOverrides
  };
}

// ==========================================
// Rendu de l'email (tableau HTML simple — pas une reproduction du rapport
// PDF, voir en-tête du fichier) et envoi via SMTP Gmail.
// ==========================================
const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Présent", REPOS: "Repos", CONGE: "Congé", MALADIE: "Maladie",
  ABSENCE: "Absence", FORMATION: "Formation", OFF: "Off (Shift 3 dimanche)", FERIE: "Jour férié"
};

function formatDateFr(isoDate: string) {
  const d = RTGDate.parseISO(isoDate);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
}

// Corps de l'email : un message court, le détail est dans les PDF joints
// (voir buildShiftReportPdf) — demande explicite de l'exploitant, qui ne
// veut plus le tableau HTML complet dans le corps du message.
function renderShortEmailHtml(isoDate: string, isShiftScoped: boolean, teamNom: string | null) {
  const bodyLine = isShiftScoped
    ? `Veuillez trouver ci-joint l'affectation du jour de votre équipe${teamNom ? " (" + teamNom + ")" : ""}.`
    : "Veuillez trouver ci-joint les affectations du jour des 3 shifts.";
  return `
    <div style="font-family:Arial,sans-serif;color:#1a1a1a;">
      <p>Bonjour,</p>
      <p>${bodyLine}</p>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;">Message automatique — CES Driver Planner, Marsa Maroc TC3PC — ${formatDateFr(isoDate)}.</p>
    </div>`;
}

// Un profil peut avoir plusieurs adresses dans son champ email (saisie
// libre), séparées par une virgule ou un point-virgule — ex. "a@x.com;
// b@y.com" — cas réel observé en usage. Le serveur SMTP rejette une seule
// chaîne "to" contenant plusieurs adresses jointes par ";" ; on les
// sépare donc et on les passe en tableau (accepté nativement par
// client.send({ to: [...] })).
function splitEmails(raw: string) {
  return raw.split(/[;,]/).map(e => e.trim()).filter(Boolean);
}

type PdfAttachment = { filename: string; bytes: Uint8Array };

async function sendAffectationEmail(client: SMTPClient, to: string, isoDate: string, html: string, pdfAttachments: PdfAttachment[]) {
  const recipients = splitEmails(to);
  if (recipients.length === 0) return;
  await client.send({
    from: GMAIL_USER!,
    to: recipients,
    subject: `Affectation du jour — ${isoDate}`,
    // content:"auto" génère automatiquement la version texte brut (fallback
    // pour les clients mail qui n'affichent pas le HTML) à partir de "html".
    content: "auto",
    html,
    attachments: pdfAttachments.map(a => ({ filename: a.filename, contentType: "application/pdf", encoding: "binary", content: a.bytes }))
  });
}

// ==========================================
// Génération des PDF joints — reproduit ShiftBlockPrintable/PrintHeader
// (pages.js) : en-tête TC3PC (texte, sans le logo graphique — voir
// commentaire d'en-tête du fichier), une section par VACATION (V1/V2),
// tableau Mat/Nom/Prénom/Vacation/Zone avec lignes alternées, section OFF
// (Shift 3 dimanche) si concernée. Rendu vectoriel via pdf-lib — pas de
// capture d'écran (html2canvas, indisponible côté serveur).
// ==========================================
const A4_WIDTH = 595.28, A4_HEIGHT = 841.89, PAGE_MARGIN = 36;
const ROW_ALT_BG = rgb(0.878, 0.949, 0.996); // #e0f2fe, identique à l'appli
const ALERT_COLOR = rgb(0.725, 0.11, 0.11); // #b91c1c, identique à l'appli

type PdfCursor = { doc: any; page: any; font: any; boldFont: any; y: number; scale: number };

// `scale` (>=1, jamais > MAX_STRETCH) : étire l'ESPACEMENT vertical
// (hauteur des lignes, marges entre sections) — jamais la taille des
// polices ni la largeur des colonnes — pour qu'un rapport avec peu de
// conducteurs remplisse mieux la page A4 au lieu de rester collé en haut
// avec un grand vide en dessous (retour direct de l'exploitant). Calculé
// une fois via measureShiftReportHeight() avant de dessiner quoi que ce
// soit. Plafonné à 1.8 comme le fait déjà addFittedImageToPage (pages.js)
// pour les exports PDF basés sur html2canvas — un rapport très court garde
// donc un peu de vide, plutôt qu'un espacement excessif entre les lignes.
const MAX_STRETCH = 1.8;

function newPdfCursor(doc: any, font: any, boldFont: any, scale: number): PdfCursor {
  return { doc, page: doc.addPage([A4_WIDTH, A4_HEIGHT]), font, boldFont, y: A4_HEIGHT - PAGE_MARGIN, scale };
}

// Doit rester EXACTEMENT synchronisé avec les incréments verticaux utilisés
// par drawReportHeader/drawSectionTable ci-dessous (à scale=1) — sert
// uniquement à calculer `scale` avant de dessiner quoi que ce soit.
function measureShiftReportHeight(groups: any[], offRows: any[]) {
  const HEADER_HEIGHT = 58; // 40 + 18, cf. drawReportHeader
  const sectionHeight = (rowCount: number) => rowCount === 0 ? 34 : 42 + rowCount * 14;
  let total = HEADER_HEIGHT;
  groups.forEach((g: any) => { total += sectionHeight(g.rows.length); });
  if (offRows.length > 0) total += sectionHeight(offRows.length);
  return total;
}

function ensureSpace(cursor: PdfCursor, needed: number) {
  if (cursor.y - needed < PAGE_MARGIN) {
    cursor.page = cursor.doc.addPage([A4_WIDTH, A4_HEIGHT]);
    cursor.y = A4_HEIGHT - PAGE_MARGIN;
  }
}

function formatDateFrNumeric(isoDate: string) {
  // Même format que RTGDate.formatFr côté frontend (pages.js) : DD/MM/YYYY.
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

function drawReportHeader(cursor: PdfCursor, subtitle: string, generatedLabel: string, countLabel: string) {
  const s = cursor.scale;
  ensureSpace(cursor, 60 * s);
  const topY = cursor.y;
  cursor.page.drawText("TC3PC — Terminal à Conteneurs 3 du Port de Casablanca", { x: PAGE_MARGIN, y: topY - 12 * s, size: 13, font: cursor.boldFont, color: rgb(0.04, 0.08, 0.15) });
  cursor.page.drawText(subtitle, { x: PAGE_MARGIN, y: topY - 27 * s, size: 9, font: cursor.font, color: rgb(0.35, 0.38, 0.45) });
  const genW = cursor.font.widthOfTextAtSize(generatedLabel, 8);
  cursor.page.drawText(generatedLabel, { x: A4_WIDTH - PAGE_MARGIN - genW, y: topY - 10 * s, size: 8, font: cursor.font, color: rgb(0.4, 0.4, 0.45) });
  const countW = cursor.font.widthOfTextAtSize(countLabel, 8);
  cursor.page.drawText(countLabel, { x: A4_WIDTH - PAGE_MARGIN - countW, y: topY - 23 * s, size: 8, font: cursor.font, color: rgb(0.4, 0.4, 0.45) });
  cursor.y = topY - 40 * s;
  cursor.page.drawLine({ start: { x: PAGE_MARGIN, y: cursor.y }, end: { x: A4_WIDTH - PAGE_MARGIN, y: cursor.y }, thickness: 1.5, color: rgb(0.1, 0.12, 0.18) });
  cursor.y -= 18 * s;
}

const PDF_COLUMNS = [
  { label: "Mat", width: 65 },
  { label: "Nom", width: 150 },
  { label: "Prénom", width: 130 },
  { label: "Vacation", width: 75, align: "center" as const },
  { label: "Zone", width: A4_WIDTH - 2 * PAGE_MARGIN - (65 + 150 + 130 + 75), align: "center" as const }
];

function drawSectionTable(cursor: PdfCursor, sectionTitle: string, rows: { cells: string[]; alert: boolean }[]) {
  const s = cursor.scale;
  ensureSpace(cursor, 34 * s);
  cursor.page.drawText(sectionTitle.toUpperCase(), { x: PAGE_MARGIN, y: cursor.y, size: 10, font: cursor.boldFont, color: rgb(0.04, 0.08, 0.15) });
  cursor.y -= 16 * s;
  const totalWidth = PDF_COLUMNS.reduce((sum, c) => sum + c.width, 0);

  if (rows.length === 0) {
    cursor.page.drawText("Aucun conducteur affecté.", { x: PAGE_MARGIN, y: cursor.y, size: 8, font: cursor.font, color: rgb(0.5, 0.5, 0.5) });
    cursor.y -= 18 * s;
    return;
  }

  ensureSpace(cursor, 22 * s);
  let x = PAGE_MARGIN;
  PDF_COLUMNS.forEach(col => {
    cursor.page.drawText(col.label, { x, y: cursor.y, size: 9, font: cursor.boldFont, color: rgb(0, 0, 0) });
    x += col.width;
  });
  cursor.y -= 6 * s;
  cursor.page.drawLine({ start: { x: PAGE_MARGIN, y: cursor.y }, end: { x: PAGE_MARGIN + totalWidth, y: cursor.y }, thickness: 1.2, color: rgb(0.6, 0.6, 0.65) });
  cursor.y -= 12 * s;

  const rowStep = 14 * s;
  rows.forEach((row, idx) => {
    ensureSpace(cursor, rowStep + 2);
    if (idx % 2 === 1) {
      cursor.page.drawRectangle({ x: PAGE_MARGIN - 2, y: cursor.y - 3, width: totalWidth + 4, height: rowStep, color: ROW_ALT_BG });
    }
    let cx = PAGE_MARGIN;
    row.cells.forEach((cellText, i) => {
      const col = PDF_COLUMNS[i];
      const font = i === 1 ? cursor.boldFont : cursor.font;
      const color = row.alert ? ALERT_COLOR : rgb(0.05, 0.05, 0.08);
      let tx = cx;
      if (col.align === "center") {
        const textWidth = font.widthOfTextAtSize(cellText, 9);
        tx = cx + (col.width - textWidth) / 2;
      }
      cursor.page.drawText(cellText, { x: tx, y: cursor.y, size: 9, font, color });
      cx += col.width;
    });
    cursor.y -= rowStep;
  });
  cursor.y -= 8 * s;
}

async function buildShiftReportPdf(dateIso: string, shiftDef: any, teamNom: string, groups: any[], offRows: any[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  // Étire l'espacement vertical pour qu'un rapport avec peu de conducteurs
  // remplisse mieux la page A4 (voir commentaire de MAX_STRETCH).
  const usableHeight = A4_HEIGHT - 2 * PAGE_MARGIN;
  const baseHeight = measureShiftReportHeight(groups, offRows);
  const scale = baseHeight > 0 ? Math.min(MAX_STRETCH, Math.max(1, usableHeight / baseHeight)) : 1;
  const cursor = newPdfCursor(doc, font, boldFont, scale);

  const totalCount = groups.reduce((n, g) => n + g.rows.length, 0) + offRows.length;
  // "->" plutôt que "→" : la police standard PDF (encodage WinAnsi) ne sait
  // pas encoder la flèche unicode "→" (plante à la génération) — sans
  // incidence visuelle notable pour ce texte.
  const subtitle = `Rapport d'affectation journalière — RTG — ${formatDateFrNumeric(dateIso)} — ${shiftDef.label}${shiftDef.start ? ` (${shiftDef.start} -> ${shiftDef.end})` : ""} — ${teamNom}`;
  const now = new Date();
  const generatedLabel = `Généré le ${now.toLocaleDateString("fr-FR")} à ${now.toLocaleTimeString("fr-FR")}`;
  const countLabel = `${totalCount} conducteur${totalCount > 1 ? "s" : ""}`;
  drawReportHeader(cursor, subtitle, generatedLabel, countLabel);

  groups.forEach((g: any) => {
    const sectionTitle = `Vacation ${g.vacation.id} · ${g.vacation.start} -> ${g.vacation.end} — ${g.rows.length} conducteur${g.rows.length > 1 ? "s" : ""}`;
    const rows = g.rows.map((a: any) => ({
      cells: [
        a.matricule,
        a.nom + (a.vacationBalanceAlert ? " (*)" : ""),
        a.prenom,
        a.vacation || "—",
        a.status === "PRESENT" ? (a.zone || "—") : (STATUS_LABELS[a.status] || a.status)
      ],
      alert: !!a.vacationBalanceAlert
    }));
    drawSectionTable(cursor, sectionTitle, rows);
  });

  if (offRows.length > 0) {
    const rows = offRows.map((a: any) => ({ cells: [a.matricule, a.nom, a.prenom, "—", "OFF"], alert: false }));
    drawSectionTable(cursor, `OFF — Shift 3 dimanche — ${offRows.length} conducteur${offRows.length > 1 ? "s" : ""}`, rows);
  }

  cursor.page.drawText("Document généré automatiquement par CES Driver Planner.", { x: PAGE_MARGIN, y: PAGE_MARGIN / 2, size: 7, font, color: rgb(0.5, 0.5, 0.55) });

  return await doc.save();
}

// Reproduit exactement le regroupement de pages.js (AffectationDuJourPage) :
// un conducteur absent (repos/congé/maladie/absence/formation) n'a pas de
// `shift`/`vacation` calculé par PlanningEngine (seuls les présents en ont)
// — on le rattache donc au shift de SON ÉQUIPE ce jour-là (teamShiftMap) et
// à la vacation ACTUELLEMENT AFFICHÉE par son bloc (VacationRotationEngine),
// jamais driver.initialVacation tel quel (qui ne correspond au jour que
// un jour sur deux).
function buildAllShiftReports(assignments: any[], state: any, dateIso: string) {
  const dateObj = RTGDate.parseISO(dateIso);
  const ABSENT_STATUSES = ["REPOS", "CONGE", "MALADIE", "ABSENCE", "FORMATION"];
  const driverById: Record<string, any> = {};
  state.drivers.forEach((d: any) => { driverById[d.id] = d; });
  const teamShiftMap: Record<string, string> = {};
  state.teams.forEach((t: any) => { teamShiftMap[t.id] = ShiftRotationEngine.getTeamShiftForDate(t, dateObj, state.config); });
  const vacationLabelToday: Record<string, string | null> = {};
  state.drivers.forEach((d: any) => { vacationLabelToday[d.id] = VacationRotationEngine.getVacationForDate(d, dateObj, state, state.teams.find((t: any) => t.id === d.teamId)); });
  const byOrdreAffichage = (a: any, b: any) => {
    const oa = (driverById[a.driverId] || {}).ordreAffichage, ob = (driverById[b.driverId] || {}).ordreAffichage;
    if (oa == null && ob == null) return 0;
    if (oa == null) return 1;
    if (ob == null) return -1;
    return oa - ob;
  };

  const offRowsAll = assignments.filter((a: any) => a.status === "OFF").sort(byOrdreAffichage);
  const reports: Record<string, { teamNom: string; groups: any[]; offRows: any[] }> = {};

  state.config.shifts.forEach((s: any) => {
    const team = state.teams.find((t: any) => teamShiftMap[t.id] === s.id);
    if (!team) return;
    const teamAssignments = assignments.filter((a: any) => a.teamId === team.id);
    const absent = teamAssignments.filter((a: any) => ABSENT_STATUSES.indexOf(a.status) !== -1);
    const vacationDefs = state.config.vacations[s.id] || [];
    const groups = vacationDefs.map((v: any) => ({
      vacation: v,
      rows: teamAssignments.filter((a: any) => a.shift === s.id && a.vacation === v.id && a.status === "PRESENT")
        .concat(absent.filter((a: any) => vacationLabelToday[a.driverId] === v.id))
        .sort(byOrdreAffichage)
    }));
    const offRows = s.id === "S3" ? offRowsAll.filter((a: any) => a.teamId === team.id) : [];
    reports[s.id] = { teamNom: team.nom, groups, offRows };
  });

  return { reports, teamShiftMap };
}

// ==========================================
// Point d'entrée
// ==========================================
Deno.serve(async _req => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
      throw new Error("Configuration incomplète (secrets manquants).");
    }
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    RestDayEngine.clearCache();
    ZoneRotationEngine.clearCache();
    VacationRotationEngine.clearCache();

    const todayIso = RTGDate.toISO(new Date());
    const state = await loadState(admin);
    const assignments = PlanningEngine.generateDailyAssignments(todayIso, state);

    const teamById: Record<string, any> = {};
    state.teams.forEach((t: any) => { teamById[t.id] = t; });
    const shiftDefById: Record<string, any> = {};
    (state.config.shifts || []).forEach((s: any) => { shiftDefById[s.id] = s; });

    // Un PDF par shift qui a effectivement une équipe ce jour-là (voir
    // buildAllShiftReports) — généré UNE SEULE FOIS, puis réutilisé pour
    // chaque destinataire concerné (les 3 pour un Responsable/Admin, celui
    // de sa propre équipe pour un Responsable de Shift).
    const { reports, teamShiftMap } = buildAllShiftReports(assignments, state, todayIso);
    const pdfByShift: Record<string, PdfAttachment> = {};
    for (const shiftId of Object.keys(reports)) {
      const r = reports[shiftId];
      const bytes = await buildShiftReportPdf(todayIso, shiftDefById[shiftId] || { id: shiftId, label: shiftId }, r.teamNom, r.groups, r.offRows);
      pdfByShift[shiftId] = { filename: `affectation-${todayIso}-${shiftId}.pdf`, bytes };
    }

    // Test ciblé : { "testEmail": "moi@exemple.com" } dans le corps de la
    // requête envoie UNIQUEMENT à cette adresse (toutes les équipes, les 3
    // PDF) — sans toucher aux vrais destinataires (Responsables/Admin). Utile
    // pour tester depuis le bouton "Test" sans notifier toute l'équipe à
    // chaque essai.
    let testEmail: string | null = null;
    try {
      const body = await _req.json();
      if (body && typeof body.testEmail === "string" && body.testEmail.trim()) testEmail = body.testEmail.trim().toLowerCase();
    } catch { /* corps vide ou non-JSON — comportement normal (cron) */ }

    const { data: profiles, error: profilesError } = testEmail
      ? { data: [{ id: "test", nom: "Test", username: "test", role: "RESPONSABLE", team_id: null, email: testEmail, actif: true }], error: null }
      : await admin
        .from("profiles").select("id,nom,username,role,team_id,email,actif")
        .in("role", ["ADMIN", "RESPONSABLE", "RESPONSABLE_SHIFT"]).eq("actif", true);
    if (profilesError) throw profilesError;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } }
    });

    let sent = 0, skipped = 0;
    const errors: string[] = [];
    // Détail des comptes ignorés (email absent, ou équipe sans conducteur ce
    // jour-là) — renvoyé dans la réponse pour pouvoir diagnostiquer sans
    // avoir à deviner qui a été sauté et pourquoi.
    const skippedDetails: { username: string; nom: string; role: string; reason: string }[] = [];
    for (const p of profiles || []) {
      if (!p.email) {
        skipped++;
        skippedDetails.push({ username: p.username, nom: p.nom, role: p.role, reason: "aucun email renseigné sur le compte" });
        continue;
      }
      const isShiftScoped = p.role === "RESPONSABLE_SHIFT";
      const scoped = isShiftScoped ? assignments.filter(a => a.teamId === p.team_id) : assignments;
      if (scoped.length === 0) {
        skipped++;
        skippedDetails.push({ username: p.username, nom: p.nom, role: p.role, reason: "aucun conducteur dans le périmètre (équipe introuvable ?)" });
        continue;
      }
      const html = renderShortEmailHtml(todayIso, isShiftScoped, isShiftScoped ? ((teamById[p.team_id] || {}).nom || p.team_id) : null);
      // PDF joint(s) : le shift de sa propre équipe pour un Responsable de
      // Shift, les 3 shifts du jour pour un Responsable/Admin.
      const pdfAttachments: PdfAttachment[] = isShiftScoped
        ? (pdfByShift[teamShiftMap[p.team_id]] ? [pdfByShift[teamShiftMap[p.team_id]]] : [])
        : ["S1", "S2", "S3"].map(s => pdfByShift[s]).filter(Boolean);
      try {
        await sendAffectationEmail(client, p.email, todayIso, html, pdfAttachments);
        sent++;
      } catch (e) {
        errors.push(p.email + ": " + (e && (e as Error).message ? (e as Error).message : String(e)));
      }
    }
    await client.close();

    return new Response(JSON.stringify({ ok: true, date: todayIso, testEmail, sent, skipped, skippedDetails, errors }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && (e as Error).message ? (e as Error).message : e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
