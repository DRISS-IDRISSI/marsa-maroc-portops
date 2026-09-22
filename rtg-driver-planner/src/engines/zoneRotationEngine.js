// ==========================================
// RTG DRIVER PLANNER — Moteur de rotation des ZONES (§7-8)
// Rotation zone[0] → zone[1] → ... → zone[dernière] → zone[0], mais UNIQUEMENT
// sur les journées effectivement travaillées : un jour REPOS/CONGÉ/MALADIE/
// ABSENCE/FORMATION/OFF ne fait pas avancer le pointeur de zone du conducteur
// (règle absolue §8). Dépend de PlanningEngine.getDailyStatus pour savoir
// quels jours ont été travaillés depuis la date de référence
// (config.rotationReferenceDate).
//
// La liste des zones dépend de la flotte de l'équipe du conducteur (RTG ou
// CC — § module Chariots Cavalier, zonesForFleet dans data.js).
//
// Pour la flotte CC, la mécanique reste la formule individuelle indépendante
// d'origine (chaque conducteur avance de 1 zone par jour PRESENT, sans lien
// avec les autres conducteurs de son équipe).
//
// Pour la flotte RTG, la règle a été étendue (règle métier confirmée) : la
// zone de demain d'un conducteur dépend de la zone RÉELLEMENT reçue hier
// (après répartition équitable du créneau, ZoneBalancingEngine), pas d'une
// formule indépendante. Concrètement, si un conducteur reçoit hier la zone
// "0kX" (occupant n°k d'une zone doublée X — ou simplement "X" pour un seul
// occupant, k=1 implicite), sa zone naturelle pour son prochain jour PRESENT
// est X + k (modulo le nombre de zones) : ex. 01D → E (D+1), 02D → F (D+2),
// 03D → G (D+3). C'est une généralisation directe de la rotation individuelle
// simple (k=1 → +1) au cas des zones doublées.
// Cette "zone naturelle" est ensuite fournie à ZoneBalancingEngine.assignZonesForSlot
// (INCHANGÉ) comme clé de tri/répartition du créneau (équipe+shift+vacation),
// exactement comme le faisait l'ancienne formule indépendante — seule l'origine
// de cette zone naturelle change. La couverture complète des 8 zones (dès 8
// présents sur un créneau) reste donc TOUJOURS garantie par
// assignZonesForSlot, qui décide en dernier ressort de la zone réellement
// affichée (priorité confirmée : couverture complète > continuité stricte).
// Comme la répartition d'un créneau RTG se fait tous conducteurs confondus
// (toutes équipes RTG partageant le même shift+vacation un jour donné — cf.
// Passe 2 de PlanningEngine), la simulation ci-dessous doit avancer jour par
// jour pour TOUTE la flotte RTG à la fois, dans l'ordre chronologique depuis
// rotationReferenceDate, et non conducteur par conducteur indépendamment.
// ==========================================

function zonesForDriver(driver, state, teams) {
  const team = teams.find(t => t.id === driver.teamId);
  const fleet = (team && team.typeEngin) || "RTG";
  return zonesForFleet(state.config, fleet);
}

