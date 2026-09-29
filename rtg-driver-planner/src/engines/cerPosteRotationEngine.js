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

// PARC (réserve) se décompose en 3 zones nommées d'après les lignes
// desservies (MAERSK, MSC, COSCO — confirmé par l'exploitant) : aucune de
// ces 3 n'est un poste physique QUAI, au même titre que le générique
// "PARC" — un conducteur qui y était hier n'est jamais compté "était au
// quai" pour l'escalier de la file d'attente.
const CER_NON_PHYSICAL_ZONES = ["PARC", "AUTORISE", "MAERSK", "MSC", "COSCO"];

function cerBlockKey(driver) {
  return driver.teamId;
}

function isCdiTeam(team) {
  return !!team && /\bcdi\b/i.test(team.nom || "");
}

// Confirmé par l'exploitant ("CHAQUE GROUPE DE CDI AFFECTES A UN SHIFT SUIT
// SA ROTATION SEPAREMENT") : les CDI d'une même équipe ne forment PAS une
// seule file d'attente — chaque shift (S1/S2) où des CDI sont affectés ce
// jour-là tourne sa propre rotation MAERSK/MSC/COSCO, indépendamment de
// l'autre shift. Le shift d'un CDI est TOUJOURS une saisie manuelle (jamais
// une rotation d'équipe automatique, cf. isNoRotationTeam) : on le lit donc
// directement dans manual_overrides pour le jour donné, jamais via
// PlanningEngine.getDailyStatus (qui ignore les affectations manuelles).
function cdiShiftForDate(driver, iso, state) {
  const ov = state.manualOverrides && state.manualOverrides[iso + "_" + driver.id];
  return ov && ov.shift !== undefined && ov.shift !== null ? ov.shift : null;
}

// File de départ RÉELLE des 3 équipes titulaires CER (relevé papier "État
// d'affectation des conducteurs", Chariots Élévateurs TC3PC, 28/09/2026 —
// même date que cerRotationReferenceDate), matricules dans l'ordre exact du
// document, du plus prioritaire (haut de la liste, ex. QUASSID en tête pour
// GR EDDAOUIDI-HOUSSAM) au moins prioritaire — même principe que
// CC_BOOTSTRAP_ORDER (ccPosteRotationEngine.js). Une équipe CER absente de
// cette table démarre par tri matricule classique (comportement par défaut).
const CER_BOOTSTRAP_ORDER = [
  { pattern: /azzam/i, order: ["TCI040", "TC0075", "TCI033", "TC0085", "TC0082", "TC0090", "TCI027", "TC0087", "TC0072"] },
  { pattern: /bakkali|haddazi/i, order: ["C07847", "TC0084", "TCI032", "TCI026", "C07846", "C07220", "TCI028", "C07789", "TCI035"] },
  { pattern: /eddaouidi|houssam/i, order: ["C07845", "TCI037", "C07783", "C07402", "TCI022", "TCI031", "C07803", "TC0081"] }
];
function cerBootstrapOrderFor(team) {
  if (!team) return null;
  const entry = CER_BOOTSTRAP_ORDER.find(e => e.pattern.test(team.nom || ""));
  return entry ? entry.order : null;
}

