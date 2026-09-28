// ==========================================
// RTG DRIVER PLANNER — Rotation des POSTES pour la flotte CER
// (Conducteurs Engin Roulant)
// ==========================================
// Même mécanique que CcPosteRotationEngine (file d'attente par bloc, partition
// stable "était au poste hier" / "était en repos/parc hier", postes physiques
// à capacité limitée) — voir ccPosteRotationEngine.js pour le détail des
// règles, reprises ici à l'identique. Deux différences confirmées par
// l'exploitant :
//
//   - Pas de notion de VACATION pour CER (§ data.js, fleetHasVacation) : un
//     seul bloc par ÉQUIPE (pas de split V1/V2 comme pour CC) — la clé de
//     bloc est donc simplement driver.teamId.
//   - Les conducteurs CDI suivent EXACTEMENT le même principe que les
//     stagiaires CC (équipe sans rotation fixe, team.shiftCycle vide) :
//     jamais dans cette file d'attente automatique, affectés manuellement
//     au jour le jour (voir _cerDrivers ci-dessous, même détection que
//     CcPosteRotationEngine._ccDrivers) — c'est ainsi que la règle "CDI
//     jamais sur le 3ème shift" est respectée, sans logique dédiée : un CDI
//     n'a tout simplement pas de shift automatique à suivre, il est saisi
//     à la main sur le shift qui a besoin de renfort ce jour-là (S1 ou S2
//     uniquement, jamais S3, par consigne terrain).
//
// Postes physiques (config.cerPostes) confirmés identiques à CC : P71/P74/
// DTV, mêmes capacités (7 places au total). Contrairement à CC, il n'existe
// pas (encore) de file de départ réelle communiquée par équipe
// (CC_BOOTSTRAP_ORDER) ni de postes propres par équipe
// (CC_QUAI_POSTS_BY_TEAM) : toute équipe CER démarre triée par matricule à
// cerRotationReferenceDate, et utilise la liste globale config.cerPostes.
// ==========================================

const CER_FROZEN_STATUSES = ["CONGE", "MALADIE", "ABSENCE", "FORMATION", "DETACHEMENT"];

// PARC (réserve) se décompose en 3 zones nommées d'après les lignes/
// terminaux desservis (MAERS, MSC, COSCO — confirmé par l'exploitant) :
// aucune de ces 3 n'est un poste physique QUAI, au même titre que le
// générique "PARC" — un conducteur qui y était hier n'est jamais compté
// "était au quai" pour l'escalier de la file d'attente.
const CER_NON_PHYSICAL_ZONES = ["PARC", "AUTORISE", "MAERS", "MSC", "COSCO"];

function cerBlockKey(driver) {
  return driver.teamId;
}

function cerRefDate(state) {
  return RTGDate.parseISO(state.config.cerRotationReferenceDate || state.config.rotationReferenceDate);
}

function flattenCerPosts(postsConfig) {
  const flat = [];
  (postsConfig || []).forEach(p => {
    for (let i = 0; i < (p.capacity || 1); i++) flat.push(p.id);
  });
  return flat;
}