const ZoneRotationEngine = {
  _cache: {},

  // --- État de la simulation en cascade RTG (voir en-tête) ---
  // _cascadeIndex[driverId] : index (0-based) de la zone "naturelle" que ce
  // conducteur recevra à son prochain jour PRESENT (avant répartition/doublon).
  // _cascadeNaturalIndex[iso][driverId] : index naturel du conducteur EN ENTRANT
  // dans ce jour (avant répartition de ce jour-là) — utilisé pour "la zone
  // qu'aurait eue le conducteur" même s'il est absent ce jour-là.
  // _cascadeDayZone[iso][driverId] : zone finale (après répartition, ex. "01D")
  // réellement affectée ce jour-là si le conducteur était présent.
  // _cascadeCursorIso : dernier jour entièrement traité (inclus), ou null.
  _cascadeIndex: {},
  _cascadeNaturalIndex: {},
  _cascadeDayZone: {},
  _cascadeCursorIso: null,

  clearCache() {
    this._cache = {};
    this._cascadeIndex = {};
    this._cascadeNaturalIndex = {};
    this._cascadeDayZone = {};
    this._cascadeCursorIso = null;
  },

  // Découpe une zone finale ("D" ou "01D") en { letter, slot } — slot=1 pour un
  // occupant unique (pas de préfixe), sinon le numéro du préfixe (1, 2, 3...).
  _parseZoneStr(str) {
    if (!str || str.length <= 1) return { letter: str, slot: 1 };
    const slot = parseInt(str.slice(0, -1), 10);
    return { letter: str.slice(-1), slot: isNaN(slot) ? 1 : slot };
  },

  // Avance la simulation en cascade RTG (tous conducteurs RTG, tous créneaux)
  // jour par jour depuis le dernier jour traité (ou rotationReferenceDate au
  // départ) jusqu'à targetIso inclus. Idempotent : ne refait jamais un jour
  // déjà traité.
  _ensureRtgCascade(targetIso, state, teams) {
    if (this._cascadeCursorIso !== null && this._cascadeCursorIso >= targetIso) return;

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    const targetDate = RTGDate.parseISO(targetIso);
    if (targetDate.getTime() < refDate.getTime()) return;

    const zones = zonesForFleet(state.config, "RTG");
    if (!zones || zones.length === 0) return;

    let cursor;
    if (this._cascadeCursorIso === null) {
      state.drivers.forEach(driver => {
        const team = teams.find(t => t.id === driver.teamId);
        if (team && team.typeEngin === "RTG") {
          this._cascadeIndex[driver.id] = Math.max(0, zones.indexOf(driver.initialZone));
        }
      });
      cursor = refDate;
    } else {
      cursor = RTGDate.addDays(RTGDate.parseISO(this._cascadeCursorIso), 1);
    }

    while (cursor.getTime() <= targetDate.getTime()) {
      const iso = RTGDate.toISO(cursor);

      const naturalForDay = {};
      const rtgDrivers = [];
      state.drivers.forEach(driver => {
        const team = teams.find(t => t.id === driver.teamId);
        if (!team || team.typeEngin !== "RTG") return;
        const zoneIdx = this._cascadeIndex[driver.id] !== undefined
          ? this._cascadeIndex[driver.id]
          : Math.max(0, zones.indexOf(driver.initialZone));
        naturalForDay[driver.id] = zoneIdx;
        rtgDrivers.push(driver);
      });
      this._cascadeNaturalIndex[iso] = naturalForDay;

      const groups = {};
      rtgDrivers.forEach(driver => {
        if (driver.actif === false) return;
        const team = teams.find(t => t.id === driver.teamId);
        const status = PlanningEngine.getDailyStatus(driver, cursor, state, teams);
        if (status !== "PRESENT") return;
        const shift = ShiftRotationEngine.getTeamShiftForDate(team, cursor, state.config);
        const vacation = VacationRotationEngine.getVacationForDate(driver, cursor, state, team);
        if (!shift || !vacation) return;
        const key = shift + "_" + vacation;
        (groups[key] = groups[key] || []).push({ driverId: driver.id, zone: zones[naturalForDay[driver.id]] });
      });

      const dayResult = {};
      Object.keys(groups).forEach(key => {
        const entries = groups[key];
        ZoneBalancingEngine.assignZonesForSlot(entries, zones);
        entries.forEach(e => {
          dayResult[e.driverId] = e.zone;
          const parsed = this._parseZoneStr(e.zone);
          const letterIdx = Math.max(0, zones.indexOf(parsed.letter));
          this._cascadeIndex[e.driverId] = (letterIdx + parsed.slot) % zones.length;
        });
      });
      this._cascadeDayZone[iso] = dayResult;
      this._cascadeCursorIso = iso;
      cursor = RTGDate.addDays(cursor, 1);
    }
  },

  // Index de zone du conducteur à une date donnée, indépendamment de son statut ce
  // jour-là (avance uniquement sur les jours PRESENT rencontrés avant cette date).
  // Formule individuelle indépendante — utilisée telle quelle pour la flotte CC
  // uniquement (la flotte RTG passe désormais par la cascade, voir en-tête).
  getZoneIndexForDate(driver, date, state, teams) {
    const zones = zonesForDriver(driver, state, teams);
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

  getZoneForDate(driver, date, state, teams) {
    const iso = RTGDate.toISO(date);
    const key = driver.id + "_" + iso;
    if (this._cache[key] !== undefined) return this._cache[key];

    const team = teams.find(t => t.id === driver.teamId);
    const fleet = (team && team.typeEngin) || "RTG";
    let result;
    if (fleet === "RTG") {
      const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
      if (date.getTime() < refDate.getTime()) {
        result = null;
      } else {
        this._ensureRtgCascade(iso, state, teams);
        const dayResult = this._cascadeDayZone[iso];
        result = (dayResult && dayResult[driver.id] !== undefined) ? dayResult[driver.id] : null;
      }
    } else {
      const zones = zonesForDriver(driver, state, teams);
      const zoneIdx = this.getZoneIndexForDate(driver, date, state, teams);
      const statusToday = PlanningEngine.getDailyStatus(driver, date, state, teams);
      result = (zoneIdx !== null && statusToday === "PRESENT") ? zones[zoneIdx] : null;
    }
    this._cache[key] = result;
    return result;
  },

  // Zone qu'aurait eue le conducteur ce jour-là s'il avait travaillé — utile pour le
  // remplacement, où on doit connaître la zone laissée vacante par un conducteur absent.
  // Pour la flotte RTG, c'est la zone "naturelle" issue de la cascade (avant
  // répartition du créneau) — comme pour l'ancienne formule indépendante, on ne
  // simule jamais une répartition hypothétique avec le conducteur absent inclus.
  getExpectedZoneForDate(driver, date, state, teams) {
    const team = teams.find(t => t.id === driver.teamId);
    const fleet = (team && team.typeEngin) || "RTG";
    if (fleet === "RTG") {
      const zones = zonesForFleet(state.config, "RTG");
      const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
      if (date.getTime() < refDate.getTime()) return null;
      const iso = RTGDate.toISO(date);
      this._ensureRtgCascade(iso, state, teams);
      const nat = this._cascadeNaturalIndex[iso];
      const idx = (nat && nat[driver.id] !== undefined) ? nat[driver.id] : null;
      return idx !== null ? zones[idx] : null;
    }
    const zones = zonesForDriver(driver, state, teams);
    const zoneIdx = this.getZoneIndexForDate(driver, date, state, teams);
    return zoneIdx !== null ? zones[zoneIdx] : null;
  }
};
