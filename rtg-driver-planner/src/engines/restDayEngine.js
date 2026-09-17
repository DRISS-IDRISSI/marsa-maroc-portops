// ==========================================
// RTG DRIVER PLANNER — Moteur des repos mensuels (règle §12)
// Génère automatiquement config.reposMensuel (6) jours de REPOS par conducteur
// et par mois, choisis parmi les jours qui ne sont ni déjà CONGÉ/MALADIE/ABSENCE
// ni un dimanche de shift 3 (OFF), ni un jour férié.
//
// Calculé équipe par équipe (pas conducteur par conducteur isolément) afin de
// pouvoir imposer un plafond du nombre de conducteurs en repos le même jour —
// sans ce plafond partagé, plusieurs conducteurs peuvent indépendamment choisir
// le même jour "idéal" (ex. un dimanche à faible charge) et vider l'équipe ce
// jour-là.
//
// Le CHOIX des jours eux-mêmes (une fois le nombre de repos dû à chaque
// conducteur déterminé, cf. répartition par shift/label ci-dessous) se fait
// par ROTATION PARTAGÉE au sein de chaque bloc de vacation (driver.
// initialVacation) : les jours candidats sont parcourus dans l'ordre
// chronologique et, à chaque jour, le conducteur suivant dans la rotation qui
// a encore besoin d'un repos ce mois-ci se voit attribuer ce jour — le
// pointeur de rotation n'est jamais réinitialisé (il persiste sur tout le
// mois pour ce bloc). Ceci produit un placement visuellement ORDONNÉ "en
// escalier" (chaque conducteur avance d'un cran par rapport au précédent),
// demande explicite de l'exploitant à la place d'un placement dispersé.
// config.restDayWeightByDow (préférence jour de semaine) n'intervient donc
// plus dans ce choix fin — seul restDayWeightByShift (charge relative de
// chaque SHIFT, voir plus bas) continue de déterminer COMBIEN de repos un
// conducteur reçoit dans chaque période de shift, pas QUEL jour précis.
//
// Le quota de 6 repos est réduit d'un jour pour chaque tranche de
// config.reposReductionParJoursCongé (5) jours de CONGÉ pris dans le mois.
//
// Deux repos consécutifs pour un même conducteur sont évités (le choix d'un
// jour candidat écarte systématiquement les jours immédiatement adjacents à
// un repos déjà retenu ce mois-ci), sauf repli extrême si aucune autre
// option n'est disponible.
//
// Le quota mensuel de chaque conducteur est réparti par ANTICIPATION entre les
// semaines où son équipe est sur Shift 1, Shift 2 et Shift 3, proportionnellement
// au nombre de jours candidats de chaque shift ce mois-là ET à sa charge de
// travail relative (config.restDayWeightByShift — Shift 1 = 30%, Shift 2 = 40%,
// Shift 3 = 30% ; plus la charge d'un shift est faible, plus il reçoit de
// repos). Le placement fin à l'intérieur de chaque shift (et, quand
// applicable, de chaque label V1/V2) utilise ensuite la rotation partagée
// décrite plus haut.
//
// Chaque conducteur appartient à un bloc de vacation FIXE (driver.initialVacation,
// §9-10 — les deux blocs d'une équipe ne se séparent jamais). Pour qu'un bloc ne
// se retrouve pas presque vide de repos pendant que l'autre est presque vidé de
// conducteurs présents un même jour, le nombre de repos pris le même jour dans
// CHAQUE bloc est plafonné proportionnellement à la taille de ce bloc (en plus
// du plafond global par jour toute l'équipe confondue).
// ==========================================

// Exposant appliqué à l'inverse de la charge (%) de chaque vacation pour biaiser
// le placement des repos entre V1/V2 (restDayLabelBiasByShift) : plus il est
// élevé, plus la vacation à charge plus faible est poussée à avoir MOINS de
// présents que l'autre.
//
// Une valeur élevée (12) a été testée : elle empêche bien V1 de dépasser V2 sur
// le Shift 1, MAIS aggrave l'écart global dans l'AUTRE sens (le biais devient si
// fort qu'il vide trop V1 certains jours — écart moyen mesuré 3.8, jusqu'à 16
// jours/mois avec un écart > 3, contre un cas extrême observé de 4 présents en
// V1 pour 13 en V2). Une valeur plus souple (2) donne un résultat globalement
// bien plus équilibré (écart moyen ~2.0, 2 à 3 fois moins de jours très
// déséquilibrés), au prix d'un compromis assumé : V1 dépasse alors V2 quelques
// jours par mois (3 à 6), parfois de plus d'un conducteur à la fois — ces cas
// sont signalés visuellement (PlanningEngine, vacationBalanceAlert) pour une
// décision humaine, au lieu d'être empêchés automatiquement à tout prix.
const LABEL_BIAS_EXPONENT = 2;