const CerPosteRotationEngine = {
  _order: {},
  _dayZone: {},
  _dayRank: {},
  _frozen: {},
  _cursorIso: null,

  clearCache() {
    this._order = {};
    this._dayZone = {};
    this._dayRank = {};
    this._frozen = {};
    this._cursorIso = null;
  },

  // Conducteurs CER concernés par la file d'attente automatique — exclut les
  // équipes CDI (pas de rotation fixe, même détection que les stagiaires CC :
  // team.shiftCycle vide OU nom contenant "stagiaire"/"cdi").
  _cerDrivers(state, teams) {
    return state.drivers.filter(d => {
      if (d.actif === false) return false;
      const team = teams.find(t => t.id === d.teamId);
      if (!team || team.typeEngin !== "CER") return false;
      if (!team.shiftCycle || team.shiftCycle.length === 0) return false;
      if (/stagiaire|\bcdi\b/i.test(team.nom || "")) return false;
      return true;
    });
  },

  _bootstrapOrder(state, teams, refDate) {
    const drivers = this._cerDrivers(state, teams);
    const byBlock = {};
    drivers.forEach(driver => {
      const status = PlanningEngine.getDailyStatus(driver, refDate, state, teams);
      if (CER_FROZEN_STATUSES.indexOf(status) !== -1) {
        this._frozen[driver.id] = true;
        return;
      }
      const key = cerBlockKey(driver);
      (byBlock[key] = byBlock[key] || []).push(driver);
    });

    Object.keys(byBlock).forEach(key => {
      const ordered = byBlock[key].slice().sort((a, b) => String(a.matricule).localeCompare(String(b.matricule)));
      this._order[key] = ordered.map(d => d.id);
    });
  },

  _ensureCascade(targetIso, state, teams) {
    if (this._cursorIso !== null && this._cursorIso >= targetIso) return;

    const todayIsoForCascade = RTGDate.toISO(new Date());
    const refDate = cerRefDate(state);
    const targetDate = RTGDate.parseISO(targetIso);
    if (targetDate.getTime() < refDate.getTime()) return;

    let cursor;
    if (this._cursorIso === null) {
      this._bootstrapOrder(state, teams, refDate);
      cursor = refDate;
    } else {
      cursor = RTGDate.addDays(RTGDate.parseISO(this._cursorIso), 1);
    }

    while (cursor.getTime() <= targetDate.getTime()) {
      const iso = RTGDate.toISO(cursor);
      const driversById = {};
      this._cerDrivers(state, teams).forEach(d => { driversById[d.id] = d; });

      const byBlock = {};
      Object.keys(driversById).forEach(id => {
        const key = cerBlockKey(driversById[id]);
        (byBlock[key] = byBlock[key] || []).push(id);
      });

      const dayZone = {};
      const dayRank = {};

      Object.keys(byBlock).forEach(key => {
        const blockDriverIds = byBlock[key];
        let order = (this._order[key] || []).filter(id => driversById[id]);
        const cerPosts = flattenCerPosts(state.config.cerPostes);

        const statusToday = {};
        blockDriverIds.forEach(id => { statusToday[id] = PlanningEngine.getDailyStatus(driversById[id], cursor, state, teams); });

        const toAppend = [];
        blockDriverIds.forEach(id => {
          if (order.indexOf(id) !== -1) return;
          if (this._frozen[id] && CER_FROZEN_STATUSES.indexOf(statusToday[id]) === -1) {
            this._frozen[id] = false;
            toAppend.push(id);
          } else if (!this._frozen[id]) {
            toAppend.push(id);
          }
        });
        toAppend.sort((a, b) => String(driversById[a].matricule).localeCompare(String(driversById[b].matricule)));

        order = order.filter(id => {
          if (!this._frozen[id] && CER_FROZEN_STATUSES.indexOf(statusToday[id]) !== -1) {
            this._frozen[id] = true;
            return false;
          }
          return true;
        });

        const yesterdayIso = RTGDate.toISO(RTGDate.addDays(cursor, -1));
        const front = [], back = [];
        order.forEach(id => {
          const manualYesterday = state.manualOverrides && state.manualOverrides[yesterdayIso + "_" + id];
          const isImportForecast = manualYesterday && manualYesterday.motif === RTG_IMPORT_OVERRIDE_MOTIF && yesterdayIso >= todayIsoForCascade;
          let z;
          if (manualYesterday && manualYesterday.zone !== undefined && !isImportForecast) {
            z = manualYesterday.zone;
          } else if (yesterdayIso < todayIsoForCascade) {
            const simulated = this._dayZone[yesterdayIso];
            z = simulated ? simulated[id] : undefined;
          } else {
            z = null;
          }
          const wasOnPoste = !!z && CER_NON_PHYSICAL_ZONES.indexOf(String(z).toUpperCase()) === -1;
          if (wasOnPoste) back.push(id); else front.push(id);
        });
        order = front.concat(back).concat(toAppend);

        this._order[key] = order;
        order.forEach((id, idx) => { dayRank[id] = idx; });

        let posteTaken = 0;
        order.forEach(id => {
          if (statusToday[id] !== "PRESENT") return;
          if (posteTaken < cerPosts.length) {
            dayZone[id] = cerPosts[posteTaken];
            posteTaken++;
          } else {
            dayZone[id] = "PARC";
          }
        });
      });

      this._dayZone[iso] = dayZone;
      this._dayRank[iso] = dayRank;
      this._cursorIso = iso;
      cursor = RTGDate.addDays(cursor, 1);
    }
  },

  getZoneForDate(driver, date, state, teams) {
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const dayResult = this._dayZone[iso];
    return (dayResult && dayResult[driver.id] !== undefined) ? dayResult[driver.id] : null;
  },

  getRankForDate(driver, date, state, teams) {
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    return rank === undefined ? null : rank;
  },

  getExpectedZoneForDate(driver, date, state, teams) {
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    if (rank === undefined) return null;
    const cerPosts = flattenCerPosts(state.config.cerPostes);
    return rank < cerPosts.length ? cerPosts[rank] : "PARC";
  }
};
