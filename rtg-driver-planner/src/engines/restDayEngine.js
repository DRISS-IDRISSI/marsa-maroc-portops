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
// jour-là. Ce plafond est calculé ET suivi PAR BLOC de vacation (driver.
// initialVacation) : les deux blocs d'une équipe sont planifiés de façon
// complètement INDÉPENDANTE l'un de l'autre (jamais de ressource partagée
// entre eux) — confirmé en comparant un modèle Excel fourni par l'exploitant
// où les deux blocs sont des copies exactes l'un de l'autre, jour pour jour.
//
// Le CHOIX des jours (une fois le nombre de repos dû à chaque conducteur
// déterminé par occurrence de shift, cf. répartition par shift/label
// ci-dessous) se fait par un choix GLOUTON "MOINS SERVI D'ABORD" : pour
// chaque jour d'une occurrence (dans l'ordre chronologique), le nombre de
// repos dû ce jour-là (proportionnel à son poids — charge du shift, biais
// V1/V2, ET préférence jour de semaine restDayWeightByDow/
// restDayWeightSaturdayShift2, ex. samedi/dimanche à charge plus faible) est
// attribué aux conducteurs du bloc qui ont encore besoin de repos, en
// priorisant celui qui a le MOINS de repos déjà placés ce mois-ci (égalité
// départagée par rang fixe dans l'équipe). Confirmé par correspondance EXACTE
// avec le modèle Excel fourni par l'exploitant sur la sélection des dimanches
// à plafond renforcé. La préférence jour de semaine influence ainsi seulement
// COMBIEN de repos un jour reçoit, jamais QUI l'obtient précisément — c'est ce
// qui permet de la réutiliser sans fragmenter l'escalier comme l'ancien
// système (qui s'en servait pour fixer une POSITION par conducteur).
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

    // Trié par ordreAffichage (même tri que la grille Planning Mensuel,
    // pages.js) — SANS ce tri, la rotation continue de Phase B (qui avance
    // dans l'ordre de `teamDrivers`, ici l'ordre matricule de Supabase) ne
    // correspond pas à l'ordre des LIGNES affichées à l'écran (ordreAffichage,
    // rempli par l'import Excel) : une rotation parfaitement contiguë en
    // interne apparaît alors dispersée sur des lignes non consécutives dans
    // le tableau — signalé par l'exploitant (repos censés être groupés sur
    // des conducteurs consécutifs, ex. OUDRAOUA/MAAQUOUL/CHARIH/AYAR le même
    // jour, mais rendus sur des lignes éparpillées).
    const teamDrivers = state.drivers
      .filter(dr => dr.teamId === (team ? team.id : null) && dr.actif !== false)
      .slice()
      .sort((a, b) => {
        const oa = a.ordreAffichage, ob = b.ordreAffichage;
        if (oa == null && ob == null) return 0;
        if (oa == null) return 1;
        if (ob == null) return -1;
        return oa - ob;
      });
    const N = teamDrivers.length || 1;
    const dim = RTGDate.daysInMonth(month, year);
    const results = {};

    // Taille de chaque bloc de vacation FIXE de l'équipe (driver.initialVacation —
    // ne bouge jamais, cf. en-tête du fichier). Le modèle de référence fourni par
    // l'exploitant (deux blocs de 12) montre que chaque bloc doit produire son
    // PROPRE escalier de façon complètement INDÉPENDANTE de l'autre : dans ce
    // modèle, les deux blocs sont des copies exactes l'un de l'autre, jour pour
    // jour, preuve qu'ils ne se disputent PAS une même ressource commune. Le
    // plafond de conducteurs en repos le même jour est donc calculé ET SUIVI
    // PAR BLOC (jamais partagé entre V1 et V2, ni fusionné dans un compteur
    // d'équipe) : un plafond partagé faisait échouer artificiellement le second
    // bloc traité sur des jours déjà à moitié remplis par le premier, sans
    // réelle raison de capacité — repos renvoyés en repli (Phase C) ailleurs
    // dans le mois alors que ce bloc, livré à lui-même, aurait très bien pu
    // placer ce repos ce jour-là.
    const groupSizes = { V1: 0, V2: 0 };
    teamDrivers.forEach(dr => {
      if (dr.initialVacation === "V1" || dr.initialVacation === "V2") groupSizes[dr.initialVacation]++;
    });
    const maxPerDayByGroup = {
      V1: Math.max(2, Math.ceil(groupSizes.V1 * 0.3)),
      V2: Math.max(2, Math.ceil(groupSizes.V2 * 0.3))
    };
    const capForGroup = group => (maxPerDayByGroup[group] !== undefined ? maxPerDayByGroup[group] : Math.max(2, Math.ceil(N * 0.3)));
    const dayUsage = { V1: {}, V2: {} }; // { [group]: { [day]: n } } — jamais partagé entre V1 et V2
    const usageAt = (group, day) => (dayUsage[group] && dayUsage[group][day]) || 0;
    const bumpUsage = (group, day) => {
      if (!dayUsage[group]) return;
      dayUsage[group][day] = (dayUsage[group][day] || 0) + 1;
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
      const group = driver.initialVacation;
      const fixedDays = new Set([...(mandatorySundayOff[driver.id] || []), ...manualRestByDriver[driver.id]]);
      fixedDays.forEach(d => { bumpUsage(group, d); });
    });

    // Repos du DERNIER jour du mois précédent, par conducteur : deux mois sont
    // calculés indépendamment l'un de l'autre, donc sans cette vérification un
    // repos pourrait être choisi le 1er jour de CE mois alors que le conducteur
    // était déjà en repos la veille (dernier jour du mois précédent) — deux
    // repos consécutifs à cheval sur la frontière des mois. Ne regarde qu'en
    // arrière (jamais le mois suivant) pour ne jamais créer de dépendance
    // circulaire entre deux mois calculés l'un après l'autre.
    //
    // config.reposReferenceDate (mois de DÉPART des repos, distinct de
    // rotationReferenceDate qui reste dédié au zone/vacation) : aucun mois
    // AVANT cette date n'est jamais regardé en arrière — demande explicite de
    // l'exploitant après avoir constaté que des contraintes calculées sur un
    // mois antérieur (dont il ne veut plus tenir compte) bloquaient par
    // adjacence certains repos du mois de départ.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMonthLastDay = RTGDate.daysInMonth(prevMonth, prevYear);
    const prevMonthRestByDriver = {};
    if (team) {
      const refDate = RTGDate.parseISO(state.config.reposReferenceDate || state.config.rotationReferenceDate);
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
    // Regroupe les jours consécutifs sous le même shift (rotation hebdomadaire
    // de l'équipe) en occurrences SÉPARÉES — ex. "Shift 1" du 1 au 4 PUIS à
    // nouveau "Shift 1" du 19 au 25 sont deux occurrences distinctes. Sert à
    // répartir le quota de chaque conducteur PAR OCCURRENCE (Phase A) plutôt
    // que sur tout le mois d'un coup : répartir sur tout le mois (essayé
    // précédemment) donnait une part quotidienne trop fine (~2/jour en
    // moyenne sur ~29 jours) — l'exploitant attend des groupes plus fournis
    // (3-4) concentrés sur les jours d'une même période de shift, pas dilués
    // sur tout le mois.
    const shiftRuns = [];
    if (team) {
      for (let d = 1; d <= dim; d++) {
        const last = shiftRuns[shiftRuns.length - 1];
        if (last && last.shift === dayShift[d]) last.days.push(d);
        else shiftRuns.push({ shift: dayShift[d], days: [d] });
      }
    }
    const shiftWeights = state.config.restDayWeightByShift || { S1: 1, S2: 1, S3: 1 };
    const labelBiasByShift = state.config.restDayLabelBiasByShift || {};

    // Répartit `total` entre des groupes de jours (occurrences de shift),
    // proportionnellement à leur nombre de jours ET à un poids relatif — mais
    // JAMAIS en laissant un groupe totalement vide tant que `total` permet
    // d'en donner au moins un partout : chaque groupe reçoit d'abord
    // floor(total / nombre de groupes) (borné par sa capacité), le reste
    // étant ensuite départagé par poids (plus grand reste). Sans cette base
    // garantie, une petite occurrence peut arrondir à zéro pour certains
    // conducteurs et à deux pour d'autres, cassant l'escalier d'un bloc à
    // l'autre.
    const distributeByWeight = (total, groups) => {
      const shares = {};
      let totalWeighted = 0;
      groups.forEach(g => { g.weighted = g.days.length * (g.weight || 0); totalWeighted += g.weighted; });
      if (totalWeighted <= 0) {
        groups.forEach(g => { shares[g.key] = 0; });
        return shares;
      }
      const base = Math.floor(total / groups.length);
      let allocated = 0;
      const remainders = [];
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

    // Répartit `total` entre des JOURS individuels (pas des groupes de jours),
    // par poids (méthode du plus grand reste), SANS plafond artificiel par
    // jour — un jour peut recevoir plusieurs unités. Sert à répartir la
    // demande totale d'une occurrence de shift sur ses propres jours,
    // biaisée par le label V1/V2 que le bloc affiche ce jour-là
    // (restDayLabelBiasByShift) : trouvé en comparant précisément au modèle
    // Excel fourni par l'exploitant — le jour où le bloc affiche le label à
    // charge plus faible reçoit mécaniquement plus de repos que le jour où
    // il affiche l'autre label, ce qui explique l'asymétrie observée entre
    // jours consécutifs d'une même occurrence (jamais un simple partage à
    // parts égales).
    const splitDemandAcrossDays = (total, days, weightForDay) => {
      const weights = days.map(weightForDay);
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      const shares = {};
      if (totalWeight <= 0 || total <= 0) {
        days.forEach(d => { shares[d] = 0; });
        return shares;
      }
      const base = Math.floor(total / days.length);
      let allocated = 0;
      const remainders = [];
      days.forEach((d, i) => {
        shares[d] = base;
        allocated += base;
        const raw = total * weights[i] / totalWeight;
        remainders.push({ day: d, rem: raw - base });
      });
      let leftover = total - allocated;
      remainders.sort((a, b) => b.rem - a.rem);
      let idx = 0;
      while (leftover > 0 && remainders.length > 0) {
        shares[remainders[idx % remainders.length].day]++;
        leftover--;
        idx++;
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

      const remainingQuota = Math.max(0, Math.min(quota, candidates.length) - chosen.length);

      // Répartit remainingQuota entre les OCCURRENCES de shift (jamais deux
      // occurrences non consécutives fusionnées, cf. shiftRuns plus haut),
      // proportionnellement au nombre de jours candidats de chaque occurrence
      // ET à la charge de travail relative du shift (restDayWeightByShift).
      const needsByBucket = {};
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

      driverState[driver.id] = { driver: driver, chosen: chosen, used: used, remainingQuota: remainingQuota, needsByBucket: needsByBucket, candidateSet: new Set(candidates) };
    });

    if (!team) {
      // Cas isolé (sans contexte d'équipe) : jamais emprunté en pratique —
      // PlanningEngine résout toujours l'équipe avant d'appeler ce moteur
      // (getDailyStatus retourne "ABSENCE" en amont si le conducteur n'a pas
      // d'équipe). Repli simple : espacement de base et non-adjacence.
      teamDrivers.forEach(driver => {
        const st = driverState[driver.id];
        let need = st.remainingQuota;
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
      // Phase B : attribution des jours en ESCALIER, bloc de vacation par
      // bloc de vacation (driver.initialVacation — §9-10, jamais séparé), par
      // ROTATION CONTINUE — instruction ferme de l'exploitant : les repos
      // d'un même jour J sont donnés à des conducteurs CONSÉCUTIFS dans
      // l'ordre de l'équipe ; une fois le quota du jour J épuisé, le jour J+1
      // reprend juste APRÈS le dernier conducteur servi le jour J — jamais un
      // retour en arrière dans l'ordre, jamais de saut arbitraire. Un seul
      // pointeur PAR BLOC, qui ne se réinitialise JAMAIS (ni entre jours, ni
      // entre occurrences de shift — il n'y a d'ailleurs plus de découpage
      // par occurrence ici, cf. dayWeightForBlock plus bas qui absorbe
      // directement la charge du shift dans le poids du jour). Remplace
      // l'ancien choix glouton "moins servi d'abord" (qui donnait un résultat
      // proche la plupart du temps mais pouvait, par tri, servir un
      // conducteur hors ordre si son compteur de repos était légèrement plus
      // bas) : ici l'ORDRE DE L'ÉQUIPE prime toujours, sans exception.
      // ------------------------------------------------------------------
      const blockDrivers = { V1: [], V2: [] };
      teamDrivers.forEach(driver => {
        if (driver.initialVacation === "V1" || driver.initialVacation === "V2") {
          blockDrivers[driver.initialVacation].push(driver);
        }
      });

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

      // Poids d'UN JOUR pour UN bloc donné : biaisé par restDayLabelBiasByShift
      // selon le label (V1/V2) que CE bloc affiche ce jour-là (1 par défaut,
      // sans biais). Utilisé pour répartir la demande d'une occurrence sur ses
      // propres jours (splitDemandAcrossDays) — trouvé en comparant précisément
      // au modèle Excel fourni : le jour où le bloc affiche le label à charge
      // plus faible reçoit mécaniquement plus de repos que l'autre. Combiné à
      // la préférence jour de semaine (restDayWeightByDow — samedi/dimanche à
      // charge plus faible) : celle-ci n'influence plus qu'une PART relative
      // du nombre de repos par jour au sein d'une occurrence (jamais QUI
      // l'obtient, cf. plus bas), donc ne peut plus fragmenter l'escalier
      // comme lorsqu'elle décidait directement une position par conducteur —
      // demande explicite de l'exploitant après un cas observé (samedi à
      // zéro repos alors qu'il est à charge plus faible).
      const dowWeightFor = day => {
        const dow = RTGDate.dowMon0(RTGDate.makeDate(year, month, day));
        if (dow === 5 && dayShift[day] === "S2" && state.config.restDayWeightSaturdayShift2) {
          return state.config.restDayWeightSaturdayShift2;
        }
        const arr = state.config.restDayWeightByDow;
        return (arr && arr[dow]) || 1;
      };
      // Poids d'un jour pour un bloc donné : préférence jour de semaine
      // (dow/samedi-shift2) ET biais V1/V2 du label affiché par ce bloc ce
      // jour-là — combinés, utilisés pour répartir la demande d'UNE
      // OCCURRENCE sur ses propres jours (la charge du SHIFT, elle, est déjà
      // prise en compte au niveau de l'occurrence entière, cf. needsByBucket
      // en Phase A — la répéter ici par jour n'aurait aucun effet, tous les
      // jours d'une même occurrence partageant le même shift). Détermine
      // uniquement COMBIEN de repos un jour reçoit, jamais QUI les obtient
      // (cf. rotation continue plus bas, qui seule décide de l'ordre).
      const dayWeightForBlock = (block, day) => {
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
        // Rotation CONTINUE (cf. en-tête de Phase B) : UN SEUL pointeur pour
        // tout le bloc, déclaré ICI (hors de la boucle sur les occurrences)
        // pour ne JAMAIS se réinitialiser d'une occurrence à l'autre — sans
        // quoi le premier conducteur de chaque nouvelle occurrence serait
        // systématiquement le même (toujours le conducteur de rang 0), au
        // lieu de continuer juste après le dernier conducteur servi.
        let pointer = 0;

        shiftRuns.forEach((run, idx) => {
          const bucketKey = "occ" + idx;
          const needing = blockList.filter(dr => (driverState[dr.id].needsByBucket[bucketKey] || 0) > 0);
          if (needing.length === 0) return;
          const totalDemand = needing.reduce((sum, dr) => sum + driverState[dr.id].needsByBucket[bucketKey], 0);
          // Exclut d'emblée les jours déjà saturés pour ce bloc (ex. le repos
          // obligatoire du dimanche, déjà enregistré dans dayUsage avant
          // Phase B) du calcul de répartition — sans ça, ce jour recevait
          // quand même une part théorique qui, une fois neutralisée par le
          // plafond, se perdait purement et simplement (au lieu d'être
          // redirigée vers les autres jours de l'occurrence), forçant le
          // reliquat à partir en rattrapage sur un jour quelconque et à
          // casser l'ordre de la rotation continue.
          const openDays = run.days.filter(d => usageAt(block, d) < capForGroup(block));
          const dayShares = splitDemandAcrossDays(totalDemand, openDays.length > 0 ? openDays : run.days, d => dayWeightForBlock(block, d));

          run.days.forEach(day => {
            let capLeft = Math.min(dayShares[day] || 0, Math.max(0, capForGroup(block) - usageAt(block, day)));
            let tries = 0;
            while (capLeft > 0 && tries < blockList.length) {
              const dr = blockList[pointer];
              pointer = (pointer + 1) % blockList.length;
              tries++;
              const st = driverState[dr.id];
              if ((st.needsByBucket[bucketKey] || 0) <= 0 || !st.candidateSet.has(day) || st.used.has(day)
                  || st.used.has(day - 1) || st.used.has(day + 1)) continue;
              st.chosen.push(day);
              st.used.add(day);
              bumpUsage(block, day);
              st.needsByBucket[bucketKey]--;
              st.remainingQuota--;
              capLeft--;
            }
          });

          // Rattrapage LOCAL (même occurrence) : la demande du jour
          // (dayShares) peut, dans de rares cas, ne pas trouver assez de
          // conducteurs éligibles ce jour précis (adjacence) alors qu'un
          // autre jour de LA MÊME occurrence a encore de la marge — replacé
          // ici plutôt que de partir directement en Phase C (recherche sur
          // tout le mois), pour rester le plus proche possible dans le temps.
          // Choisit le jour ÉLIGIBLE le MOINS CHARGÉ (pas le premier trouvé) :
          // sans ça, plusieurs replis consécutifs s'entassaient sur le même
          // jour "de secours" pendant qu'un autre restait sous-utilisé,
          // cassant l'escalier régulier attendu (repos qui progressent
          // 1, 2, 3... plutôt qu'un pic isolé sur un seul jour).
          needing.forEach(dr => {
            const st = driverState[dr.id];
            while ((st.needsByBucket[bucketKey] || 0) > 0) {
              const eligibleDays = run.days.filter(d => st.candidateSet.has(d) && !st.used.has(d) && !st.used.has(d - 1) && !st.used.has(d + 1) && usageAt(block, d) < capForGroup(block));
              if (eligibleDays.length === 0) break;
              const day = eligibleDays.reduce((best, d) => usageAt(block, d) < usageAt(block, best) ? d : best);
              st.chosen.push(day);
              st.used.add(day);
              bumpUsage(block, day);
              st.needsByBucket[bucketKey]--;
              st.remainingQuota--;
            }
          });
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
        let need = st.remainingQuota;
        if (need <= 0) return;
        const candidates = this.getCandidatesForDriver(driver, month, year, state, team).filter(d => !st.used.has(d));
        const group = driver.initialVacation;
        const place = day => {
          st.chosen.push(day); st.used.add(day);
          bumpUsage(group, day);
          need--;
        };
        for (const day of candidates) {
          if (need <= 0) break;
          if (st.used.has(day - 1) || st.used.has(day + 1)) continue;
          if (usageAt(group, day) >= capForGroup(group)) continue;
          place(day);
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if (st.used.has(day - 1) || st.used.has(day + 1)) continue;
            if (usageAt(group, day) >= capForGroup(group)) continue;
            place(day);
          }
        }
        if (need > 0) {
          for (const day of candidates) {
            if (need <= 0) break;
            if (st.used.has(day)) continue;
            if (usageAt(group, day) >= capForGroup(group)) continue;
            place(day);
          }
        }
      });
    }

    teamDrivers.forEach(driver => {
      results[driver.id] = driverState[driver.id].chosen.sort((a, b) => a - b);
    });

    // Les deux anciennes post-passes de rééquilibrage automatique V1/V2
    // (échange de repos déjà attribués, puis ajout d'un repos bonus en
    // dernier recours) ont été retirées — instruction ferme de l'exploitant :
    // l'ordre/escalier de la rotation continue (Phase B) prime toujours sur
    // l'équilibrage automatique de la présence V1/V2. Ces passes ne
    // touchaient que Shift 1/Shift 3 (jamais Shift 2), ce qui cassait
    // sélectivement la continuité sur ces shifts alors que Shift 2 restait
    // ordonné — signalé par l'exploitant sur GR AZZAM/Octobre. L'équilibrage
    // V1/V2, si besoin, se fait désormais manuellement (case par case),
    // comme dans le modèle de référence fourni par l'exploitant (quota
    // individuel ajusté à 6 ou 7 selon les cas, jamais un forçage quotidien
    // automatique).
    const corrections = {}; // { "<driverId>_<day>": true } — toujours vide désormais
    const flags = {}; // { "<driverId>_<day>": true } — toujours vide désormais

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
