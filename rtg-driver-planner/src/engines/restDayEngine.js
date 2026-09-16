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
// jour-là. Le placement privilégie quand même les jours à faible charge de
// travail (lundi/mardi, dimanche, samedi si shift 2 cette semaine-là) et évite
// le pic mercredi-vendredi, via config.restDayWeightByDow, tant que le plafond
// n'est pas atteint.
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
// travail relative (config.restDayWeightByShift — Shift 3 = 20% de charge donc
// plus de repos que Shift 1 = 30% ou Shift 2 = 50%). Le placement fin à
// l'intérieur de chaque shift utilise ensuite le même algorithme d'espacement
// pondéré par jour de semaine qu'avant (restDayWeightByDow).
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

  getDayWeight(date, team, state) {
    const dow = RTGDate.dowMon0(date); // 0=Lundi ... 6=Dimanche
    const weights = state.config.restDayWeightByDow || [1, 1, 1, 1, 1, 1, 1];
    const shift = team ? ShiftRotationEngine.getTeamShiftForDate(team, date, state.config) : null;
    const shiftWeights = state.config.restDayWeightByShift || { S1: 1, S2: 1, S3: 1 };
    const shiftFactor = (shift && shiftWeights[shift]) || 1;

    if (dow === 5 && shift === "S2") {
      return (state.config.restDayWeightSaturdayShift2 || weights[5]) * shiftFactor;
    }
    return (weights[dow] || 1) * shiftFactor;
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
      if (HolidayEngine.getHoliday(iso, state.config)) continue;
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
      if (HolidayEngine.getHoliday(iso, state.config)) continue;
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

    teamDrivers.forEach((driver, idxInTeam) => {
      const candidates = this.getCandidatesForDriver(driver, month, year, state, team);
      const congeDays = this.countCongeDaysInMonth(driver, month, year, state);
      const reduction = Math.floor(congeDays / (state.config.reposReductionParJoursCongé || 5));
      const quota = Math.max(0, state.config.reposMensuel - reduction);

      const fixedDays = new Set([...(mandatorySundayOff[driver.id] || []), ...manualRestByDriver[driver.id]]);
      const chosen = [];
      const used = new Set();
      fixedDays.forEach(d => {
        chosen.push(d);
        used.add(d);
      });
      // Jour 0 virtuel : bloque le jour 1 par adjacence si le conducteur était
      // déjà en repos le dernier jour du mois précédent.
      if (prevMonthRestByDriver[driver.id]) used.add(0);

      const target = Math.max(0, Math.min(quota, candidates.length) - chosen.length);

      if (target <= 0) { results[driver.id] = chosen.sort((a, b) => a - b); return; }

      const group = driver.initialVacation;
      // Plafond quotidien de repos pour LE BLOC de ce conducteur, recalculé jour
      // par jour : quand une charge par label est définie pour le shift de ce
      // jour (restDayLabelBiasByShift), le plafond suit CETTE proportion (même
      // poids que le sous-partage ci-dessous : la vacation à charge plus faible
      // reçoit un plafond plus haut, donc plus de repos ce jour-là) — sinon, on
      // retombe sur le plafond proportionnel à la taille du bloc (comportement
      // précédent, qui empêche déjà un bloc de vider l'autre un jour donné).
      const groupCapForDay = day => {
        const shift = dayShift[day];
        const ratio = shift && labelBiasByShift[shift];
        if (ratio && ratio.V1 > 0 && ratio.V2 > 0) {
          const label = VacationRotationEngine.getVacationForDate(driver, RTGDate.makeDate(year, month, day), state);
          if (label === "V1" || label === "V2") {
            const w = { V1: 1 / Math.pow(ratio.V1, LABEL_BIAS_EXPONENT), V2: 1 / Math.pow(ratio.V2, LABEL_BIAS_EXPONENT) };
            const share = w[label] / (w.V1 + w.V2);
            return Math.max(1, Math.ceil(maxPerDay * share));
          }
        }
        return maxPerDayGroup[group] !== undefined ? maxPerDayGroup[group] : maxPerDay;
      };
      const underGroupCap = day => groupUsageAt(day, group) < groupCapForDay(day);
      // Un jour candidat est adjacent (veille/lendemain civil) à un repos déjà
      // retenu pour CE conducteur : à éviter en priorité pour ne jamais produire
      // deux repos consécutifs.
      const isAdjacentToUsed = day => used.has(day - 1) || used.has(day + 1);

      // Place jusqu'à `bucketTarget` repos parmi `bucketCandidates` (sous-ensemble
      // des jours candidats, ex. tous ceux d'un même shift), avec le même
      // algorithme d'espacement + fenêtre pondérée qu'avant — mais borné à ce
      // sous-ensemble, en partageant used/dayUsage/groupDayUsage/chosen avec les
      // autres buckets du même conducteur (adjacence et plafonds valables sur tout
      // le mois, pas seulement à l'intérieur d'un bucket).
      //
      // Si `allowAdjacencyRelax` est faux (répartition PAR SHIFT), on ne force
      // jamais deux repos consécutifs pour rester dans un bucket trop petit/serré :
      // on s'arrête dès qu'aucun jour ne respecte au moins la non-adjacence et le
      // plafond d'équipe, et on rend le nombre réellement placé — l'appelant
      // reporte le reliquat sur un autre bucket (ou sur l'ensemble du mois en tout
      // dernier recours, où la marge de manœuvre est bien plus grande). Si vrai
      // (dernier recours sur tout le mois, comme avant ce correctif), la relaxation
      // de l'adjacence reste le tout dernier repli, inchangée.
      const assignWithinBucket = (bucketCandidates, bucketTarget, allowAdjacencyRelax) => {
        if (bucketTarget <= 0 || bucketCandidates.length === 0) return 0;
        const spacing = bucketCandidates.length / bucketTarget;
        const offset = Math.floor((idxInTeam / N) * bucketCandidates.length);
        const windowRadius = Math.max(1, Math.floor(spacing / 2));
        let placed = 0;

        for (let k = 0; k < bucketTarget; k++) {
          const basePos = Math.round(k * spacing);
          let best = null;
          for (let j = 0; j <= windowRadius; j++) {
            const deltas = j === 0 ? [0] : [-j, j];
            for (const dj of deltas) {
              const pos = ((offset + basePos + dj) % bucketCandidates.length + bucketCandidates.length) % bucketCandidates.length;
              const day = bucketCandidates[pos];
              if (used.has(day)) continue;
              if (isAdjacentToUsed(day)) continue;
              if ((dayUsage[day] || 0) >= maxPerDay) continue;
              if (!underGroupCap(day)) continue;
              const weight = this.getDayWeight(RTGDate.makeDate(year, month, day), team, state);
              if (!best || weight > best.weight || (weight === best.weight && Math.abs(dj) < best.dist)) {
                best = { day: day, weight: weight, dist: Math.abs(dj) };
              }
            }
          }
          if (!best) {
            // Repli niveau 1 : rien de disponible dans la fenêtre (plafond atteint
            // partout autour) — recherche linéaire du premier jour candidat encore
            // sous le plafond (équipe et bloc), non adjacent à un repos déjà choisi.
            let pos = (offset + basePos) % bucketCandidates.length;
            let tries = 0;
            let found = null;
            while (tries < bucketCandidates.length) {
              const day = bucketCandidates[pos];
              if (!used.has(day) && !isAdjacentToUsed(day) && (dayUsage[day] || 0) < maxPerDay && underGroupCap(day)) { found = day; break; }
              pos = (pos + 1) % bucketCandidates.length;
              tries++;
            }
            if (found === null) {
              // Repli niveau 2 : on relâche uniquement le plafond du BLOC (le plafond
              // partagé de l'équipe et la non-adjacence restent respectés) — préférable
              // à casser l'équilibre entre blocs plutôt qu'à produire deux repos
              // consécutifs ou dépasser le plafond d'équipe.
              pos = (offset + basePos) % bucketCandidates.length;
              tries = 0;
              while (tries < bucketCandidates.length) {
                const day = bucketCandidates[pos];
                if (!used.has(day) && !isAdjacentToUsed(day) && (dayUsage[day] || 0) < maxPerDay) { found = day; break; }
                pos = (pos + 1) % bucketCandidates.length;
                tries++;
              }
            }
            if (found === null && !allowAdjacencyRelax) {
              // Ce bucket est épuisé sans casser la non-adjacence : on s'arrête ici,
              // le reliquat sera replacé ailleurs (autre bucket, puis en tout
              // dernier recours sur l'ensemble du mois).
              return placed;
            }
            if (found === null) {
              // Repli niveau 3 (dernier recours, mois entier uniquement) : aucun
              // jour non adjacent disponible — on relâche aussi la contrainte
              // d'adjacence ; le plafond partagé de l'équipe reste respecté.
              pos = (offset + basePos) % bucketCandidates.length;
              tries = 0;
              while (tries < bucketCandidates.length) {
                const day = bucketCandidates[pos];
                if (!used.has(day) && (dayUsage[day] || 0) < maxPerDay) { found = day; break; }
                pos = (pos + 1) % bucketCandidates.length;
                tries++;
              }
            }
            best = { day: found !== null ? found : bucketCandidates[pos] };
          }
          used.add(best.day);
          dayUsage[best.day] = (dayUsage[best.day] || 0) + 1;
          bumpGroupUsage(best.day, group);
          chosen.push(best.day);
          placed++;
        }
        return placed;
      };

      // Sous-répartit `bucketTarget` (déjà attribué à un shift) entre les jours où
      // le bloc de CE conducteur affiche ce jour-là le label V1 et ceux où il
      // affiche V2 (VacationRotationEngine — bascule quotidienne du bloc entier),
      // selon restDayLabelBiasByShift : la vacation à charge plus FAIBLE reçoit
      // davantage de repos (donc moins de présents), ce qui fait mécaniquement
      // pencher la présence quotidienne vers la vacation à charge plus élevée
      // (ex. Shift 3 : plus de présents en V1 qu'en V2, conforme à 12% / 8%).
      // N'affecte jamais l'appartenance au bloc, seulement le PLACEMENT des repos.
      const assignShiftBucket = (bucketDays, bucketTarget, shiftId) => {
        if (bucketTarget <= 0 || bucketDays.length === 0) return 0;
        const ratio = labelBiasByShift[shiftId];
        if (!ratio || !(ratio.V1 > 0) || !(ratio.V2 > 0)) {
          return assignWithinBucket(bucketDays, bucketTarget, false);
        }
        const labelDays = { V1: [], V2: [] };
        bucketDays.forEach(d => {
          const label = VacationRotationEngine.getVacationForDate(driver, RTGDate.makeDate(year, month, d), state);
          if (labelDays[label]) labelDays[label].push(d);
        });
        // Poids en 1/pct^LABEL_BIAS_EXPONENT (et non 1/pct) : les contraintes déjà en
        // jeu (espacement, plafond équipe, non-adjacence, arrondis par petits
        // buckets) atténuent fortement un simple ratio inverse — un exposant élevé
        // est nécessaire pour que l'écart de présence obtenu se rapproche de celui
        // attendu, surtout quand les deux vacations ont des charges proches (ex.
        // 13.5%/16.5%) : sans ça, la vacation à charge plus faible peut se retrouver
        // avec AUTANT ou PLUS de présents que l'autre certains jours, ce qui
        // contredit la règle métier.
        const subShares = distributeByWeight(bucketTarget, [
          { key: "V1", days: labelDays.V1, weight: 1 / Math.pow(ratio.V1, LABEL_BIAS_EXPONENT) },
          { key: "V2", days: labelDays.V2, weight: 1 / Math.pow(ratio.V2, LABEL_BIAS_EXPONENT) }
        ]);
        let placed = 0;
        ["V1", "V2"]
          .filter(l => labelDays[l].length > 0)
          .sort((a, b) => (labelDays[a][0] || 0) - (labelDays[b][0] || 0))
          .forEach(l => { placed += assignWithinBucket(labelDays[l], subShares[l], false); });
        return placed;
      };

      if (!team) {
        assignWithinBucket(candidates, target, true);
      } else {
        // Répartit `target` entre les jours candidats de Shift 1 / Shift 2 / Shift 3,
        // proportionnellement au nombre de jours candidats de chaque shift ET à sa
        // charge de travail relative (restDayWeightByShift) — plus la charge d'un
        // shift est faible, plus il reçoit une part de repos élevée. Méthode du plus
        // grand reste pour que les parts arrondies totalisent exactement `target`.
        const availableCandidates = candidates.filter(d => !used.has(d));
        const buckets = { S1: [], S2: [], S3: [] };
        availableCandidates.forEach(d => {
          const s = dayShift[d];
          if (buckets[s]) buckets[s].push(d);
        });

        const shiftIds = ["S1", "S2", "S3"];
        const shares = distributeByWeight(target, shiftIds.map(s => ({
          key: s, days: buckets[s], weight: shiftWeights[s] || 1
        })));

        // Traite les buckets dans l'ordre chronologique (premier jour candidat de
        // chaque bucket) pour un comportement prévisible d'un mois à l'autre ; en
        // mode strict (sans relâcher l'adjacence), un bucket trop serré peut placer
        // moins que sa part — le reliquat est cumulé pour un dernier passage.
        let shortfall = 0;
        shiftIds
          .filter(s => buckets[s].length > 0)
          .sort((a, b) => (buckets[a][0] || 0) - (buckets[b][0] || 0))
          .forEach(s => {
            const placed = assignShiftBucket(buckets[s], shares[s], s);
            shortfall += shares[s] - placed;
          });

        if (shortfall > 0) {
          // Dernier recours : replace le reliquat sur l'ensemble des jours candidats
          // encore libres ce mois-ci (tous shifts confondus), avec la marge de
          // manœuvre bien plus grande qu'à l'échelle d'un seul bucket — la
          // relaxation de l'adjacence n'y est donc quasiment jamais nécessaire.
          const remaining = candidates.filter(d => !used.has(d));
          assignWithinBucket(remaining, shortfall, true);
        }
      }

      results[driver.id] = chosen.sort((a, b) => a - b);
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
