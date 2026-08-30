// ==========================================
// RTG DRIVER PLANNER — Données de référence (seed)
// Roster officiel des 75 conducteurs RTG actifs (matricules/noms/prénoms fournis
// par l'exploitant), répartis dans les 3 équipes d'après les plannings Excel
// fournis (GR EDDAOUIDI, GR YAGOUBI, GR AZZAM) : 26 + 24 + 25 = 75.
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
  // le ratio V1/V2 de conducteurs présents au sein de chaque shift : ex. pour S1,
  // sur les conducteurs présents ce jour-là, ~1/3 sont placés en V1 et ~2/3 en V2
  // (ratio 10:20). Le ratio est recalculé chaque jour selon le shift en cours pour
  // l'équipe, avec une rotation équitable des conducteurs entre les deux groupes.
  vacationRatioByShift: {
    S1: { V1: 10, V2: 20 },
    S2: { V1: 25, V2: 25 },
    S3: { V1: 12, V2: 8 }
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
    initialVacation: i % 2 === 0 ? "V1" : "V2",
    statut: "PRESENT",
    dateEntree: "2020-01-01",
    dateSortie: null,
    observation: "",
    actif: true
  }));
}

// Équipe GR EDDAOUIDI (26)
const RTG_TEAM_A_RAW = [
  { mat: "C06491", nom: "AFIR", prenom: "MOHAMED" },
  { mat: "C07206", nom: "EL HOUR", prenom: "ABDELKEBIR" },
  { mat: "TC0009", nom: "SAOUI", prenom: "ABDELALI" },
  { mat: "TC0067", nom: "TAGHIA", prenom: "HAMID" },
  { mat: "TC0065", nom: "KHACHI", prenom: "AHMED" },
  { mat: "TC0005", nom: "KARABILA", prenom: "ABDELHAFID" },
  { mat: "TC0063", nom: "CHARRAKI", prenom: "HAMZA" },
  { mat: "C06234", nom: "BOULHEND", prenom: "ABDELLATIF" },
  { mat: "TC0007", nom: "ABOUSSOUGHRA", prenom: "ABDELILAH" },
  { mat: "TC0006", nom: "BENHICHAM", prenom: "AZIZ" },
  { mat: "C07790", nom: "AIMARAH", prenom: "OMAR" },
  { mat: "C07707", nom: "HAITOU", prenom: "ZAKARIA" },
  { mat: "C06119", nom: "MOUAKKIR", prenom: "MUSTAPHA" },
  { mat: "C06342", nom: "ZOUMHANE", prenom: "BRAHIM" },
  { mat: "C07498", nom: "OLKOM", prenom: "ABDELLAH" },
  { mat: "D06888", nom: "ALOUANI", prenom: "RACHID" },
  { mat: "D06752", nom: "TAOUDI", prenom: "DRISS" },
  { mat: "TC0004", nom: "CHELH", prenom: "HASSAN" },
  { mat: "TC0012", nom: "EL HAMRI", prenom: "YASSINE" },
  { mat: "C07497", nom: "AZMI", prenom: "HICHAM" },
  { mat: "C07526", nom: "ZAHIR", prenom: "MOHAMED" },
  { mat: "C07799", nom: "SALIM", prenom: "YOUSSEF" },
  { mat: "A01040", nom: "NOUBHANI", prenom: "FAROUK" },
  { mat: "C07709", nom: "TOUBALI", prenom: "ILYAS" },
  { mat: "C07793", nom: "EL AZHAR", prenom: "RACHID" },
  { mat: "C06241", nom: "AMMARI", prenom: "DRISS" }
];

