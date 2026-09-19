// ==========================================
// RTG DRIVER PLANNER — Configuration métier (RTG_CONFIG)
// Règles de planification (shifts/vacations/zones/jours fériés/pondérations) :
// statique, ne change presque jamais, donc volontairement pas migrée dans
// Supabase (voir supabase/schema.sql) pour rester disponible sans requête
// réseau. Conducteurs, équipes, congés, utilisateurs, etc. vivent désormais
// dans Supabase (store.js) — l'ancien roster/seed localStorage a été retiré
// de ce fichier une fois la migration validée.
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
  // Pour chaque tranche de 5 jours de CONGÉ dans le mois, le quota de repos du
  // conducteur ce mois-là est réduit d'un jour (plancher 0).
  reposReductionParJoursCongé: 5,
  // Poids de préférence pour le placement des repos, par jour de la semaine
  // (indices Lundi=0 ... Dimanche=6) : plus le poids est élevé, plus le jour est
  // privilégié pour y placer un repos (car charge de travail plus faible).
  // Règle "Lundi/Mardi = charge faible" annulée sur demande explicite : ces deux
  // jours ont maintenant la même charge que Mercredi-Vendredi. Seules exceptions
  // conservées : Samedi (si Shift 2 cette semaine-là, via
  // restDayWeightSaturdayShift2 ci-dessous) et Dimanche, charge la plus faible.
  restDayWeightByDow: [1, 1, 1, 1, 1, 2, 4],
  // Le samedi, si l'équipe est sur le SHIFT 2 cette semaine-là, la charge est
  // plus faible que d'habitude : ce poids remplace celui de restDayWeightByDow[5].
  restDayWeightSaturdayShift2: 4,
  // Charge de travail par shift (§ note métier, mise à jour exploitant) :
  // Shift 1 = 30% (13%+17%), Shift 2 = 40% (20%+20%), Shift 3 = 30% (18%+12%).
  // Le nombre de repos DÛS à un conducteur pour les jours candidats de ce
  // shift ce mois-ci est inversement proportionnel à cette charge (formule :
  // référence = charge du Shift 1, poids = référence / charge du shift) :
  // plus la charge du shift est faible, plus il reçoit une part de repos
  // élevée (donc moins de conducteurs présents), et inversement pour un
  // shift à forte charge.
  restDayWeightByShift: { S1: 1, S2: 0.75, S3: 1 },
  // Charge de travail par VACATION à l'intérieur de chaque shift (§ note
  // métier, mise à jour exploitant, sur 100) : Shift 1 = 13% (V1) / 17% (V2),
  // Shift 2 = 20% / 20% (moitié chacune des 40% du shift), Shift 3 = 18% (V1)
  // / 12% (V2). NE définit PAS l'appartenance à un bloc (driver.
  // initialVacation reste fixe, un bloc ne se sépare jamais — §9-10) : sert
  // uniquement à biaiser, à l'intérieur d'un shift, le placement des repos
  // selon le LABEL de vacation qu'affiche CE JOUR-LÀ le bloc de chaque
  // conducteur (qui bascule quotidiennement — VacationRotationEngine). Plus
  // la charge d'une vacation est faible, plus les jours où le bloc du
  // conducteur affiche cette vacation sont privilégiés pour y placer un
  // repos — ce qui fait mécaniquement pencher la présence quotidienne vers
  // la vacation à charge plus élevée (ex. Shift 3 : plus de présents en V1
  // qu'en V2, conformément à 18% contre 12%).
  restDayLabelBiasByShift: {
    S1: { V1: 13, V2: 17 },
    S2: { V1: 20, V2: 20 },
    S3: { V1: 18, V2: 12 }
  },
  // Le dimanche (shifts 1/2, le shift 3 est déjà OFF) n'a plus de nombre de
  // repos FIGÉ (l'ancienne règle forçait exactement ce nombre de présents,
  // quel que soit le quota restant — retirée sur demande explicite de
  // l'exploitant, § restDayEngine.js). Ne sert plus qu'à calculer un plafond
  // journalier assoupli pour le dimanche (bloc de vacation moins ce nombre) :
  // le nombre réel de repos dépend uniquement du quota mensuel restant,
  // jamais imposé.
  sundayVacationCap: 6,
  // Nombre MINIMUM de repos garanti le samedi / le dimanche, par bloc de
  // vacation, quand le quota restant et les contraintes (adjacence, congés)
  // le permettent — demande explicite de l'exploitant, ces deux jours étant
  // les plus propices au repos (charge de travail la plus faible). Un
  // plancher, jamais un nombre imposé : le placement peut dépasser ce
  // minimum (poids restDayWeightByDow) ou, en cas de contrainte réelle
  // (adjacence, peu de quota restant en fin de mois), rester en dessous.
  restDayMinSaturday: 4,
  restDayMinSunday: 5,
  // Fourchette de présents ATTENDUE sur le Shift 3, par bloc de vacation
  // (demande explicite de l'exploitant, valeurs observées sur un bloc de 12
  // conducteurs) : le nombre de repos ce jour-là est contraint pour que le
  // nombre de présents reste dans cette fourchette (min/max), jamais un
  // chiffre imposé au-delà de ce que le quota restant/l'adjacence permet.
  // V1 est plus sollicité que V2 sur le Shift 3 (restDayLabelBiasByShift.S3 :
  // 18% contre 12%), d'où une fourchette de présents plus haute pour V1.
  restDayShift3Present: {
    V1: { min: 8, max: 9 },
    V2: { min: 5, max: 7 }
  },
  offShift3Dimanche: true,
  exceptionDimancheLundi: true,
  shiftRotationCycleDefault: ["S1", "S3", "S2"],
  // Lundi de la semaine de référence utilisée pour caler la rotation des shifts
  // (semaine contenant le 01/08/2026, telle qu'observée sur les plannings fournis).
  referenceWeekStart: "2026-07-27",
  // Date à partir de laquelle les rotations de zone/vacation sont calculées ;
  // driver.initialZone / driver.initialVacation s'appliquent exactement à cette date.
  rotationReferenceDate: "2026-08-01",
  // Mois de DÉPART des repos mensuels — demande explicite de l'exploitant :
  // les contraintes calculées sur septembre 2026 (mois avant ce point de
  // départ, notamment le repos du dernier jour du mois qui bloquait par
  // adjacence le 1er jour du mois suivant) ne doivent plus influencer
  // octobre 2026 ni les mois suivants. Le moteur des repos (restDayEngine)
  // ne regarde jamais en arrière avant cette date — octobre 2026 démarre
  // donc sans aucune restriction héritée. Séparé de rotationReferenceDate
  // (zone/vacation, ne doit pas changer) car ce n'est qu'une demande sur les
  // REPOS.
  reposReferenceDate: "2026-10-01",
  // Jours fériés marocains — affichage uniquement (aucun impact sur les repos ou
  // les affectations). Les dates religieuses (Aïd, Moharram, Mawlid) sont
  // approximatives : elles dépendent de l'observation du croissant lunaire et
  // peuvent être confirmées/décalées d'un jour par les autorités marocaines.
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

