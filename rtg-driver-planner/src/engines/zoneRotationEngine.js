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
// Pour la flotte CC, la mécanique est entièrement différente (file d'attente
// QUAI/PARC par bloc de vacation, voir ccPosteRotationEngine.js) — ce fichier
// ne fait que déléguer à CcPosteRotationEngine pour cette flotte.
//
// ==========================================
// RTG — règle de rotation individuelle (remplace entièrement l'ancienne
// redistribution de groupe "couverture complète > continuité stricte" —
// demande explicite de l'exploitant, confirmée par une série d'exemples
// concrets) :
//
// Un conducteur JAMAIS en collision avance TOUJOURS d'UNE LETTRE ENTIÈRE par
// jour effectivement travaillé (règle §8 inchangée : aucune avance un jour
// non travaillé), jamais de répétition. Le découpage en 2 crans par lettre
// (01X/02X) n'existe QUE le temps d'une collision réelle à 2 conducteurs sur
// la même lettre le même jour (ça n'arrive que si le créneau compte plus de
// présents que de zones — voir plus bas, aucun doublage "gratuit") :
//   - le NOUVEAU venu sur cette lettre (il occupait une autre lettre hier)
//     "tient" la lettre un jour de plus (affiché "01X") — il ne l'a
//     rejointe qu'aujourd'hui, il faut la garder occupée le temps que
//     l'ancien occupant parte ;
//   - celui qui occupait DÉJÀ cette lettre hier est "relâché" (affiché
//     "02X") et avance normalement à la lettre suivante le jour d'après.
// Le lendemain, celui qui "tenait" (01X) reste sur la MÊME lettre un jour de
// plus (il devient l'ancien occupant, "relâché" à son tour si quelqu'un
// d'autre le rejoint, ou simplement affiché seul sinon) — d'où le fameux
// "01D→02D" : ce n'est jamais un cran caché qui avance en coulisses pour un
// conducteur seul, uniquement la mécanique d'un relais à 2 pendant une
// collision réelle.
//
// Un jour NON TRAVAILLÉ (repos/congé/maladie/absence/formation, ou tout
// simplement le tout premier jour d'un nouveau conducteur) CASSE la chaîne :
// à son retour, le conducteur ne reprend PAS son ancienne lettre — il
// récupère une zone VACANTE ce jour-là (aucun conducteur "en chaîne
// continue" n'y est affecté), qui devient son nouveau point de départ (et il
// est immédiatement "relâché" : il avancera normalement dès le lendemain,
// sauf collision réelle ce jour précis). Quand plusieurs conducteurs
// reviennent le même jour (ou qu'il y a plusieurs zones vacantes), la zone
// vacante est attribuée dans l'ORDRE DE LEUR PROPRE ZONE AVANT L'ABSENCE
// (croissant) — celui qui avait la zone la plus "petite" avant son repos
// prend la 1ère zone vacante disponible, et ainsi de suite.
//
// La 1ère zone de la flotte (A) est volontairement REJETÉE EN DERNIER
// (règle déjà en place ailleurs dans l'appli, reconfirmée ici) : jamais
// occupée par défaut tant qu'une autre lettre est libre ce jour-là, que ce
// soit pour un conducteur en chaîne continue ou pour une zone vacante.
//
// Aucun doublage n'est JAMAIS laissé "gratuit" : tant que le nombre de
// présents du créneau ne dépasse pas le nombre de zones (8), une collision
// purement accidentelle entre deux chaînes indépendantes (ex. 7 présents,
// deux conducteurs atterrissent par coïncidence sur la même lettre) est
// résolue en redirigeant l'un des deux vers une lettre encore libre — un
// doublage n'est laissé tel quel que lorsqu'il est réellement inévitable
// (plus de présents que de zones ce jour-là).
//
// Le regroupement (qui partage la même lettre un jour donné, quelles zones
// sont "vacantes") se fait par CRÉNEAU (même shift + même vacation, tous
// conducteurs RTG confondus) : les 8 zones physiques A-H sont une ressource
// par créneau, pas globale à la flotte.
//
// Une correction manuelle du jour (case cliquable) prime toujours sur la
// chaîne calculée : elle fixe directement la lettre du jour (et la "tenue"
// éventuelle, si saisie avec un préfixe 01/02) — jamais une valeur fantôme
// invisible calculée en parallèle.
// ==========================================

