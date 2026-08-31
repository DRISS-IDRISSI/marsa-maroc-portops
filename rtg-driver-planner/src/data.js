// ==========================================
// RTG DRIVER PLANNER — Données de référence (seed)
// Roster officiel des 75 conducteurs RTG actifs (matricules/noms/prénoms fournis
// par l'exploitant), répartis dans les 3 équipes d'après les plannings Excel
// fournis (GR EDDAOUIDI, GR YAGOUBI, GR AZZAM) : 25 + 25 + 25 = 75.
//
// Ces données ne sont utilisées que pour amorcer le stockage local (localStorage)
// la première fois que l'application démarre. Modifiable ensuite via le module
// Conducteurs (phase 2) ou directement dans les paramètres.
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
  // Charge de travail par shift/vacation (répartie sur 100%), utilisée pour fixer
  // le ratio V1/V2 de conducteurs présents au sein de chaque shift. Le ratio est
  // recalculé chaque jour selon le shift en cours pour l'équipe, avec une rotation
  // équitable des conducteurs entre les deux groupes.
  vacationRatioByShift: {
    S1: { V1: 13.5, V2: 16.5 },
    S2: { V1: 25, V2: 25 },
    S3: { V1: 11.5, V2: 8.5 }
  },
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

// Rotation des shifts par équipe : S1 → S3 → S2 → S1 ... (cycle de 3 semaines).
// Le shift de chaque équipe pour la semaine de référence (01/08/2026) a été relevé
// directement sur l'en-tête de chaque feuille Excel fournie.
const RTG_TEAMS = [
  { id: "A", nom: "GR EDDAOUIDI", shiftCycle: ["S3", "S2", "S1"] },
  { id: "B", nom: "GR YAGOUBI", shiftCycle: ["S2", "S1", "S3"] },
  { id: "C", nom: "GR AZZAM", shiftCycle: ["S1", "S3", "S2"] }
];

function rtgBuildTeam(teamId, list) {
  const zones = RTG_CONFIG.zones;
  return list.map((d, i) => ({
    id: teamId + "_" + d.mat,
    matricule: d.mat,
    nom: d.nom,
    prenom: d.prenom,
    teamId: teamId,
    initialShift: RTG_TEAMS.find(t => t.id === teamId).shiftCycle[0],
    initialZone: zones[i % zones.length],
    // Bloc de vacation du conducteur à rotationReferenceDate (§9-10, d'après la
    // liste officielle des conducteurs RTG par shift et vacation) : le conducteur
    // appartient en permanence à ce bloc (les membres d'un même bloc ne se
    // séparent jamais), mais le bloc ENTIER bascule chaque jour entre V1 et V2,
    // gelé entre dimanche et lundi — voir VacationRotationEngine.getVacationForDate.
    initialVacation: d.vac,
    statut: "PRESENT",
    dateEntree: "2020-01-01",
    dateSortie: null,
    observation: "",
    actif: true
  }));
}

// Équipe GR EDDAOUIDI (25)
const RTG_TEAM_A_RAW = [
  { mat: "C06491", nom: "AFIR", prenom: "MOHAMED", vac: "V1" },
  { mat: "C07206", nom: "EL HOUR", prenom: "ABDELKEBIR", vac: "V1" },
  { mat: "TC0009", nom: "SAOUI", prenom: "ABDELALI", vac: "V1" },
  { mat: "TC0067", nom: "TAGHIA", prenom: "HAMID", vac: "V1" },
  { mat: "TC0065", nom: "KHACHI", prenom: "AHMED", vac: "V1" },
  { mat: "TC0005", nom: "KARABILA", prenom: "ABDELHAFID", vac: "V1" },
  { mat: "TC0063", nom: "CHARRAKI", prenom: "HAMZA", vac: "V1" },
  { mat: "C06234", nom: "BOULHEND", prenom: "ABDELLATIF", vac: "V1" },
  { mat: "TC0007", nom: "ABOUSSOUGHRA", prenom: "ABDELILAH", vac: "V1" },
  { mat: "TC0006", nom: "BENHICHAM", prenom: "AZIZ", vac: "V1" },
  { mat: "C07790", nom: "AIMARAH", prenom: "OMAR", vac: "V1" },
  { mat: "C07707", nom: "HAITOU", prenom: "ZAKARIA", vac: "V1" },
  { mat: "C06119", nom: "MOUAKKIR", prenom: "MUSTAPHA", vac: "V2" },
  { mat: "C06342", nom: "ZOUMHANE", prenom: "BRAHIM", vac: "V2" },
  { mat: "C07498", nom: "OLKOM", prenom: "ABDELLAH", vac: "V2" },
  { mat: "D06888", nom: "ALOUANI", prenom: "RACHID", vac: "V2" },
  { mat: "D06752", nom: "TAOUDI", prenom: "DRISS", vac: "V2" },
  { mat: "TC0004", nom: "CHELH", prenom: "HASSAN", vac: "V2" },
  { mat: "TC0012", nom: "EL HAMRI", prenom: "YASSINE", vac: "V2" },
  { mat: "C07497", nom: "AZMI", prenom: "HICHAM", vac: "V2" },
  { mat: "C07526", nom: "ZAHIR", prenom: "MOHAMED", vac: "V2" },
  { mat: "C07799", nom: "SALIM", prenom: "YOUSSEF", vac: "V2" },
  { mat: "A01040", nom: "NOUBHANI", prenom: "FAROUK", vac: "V2" },
  { mat: "C07709", nom: "TOUBALI", prenom: "ILYAS", vac: "V2" },
  { mat: "C07793", nom: "EL AZHAR", prenom: "RACHID", vac: "V2" }
];

