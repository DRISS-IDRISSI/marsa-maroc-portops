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
// RTG — règle de rotation individuelle par CHAÎNE DE BLOCS (remplace
// entièrement l'ancienne redistribution de groupe "couverture complète >
// continuité stricte" — demande explicite de l'exploitant, confirmée par
// une série d'exemples concrets) :
//
// Chaque conducteur suit une chaîne FIXE et continue à 16 crans :
//   01A→02A→01B→02B→01C→02C→01D→02D→01E→02E→01F→02F→01G→02G→01H→02H→01A...
// Il avance d'UN cran par jour effectivement travaillé (règle §8 inchangée :
// aucune avance un jour non travaillé). Ce cran n'est affiché avec son numéro
// (01X/02X) QUE si un autre conducteur se retrouve, le même jour, sur la
// MÊME lettre — auquel cas les deux occupent forcément les 2 seuls crans de
// cette lettre (01X et 02X), jamais plus. Si un seul conducteur est sur une
// lettre donnée ce jour-là, on affiche la lettre seule (le cran reste
// "caché" mais continue d'avancer en coulisses) — c'est ce qui explique
// qu'un "01D" avance au cran suivant vers "02D" (même lettre) alors qu'un
// "02D" avance vers "01E" (lettre suivante) : ce n'est pas une redistribution
// de groupe, juste la suite mécanique de la même chaîne à 16 crans.
//
// Un jour NON TRAVAILLÉ (repos/congé/maladie/absence/formation, ou tout
// simplement le tout premier jour d'un nouveau conducteur) CASSE la chaîne :
// à son retour, le conducteur ne reprend PAS son ancien cran — il récupère
// une zone VACANTE ce jour-là (aucun conducteur "en chaîne continue" n'y est
// affecté), qui devient son nouveau point de départ (cran = cette lettre,
// 2e position — càd prêt à avancer vers la lettre suivante le jour d'après,
// s'il reste seul). Quand plusieurs conducteurs reviennent le même jour (ou
// qu'il y a plusieurs zones vacantes), la zone vacante est attribuée dans
// l'ORDRE DE LEUR PROPRE ZONE AVANT L'ABSENCE (croissant A→H) — celui qui
// avait la zone la plus "petite" avant son repos prend la 1ère zone vacante
// disponible (dans l'ordre A→H), et ainsi de suite.
//
// Le regroupement (qui partage la même lettre un jour donné, quelles zones
// sont "vacantes") se fait par CRÉNEAU (même shift + même vacation, tous
// conducteurs RTG confondus — inchangé de l'ancien système) : les 8 zones
// physiques A-H sont une ressource par créneau, pas globale à la flotte.
//
// Une correction manuelle du jour (case cliquable) prime toujours sur la
// chaîne calculée : elle fixe directement le cran du jour (et donc celui
// d'où repart la chaîne le jour suivant), exactement comme une "zone reçue
// réellement" — jamais une valeur fantôme invisible calculée en parallèle.
// ==========================================

