// ==========================================
// RTG DRIVER PLANNER — Rotation des POSTES pour la flotte CC (Chariots Cavaliers)
// ==========================================
// Règles confirmées par l'exploitant (distinctes de la cascade RTG — voir
// zoneRotationEngine.js) :
//
//   - Chaque "bloc" fixe de conducteurs (driver.teamId + driver.initialVacation
//     — la même notion de bloc que VacationRotationEngine, qui bascule ENTIER
//     entre V1/V2 jour après jour, sauf week-end/dimanche 3ème shift OFF) tient
//     sa propre file d'attente ordonnée, jamais mélangée avec l'autre bloc de
//     la même équipe ni avec les autres équipes.
//   - Chaque jour, dans la file d'un bloc : les conducteurs qui étaient AU QUAI
//     la veille passent en BAS de la liste ; ceux qui étaient en REPOS, au
//     PARC ou AUTORISE la veille passent en HAUT (dans leur ordre relatif
//     d'origine — partition stable, pas de tri).
//   - Le nombre de postes QUAI est plafonné par le nombre de postes physiques
//     (config.ccQuaiPosts, 7 postes confirmés dont DTV) : les premiers de la
//     file (parmi les conducteurs PRESENT ce jour-là) reçoivent un poste QUAI
//     (dans l'ordre de ccQuaiPosts), le reste va au PARC. Le Responsable de
//     Shift peut toujours corriger à la main (mêmes overrides manuels que
//     RTG, via Affectation du jour → AssignmentEditModal) si moins de postes
//     sont réellement nécessaires ce jour-là — CETTE correction devient alors
//     le "poste d'hier" pour le calcul du LENDEMAIN (voir la partition
//     ci-dessous) : la simulation automatique n'est qu'une proposition de
//     priorité tant qu'aucune saisie réelle n'existe pour ce jour-là, jamais
//     une prédiction qui prime sur le terrain une fois celui-ci renseigné.
//   - CONGÉ (et MALADIE/ABSENCE/FORMATION/DÉTACHEMENT, mêmes statuts figés que
//     PlanningEngine) : le conducteur est GELÉ hors de la file pendant toute
//     la durée de son absence (ne remonte pas comme au parc). À son 1er jour
//     de reprise, il est réinséré en DERNIÈRE position de la file ; à partir
//     du jour suivant, il réintègre la boucle normale de partition ci-dessus.
//   - REPOS : jamais 2 jours consécutifs pour un même conducteur — déjà
//     garanti par RestDayEngine (génération du planning mensuel, même
//     principe que RTG), rien à refaire ici.
//   - STAGIAIRES (ex. GR STAGIAIRES — équipe sans rotation fixe,
//     team.shiftCycle vide) : EXCLUS de cette file d'attente. Ils travaillent
//     V1+V2 (journée complète), affectés manuellement chaque jour au shift
//     d'une équipe titulaire à renforcer — jamais de poste QUAI/PARC calculé
//     pour eux, jamais comptés dans le plafond des 7 postes (voir
//     _ccDrivers ci-dessous).
//
// Comme pour ZoneRotationEngine (RTG), la file d'attente ne peut être connue
// qu'en rejouant jour par jour depuis ccRotationReferenceDate (cascade), car
// l'ordre de demain dépend du résultat réel d'aujourd'hui.
//
// "Jour de départ" CC (demande explicite de l'exploitant, 24/09/2026) :
// config.ccRotationReferenceDate est DISTINCTE de config.rotationReferenceDate
// (RTG zone/vacation, jamais touchée) — seule la file QUAI/PARC CC repart de
// cette date. Comme le calcul est une cascade jour après jour, "ignorer tout
// avant cette date" revient à démarrer une nouvelle simulation à partir
// d'elle : ccRotationReferenceDate EST ce nouveau point de départ.
// À ce jour précis, l'ORDRE DE DÉPART de chaque bloc n'est plus déduit d'un
// tri par matricule (fiction) mais de l'affectation RÉELLE relevée sur le
// terrain, quand elle a été communiquée (CC_BOOTSTRAP_ORDER ci-dessous) — une
// équipe pas encore communiquée démarre par défaut triée par matricule à
// cette même date, en attendant sa vraie file de départ.
// ==========================================

const CC_FROZEN_STATUSES = ["CONGE", "MALADIE", "ABSENCE", "FORMATION", "DETACHEMENT"];