// Équipe GR YAGOUBI (25)
const RTG_TEAM_B_RAW = [
  { mat: "A00913", nom: "SOUALA", prenom: "ABDELHADI", vac: "V1" },
  { mat: "C07496", nom: "AGUELMOUK", prenom: "ABDELLATIF", vac: "V1" },
  { mat: "C07236", nom: "EL GHANNAMI", prenom: "MOKHTAR", vac: "V1" },
  { mat: "C07378", nom: "EL MADKOURI", prenom: "MOHAMED", vac: "V1" },
  { mat: "C07383", nom: "TALLABI", prenom: "MUSTAPHA", vac: "V1" },
  { mat: "TC0008", nom: "AZOUINE", prenom: "SOUFIANE", vac: "V1" },
  { mat: "TC0001", nom: "ELOMARI", prenom: "OTHMANE", vac: "V1" },
  { mat: "TC0003", nom: "JOBRANE", prenom: "AYOUB", vac: "V1" },
  { mat: "TC0062", nom: "ABOU EL FATH", prenom: "ABDELFATTAH", vac: "V1" },
  { mat: "J05183", nom: "SABIR", prenom: "IMADEDDINE", vac: "V1" },
  { mat: "J05217", nom: "HOUBBAN", prenom: "FAISSAL", vac: "V1" },
  { mat: "C07713", nom: "SMIDI", prenom: "ABDERRAHIM", vac: "V1" },
  { mat: "C06126", nom: "BINADRY", prenom: "JILALI", vac: "V2" },
  { mat: "C06067", nom: "ADNANE", prenom: "TAOUFIK", vac: "V2" },
  { mat: "C06948", nom: "LOUZI", prenom: "MOHAMED", vac: "V2" },
  { mat: "D07161", nom: "SMAIRKANDI", prenom: "YASSINE", vac: "V2" },
  { mat: "C06341", nom: "COURDI", prenom: "ELMOSTAFA", vac: "V2" },
  { mat: "C07208", nom: "OUBAKRIM", prenom: "AZIZ", vac: "V2" },
  { mat: "C07528", nom: "MINAR", prenom: "HASSAN", vac: "V2" },
  { mat: "C07499", nom: "MATINE", prenom: "ABDELJALIL", vac: "V2" },
  { mat: "C07524", nom: "MANDOURI", prenom: "MOHAMED", vac: "V2" },
  { mat: "TC0011", nom: "ZAHID", prenom: "KARIM", vac: "V2" },
  { mat: "C07484", nom: "TAHTY", prenom: "MOHAMMED", vac: "V2" },
  { mat: "C07771", nom: "AMNAI", prenom: "OMAR", vac: "V2" },
  { mat: "J05173", nom: "AHEBRICH", prenom: "LAHCEN", vac: "V2" }
];