// Équipe GR YAGOUBI (24)
const RTG_TEAM_B_RAW = [
  { mat: "A00913", nom: "SOUALA", prenom: "ABDELHADI" },
  { mat: "C07496", nom: "AGUELMOUK", prenom: "ABDELLATIF" },
  { mat: "C07236", nom: "EL GHANNAMI", prenom: "MOKHTAR" },
  { mat: "C07378", nom: "EL MADKOURI", prenom: "MOHAMED" },
  { mat: "C07383", nom: "TALLABI", prenom: "MUSTAPHA" },
  { mat: "TC0008", nom: "AZOUINE", prenom: "SOUFIANE" },
  { mat: "TC0001", nom: "ELOMARI", prenom: "OTHMANE" },
  { mat: "TC0003", nom: "JOBRANE", prenom: "AYOUB" },
  { mat: "TC0062", nom: "ABOU EL FATH", prenom: "ABDELFATTAH" },
  { mat: "J05183", nom: "SABIR", prenom: "IMADEDDINE" },
  { mat: "J05217", nom: "HOUBBAN", prenom: "FAISSAL" },
  { mat: "C07713", nom: "SMIDI", prenom: "ABDERRAHIM" },
  { mat: "C06126", nom: "BINADRY", prenom: "JILALI" },
  { mat: "C06067", nom: "ADNANE", prenom: "TAOUFIK" },
  { mat: "C06948", nom: "LOUZI", prenom: "MOHAMED" },
  { mat: "D07161", nom: "SMAIRKANDI", prenom: "YASSINE" },
  { mat: "C06341", nom: "COURDI", prenom: "ELMOSTAFA" },
  { mat: "C07208", nom: "OUBAKRIM", prenom: "AZIZ" },
  { mat: "C07528", nom: "MINAR", prenom: "HASSAN" },
  { mat: "C07499", nom: "MATINE", prenom: "ABDELJALIL" },
  { mat: "C07524", nom: "MANDOURI", prenom: "MOHAMED" },
  { mat: "TC0011", nom: "ZAHID", prenom: "KARIM" },
  { mat: "C07484", nom: "TAHTY", prenom: "MOHAMMED" },
  { mat: "C07771", nom: "AMNAI", prenom: "OMAR" }
];

// Équipe GR AZZAM (25)
const RTG_TEAM_C_RAW = [
  { mat: "C06137", nom: "AZIB", prenom: "MOHAMED" },
  { mat: "TC0053", nom: "OUDRAOUA", prenom: "ISSAM" },
  { mat: "C07510", nom: "MAAQUOUL", prenom: "ABDELGHANI" },
  { mat: "TC0013", nom: "CHARIH", prenom: "MEHDI" },
  { mat: "A01031", nom: "AYAR", prenom: "REDOUANE" },
  { mat: "C07792", nom: "BIDDA", prenom: "SALAHEDDINE" },
  { mat: "C07495", nom: "MOUSSADAK", prenom: "ABDELLATIF" },
  { mat: "TC0061", nom: "AKIK", prenom: "AMINE" },
  { mat: "TC0058", nom: "RBIAA", prenom: "SAAD" },
  { mat: "C07467", nom: "HAKIM", prenom: "HICHAM" },
  { mat: "TC0057", nom: "MIRE", prenom: "OTHMANE" },
  { mat: "C06520", nom: "KHALAFI", prenom: "ABDELJALIL" },
  { mat: "C06809", nom: "ABDERRAZIK", prenom: "TARIK" },
  { mat: "TC0002", nom: "ZHAR", prenom: "HICHAM" },
  { mat: "C06924", nom: "RHOUZLANI", prenom: "AHMED" },
  { mat: "C06143", nom: "SINDEL", prenom: "SAID" },
  { mat: "C07775", nom: "BOUNAIM", prenom: "EZZOBAIR" },
  { mat: "TC0060", nom: "AYAD", prenom: "SOUFIANE" },
  { mat: "TC0064", nom: "EL HAMED", prenom: "ABDELKHALEK" },
  { mat: "C07515", nom: "IHSANE", prenom: "TARIK" },
  { mat: "C07532", nom: "EL OUNSSRI", prenom: "KAMAL" },
  { mat: "C07798", nom: "RAJI", prenom: "MOHAMED" },
  { mat: "C07770", nom: "ADDI", prenom: "ALAEDDINE" },
  { mat: "T02750", nom: "AZGAR", prenom: "YASSINE" },
  { mat: "J05173", nom: "AHEBRICH", prenom: "LAHCEN" }
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
  dataVersion: 5,
  drivers: RTG_DRIVERS,
  teams: RTG_TEAMS,
  config: RTG_CONFIG,
  conges: RTG_CONGES,
  maladies: RTG_MALADIES,
  absences: RTG_ABSENCES,
  manualOverrides: {},
  auditLog: []
};