const ZoneRotationEngine = {
  _cache: {},

  // --- État de la simulation RTG (voir en-tête) ---
  // _letterIdx[driverId] : index (0-based, ordre de chaîne — voir chainZones
  // ci-dessous) de la lettre occupée par ce conducteur à l'issue de son
  // dernier jour réellement travaillé (figé tant qu'il ne retravaille pas).
  // _heldOver[driverId] : true si ce conducteur "tient" sa lettre actuelle
  // (nouveau venu dans une collision réelle) — il répètera cette même
  // lettre son prochain jour travaillé au lieu d'avancer, puis sera relâché.
  // _lastWorkedIso[driverId] : dernier jour (iso) où ce conducteur a été
  // traité comme PRÉSENT — sert à détecter une chaîne cassée (absence).
  // _cascadeNaturalIndex[iso][driverId] : _letterIdx à l'issue de ce jour-là
  // (qu'il ait travaillé ou non ce jour-là — figé sinon), utilisé par
  // getExpectedZoneForDate (zone laissée vacante par un absent, utile au
  // remplacement).
  // _cascadeDayZone[iso][driverId] : zone AFFICHÉE ce jour-là (ex. "D" ou
  // "01D") si le conducteur était présent.
  // _cascadeCursorIso : dernier jour entièrement traité (inclus), ou null.
  _letterIdx: {},
  _heldOver: {},
  _lastWorkedIso: {},
  _cascadeNaturalIndex: {},
  _cascadeDayZone: {},
  _cascadeCursorIso: null,

  clearCache() {
    this._cache = {};
    this._letterIdx = {};
    this._heldOver = {};
    this._lastWorkedIso = {};
    this._cascadeNaturalIndex = {};
    this._cascadeDayZone = {};
    this._cascadeCursorIso = null;
  },

  // Décode une zone affichée ("D", "01D" ou "02D") en { idx, heldOver } —
  // 01X = tient (répétera la même lettre demain), "02X" ou lettre seule =
  // relâché (avancera normalement demain, sauf nouvelle collision réelle).
  _decodeZoneStr(str, chainZones) {
    if (!str) return { idx: 0, heldOver: false };
    let letter = str, prefix = null;
    const m = String(str).match(/^(\d+)(.+)$/);
    if (m) { prefix = parseInt(m[1], 10) || 1; letter = m[2]; }
    const idx = Math.max(0, chainZones.indexOf(letter));
    return { idx: idx, heldOver: prefix === 1 };
  },

  _referenceIdxForReset(driver, chainZones) {
    const idx = this._letterIdx[driver.id];
    if (idx !== undefined) return idx;
    return Math.max(0, chainZones.indexOf(driver.initialZone));
  },

  // Avance la simulation RTG (tous conducteurs RTG, tous créneaux) jour par
  // jour depuis le dernier jour traité (ou rotationReferenceDate au départ)
  // jusqu'à targetIso inclus. Idempotent : ne refait jamais un jour déjà
  // traité.
  _ensureRtgCascade(targetIso, state, teams) {
    if (this._cascadeCursorIso !== null && this._cascadeCursorIso >= targetIso) return;

    const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
    const targetDate = RTGDate.parseISO(targetIso);
    if (targetDate.getTime() < refDate.getTime()) return;

    const zones = zonesForFleet(state.config, "RTG");
    if (!zones || zones.length === 0) return;

    // Zone A rejetée en dernier dans l'ordre de chaîne (voir en-tête).
    const chainZones = zones.slice(1).concat([zones[0]]);
    const N = chainZones.length;
    const zoneAIdx = N - 1;

    let cursor = this._cascadeCursorIso === null ? refDate : RTGDate.addDays(RTGDate.parseISO(this._cascadeCursorIso), 1);

    const rtgTeamIds = new Set(teams.filter(t => t.typeEngin === "RTG").map(t => t.id));
    const rtgDriversAll = state.drivers.filter(d => rtgTeamIds.has(d.teamId));

    while (cursor.getTime() <= targetDate.getTime()) {
      const iso = RTGDate.toISO(cursor);
      const prevIso = RTGDate.toISO(RTGDate.addDays(cursor, -1));

      // Regroupe les conducteurs RTG PRÉSENTS ce jour-là par créneau (les 8
      // zones physiques sont une ressource par shift+vacation).
      const slotGroups = {};
      rtgDriversAll.forEach(driver => {
        if (driver.actif === false) return;
        const team = teams.find(t => t.id === driver.teamId);
        const status = PlanningEngine.getDailyStatus(driver, cursor, state, teams);
        if (status !== "PRESENT") return;
        const shift = ShiftRotationEngine.getTeamShiftForDate(team, cursor, state.config);
        const vacation = VacationRotationEngine.getVacationForDate(driver, cursor, state, team);
        if (!shift || !vacation) return;
        const key = shift + "_" + vacation;
        (slotGroups[key] = slotGroups[key] || []).push(driver);
      });

      const dayResult = {};

      Object.keys(slotGroups).forEach(key => {
        const slotDrivers = slotGroups[key];
        const overridden = [], continuing = [], resetting = [];
        slotDrivers.forEach(driver => {
          const override = state.manualOverrides[iso + "_" + driver.id];
          if (override && override.zone !== undefined && override.zone !== null) { overridden.push(driver); return; }
          if (this._lastWorkedIso[driver.id] === prevIso) continuing.push(driver);
          else resetting.push(driver);
        });

        const effectiveIdx = {};   // driverId -> index de lettre affiché ce jour
        const wasIncumbent = {};   // driverId -> occupait DÉJÀ cette même lettre hier (relâché par défaut)

        // 1) Correction manuelle : fixe directement la lettre (et la tenue,
        // si saisie avec un préfixe 01/02).
        overridden.forEach(driver => {
          const override = state.manualOverrides[iso + "_" + driver.id];
          const decoded = this._decodeZoneStr(override.zone, chainZones);
          this._letterIdx[driver.id] = decoded.idx;
          this._heldOver[driver.id] = decoded.heldOver;
          effectiveIdx[driver.id] = decoded.idx;
        });

        // 2) Conducteurs en chaîne continue : s'ils "tenaient" leur lettre
        // (nouveau venu dans une collision réelle hier), ils y restent
        // encore un jour (puis relâchés) ; sinon ils avancent normalement
        // d'une lettre entière. Un conducteur jamais en collision avance
        // donc TOUJOURS d'une lettre par jour travaillé, sans répétition.
        continuing.forEach(driver => {
          const idx = this._letterIdx[driver.id] !== undefined
            ? this._letterIdx[driver.id]
            : Math.max(0, chainZones.indexOf(driver.initialZone));
          if (this._heldOver[driver.id]) {
            effectiveIdx[driver.id] = idx;
            wasIncumbent[driver.id] = true;
            this._heldOver[driver.id] = false;
          } else {
            effectiveIdx[driver.id] = (idx + 1) % N;
          }
        });

        // 2b) Zone A évitée : redirection vers la 1ère autre lettre encore
        // libre ce jour-là (jamais de "tenue" déclenchée par une simple
        // redirection — le conducteur avancera normalement dès demain).
        continuing.forEach(driver => {
          if (effectiveIdx[driver.id] !== zoneAIdx) return;
          const used = new Set(Object.values(effectiveIdx));
          for (let i = 0; i < zoneAIdx; i++) {
            if (!used.has(i)) { effectiveIdx[driver.id] = i; delete wasIncumbent[driver.id]; break; }
          }
        });

        // 2c) Aucun doublage n'est mathématiquement nécessaire tant que le
        // nombre de présents ne dépasse pas le nombre de zones (8) : une
        // collision purement accidentelle entre deux chaînes indépendantes
        // est résolue en redirigeant l'une vers une lettre encore libre
        // (zone A en tout dernier recours) — jamais de doublage "gratuit".
        if (slotDrivers.length <= N) {
          const byIdx = {};
          continuing.forEach(d => { (byIdx[effectiveIdx[d.id]] = byIdx[effectiveIdx[d.id]] || []).push(d); });
          Object.keys(byIdx).forEach(k => {
            const group = byIdx[k];
            if (group.length <= 1) return;
            group.sort((a, b) => (this._letterIdx[a.id] || 0) - (this._letterIdx[b.id] || 0));
            for (let i = 1; i < group.length; i++) {
              const used = new Set(Object.values(effectiveIdx));
              let free = -1;
              for (let c = 0; c < zoneAIdx; c++) { if (!used.has(c)) { free = c; break; } }
              if (free === -1) { for (let c = 0; c < N; c++) { if (!used.has(c)) { free = c; break; } } }
              if (free !== -1) { effectiveIdx[group[i].id] = free; delete wasIncumbent[group[i].id]; }
            }
          });
        }

        // 3) Zones vacantes ce jour-là (aucun conducteur "fixe" — corrigé
        // ou en chaîne continue — n'y est) : pour les revenants d'absence
        // et les nouveaux, dans l'ordre de leur PROPRE zone avant
        // l'absence (croissant, zone A en dernier recours).
        const fixedIdx = new Set(Object.values(effectiveIdx));
        const vacantIdx = [];
        for (let i = 0; i < N; i++) if (!fixedIdx.has(i)) vacantIdx.push(i);
        const sortedResetting = resetting.slice().sort((a, b) =>
          this._referenceIdxForReset(a, chainZones) - this._referenceIdxForReset(b, chainZones)
        );
        sortedResetting.forEach((driver, i) => {
          effectiveIdx[driver.id] = vacantIdx.length > 0 ? vacantIdx[i % vacantIdx.length] : zoneAIdx;
        });

        // 4) Détermine les vraies collisions du jour (exactement 2 sur la
        // même lettre — ne peut arriver que si le créneau compte plus de
        // présents que de zones, cf. 2c ci-dessus) : le NOUVEAU venu sur
        // cette lettre (ne l'occupait pas déjà hier) "tient" (affiché
        // "01X", répétera demain) ; celui qui l'occupait DÉJÀ hier est
        // "relâché" (affiché "02X", avancera normalement demain).
        const byLetter = {};
        continuing.concat(resetting).forEach(driver => {
          const idx = effectiveIdx[driver.id];
          (byLetter[idx] = byLetter[idx] || []).push(driver);
        });
        Object.keys(byLetter).forEach(k => {
          const idx = Number(k);
          const letter = chainZones[idx];
          const ds = byLetter[k];
          if (ds.length === 1) {
            const driver = ds[0];
            this._letterIdx[driver.id] = idx;
            dayResult[driver.id] = letter;
            return;
          }
          const incumbents = ds.filter(d => wasIncumbent[d.id]);
          const newcomers = ds.filter(d => !wasIncumbent[d.id]);
          let held, released, extra = [];
          if (incumbents.length === 1 && newcomers.length >= 1) {
            held = newcomers[0]; released = incumbents[0]; extra = newcomers.slice(1);
          } else {
            // Aucun n'occupait déjà cette lettre hier (2 chaînes
            // indépendantes convergent le même jour) : ordre déterministe.
            const sorted = ds.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
            held = sorted[0]; released = sorted[1]; extra = sorted.slice(2);
          }
          this._letterIdx[held.id] = idx; this._heldOver[held.id] = true;
          dayResult[held.id] = "01" + letter;
          this._letterIdx[released.id] = idx; this._heldOver[released.id] = false;
          dayResult[released.id] = "02" + letter;
          // Au-delà de 2 sur la même lettre (ne devrait pas arriver avec ce
          // mécanisme, mais robustesse) : numérotation de secours.
          extra.forEach((d, i) => {
            this._letterIdx[d.id] = idx; this._heldOver[d.id] = false;
            dayResult[d.id] = String(i + 3).padStart(2, "0") + letter;
          });
        });

        overridden.forEach(driver => {
          dayResult[driver.id] = state.manualOverrides[iso + "_" + driver.id].zone;
        });

        slotDrivers.forEach(driver => { this._lastWorkedIso[driver.id] = iso; });
      });

      // Position (figée si absent ce jour-là) de TOUS les conducteurs RTG,
      // qu'ils aient travaillé ou non — utilisé par getExpectedZoneForDate
      // (zone qu'aurait eue / laissée vacante un conducteur absent, utile
      // au remplacement).
      const naturalForDay = {};
      rtgDriversAll.forEach(driver => {
        naturalForDay[driver.id] = this._letterIdx[driver.id] !== undefined
          ? this._letterIdx[driver.id]
          : Math.max(0, chainZones.indexOf(driver.initialZone));
      });
      this._cascadeNaturalIndex[iso] = naturalForDay;
      this._cascadeDayZone[iso] = dayResult;
      this._cascadeCursorIso = iso;
      cursor = RTGDate.addDays(cursor, 1);
    }
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
    } else if (fleet === "CER") {
      result = CerPosteRotationEngine.getZoneForDate(driver, date, state, teams);
    } else {
      result = CcPosteRotationEngine.getZoneForDate(driver, date, state, teams);
    }
    this._cache[key] = result;
    return result;
  },

  // Zone qu'aurait eue le conducteur ce jour-là s'il avait travaillé — utile
  // pour le remplacement, où on doit connaître la zone laissée vacante par
  // un conducteur absent. Pour la flotte RTG, c'est la lettre correspondant
  // à sa dernière position figée (dernier jour réellement travaillé) — la
  // chaîne étant cassée par une absence, il n'y a pas de "lettre
  // hypothétique" à avancer pour un jour non travaillé, juste la dernière
  // position connue.
  getExpectedZoneForDate(driver, date, state, teams) {
    const team = teams.find(t => t.id === driver.teamId);
    const fleet = (team && team.typeEngin) || "RTG";
    if (fleet === "RTG") {
      const zones = zonesForFleet(state.config, "RTG");
      const chainZones = zones.slice(1).concat([zones[0]]);
      const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
      if (date.getTime() < refDate.getTime()) return null;
      const iso = RTGDate.toISO(date);
      this._ensureRtgCascade(iso, state, teams);
      const nat = this._cascadeNaturalIndex[iso];
      const idx = (nat && nat[driver.id] !== undefined) ? nat[driver.id] : null;
      return idx !== null ? chainZones[idx] : null;
    }
    if (fleet === "CER") {
      return CerPosteRotationEngine.getExpectedZoneForDate(driver, date, state, teams);
    }
    return CcPosteRotationEngine.getExpectedZoneForDate(driver, date, state, teams);
  }
};