// Équipe GR AZZAM (25)
const RTG_TEAM_C_RAW = [
  { mat: "C06137", nom: "AZIB", prenom: "MOHAMED", vac: "V1" },
  { mat: "TC0053", nom: "OUDRAOUA", prenom: "ISSAM", vac: "V1" },
  { mat: "C07510", nom: "MAAQUOUL", prenom: "ABDELGHANI", vac: "V1" },
  { mat: "TC0013", nom: "CHARIH", prenom: "MEHDI", vac: "V1" },
  { mat: "A01031", nom: "AYAR", prenom: "REDOUANE", vac: "V1" },
  { mat: "C07792", nom: "BIDDA", prenom: "SALAHEDDINE", vac: "V1" },
  { mat: "C07495", nom: "MOUSSADAK", prenom: "ABDELLATIF", vac: "V1" },
  { mat: "TC0061", nom: "AKIK", prenom: "AMINE", vac: "V1" },
  { mat: "TC0058", nom: "RBIAA", prenom: "SAAD", vac: "V1" },
  { mat: "C07467", nom: "HAKIM", prenom: "HICHAM", vac: "V1" },
  { mat: "TC0057", nom: "MIRE", prenom: "OTHMANE", vac: "V1" },
  { mat: "C06520", nom: "KHALAFI", prenom: "ABDELJALIL", vac: "V2" },
  { mat: "C06809", nom: "ABDERRAZIK", prenom: "TARIK", vac: "V2" },
  { mat: "TC0002", nom: "ZHAR", prenom: "HICHAM", vac: "V2" },
  { mat: "C06924", nom: "RHOUZLANI", prenom: "AHMED", vac: "V2" },
  { mat: "C06143", nom: "SINDEL", prenom: "SAID", vac: "V2" },
  { mat: "C07775", nom: "BOUNAIM", prenom: "EZZOBAIR", vac: "V2" },
  { mat: "TC0060", nom: "AYAD", prenom: "SOUFIANE", vac: "V2" },
  { mat: "TC0064", nom: "EL HAMED", prenom: "ABDELKHALEK", vac: "V2" },
  { mat: "C07515", nom: "IHSANE", prenom: "TARIK", vac: "V2" },
  { mat: "C07532", nom: "EL OUNSSRI", prenom: "KAMAL", vac: "V2" },
  { mat: "C07798", nom: "RAJI", prenom: "MOHAMED", vac: "V2" },
  { mat: "C07770", nom: "ADDI", prenom: "ALAEDDINE", vac: "V2" },
  { mat: "T02750", nom: "AZGAR", prenom: "YASSINE", vac: "V2" },
  { mat: "C06241", nom: "AMMARI", prenom: "DRISS", vac: "V1" }
];

const RTG_DRIVERS = [
  ...rtgBuildTeam("A", RTG_TEAM_A_RAW),
  ...rtgBuildTeam("B", RTG_TEAM_B_RAW),
  ...rtgBuildTeam("C", RTG_TEAM_C_RAW)
];

function rtgDriverIdByMatricule(mat) {
  const d = RTG_DRIVERS.find(dr => dr.matricule === mat);
  return d ? d.id : null;
}

// Quelques congés / maladies de démonstration (août 2026) pour valider que le moteur
// les distingue bien des repos et ne fait pas avancer leur rotation de zone.
const RTG_CONGES = [
  { id: "cg1", driverId: rtgDriverIdByMatricule("C07510"), dateDebut: "2026-08-10", dateFin: "2026-08-14", type: "Congé annuel", commentaire: "", utilisateur: "Admin", createdAt: "2026-07-20T09:00:00Z" },
  { id: "cg2", driverId: rtgDriverIdByMatricule("TC0003"), dateDebut: "2026-08-18", dateFin: "2026-08-20", type: "Congé annuel", commentaire: "", utilisateur: "Admin", createdAt: "2026-07-22T09:00:00Z" }
].filter(c => c.driverId);

const RTG_MALADIES = [
  { id: "ml1", driverId: rtgDriverIdByMatricule("C06234"), dateDebut: "2026-08-05", dateFin: "2026-08-07", commentaire: "Certificat médical", utilisateur: "Admin", createdAt: "2026-08-05T08:00:00Z" }
].filter(m => m.driverId);

const RTG_ABSENCES = [];

const RTG_SEED = {
  // Incrémenté à chaque changement du roster/de la structure de référence : le store
  // compare cette valeur à celle enregistrée dans localStorage pour savoir s'il doit
  // ignorer d'anciennes données mises en cache (ex. un ancien roster de conducteurs)
  // plutôt que de les fusionner avec le nouveau seed.
  dataVersion: 9,
  drivers: RTG_DRIVERS,
  teams: RTG_TEAMS,
  config: RTG_CONFIG,
  conges: RTG_CONGES,
  maladies: RTG_MALADIES,
  absences: RTG_ABSENCES,
  manualOverrides: {},
  auditLog: []
};