const ZoneRotationEngine = {
  _cache: {},

  // --- État de la simulation en chaîne RTG (voir en-tête) ---
  // _pointer[driverId] : position 0-15 dans la chaîne à 16 crans (0=01A,
  // 1=02A, 2=01B, ... 15=02H), TELLE QU'ELLE ÉTAIT à la fin du dernier jour
  // travaillé de ce conducteur (figée tant qu'il ne retravaille pas).
  // _lastWorkedIso[driverId] : dernier jour (iso) où ce conducteur a été
  // traité comme PRÉSENT dans la simulation — sert à détecter une chaîne
  // cassée (le jour d'après n'est pas iso+1 exactement).
  // _cascadeNaturalIndex[iso][driverId] : position (0-15) du conducteur à
  // l'issue du traitement de ce jour-là (qu'il ait travaillé ou non ce
  // jour-là — figée sinon) — utilisé pour "la zone qu'aurait eue le
  // conducteur", utile au remplacement (zone laissée vacante par un absent).
  // _cascadeDayZone[iso][driverId] : zone AFFICHÉE ce jour-là (ex. "D" ou
  // "01D") si le conducteur était présent.
  // _cascadeCursorIso : dernier jour entièrement traité (inclus), ou null.
  _pointer: {},
  _lastWorkedIso: {},
  _cascadeNaturalIndex: {},
  _cascadeDayZone: {},
  _cascadeCursorIso: null,

  clearCache() {
    this._cache = {};
    this._pointer = {};
    this._lastWorkedIso = {};
    this._cascadeNaturalIndex = {};
    this._cascadeDayZone = {};
    this._cascadeCursorIso = null;
  },

  _letterOfPointer(pointer, zones) {
    return zones[Math.floor(pointer / 2) % zones.length];
  },
  _subslotOfPointer(pointer) {
    return (pointer % 2) + 1; // 1 ou 2
  },
  // Décode une zone affichée ("D" ou "01D") en position 0-15 dans la chaîne.
  // Une zone AVEC préfixe (01X/02X) donne le cran exact. Une zone SANS
  // préfixe (un seul occupant ce jour-là — le cran réel reste caché) ne
  // révèle pas sa parité : on préserve alors celle déjà suivie par ce
  // conducteur (existingPointer, s'il en a une) — c'est elle qui déterminera
  // s'il reste sur la même lettre ou avance à la suivante le jour d'après,
  // exactement comme s'il n'y avait pas eu de correction manuelle sur la
  // LETTRE seule. Seul un conducteur SANS historique du tout (aucune
  // position suivie) retombe sur la convention par défaut (2e cran).
  _pointerFromZoneStr(str, zones, existingPointer) {
    if (!str) return 1;
    let letter = str, subslot = null;
    const m = String(str).match(/^(\d+)(.+)$/);
    if (m) { subslot = parseInt(m[1], 10) || 1; letter = m[2]; }
    const idx = Math.max(0, zones.indexOf(letter));
    if (subslot !== null) return idx * 2 + (subslot >= 2 ? 1 : 0);
    const preservedParity = existingPointer !== undefined ? (existingPointer % 2) : 1;
    return idx * 2 + preservedParity;
  },

  // Avance la simulation en chaîne RTG (tous conducteurs RTG, tous créneaux)
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
      // Ordre de la chaîne à 16 crans : la 1ère zone de la flotte (A) est
      // volontairement REJETÉE EN DERNIER (règle déjà en place ailleurs dans
      // l'appli, confirmée à nouveau ici — demande explicite de
      // l'exploitant : "sans affecter la zone A tant qu'on a [moins de 8]
      // conducteurs présents") : elle ne doit être occupée que si aucune
      // autre lettre n'est disponible ce jour-là, jamais par défaut.
      const zoneA = zones[0];
      const chainZones = zones.slice(1).concat([zoneA]);

      Object.keys(slotGroups).forEach(key => {
        const slotDrivers = slotGroups[key];
        const overridden = [], continuing = [], resetting = [];
        slotDrivers.forEach(driver => {
          const override = state.manualOverrides[iso + "_" + driver.id];
          if (override && override.zone !== undefined && override.zone !== null) { overridden.push(driver); return; }
          if (this._lastWorkedIso[driver.id] === prevIso) continuing.push(driver);
          else resetting.push(driver);
        });

        // 1) Une correction manuelle (zone RÉELLEMENT reçue) fixe le cran
        // directement — jamais de valeur fantôme calculée en parallèle.
        const effectiveLetter = {};
        overridden.forEach(driver => {
          const override = state.manualOverrides[iso + "_" + driver.id];
          this._pointer[driver.id] = this._pointerFromZoneStr(override.zone, chainZones, this._pointer[driver.id]);
          effectiveLetter[driver.id] = this._letterOfPointer(this._pointer[driver.id], chainZones);
        });

        // 2) Les conducteurs déjà en poste hier (chaîne continue) avancent
        // d'UN cran (§ en-tête : 01X→02X même lettre, 02X→01(X+1) lettre
        // suivante).
        continuing.forEach(driver => {
          const p = this._pointer[driver.id] !== undefined
            ? this._pointer[driver.id]
            : Math.max(0, chainZones.indexOf(driver.initialZone)) * 2 + 1;
          this._pointer[driver.id] = (p + 1) % (chainZones.length * 2);
          effectiveLetter[driver.id] = this._letterOfPointer(this._pointer[driver.id], chainZones);
        });

        // 2b) Zone A évitée : un conducteur en chaîne continue qui atterrit
        // naturellement sur A est redirigé vers la première autre lettre
        // encore libre ce jour-là (son cran réel — this._pointer — n'est PAS
        // modifié, seul l'AFFICHAGE du jour change ; la chaîne continue
        // normalement en coulisses, cf. en-tête).
        continuing.forEach(driver => {
          if (effectiveLetter[driver.id] !== zoneA) return;
          const used = new Set(Object.values(effectiveLetter));
          const free = chainZones.find(z => z !== zoneA && !used.has(z));
          if (free) effectiveLetter[driver.id] = free;
        });

        // 2c) Aucun doublage n'est mathématiquement nécessaire tant que le
        // nombre de présents ne dépasse pas le nombre de zones (8) : une
        // collision qui apparaîtrait par pur hasard entre deux chaînes
        // individuelles indépendantes (ex. 7 présents, deux conducteurs
        // atterrissent sur la même lettre par coïncidence) est résolue en
        // gardant celui au cran le plus bas sur cette lettre et en
        // redirigeant les autres vers une lettre encore libre (zone A
        // toujours en tout dernier recours) — jamais de doublage "gratuit".
        // Un doublage n'est laissé tel quel que lorsqu'il est réellement
        // inévitable (plus de présents que de zones ce jour-là).
        if (slotDrivers.length <= chainZones.length) {
          const byLetterContinuing = {};
          continuing.forEach(d => {
            const l = effectiveLetter[d.id];
            (byLetterContinuing[l] = byLetterContinuing[l] || []).push(d);
          });
          Object.keys(byLetterContinuing).forEach(letter => {
            const group = byLetterContinuing[letter];
            if (group.length <= 1) return;
            group.sort((a, b) => this._pointer[a.id] - this._pointer[b.id]);
            for (let i = 1; i < group.length; i++) {
              const used = new Set(Object.values(effectiveLetter));
              const free = chainZones.find(z => z !== zoneA && !used.has(z)) || chainZones.find(z => !used.has(z));
              if (free) effectiveLetter[group[i].id] = free;
            }
          });
        }

        // 3) Zones vacantes ce jour-là (aucun conducteur "fixe" — corrigé ou
        // en chaîne continue — n'y est) : pour les revenants d'absence et
        // les nouveaux, dans l'ordre de leur PROPRE zone avant l'absence
        // (croissant, zone A en dernier recours) — demande explicite de
        // l'exploitant.
        const fixedLetters = new Set(Object.values(effectiveLetter));
        const vacantLetters = chainZones.filter(z => !fixedLetters.has(z));
        const sortedResetting = resetting.slice().sort((a, b) => {
          const la = this._referenceLetterForReset(a, chainZones);
          const lb = this._referenceLetterForReset(b, chainZones);
          const ia = chainZones.indexOf(la), ib = chainZones.indexOf(lb);
          return (ia === -1 ? chainZones.length : ia) - (ib === -1 ? chainZones.length : ib);
        });
        sortedResetting.forEach((driver, i) => {
          const letter = vacantLetters.length > 0 ? vacantLetters[i % vacantLetters.length] : zoneA;
          this._pointer[driver.id] = chainZones.indexOf(letter) * 2 + 1;
          effectiveLetter[driver.id] = letter;
        });

        // 4) Affichage : lettre seule si un seul conducteur dessus ce
        // jour-là, "01X"/"02X" si exactement deux (les 2 seuls crans
        // possibles d'une même lettre) — une correction manuelle garde son
        // libellé tel quel, saisi par le responsable.
        overridden.forEach(driver => {
          dayResult[driver.id] = state.manualOverrides[iso + "_" + driver.id].zone;
        });
        const byLetter = {};
        continuing.concat(resetting).forEach(driver => {
          const letter = effectiveLetter[driver.id];
          (byLetter[letter] = byLetter[letter] || []).push(driver);
        });
        Object.keys(byLetter).forEach(letter => {
          const ds = byLetter[letter];
          if (ds.length === 1) {
            dayResult[ds[0].id] = letter;
          } else {
            // Cas normal : exactement 2 (les 2 seuls crans d'une lettre).
            // Un 3e conducteur simultané sur la même lettre (ne devrait pas
            // arriver avec ce mécanisme, mais robustesse) : numérotation de
            // secours par ordre de cran croissant.
            ds.sort((a, b) => this._subslotOfPointer(this._pointer[a.id]) - this._subslotOfPointer(this._pointer[b.id]));
            ds.forEach((d, i) => {
              const num = ds.length === 2 ? this._subslotOfPointer(this._pointer[d.id]) : i + 1;
              dayResult[d.id] = String(num).padStart(2, "0") + letter;
            });
          }
        });

        slotDrivers.forEach(driver => { this._lastWorkedIso[driver.id] = iso; });
      });

      // Position (figée si absent ce jour-là) de TOUS les conducteurs RTG,
      // qu'ils aient travaillé ou non — utilisé par getExpectedZoneForDate
      // (zone qu'aurait eue / laissée vacante un conducteur absent, utile au
      // remplacement).
      const naturalForDay = {};
      rtgDriversAll.forEach(driver => {
        naturalForDay[driver.id] = this._pointer[driver.id] !== undefined
          ? this._pointer[driver.id]
          : Math.max(0, chainZones.indexOf(driver.initialZone)) * 2 + 1;
      });
      this._cascadeNaturalIndex[iso] = naturalForDay;
      this._cascadeDayZone[iso] = dayResult;
      this._cascadeCursorIso = iso;
      cursor = RTGDate.addDays(cursor, 1);
    }
  },

  // Dernière zone réelle connue AVANT une absence (dernier cran figé), ou la
  // zone initiale de la fiche si le conducteur n'a encore jamais travaillé.
  _referenceLetterForReset(driver, zones) {
    const p = this._pointer[driver.id];
    if (p !== undefined) return this._letterOfPointer(p, zones);
    return driver.initialZone;
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
      result = CcPosteRotationEngine.getZoneForDate(driver, date, state, teams);
    }
    this._cache[key] = result;
    return result;
  },

  // Zone qu'aurait eue le conducteur ce jour-là s'il avait travaillé — utile
  // pour le remplacement, où on doit connaître la zone laissée vacante par
  // un conducteur absent. Pour la flotte RTG, c'est la lettre correspondant
  // à son cran figé (dernier jour réellement travaillé) — la chaîne étant
  // cassée par une absence, il n'y a pas de "cran hypothétique" à avancer
  // pour un jour non travaillé, juste la dernière position connue.
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
      const p = (nat && nat[driver.id] !== undefined) ? nat[driver.id] : null;
      return p !== null ? this._letterOfPointer(p, chainZones) : null;
    }
    return CcPosteRotationEngine.getExpectedZoneForDate(driver, date, state, teams);
  }
};