function ccBlockKey(driver) {
  return driver.teamId + "_" + (driver.initialVacation === "V2" ? "V2" : "V1");
}

function ccRefDate(state) {
  return RTGDate.parseISO(state.config.ccRotationReferenceDate || state.config.rotationReferenceDate);
}

// config.ccQuaiPosts est une liste de {id, capacity} (ex. P71 capacity 4,
// P74 capacity 2, DTV capacity 1 — plusieurs conducteurs peuvent partager le
// même poste physique en même temps, confirmé par l'exploitant sur le relevé
// papier du 24/09/2026). "Aplatit" cette liste en une séquence de postes (un
// élément par PLACE, pas par poste) : le reste du moteur ci-dessous continue
// de traiter cette séquence comme avant (les N premiers PRESENT de la file
// reçoivent, dans l'ordre, la Nème place de cette séquence).
function flattenQuaiPosts(quaiPostsConfig) {
  const flat = [];
  (quaiPostsConfig || []).forEach(p => {
    for (let i = 0; i < (p.capacity || 1); i++) flat.push(p.id);
  });
  return flat;
}

// File de départ RÉELLE (relevé papier "État d'affectation des conducteurs",
// GR HADDAZI et GR HOUSSAM, 24/09/2026), par bloc de vacation — matricules
// dans l'ordre exact du document, du plus prioritaire (haut de la liste) au
// moins prioritaire (bas). Une équipe CC absente de cette table démarre par
// tri matricule classique (comportement historique) à ccRotationReferenceDate.
const CC_BOOTSTRAP_ORDER = [
  {
    pattern: /haddazi/i,
    V1: ["C07482", "C07459", "C07537", "C07779", "C07401", "C07470", "C07521", "C07782", "C07784", "C07591", "C07393", "C07397"],
    V2: ["C07785", "C07377", "C07579", "C07795", "D07348", "C07577", "C07462", "C07578", "C07394", "C07520", "C07603", "C07602", "C06982"]
  },
  {
    pattern: /houssam/i,
    V1: ["TC0038", "C07525", "C07711", "C07595", "C07596", "C07463", "C07536", "C07494", "C07387", "C05678", "C07399", "C06523"],
    V2: ["C07379", "C07606", "C07586", "C07215", "C07303", "C07777", "C07605", "C07461", "C07503", "J05122", "C07535", "C07705"]
  }
];

function ccBootstrapOrderFor(team) {
  if (!team) return null;
  const entry = CC_BOOTSTRAP_ORDER.find(e => e.pattern.test(team.nom || ""));
  return entry || null;
}

