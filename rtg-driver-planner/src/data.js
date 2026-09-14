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
  // Lundi/Mardi = charge faible en début de semaine, Mercredi-Vendredi = pic de
  // charge (à éviter pour les repos), Dimanche = charge la plus faible.
  restDayWeightByDow: [3, 3, 1, 1, 1, 2, 4],
  // Le samedi, si l'équipe est sur le SHIFT 2 cette semaine-là, la charge est
  // plus faible que d'habitude : ce poids remplace celui de restDayWeightByDow[5].
  restDayWeightSaturdayShift2: 4,
  // Charge de travail par shift (§ note métier) : Shift 1 = 30% (13.5%+16.5%),
  // Shift 2 = 50% (25%+25%), Shift 3 = 20% (12%+8%). Le poids de placement des
  // repos est inversement proportionnel à cette charge : plus la charge du
  // shift est faible, plus il est privilégié pour y placer des repos (donc
  // moins de conducteurs présents), et inversement pour un shift à forte
  // charge. Ce facteur se combine (multiplication) avec restDayWeightByDow.
  restDayWeightByShift: { S1: 1, S2: 0.6, S3: 1.5 },
  // Charge de travail par VACATION à l'intérieur de chaque shift (§ note métier,
  // sur 100) : Shift 1 = 13.5% (V1) / 16.5% (V2), Shift 2 = 25% / 25%, Shift 3 = 12%
  // (V1) / 8% (V2). NE définit PAS l'appartenance à un bloc (driver.initialVacation
  // reste fixe, un bloc ne se sépare jamais — §9-10) : sert uniquement à biaiser,
  // à l'intérieur d'un shift, le placement des repos selon le LABEL de vacation
  // qu'affiche CE JOUR-LÀ le bloc de chaque conducteur (qui bascule quotidiennement
  // — VacationRotationEngine). Plus la charge d'une vacation est faible, plus les
  // jours où le bloc du conducteur affiche cette vacation sont privilégiés pour y
  // placer un repos — ce qui fait mécaniquement pencher la présence quotidienne
  // vers la vacation à charge plus élevée (ex. Shift 3 : plus de présents en V1
  // qu'en V2, conformément à 12% contre 8%).
  restDayLabelBiasByShift: {
    S1: { V1: 13.5, V2: 16.5 },
    S2: { V1: 25, V2: 25 },
    S3: { V1: 12, V2: 8 }
  },
  // Le dimanche, sur les shifts 1 et 2 (le shift 3 est déjà OFF), au plus ce nombre
  // de conducteurs peut être affecté par vacation (V1 et V2) : le surplus de
  // l'équipe est mis en repos obligatoire ce dimanche-là, en rotation équitable
  // d'un dimanche à l'autre, et ce repos consomme le quota mensuel de 6.
  sundayVacationCap: 6,
  offShift3Dimanche: true,
  exceptionDimancheLundi: true,
  shiftRotationCycleDefault: ["S1", "S3", "S2"],
  // Lundi de la semaine de référence utilisée pour caler la rotation des shifts
  // (semaine contenant le 01/08/2026, telle qu'observée sur les plannings fournis).
  referenceWeekStart: "2026-07-27",
  // Date à partir de laquelle les rotations de zone/vacation sont calculées ;
  // driver.initialZone / driver.initialVacation s'appliquent exactement à cette date.
  rotationReferenceDate: "2026-08-01",
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