const RestDayEngine = {
  _cache: {},
  _teamCache: {},
  _extraCache: {},

  clearCache() {
    this._cache = {};
    this._teamCache = {};
    this._extraCache = {};
  },

  countCongeDaysInMonth(driver, month, year, state) {
    const dim = RTGDate.daysInMonth(month, year);
    let count = 0;
    for (let d = 1; d <= dim; d++) {
      const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
      if (AbsenceEngine.findRecord(state.conges, driver.id, iso)) count++;
    }
    return count;
  },

  getCandidatesForDriver(driver, month, year, state, team) {
    const dim = RTGDate.daysInMonth(month, year);
    const candidates = [];
    for (let d = 1; d <= dim; d++) {
      const date = RTGDate.makeDate(year, month, d);
      const iso = RTGDate.toISO(date);
      if (AbsenceEngine.getFixedStatus(driver, iso, state)) continue;
      // Un jour déjà couvert par une affectation manuelle (case par case ou
      // import Excel du planning réel) est une donnée FIGÉE, quel que soit
      // son statut — jamais un jour "libre" où cet algorithme pourrait choisir
      // de placer (ou ne pas placer) un repos automatique. Sans cette
      // exclusion, l'algorithme ignore totalement les repos déjà forcés
      // manuellement et peut placer un repos AUTO juste à côté d'un repos
      // manuel (2 repos consécutifs une fois les deux fusionnés à
      // l'affichage — cas réel observé après import Excel).
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

  // Passage 1 : repos OBLIGATOIRE le dimanche sur les shifts 1 et 2 (le shift 3 est
  // déjà OFF ce jour-là) pour ne jamais dépasser sundayVacationCap par vacation.
  // La vacation de chaque conducteur disponible ce dimanche-là est celle de son
  // bloc ce jour précis (VacationRotationEngine, bascule quotidienne du bloc entier,
  // gelée dimanche→lundi — §9-10) ; les deux blocs V1 et V2 de ce dimanche-là sont
  // donc traités séparément, chacun plafonné à sundayVacationCap. Sélection en
  // rotation équitable au sein de chaque bloc (le point de départ avance à chaque
  // bloc/dimanche traité) pour que ce ne soit pas toujours les mêmes conducteurs
  // qui travaillent — ou qui restent chez eux — le dimanche. Ce repos consomme le
  // quota mensuel.
  getMandatorySundayOff(team, month, year, state, teamDrivers) {
    const mandatory = {};
    teamDrivers.forEach(d => { mandatory[d.id] = new Set(); });
    if (!team) return mandatory;

    const cap = state.config.sundayVacationCap || 6;
    const N = teamDrivers.length || 1;
    const dim = RTGDate.daysInMonth(month, year);
    let pointer = 0;

    for (let d = 1; d <= dim; d++) {
      const date = RTGDate.makeDate(year, month, d);
      if (!RTGDate.isSunday(date)) continue;
      const iso = RTGDate.toISO(date);
      if (HolidayEngine.getEffectiveHoliday(date, team, state.config)) continue;
      const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
      if (shift !== "S1" && shift !== "S2") continue;

      const available = teamDrivers.filter(dr => !AbsenceEngine.getFixedStatus(dr, iso, state) && !state.manualOverrides[iso + "_" + dr.id]);
      const byVacation = { V1: [], V2: [] };
      available.forEach(dr => {
        const vac = VacationRotationEngine.getVacationForDate(dr, date, state);
        if (vac === "V1" || vac === "V2") byVacation[vac].push(dr);
      });

      ["V1", "V2"].forEach(vac => {
        const group = byVacation[vac];
        const requiredOff = group.length - cap;
        if (requiredOff <= 0) return;

        const groupIds = new Set(group.map(dr => dr.id));
        let chosen = 0;
        let scanned = 0;
        let idx = pointer;
        while (chosen < requiredOff && scanned < N * 2) {
          const candidate = teamDrivers[idx % N];
          if (groupIds.has(candidate.id)) {
            mandatory[candidate.id].add(d);
            chosen++;
          }
          idx++;
          scanned++;
        }
        pointer = idx % N;
      });
    }

    return mandatory;
  },

  // Calcule les repos de TOUTE l'équipe en une passe, avec un plafond partagé du
  // nombre de conducteurs en repos le même jour civil.
  getTeamRestDays(team, month, year, state) {
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    if (this._teamCache[key]) return this._teamCache[key];

    const teamDrivers = state.drivers.filter(dr => dr.teamId === (team ? team.id : null) && dr.actif !== false);
    const N = teamDrivers.length || 1;
    // Plafond de conducteurs en repos le même jour : suffisamment large pour laisser
    // jouer la préférence des jours à faible charge, assez bas pour ne jamais vider
    // une part significative de l'équipe le même jour.
    const maxPerDay = Math.max(2, Math.ceil(N * 0.3));
    const dim = RTGDate.daysInMonth(month, year);
    const dayUsage = {};
    const results = {};

    // Taille de chaque bloc de vacation FIXE de l'équipe (driver.initialVacation —
    // ne bouge jamais, cf. en-tête du fichier), pour plafonner les repos du même
    // jour dans chaque bloc proportionnellement à sa taille.
    const groupSizes = { V1: 0, V2: 0 };
    teamDrivers.forEach(dr => {
      if (dr.initialVacation === "V1" || dr.initialVacation === "V2") groupSizes[dr.initialVacation]++;
    });
    const maxPerDayGroup = {
      V1: Math.max(1, Math.ceil(maxPerDay * groupSizes.V1 / N)),
      V2: Math.max(1, Math.ceil(maxPerDay * groupSizes.V2 / N))
    };
    const groupDayUsage = {}; // { [day]: { V1: n, V2: n } }
    const bumpGroupUsage = (day, group) => {
      if (group !== "V1" && group !== "V2") return;
      const g = (groupDayUsage[day] = groupDayUsage[day] || { V1: 0, V2: 0 });
      g[group]++;
    };
    const groupUsageAt = (day, group) => {
      const g = groupDayUsage[day];
      return g ? g[group] || 0 : 0;
    };

    const mandatorySundayOff = this.getMandatorySundayOff(team, month, year, state, teamDrivers);

    // Jours où un conducteur a déjà un REPOS forcé par une affectation manuelle
    // (case par case ou import Excel du planning réel) : à traiter exactement
    // comme un repos obligatoire pour cet algorithme — consomme son quota,
    // compte dans les plafonds du jour/du bloc, et bloque l'adjacence — sinon
    // l'algorithme, totalement aveugle aux affectations manuelles, peut placer
    // un repos AUTO juste à côté (2 repos consécutifs une fois fusionnés à
    // l'affichage, cas réel observé après un import Excel) ou dépasser
    // discrètement les plafonds d'un jour déjà chargé de repos manuels.
    const manualRestByDriver = {};
    teamDrivers.forEach(driver => {
      const set = new Set();
      for (let d = 1; d <= dim; d++) {
        const iso = RTGDate.toISO(RTGDate.makeDate(year, month, d));
        const ov = state.manualOverrides[iso + "_" + driver.id];
        if (ov && ov.status === "REPOS") set.add(d);
      }
      manualRestByDriver[driver.id] = set;
    });

    // Comptabilise TOUTES les affectations obligatoires (dimanche + manuelles)
    // de l'équipe dans dayUsage avant de traiter le moindre conducteur : sans
    // ça, les premiers conducteurs de la boucle voient le compteur encore à
    // zéro pour un jour dont le repos obligatoire/manuel n'a été enregistré
    // que pour des conducteurs plus loin dans la liste, et peuvent alors
    // choisir ce même jour par préférence, faisant largement dépasser le
    // plafond une fois tout le monde traité.
    teamDrivers.forEach(driver => {
      const fixedDays = new Set([...(mandatorySundayOff[driver.id] || []), ...manualRestByDriver[driver.id]]);
      fixedDays.forEach(d => {
        dayUsage[d] = (dayUsage[d] || 0) + 1;
        bumpGroupUsage(d, driver.initialVacation);
      });
    });

    // Repos du DERNIER jour du mois précédent, par conducteur : deux mois sont
    // calculés indépendamment l'un de l'autre, donc sans cette vérification un
    // repos pourrait être choisi le 1er jour de CE mois alors que le conducteur
    // était déjà en repos la veille (dernier jour du mois précédent) — deux
    // repos consécutifs à cheval sur la frontière des mois. Ne regarde qu'en
    // arrière (jamais le mois suivant) pour ne jamais créer de dépendance
    // circulaire entre deux mois calculés l'un après l'autre.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthLastDay = RTGDate.daysInMonth(prevMonth, prevYear);
    const prevMonthRestByDriver = {};
    if (team) {
      const refDate = RTGDate.parseISO(state.config.rotationReferenceDate);
      if (refDate.getTime() < RTGDate.makeDate(prevYear, prevMonth, prevMonthLastDay).getTime()) {
        teamDrivers.forEach(driver => {
          const prevDays = this.getRestDaysForMonth(driver, prevMonth, prevYear, state, state.teams);
          prevMonthRestByDriver[driver.id] = prevDays.indexOf(prevMonthLastDay) !== -1;
        });
      }
    }

    // Shift de l'équipe pour chaque jour du mois (indépendant du conducteur) —
    // sert à répartir le quota de repos de chaque conducteur entre les périodes
    // Shift 1 / Shift 2 / Shift 3 avant le placement fin jour par jour.
    const dayShift = {};
    if (team) {
      for (let d = 1; d <= dim; d++) {
        dayShift[d] = ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.makeDate(year, month, d), state.config);
      }
    }
    const shiftWeights = state.config.restDayWeightByShift || { S1: 1, S2: 1, S3: 1 };
    const labelBiasByShift = state.config.restDayLabelBiasByShift || {};

    // Répartit `total` entre des groupes de jours candidats (ex. par shift, ou par
    // label de vacation du jour), proportionnellement à leur nombre de jours ET à
    // un poids relatif — méthode du plus grand reste pour que les parts arrondies
    // totalisent exactement `total`, sans jamais dépasser la capacité (longueur)
    // de chacun.
    const distributeByWeight = (total, groups) => {
      const shares = {};
      let totalWeighted = 0;
      groups.forEach(g => { g.weighted = g.days.length * (g.weight || 0); totalWeighted += g.weighted; });
      if (totalWeighted <= 0) {
        groups.forEach(g => { shares[g.key] = 0; });
        return shares;
      }
      let allocated = 0;
      const remainders = [];
      groups.forEach(g => {
        const raw = total * g.weighted / totalWeighted;
        const floor = Math.min(Math.floor(raw), g.days.length);
        shares[g.key] = floor;
        allocated += floor;
        remainders.push({ key: g.key, rem: raw - Math.floor(raw), cap: g.days.length });
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

    // ------------------------------------------------------------------
    // Phase A : pour chaque conducteur, jours fixes déjà comptabilisés,
    // quota restant, puis répartition — SANS encore choisir les jours eux-
    // mêmes — par shift (restDayWeightByShift) et, à l'intérieur de chaque
    // shift, par label V1/V2 (restDayLabelBiasByShift) : calcul de
    // répartition identique à avant. Le CHOIX des jours se fait ensuite en
    // Phase B, par ROTATION PARTAGÉE au sein de chaque bloc de vacation
    // (voir en-tête du fichier).
    // ------------------------------------------------------------------
    const driverState = {};
    teamDrivers.forEach(driver => {
      const candidates = this.getCandidatesForDriver(driver, month, year, state, team);
      const congeDays = this.countCongeDaysInMonth(driver, month, year, state);
      const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
      const quota = Math.max(0, state.config.reposMensuel - reduction);

      const fixedDays = new Set([...(mandatorySundayOff[driver.id] || []), ...manualRestByDriver[driver.id]]);
      const chosen = [];
      const used = new Set();
      fixedDays.forEach(d => { chosen.push(d); used.add(d); });
      // Jour 0 virtuel : bloque le jour 1 par adjacence si le conducteur était
      // déjà en repos le dernier jour du mois précédent.
      if (prevMonthRestByDriver[driver.id]) used.add(0);

      const target = Math.max(0, Math.min(quota, candidates.length) - chosen.length);
      const needsByBucket = {};

      if (target > 0) {
        if (!team) {
          needsByBucket.__all__ = target;
        } else {
          const availableCandidates = candidates.filter(d => !used.has(d));
          const buckets = { S1: [], S2: [], S3: [] };
          availableCandidates.forEach(d => { const s = dayShift[d]; if (buckets[s]) buckets[s].push(d); });
          const shiftIds = ["S1", "S2", "S3"];
          const shares = distributeByWeight(target, shiftIds.map(s => ({
            key: s, days: buckets[s], weight: shiftWeights[s] || 1
          })));
          shiftIds.forEach(s => {
            const shiftTarget = shares[s];
            if (shiftTarget <= 0) return;
            const ratio = labelBiasByShift[s];
            if (!ratio || !(ratio.V1 > 0) || !(ratio.V2 > 0)) {
              needsByBucket[s + "_ANY"] = (needsByBucket[s + "_ANY"] || 0) + shiftTarget;
              return;
            }
            const labelDays = { V1: [], V2: [] };
            buckets[s].forEach(d => {
              const label = VacationRotationEngine.getVacationForDate(driver, RTGDate.makeDate(year, month, d), state);
              if (labelDays[label]) labelDays[label].push(d);
            });
            // Poids en 1/pct^LABEL_BIAS_EXPONENT (et non 1/pct) : les contraintes
            // déjà en jeu (plafonds, non-adjacence, arrondis par petits buckets)
            // atténuent fortement un simple ratio inverse — un exposant élevé est
            // nécessaire pour que l'écart de présence obtenu se rapproche de celui
            // attendu, surtout quand les deux vacations ont des charges proches.
            const subShares = distributeByWeight(shiftTarget, [
              { key: "V1", days: labelDays.V1, weight: 1 / Math.pow(ratio.V1, LABEL_BIAS_EXPONENT) },
              { key: "V2", days: labelDays.V2, weight: 1 / Math.pow(ratio.V2, LABEL_BIAS_EXPONENT) }
            ]);
            ["V1", "V2"].forEach(l => {
              if (subShares[l] > 0) needsByBucket[s + "_" + l] = (needsByBucket[s + "_" + l] || 0) + subShares[l];
            });
          });
        }
      }

      driverState[driver.id] = { driver: driver, chosen: chosen, used: used, needsByBucket: needsByBucket, candidateSet: new Set(candidates) };
    });

    if (!team) {
      // Cas isolé (sans contexte d'équipe) : jamais emprunté en pratique —
      // PlanningEngine résout toujours l'équipe avant d'appeler ce moteur
      // (getDailyStatus retourne "ABSENCE" en amont si le conducteur n'a pas
      // d'équipe). Repli simple : espacement de base et non-adjacence.
      teamDrivers.forEach(driver => {
        const st = driverState[driver.id];
        let need = st.needsByBucket.__all__ || 0;
        if (need <= 0) return;
        const candidates = this.getCandidatesForDriver(driver, month, year, state, team).filter(d => !st.used.has(d));
        for (const day of candidates) {
          if (need <= 0) break;
          if (st.used.has(day - 1) || st.used.has(day + 1)) continue;
          st.chosen.push(day);
          st.used.add(day);
          need--;
        }
      });
    } else {
      // ------------------------------------------------------------------
      // Phase B : attribution des jours par ROTATION PARTAGÉE, bloc de
      // vacation par bloc de vacation (driver.initialVacation — §9-10,
      // jamais séparé), bucket par bucket (shift × label), jours du bucket
      // traités dans l'ordre chronologique. Le pointeur de rotation n'est
      // JAMAIS réinitialisé d'un bucket à l'autre (persiste sur tout le mois
      // pour ce bloc) : même quand un conducteur est ignoré (déjà pourvu ce
      // jour-là, adjacence, plafond) ou qu'un jour est sauté (plafond du
      // jour atteint), l'ordre reprend exactement où il s'est arrêté au
      // bucket suivant — c'est ce qui produit un motif "en escalier"
      // cohérent sur l'ensemble du mois plutôt que juste à l'intérieur d'un
      // seul petit groupe de jours (résolution insuffisante avec un simple
      // décalage proportionnel recalculé indépendamment par petit bucket).
      // ------------------------------------------------------------------
      const blockDrivers = { V1: [], V2: [] };
      teamDrivers.forEach(driver => {
        if (driver.initialVacation === "V1" || driver.initialVacation === "V2") {
          blockDrivers[driver.initialVacation].push(driver);
        }
      });
      const rotationPointer = { V1: 0, V2: 0 };

      // Label (V1/V2) qu'affiche CE JOUR-LÀ un bloc de vacation FIXE donné,
      // indépendant du conducteur précis (VacationRotationEngine ne lit que
      // driver.initialVacation) — calculé une seule fois par jour/bloc.
      const labelForBlock = { V1: {}, V2: {} };
      ["V1", "V2"].forEach(block => {
        const blockStub = { id: "__block_" + block, initialVacation: block };
        for (let d = 1; d <= dim; d++) {
          labelForBlock[block][d] = VacationRotationEngine.getVacationForDate(blockStub, RTGDate.makeDate(year, month, d), state);
        }
      });

      // Plafond quotidien de repos pour un BLOC donné, identique à avant
      // (biaisé par restDayLabelBiasByShift quand applicable, sinon
      // proportionnel à la taille du bloc) mais paramétré par bloc plutôt
      // que fermé sur un conducteur précis.
      const groupCapForDayGeneric = (day, group) => {
        const shift = dayShift[day];
        const ratio = shift && labelBiasByShift[shift];
        if (ratio && ratio.V1 > 0 && ratio.V2 > 0) {
          const label = labelForBlock[group] && labelForBlock[group][day];
          if (label === "V1" || label === "V2") {
            const w = { V1: 1 / Math.pow(ratio.V1, LABEL_BIAS_EXPONENT), V2: 1 / Math.pow(ratio.V2, LABEL_BIAS_EXPONENT) };
            const share = w[label] / (w.V1 + w.V2);
            return Math.max(1, Math.ceil(maxPerDay * share));
          }
        }
        return maxPerDayGroup[group] !== undefined ? maxPerDayGroup[group] : maxPerDay;
      };
      const underGroupCapGeneric = (day, group) => groupUsageAt(day, group) < groupCapForDayGeneric(day, group);

      // Attribue au plus UN conducteur par jour pour CE bucket précis (les
      // autres buckets/blocs peuvent encore utiliser le même jour civil,
      // dans la limite du plafond global de l'équipe) en parcourant `days`
      // dans l'ordre chronologique, avec autant de "tours" que nécessaire si
      // le besoin total du bloc sur ce bucket dépasse son nombre de jours.
      // Le besoin non satisfait (plafonds trop serrés) est laissé dans
      // needsByBucket pour le repli de Phase C.
      const assignBucketRotation = (block, bucketKey, days) => {
        const blockList = blockDrivers[block];
        const M = blockList.length;
        if (M === 0 || days.length === 0) return;
        let remaining = blockList.reduce((n, dr) => n + (driverState[dr.id].needsByBucket[bucketKey] || 0), 0);
        if (remaining <= 0) return;
        let safety = (remaining + days.length) * M + 50;
        let dayIdx = 0;
        while (remaining > 0 && safety-- > 0) {
          const day = days[dayIdx % days.length];
          dayIdx++;
          if ((dayUsage[day] || 0) >= maxPerDay) continue;
          for (let a = 0; a < M; a++) {
            const dr = blockList[rotationPointer[block] % M];
            rotationPointer[block] = (rotationPointer[block] + 1) % M;
            const st = driverState[dr.id];
            const need = st.needsByBucket[bucketKey] || 0;
            if (need <= 0) continue;
            // `days` est une liste PARTAGÉE (shift × label, commune au bloc) qui ne
            // tient pas compte des absences fixes/jours fériés propres à CE
            // conducteur (congé, maladie, absence, affectation manuelle) — seul
            // candidateSet (issu de getCandidatesForDriver) les exclut vraiment.
            if (!st.candidateSet.has(day)) continue;
            if (st.used.has(day) || st.used.has(day - 1) || st.used.has(day + 1)) continue;
            if (!underGroupCapGeneric(day, block)) continue;
            st.chosen.push(day);
            st.used.add(day);
            st.needsByBucket[bucketKey] = need - 1;
            dayUsage[day] = (dayUsage[day] || 0) + 1;
            bumpGroupUsage(day, block);
            remaining--;
            break;
          }
        }
      };

      // Poids jour-de-semaine (dimanche, ou samedi si Shift 2 cette
      // semaine-là — restDayWeightByDow / restDayWeightSaturdayShift2) :
      // charge la plus faible, donc jour à privilégier pour un repos, tant
      // que les plafonds jour/bloc le permettent.
      const dowWeight = day => {
        const dow = RTGDate.dowMon0(RTGDate.makeDate(year, month, day));
        const weights = state.config.restDayWeightByDow || [1, 1, 1, 1, 1, 1, 1];
        if (dow === 5 && dayShift[day] === "S2") {
          return state.config.restDayWeightSaturdayShift2 || weights[5];
        }
        return weights[dow] || 1;
      };

      const shiftDays = { S1: [], S2: [], S3: [] };
      for (let d = 1; d <= dim; d++) { if (shiftDays[dayShift[d]]) shiftDays[dayShift[d]].push(d); }
      // Trie chaque liste par poids jour-de-semaine DÉCROISSANT (à
      // chronologie égale) : la rotation (assignBucketRotation ci-dessous)
      // visite les jours d'un bucket dans CET ordre à chaque tour, donc ces
      // jours à faible charge sont essayés EN PREMIER — plus de repos y sont
      // mécaniquement concentrés (dans la limite des plafonds), sans perdre
      // l'équité de la rotation entre conducteurs.
      ["S1", "S2", "S3"].forEach(s => { shiftDays[s].sort((a, b) => dowWeight(b) - dowWeight(a) || a - b); });

      ["S1", "S2", "S3"].forEach(s => {
        const ratio = labelBiasByShift[s];
        ["V1", "V2"].forEach(block => {
          if (ratio && ratio.V1 > 0 && ratio.V2 > 0) {
            assignBucketRotation(block, s + "_V1", shiftDays[s].filter(d => labelForBlock[block][d] === "V1"));
            assignBucketRotation(block, s + "_V2", shiftDays[s].filter(d => labelForBlock[block][d] === "V2"));
          } else {
            assignBucketRotation(block, s + "_ANY", shiftDays[s]);
          }
        });
      });

      // ------------------------------------------------------------------
      // Phase C (repli, rare en pratique) : besoin résiduel non satisfait
      // par la rotation par bucket (plafonds trop serrés à l'échelle d'un
      // seul bucket) — replacé sur l'ensemble des jours candidats encore
      // libres de CE conducteur, tout le mois confondu, où la marge de
      // manœuvre est bien plus grande. Trois niveaux, comme avant : d'abord
      // en respectant non-adjacence + plafond du bloc, puis en relâchant le
      // plafond du bloc, puis (tout dernier recours) la non-adjacence — le
      // plafond global de l'équipe n'est en revanche JAMAIS dépassé.
      // ------------------------------------------------------------------
      teamDrivers.forEach(driver => {
        const st = driverState[driver.id];
        let need = Object.values(st.needsByBucket).reduce((a, b) => a + b, 0);
        if (need <= 0) return;
        const candidates = this.getCandidatesForDriver(driver, month, year, state, team).filter(d => !st.used.has(d));
        const group = driver.initialVacation;
        const place = day => {
          st.chosen.push(day); st.used.add(day);
          dayUsage[day] = (dayUsage[day] || 0) + 1;
          bumpGroupUsage(day, group);
          need--;
        };
        for (const day of candidates) {
          if (need <= 0) break;
          if (st.used.has(day - 1) || st.used.has(day + 1)) continue;
          if ((dayUsage[day] || 0) >= maxPerDay) continue;
          if (!underGroupCapGeneric(day, group)) continue;
          place(day);
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if (st.used.has(day - 1) || st.used.has(day + 1)) continue;
            if ((dayUsage[day] || 0) >= maxPerDay) continue;
            place(day);
          }
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if ((dayUsage[day] || 0) >= maxPerDay) continue;
            place(day);
          }
        }
      });
    }

    teamDrivers.forEach(driver => {
      results[driver.id] = driverState[driver.id].chosen.sort((a, b) => a - b);
    });

    // Post-passe (Shift 1 et Shift 3) : essaie de RÉÉQUILIBRER V1/V2 en
    // DÉPLAÇANT des repos déjà attribués (jamais en ajouter) — quota-neutre
    // pour chaque conducteur. Idée de l'exploitant : sur un jour où un bloc
    // est en déficit face à l'autre (dans un sens OU dans l'autre — un même
    // shift peut basculer d'un excès à l'autre d'un jour à l'autre), faire
    // revenir un conducteur du bloc en déficit en échangeant son repos de CE
    // jour contre un autre jour où son bloc affiche l'autre label ET où ce
    // label a alors assez d'excédent pour absorber la perte sans devenir
    // lui-même déficitaire. Respecte toujours l'espacement (jamais 2 repos
    // consécutifs) et le plafond quotidien de l'équipe.
    if (team) {
      const rebalanceShifts = ["S1", "S3"];
      const rebalanceDays = [];
      for (let d = 1; d <= dim; d++) if (rebalanceShifts.indexOf(dayShift[d]) !== -1) rebalanceDays.push(d);

      const presenceOnDay = day => {
        const counts = { V1: 0, V2: 0 };
        teamDrivers.forEach(dr => {
          if ((results[dr.id] || []).indexOf(day) !== -1) return;
          const label = VacationRotationEngine.getVacationForDate(dr, RTGDate.makeDate(year, month, day), state);
          if (label === "V1" || label === "V2") counts[label]++;
        });
        return counts;
      };
      const totalRestingOnDay = day => teamDrivers.filter(dr => (results[dr.id] || []).indexOf(day) !== -1).length;

      let improved = true, safety = 0;
      while (improved && safety < 400) {
        improved = false;
        safety++;
        for (const day of rebalanceDays) {
          const counts = presenceOnDay(day);
          const deficitLabel = counts.V1 < counts.V2 - 1 ? "V1" : (counts.V2 < counts.V1 - 1 ? "V2" : null);
          if (!deficitLabel) continue; // pas de déficit significatif dans aucun sens
          const surplusLabel = deficitLabel === "V1" ? "V2" : "V1";

          const restingDeficit = teamDrivers.filter(dr => {
            if ((results[dr.id] || []).indexOf(day) === -1) return false;
            // Jamais déplacer un repos déjà figé par une affectation manuelle
            // (import Excel du planning réel, ou case par case) : seuls les
            // repos placés par CET algorithme peuvent être rééquilibrés.
            if ((manualRestByDriver[dr.id] || new Set()).has(day)) return false;
            return VacationRotationEngine.getVacationForDate(dr, RTGDate.makeDate(year, month, day), state) === deficitLabel;
          });

          let swapped = false;
          for (const dr of restingDeficit) {
            const currentDays = results[dr.id] || [];
            const restDaysWithoutDay = currentDays.filter(d => d !== day);
            const candidateDays = this.getCandidatesForDriver(dr, month, year, state, team)
              .filter(d => currentDays.indexOf(d) === -1 && d !== day);
            const swapTarget = candidateDays.find(cd => {
              if (VacationRotationEngine.getVacationForDate(dr, RTGDate.makeDate(year, month, cd), state) !== surplusLabel) return false;
              const c = presenceOnDay(cd);
              if (!(c[surplusLabel] - 1 > c[deficitLabel])) return false;
              if (restDaysWithoutDay.indexOf(cd - 1) !== -1 || restDaysWithoutDay.indexOf(cd + 1) !== -1) return false;
              if (totalRestingOnDay(cd) + 1 > maxPerDay) return false;
              return true;
            });
            if (swapTarget === undefined) continue;
            results[dr.id] = restDaysWithoutDay.concat([swapTarget]).sort((a, b) => a - b);
            swapped = true;
            improved = true;
            break;
          }
          if (swapped) break; // recommence le scan : les effectifs du jour ont changé.
        }
      }
    }

    // Post-passe 2 (Shift 1 et Shift 3) : quand l'échange ci-dessus ne suffit
    // pas (plus assez de jours candidats pour absorber tout l'écart), règle
    // métier "les deux vacations doivent être égales, ou à défaut l'une ne
    // dépasse l'autre que d'UN SEUL conducteur au maximum" — dans les deux
    // sens. Traité ICI (une seule passe, jours dans l'ordre chronologique,
    // sur TOUT le mois d'un coup) plutôt que jour par jour dans PlanningEngine :
    // ça permet de savoir combien de repos ponctuels ont déjà été ajoutés à un
    // conducteur PLUS TÔT dans le mois avant d'en ajouter un autre — sans ça,
    // deux jours différents pouvaient chacun choisir le même conducteur sans le
    // savoir, dépassant le plafond toléré et créant parfois 2 repos consécutifs.
    // Repos ajoutés (jamais plus que quota attendu + 1 par conducteur) puis, si
    // ça ne suffit toujours pas, le dernier conducteur en excédent est toléré
    // mais signalé (vacationBalanceAlert) — décision humaine, pas automatique.
    const corrections = {}; // { "<driverId>_<day>": true }
    const flags = {}; // { "<driverId>_<day>": true }
    if (team) {
      // Écart toléré (dans un sens ou dans l'autre) avant repos exceptionnel /
      // signalement : jusqu'à 2 conducteurs d'écart, décision explicite de
      // l'exploitant (auparavant 1).
      const MAX_TOLERATED_EXCESS = 2;
      const rebalanceShifts = ["S1", "S3"];
      const isAdjacentInResults = (driverId, day) => {
        const days = results[driverId] || [];
        return days.indexOf(day - 1) !== -1 || days.indexOf(day + 1) !== -1;
      };
      for (let day = 1; day <= dim; day++) {
        if (rebalanceShifts.indexOf(dayShift[day]) === -1) continue;
        const presentByLabel = { V1: [], V2: [] };
        teamDrivers.forEach(dr => {
          if ((results[dr.id] || []).indexOf(day) !== -1) return;
          const label = VacationRotationEngine.getVacationForDate(dr, RTGDate.makeDate(year, month, day), state);
          if (label === "V1" || label === "V2") presentByLabel[label].push(dr);
        });
        const diff = presentByLabel.V1.length - presentByLabel.V2.length;
        const excessLabel = diff > 0 ? "V1" : (diff < 0 ? "V2" : null);
        if (!excessLabel) continue;
        let excess = Math.abs(diff);
        if (excess <= MAX_TOLERATED_EXCESS) {
          const toFlag = presentByLabel[excessLabel].slice().sort((a, b) => String(a.matricule).localeCompare(String(b.matricule))).slice(-excess);
          toFlag.forEach(dr => { flags[dr.id + "_" + day] = true; });
          continue;
        }

        const withMeta = presentByLabel[excessLabel].map(dr => {
          const restCount = (results[dr.id] || []).length;
          const congeDays = this.countCongeDaysInMonth(dr, month, year, state);
          const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
          const attendu = Math.max(0, state.config.reposMensuel - reduction);
          // L'adjacence (jamais 2 repos consécutifs) fait partie de l'éligibilité
          // elle-même, pas d'un simple tri, et n'est JAMAIS relâchée ici : donnée
          // réelle vérifiée (planning manuel fourni par l'exploitant, septembre
          // 2026) — 0 occurrence de 2 repos consécutifs sur tout le mois. Ce
          // repos ponctuel est un "bonus", pas un repos obligatoire ; s'il n'y a
          // personne d'éligible sans casser cette règle, l'excédent restant est
          // toléré et signalé (plus bas) plutôt que forcé.
          return { dr: dr, restCount: restCount, eligible: restCount < attendu + 1 && !isAdjacentInResults(dr.id, day) };
        });
        const eligiblePool = withMeta.filter(x => x.eligible).sort((x, y) => x.restCount - y.restCount);
        const need = excess - MAX_TOLERATED_EXCESS;
        const toConvert = eligiblePool.slice(0, need);
        const convertedIds = new Set(toConvert.map(x => x.dr.id));
        toConvert.forEach(x => {
          results[x.dr.id] = (results[x.dr.id] || []).concat([day]).sort((a, b) => a - b);
          corrections[x.dr.id + "_" + day] = true;
        });
        excess -= toConvert.length;
        if (excess <= 0) continue;

        const remaining = presentByLabel[excessLabel].filter(dr => !convertedIds.has(dr.id));
        const last = remaining.slice().sort((a, b) => String(a.matricule).localeCompare(String(b.matricule))).slice(-excess);
        last.forEach(dr => { flags[dr.id + "_" + day] = true; });
      }
    }

    this._teamCache[key] = results;
    this._extraCache[key] = { corrections: corrections, flags: flags };
    return results;
  },

  // Popule this._extraCache[key] (appelé depuis getTeamRestDays) — utilisé par
  // PlanningEngine pour savoir si le statut REPOS d'un conducteur, un jour
  // donné, vient d'un repos ponctuel d'équilibrage V1/V2 (à exclure du
  // contrôle de quota mensuel), et si sa présence ce jour-là doit être
  // signalée (excédent toléré d'UN conducteur, décision humaine).
  isVacationBalanceCorrection(driver, month, year, state, teams, day) {
    const team = teams.find(t => t.id === driver.teamId);
    this.getTeamRestDays(team, month, year, state);
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    const extra = this._extraCache[key];
    return !!(extra && extra.corrections[driver.id + "_" + day]);
  },

  hasVacationBalanceAlert(driver, month, year, state, teams, day) {
    const team = teams.find(t => t.id === driver.teamId);
    this.getTeamRestDays(team, month, year, state);
    const key = (team ? team.id : "none") + "_" + year + "_" + month;
    const extra = this._extraCache[key];
    return !!(extra && extra.flags[driver.id + "_" + day]);
  },

  getRestDaysForMonth(driver, month, year, state, teams) {
    const key = driver.id + "_" + year + "_" + month;
    if (this._cache[key]) return this._cache[key];

    const team = teams.find(t => t.id === driver.teamId);
    const teamResults = this.getTeamRestDays(team, month, year, state);
    const result = teamResults[driver.id] || [];
    this._cache[key] = result;
    return result;
  }
};