const CcPosteRotationEngine = {
  // _order[blockKey] : file d'attente courante (tous les conducteurs du bloc,
  // présents ou non ce jour-là — seuls les conducteurs gelés en CONGÉ/MALADIE/
  // ABSENCE/FORMATION en sont retirés), du plus prioritaire au moins prioritaire.
  // _dayZone[iso][driverId] : poste réellement affecté ce jour-là ("P71".."DTV"
  // ou "PARC"), ou undefined si absent/repos/etc.
  // _dayRank[iso][driverId] : rang (0-based) dans la file reclassée du jour,
  // AVANT filtrage par présence — utilisé pour "le poste qu'aurait eu" un
  // conducteur absent (remplacement).
  // _frozen[driverId] : true tant que le conducteur est gelé (congé en cours).
  // _cursorIso : dernier jour entièrement traité (inclus), ou null.
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

  // Conducteurs CC concernés par la file d'attente QUAI/PARC — exclut
  // l'équipe "stagiaires" (ex. "GR STAGIAIRE") : un stagiaire cavalier
  // travaille V1+V2 (journée complète), saisi manuellement chaque jour sur
  // le shift d'une équipe titulaire qu'il vient renforcer, et ne suit jamais
  // la rotation des titulaires ni ne compte pour les 7 postes QUAI (confirmé
  // par l'exploitant). Détection sur deux critères — soit suffit — car on ne
  // peut pas garantir que la case "pas de rotation fixe" ait été cochée à la
  // création de l'équipe (team.shiftCycle vide, voir TeamForm) : le NOM de
  // l'équipe contenant "stagiaire" (celui réellement utilisé sur le terrain)
  // sert de filet de sécurité.
  _ccDrivers(state, teams) {
    return state.drivers.filter(d => {
      if (d.actif === false) return false;
      const team = teams.find(t => t.id === d.teamId);
      if (!team || team.typeEngin !== "CC") return false;
      if (!team.shiftCycle || team.shiftCycle.length === 0) return false;
      if (/stagiaire/i.test(team.nom || "")) return false;
      return true;
    });
  },

  _bootstrapOrder(state, teams, refDate) {
    const drivers = this._ccDrivers(state, teams);
    const byBlock = {};
    drivers.forEach(driver => {
      const status = PlanningEngine.getDailyStatus(driver, refDate, state, teams);
      if (CC_FROZEN_STATUSES.indexOf(status) !== -1) {
        this._frozen[driver.id] = true;
        return;
      }
      const key = ccBlockKey(driver);
      (byBlock[key] = byBlock[key] || []).push(driver);
    });

    Object.keys(byBlock).forEach(key => {
      const blockDrivers = byBlock[key];
      const team = teams.find(t => t.id === blockDrivers[0].teamId);
      const bootstrap = ccBootstrapOrderFor(team);
      // Choisit la liste (V1 ou V2) qui correspond le mieux aux matricules
      // RÉELS de ce bloc, plutôt que de faire confiance à
      // driver.initialVacation pour deviner laquelle consulter : ce champ ne
      // reflète que l'étiquette de départ du bloc à rotationReferenceDate
      // (RTG, notion distincte), pas forcément la même convention que celle
      // utilisée pour relever le document papier — un bloc peut très bien
      // avoir initialVacation="V2" alors que sa vraie liste communiquée est
      // rangée ici sous la clé "V1" (ou l'inverse). Se fier à cette étiquette
      // pour choisir la liste faisait échouer TOUT le rattachement en
      // silence (repli intégral sur le tri matricule, plus aucun conducteur
      // du bloc ne matchant la mauvaise liste) — bug réel constaté sur GR
      // HADDAZI, ordre affiché redevenu matricule malgré CC_BOOTSTRAP_ORDER
      // correctement renseigné.
      let explicitOrder = null;
      if (bootstrap) {
        const blockMatricules = new Set(blockDrivers.map(d => String(d.matricule).trim().toUpperCase()));
        const countMatches = list => (list || []).reduce((n, mat) => n + (blockMatricules.has(String(mat).trim().toUpperCase()) ? 1 : 0), 0);
        const v1Count = countMatches(bootstrap.V1), v2Count = countMatches(bootstrap.V2);
        if (v1Count > 0 || v2Count > 0) explicitOrder = v1Count >= v2Count ? bootstrap.V1 : bootstrap.V2;
      }

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

  // Avance la simulation jour par jour depuis le dernier jour traité (ou
  // rotationReferenceDate au départ) jusqu'à targetIso inclus. Idempotent.
  _ensureCascade(targetIso, state, teams) {
    if (this._cursorIso !== null && this._cursorIso >= targetIso) return;

    const refDate = ccRefDate(state);
    const targetDate = RTGDate.parseISO(targetIso);
    if (targetDate.getTime() < refDate.getTime()) return;

    const quaiPosts = flattenQuaiPosts(state.config.ccQuaiPosts);

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
      this._ccDrivers(state, teams).forEach(d => { driversById[d.id] = d; });

      // Regroupe les conducteurs CC actuels par bloc (une équipe peut évoluer :
      // nouveaux conducteurs, départs — on les intègre/retire à la volée).
      const byBlock = {};
      Object.keys(driversById).forEach(id => {
        const key = ccBlockKey(driversById[id]);
        (byBlock[key] = byBlock[key] || []).push(id);
      });

      const dayZone = {};
      const dayRank = {};

      Object.keys(byBlock).forEach(key => {
        const blockDriverIds = byBlock[key];
        let order = (this._order[key] || []).filter(id => driversById[id]);

        const statusToday = {};
        blockDriverIds.forEach(id => { statusToday[id] = PlanningEngine.getDailyStatus(driversById[id], cursor, state, teams); });

        // Retours de congé/maladie/absence/formation (gelés hors file, donc
        // absents de `order`) et nouveaux conducteurs jamais vus dans ce bloc :
        // mis de côté maintenant, réinsérés en dernière position APRÈS la
        // partition du jour (sinon, n'ayant pas de zone "hier", ils seraient
        // classés à tort dans le groupe repos/parc qui passe devant).
        const toAppend = [];
        blockDriverIds.forEach(id => {
          if (order.indexOf(id) !== -1) return;
          if (this._frozen[id] && CC_FROZEN_STATUSES.indexOf(statusToday[id]) === -1) {
            this._frozen[id] = false;
            toAppend.push(id);
          } else if (!this._frozen[id]) {
            toAppend.push(id);
          }
        });
        toAppend.sort((a, b) => String(driversById[a].matricule).localeCompare(String(driversById[b].matricule)));

        // Nouveaux gels (congé/maladie/absence/formation qui démarre aujourd'hui) :
        // retirés de la file active jusqu'à leur retour.
        order = order.filter(id => {
          if (!this._frozen[id] && CC_FROZEN_STATUSES.indexOf(statusToday[id]) !== -1) {
            this._frozen[id] = true;
            return false;
          }
          return true;
        });

        // Partition stable : qui N'ÉTAIT PAS au QUAI hier (repos/parc/autorise)
        // passe devant ; qui ÉTAIT au QUAI hier passe derrière — ordre relatif
        // conservé dans chaque groupe. Le "poste d'hier" retenu est la
        // RÉALITÉ saisie par le responsable (Affectation du jour →
        // AssignmentEditModal, override manuel) quand elle existe, PAS le
        // résultat de la simulation : c'est exactement le "jour de départ"
        // demandé par l'exploitant — dès que le responsable a renseigné
        // l'affectation réelle d'un jour, la file du lendemain en tient
        // compte, au lieu de rejouer indéfiniment une simulation théorique
        // qui ne peut pas deviner les corrections de terrain.
        const yesterdayIso = RTGDate.toISO(RTGDate.addDays(cursor, -1));
        const yesterdayZone = this._dayZone[yesterdayIso] || {};
        const front = [], back = [];
        order.forEach(id => {
          const manualYesterday = state.manualOverrides && state.manualOverrides[yesterdayIso + "_" + id];
          const z = manualYesterday ? manualYesterday.zone : yesterdayZone[id];
          if (z && quaiPosts.indexOf(z) !== -1) back.push(id); else front.push(id);
        });
        order = front.concat(back).concat(toAppend);

        this._order[key] = order;
        order.forEach((id, idx) => { dayRank[id] = idx; });

        // Affectation du jour : les premiers PRESENT de la file reçoivent un
        // poste QUAI (dans l'ordre de ccQuaiPosts), le reste va au PARC.
        let quaiTaken = 0;
        order.forEach(id => {
          if (statusToday[id] !== "PRESENT") return;
          if (quaiTaken < quaiPosts.length) {
            dayZone[id] = quaiPosts[quaiTaken];
            quaiTaken++;
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
    const refDate = ccRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const dayResult = this._dayZone[iso];
    return (dayResult && dayResult[driver.id] !== undefined) ? dayResult[driver.id] : null;
  },

  // Rang (0-based) du conducteur dans la file du jour, TOUS statuts confondus
  // (présent ou repos — seul un gel congé/maladie/absence/formation l'exclut,
  // rank alors null). Sert à AFFICHER l'affectation du jour dans l'ordre réel
  // de la file — demande explicite de l'exploitant : le responsable doit
  // pouvoir affecter les conducteurs QUAI/PARC de haut en bas de la liste
  // affichée, sans recalculer la priorité lui-même.
  getRankForDate(driver, date, state, teams) {
    const refDate = ccRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    return rank === undefined ? null : rank;
  },

  // Poste qu'aurait eu le conducteur ce jour-là s'il avait été PRESENT (utile
  // pour le remplacement — zone laissée vacante par un conducteur absent) :
  // son rang dans la file reclassée du jour, avant filtrage par présence.
  getExpectedZoneForDate(driver, date, state, teams) {
    const refDate = ccRefDate(state);
    if (date.getTime() < refDate.getTime()) return null;
    const iso = RTGDate.toISO(date);
    this._ensureCascade(iso, state, teams);
    const rank = this._dayRank[iso] ? this._dayRank[iso][driver.id] : undefined;
    if (rank === undefined) return null;
    const quaiPosts = flattenQuaiPosts(state.config.ccQuaiPosts);
    return rank < quaiPosts.length ? quaiPosts[rank] : "PARC";
  }
};