// Même principe pour les CDI (relevé papier du 28/09/2026, shift 1 puis
// shift 2 — les CDI ne sont jamais sur le shift 3) — file unique, séparée
// des titulaires (cf. CerCdiRotationEngine). EL BOURANI et HALLAL (en congé
// ce jour-là, donc pas de position observée sur le terrain) retombent en
// fin de file par tri matricule, comme tout conducteur absent de cette liste.
const CER_CDI_BOOTSTRAP_ORDER = ["TCI059", "TCI046", "TCI054", "TCI048", "TCI055", "TCI060", "TCI053", "TCI047", "TCI051"];

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
    CerCdiRotationEngine.clearCache();
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
      const blockDrivers = byBlock[key];
      const team = teams.find(t => t.id === blockDrivers[0].teamId);
      const explicitOrder = cerBootstrapOrderFor(team);
      let ordered;
      if (explicitOrder) {
        const byMatricule = {};
        blockDrivers.forEach(d => { byMatricule[String(d.matricule).trim().toUpperCase()] = d; });
        ordered = [];
        explicitOrder.forEach(mat => {
          const d = byMatricule[mat.toUpperCase()];
          if (d) { ordered.push(d); delete byMatricule[mat.toUpperCase()]; }
        });
        // Conducteur du bloc absent de la liste communiquée (nouveau,
        // matricule erroné...) : ajouté à la fin, trié par matricule.
        Object.keys(byMatricule).sort().forEach(mat => ordered.push(byMatricule[mat]));
      } else {
        ordered = blockDrivers.slice().sort((a, b) => String(a.matricule).localeCompare(String(b.matricule)));
      }
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

        // 28/09/2026 (cerRotationReferenceDate) est un vrai POINT DE DÉPART
        // — demande explicite de l'exploitant, "ignorer tous les jours
        // avant le 28/09" : ce tout premier jour utilise directement l'ordre
        // de départ (CER_BOOTSTRAP_ORDER, relevé papier) sans repasser par
        // la partition avant/arrière basée sur une "veille" (27/09)
        // purement théorique, qui n'a jamais existé dans cette file. Cette
        // partition ne s'applique qu'à partir du 2ème jour simulé.
        if (iso === RTGDate.toISO(refDate)) {
          order = order.concat(toAppend);
        } else {
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
        }

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
    const team = teams.find(t => t.id === driver.teamId);
    if (isCdiTeam(team)) return CerCdiRotationEngine.getZoneForDate(driver, date, state, teams);
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const dayResult = this._dayZone[iso];
    return (dayResult && dayResult[driver.id] !== undefined) ? dayResult[driver.id] : null;
  },

  getRankForDate(driver, date, state, teams) {
    const team = teams.find(t => t.id === driver.teamId);
    if (isCdiTeam(team)) return CerCdiRotationEngine.getRankForDate(driver, date, state, teams);
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    return rank === undefined ? null : rank;
  },

  getExpectedZoneForDate(driver, date, state, teams) {
    const team = teams.find(t => t.id === driver.teamId);
    if (isCdiTeam(team)) return CerCdiRotationEngine.getExpectedZoneForDate(driver, date, state, teams);
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

// ==========================================
// File d'attente CDI — SÉPARÉE de celle des titulaires (demande explicite
// de l'exploitant), règle reconstituée à partir des scénarios fournis
// (fichier "ROTATION_DES_CONDUCTEURS_CER_TITULAIRE_ET_CDI") :
//
//   - S'il y a au moins un CDI au QUAI la veille (cas exceptionnel :
//     titulaires insuffisants, affectation TOUJOURS manuelle, jamais
//     automatique — demande explicite de l'exploitant) : même partition
//     avant/arrière que les titulaires (quai -> repasse dernier).
//   - Sinon (personne au quai) :
//       - si le premier de la file était en REPOS la veille : il reste
//         figé en tête, les autres tournent d'un cran entre eux ;
//       - sinon : toute la file tourne d'un cran.
//
// Les CDI n'ont JAMAIS de zone automatique écrite (cf. planningEngine.js,
// isNoRotationTeam) — cette file ne sert qu'à calculer un RANG (getRankForDate)
// et une zone SUGGÉRÉE (getExpectedZoneForDate, cycle MAERSK/MSC/COSCO),
// jamais une affectation imposée : le responsable saisit toujours la zone
// du jour lui-même, comme aujourd'hui.
// ==========================================
const CerCdiRotationEngine = {
  _order: {},
  _dayRank: {},
  _frozen: {},
  _cursorIso: null,

  clearCache() {
    this._order = {};
    this._dayRank = {};
    this._frozen = {};
    this._cursorIso = null;
  },

  _cdiDrivers(state, teams) {
    return state.drivers.filter(d => {
      if (d.actif === false) return false;
      const team = teams.find(t => t.id === d.teamId);
      return isCdiTeam(team);
    });
  },

  _bootstrapOrder(state, teams, refDate) {
    const drivers = this._cdiDrivers(state, teams);
    const refIso = RTGDate.toISO(refDate);
    const byBlock = {};
    drivers.forEach(driver => {
      const status = PlanningEngine.getDailyStatus(driver, refDate, state, teams);
      if (CER_FROZEN_STATUSES.indexOf(status) !== -1) {
        this._frozen[driver.id] = true;
        return;
      }
      const shift = cdiShiftForDate(driver, refIso, state);
      if (!shift) { this._frozen[driver.id] = true; return; }
      const key = cerBlockKey(driver) + "::" + shift;
      (byBlock[key] = byBlock[key] || []).push(driver);
    });
    Object.keys(byBlock).forEach(key => {
      const blockDrivers = byBlock[key];
      const byMatricule = {};
      blockDrivers.forEach(d => { byMatricule[String(d.matricule).trim().toUpperCase()] = d; });
      const ordered = [];
      CER_CDI_BOOTSTRAP_ORDER.forEach(mat => {
        const d = byMatricule[mat.toUpperCase()];
        if (d) { ordered.push(d); delete byMatricule[mat.toUpperCase()]; }
      });
      Object.keys(byMatricule).sort().forEach(mat => ordered.push(byMatricule[mat]));
      this._order[key] = ordered.map(d => d.id);
    });
  },

  _ensureCascade(targetIso, state, teams) {
    if (this._cursorIso !== null && this._cursorIso >= targetIso) return;

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
      this._cdiDrivers(state, teams).forEach(d => { driversById[d.id] = d; });

      // Un CDI en repos (ou sans shift saisi ce jour précis) reste à SA place
      // dans la file de son dernier shift connu — cas vécu, NOUHAIR (3ᵉ le
      // 28/09, juste après GOURAGUINE) doit rester DANS la rotation de la
      // file S2 le 29/09 (2ᵉ, la file ayant tourné d'un cran), pas en sortir
      // ni repartir en fin de file une fois son shift repris. Seul un statut
      // du groupe CER_FROZEN_STATUSES (congé/maladie/absence/formation/
      // détachement) ou un changement RÉEL de shift (S1<->S2) déplace un CDI
      // d'une file à l'autre — cf. plus bas.
      const byBlock = {};
      Object.keys(driversById).forEach(id => {
        const shift = cdiShiftForDate(driversById[id], iso, state);
        let key;
        if (shift) {
          key = cerBlockKey(driversById[id]) + "::" + shift;
        } else {
          key = Object.keys(this._order).find(k => this._order[k].indexOf(id) !== -1);
        }
        if (!key) return;
        (byBlock[key] = byBlock[key] || []).push(id);
      });

      const dayRank = {};
      const yesterdayIso = RTGDate.toISO(RTGDate.addDays(cursor, -1));

      Object.keys(byBlock).forEach(key => {
        const blockDriverIds = byBlock[key];
        // "blockDriverIds.indexOf" (pas seulement "driversById[id]") : un CDI
        // qui a changé de shift depuis hier (S1<->S2, saisie manuelle) doit
        // sortir de la file de SON ANCIEN shift, pas y rester compté en plus
        // de sa nouvelle file — il y réapparaîtra via "toAppend" ci-dessous.
        let order = (this._order[key] || []).filter(id => blockDriverIds.indexOf(id) !== -1);

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

        // 28/09/2026 est un vrai POINT DE DÉPART pour les CDI aussi (même
        // principe que les titulaires ci-dessus) : ce tout premier jour
        // garde CER_CDI_BOOTSTRAP_ORDER tel quel, sans reshuffle basé sur
        // une "veille" théorique.
        let newOrder;
        if (iso === RTGDate.toISO(refDate)) {
          newOrder = order.concat(toAppend);
        } else {
          // Réalité de la veille pour chaque CDI de la file : seule une
          // affectation manuelle saisie ce jour-là fait foi (les CDI n'ont
          // jamais de zone automatique) ; à défaut, "PARC" — la valeur par
          // défaut déjà affichée quand rien n'a été saisi (planningEngine.js).
          const wasOnQuai = {}, wasOnRepos = {};
          let quaiExists = false;
          order.forEach(id => {
            const manualYesterday = state.manualOverrides && state.manualOverrides[yesterdayIso + "_" + id];
            const statusYesterday = manualYesterday && manualYesterday.status !== undefined
              ? manualYesterday.status
              : PlanningEngine.getDailyStatus(driversById[id], RTGDate.addDays(cursor, -1), state, teams);
            const zYesterday = manualYesterday && manualYesterday.zone !== undefined ? manualYesterday.zone : "PARC";
            const onQuai = statusYesterday === "PRESENT" && !!zYesterday && CER_NON_PHYSICAL_ZONES.indexOf(String(zYesterday).toUpperCase()) === -1;
            wasOnQuai[id] = onQuai;
            wasOnRepos[id] = statusYesterday === "REPOS" || statusYesterday === "REPOS_COMPENSATOIRE";
            if (onQuai) quaiExists = true;
          });

          if (quaiExists) {
            const front = [], back = [];
            order.forEach(id => { (wasOnQuai[id] ? back : front).push(id); });
            newOrder = front.concat(back);
          } else if (order.length > 0 && wasOnRepos[order[0]]) {
            const rest = order.slice(1);
            newOrder = [order[0]].concat(rest.slice(1)).concat(rest.slice(0, 1));
          } else {
            newOrder = order.slice(1).concat(order.slice(0, 1));
          }
          newOrder = newOrder.concat(toAppend);
        }

        this._order[key] = newOrder;
        newOrder.forEach((id, idx) => { dayRank[id] = idx; });
      });

      this._dayRank[iso] = dayRank;
      this._cursorIso = iso;
      cursor = RTGDate.addDays(cursor, 1);
    }
  },

  getZoneForDate() { return null; },

  getRankForDate(driver, date, state, teams) {
    const refDate = cerRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    return rank === undefined ? null : rank;
  },

  getExpectedZoneForDate(driver, date, state, teams) {
    const rank = this.getRankForDate(driver, date, state, teams);
    if (rank === null) return null;
    const zones = ["MAERSK", "MSC", "COSCO"];
    return zones[rank % zones.length];
  }
};
