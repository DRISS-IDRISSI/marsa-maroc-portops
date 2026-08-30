// ==========================================
// RTG DRIVER PLANNER — Données de référence (seed)
// Extraites des 3 plannings Excel fournis (groupe TC3PC, GR YAGOUBI, GR AZZAM).
// Chaque feuille Excel = UNE équipe complète (les deux sous-tableaux de chaque
// feuille partagent la même rotation de shift hebdomadaire, donc appartiennent
// à la même équipe) : 25 + 24 + 23 = 72 conducteurs au total.
//
// Ces données ne sont utilisées que pour amorcer le stockage local (localStorage)
// la première fois que l'application démarre. Modifiable ensuite via le module
// Conducteurs (phase 2) ou directement dans les paramètres.
//
// NB : les matricules 7206 (ELHOUR / OUBAKRIM) et TC0060 (CHERRAKI / AYAD) sont
// dupliqués entre deux équipes dans les feuilles Excel fournies — c'est déjà le
// cas dans les fichiers source, pas une erreur de saisie ici. Cela n'empêche pas
// l'application de fonctionner (chaque conducteur a un identifiant interne unique
// préfixé par équipe), mais il faudra corriger le matricule en double dans le
// fichier source si c'est une erreur.
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
  offShift3Dimanche: true,
  exceptionDimancheLundi: true,
  shiftRotationCycleDefault: ["S1", "S3", "S2"],
  // Lundi de la semaine de référence utilisée pour caler la rotation des shifts
  // (semaine contenant le 01/08/2026, telle qu'observée sur les plannings fournis).
  referenceWeekStart: "2026-07-27",
  // Date à partir de laquelle les rotations de zone/vacation sont calculées ;
  // driver.initialZone / driver.initialVacation s'appliquent exactement à cette date.
  rotationReferenceDate: "2026-08-01"
};

// Rotation des shifts par équipe : S1 → S3 → S2 → S1 ... (cycle de 3 semaines).
// Le shift de chaque équipe pour la semaine de référence (01/08/2026) a été relevé
// directement sur l'en-tête de chaque feuille Excel fournie :
//   - groupe TC3PC (sans nom sur la feuille) : SHIFT 3 la semaine du 01-02 août
//   - GR YAGOUBI : SHIFT 2 la semaine du 01-02 août
//   - GR AZZAM   : SHIFT 1 la semaine du 01-02 août
const RTG_TEAMS = [
  { id: "A", nom: "Équipe TC3PC", shiftCycle: ["S3", "S2", "S1"] },
  { id: "B", nom: "GR YAGOUBI", shiftCycle: ["S2", "S1", "S3"] },
  { id: "C", nom: "GR AZZAM", shiftCycle: ["S1", "S3", "S2"] }
];

function rtgBuildTeam(teamId, list) {
  const zones = RTG_CONFIG.zones;
  return list.map((d, i) => ({
    id: teamId + "_" + d.mat + "_" + i,
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

// Équipe TC3PC — planning "ROPOS RTGs" (feuille sans nom d'équipe visible)
const RTG_TEAM_A_RAW = [
  { mat: "6491", nom: "AFIR", prenom: "MOHAMED" },
  { mat: "7206", nom: "ELHOUR", prenom: "ABDELKEBIR" },
  { mat: "TC0009", nom: "SAOUI", prenom: "ABDELALI" },
  { mat: "TC0067", nom: "TAGHIA", prenom: "HAMID" },
  { mat: "TC0065", nom: "KHACHII", prenom: "AHMED" },
  { mat: "TC0005", nom: "KARABILLA", prenom: "ABDELHAFID" },
  { mat: "TC0060", nom: "CHERRAKI", prenom: "HAMZA" },
  { mat: "6234", nom: "BOULHEND", prenom: "ABDELLATIF" },
  { mat: "TC0007", nom: "ABOUSSOUGHRA", prenom: "ABDELILAH" },
  { mat: "TC0006", nom: "BENHICHAM", prenom: "AZIZ" },
  { mat: "C07790", nom: "AIMARAH", prenom: "OMAR" },
  { mat: "C07707", nom: "HAITOU", prenom: "ZAKARIA" },
  { mat: "6119", nom: "MOUAKKIR", prenom: "MUSTAPHA" },
  { mat: "6342", nom: "ZOUMHANE", prenom: "BRAHIM" },
  { mat: "7498", nom: "OLKOM", prenom: "ABDELLAH" },
  { mat: "6888", nom: "ALOUANI", prenom: "RACHID" },
  { mat: "6752", nom: "TAOUDI", prenom: "DRISS" },
  { mat: "TC0004", nom: "CHELH", prenom: "HASSAN" },
  { mat: "TC0012", nom: "EL HAMRI", prenom: "YASSINE" },
  { mat: "7497", nom: "AZMI", prenom: "HICHAM" },
  { mat: "7526", nom: "ZAHIR", prenom: "MOHAMED" },
  { mat: "7799", nom: "SALIM", prenom: "YOUSSEF" },
  { mat: "A01040", nom: "NOUBHANI", prenom: "FAROUK" },
  { mat: "C07709", nom: "TOUBLALI", prenom: "ILYAS" },
  { mat: "C07793", nom: "EL AZHAR", prenom: "RACHID" }
];

// Équipe GR YAGOUBI
const RTG_TEAM_B_RAW = [
  { mat: "913", nom: "SOUALA", prenom: "ABDELHADI" },
  { mat: "7496", nom: "AGUELMOUK", prenom: "ABDELLATIF" },
  { mat: "7236", nom: "GHANNAMI", prenom: "MOKHTAR" },
  { mat: "7378", nom: "EL MADKOURI", prenom: "MOHAMED" },
  { mat: "7383", nom: "TALLABI", prenom: "MUSTAPHA" },
  { mat: "TC0008", nom: "AZOUINE", prenom: "SOUFIANE" },
  { mat: "TC0001", nom: "EL OMARI", prenom: "OTHMANE" },
  { mat: "TC0003", nom: "JOBRANE", prenom: "AYOUB" },
  { mat: "TC0062", nom: "ABOU AL FATAH", prenom: "ABDELFATAH" },
  { mat: "JO5183", nom: "SABIR", prenom: "IMAD-EDINE" },
  { mat: "JO5217", nom: "HOUBBAN", prenom: "FAISSAL" },
  { mat: "C07713", nom: "SMIDI", prenom: "ABDERRAHMANE" },
  { mat: "6126", nom: "BINADRI", prenom: "JILALI" },
  { mat: "6067", nom: "ADNANE", prenom: "TAOUFIK" },
  { mat: "6948", nom: "LOUZI", prenom: "MOHAMED" },
  { mat: "7161", nom: "SMAIRKANDI", prenom: "YASSINE" },
  { mat: "6341", nom: "COURDI", prenom: "ELMOSTAPHA" },
  { mat: "7206", nom: "OUBAKRIM", prenom: "AZIZ" },
  { mat: "7528", nom: "MINAR", prenom: "HASSAN" },
  { mat: "7499", nom: "MATINE", prenom: "ABDELJALIL" },
  { mat: "7524", nom: "MANDOURI", prenom: "MOHAMED" },
  { mat: "TC0011", nom: "ZAHID", prenom: "KARIM" },
  { mat: "CO7484", nom: "TAHTY", prenom: "MOHAMMED" },
  { mat: "CO7771", nom: "AMNAI", prenom: "OMAR" }
];

// Équipe GR AZZAM
const RTG_TEAM_C_RAW = [
  { mat: "6137", nom: "AZIB", prenom: "MOHAMED" },
  { mat: "TC0053", nom: "OUDRAOUA", prenom: "ISSAM" },
  { mat: "7510", nom: "MAAQUOUL", prenom: "ABDELGHANI" },
  { mat: "TC0013", nom: "CHARIH", prenom: "MEHDI" },
  { mat: "A01031", nom: "AYAR", prenom: "REDOUANE" },
  { mat: "7792", nom: "BIDDA", prenom: "SALAEDDINE" },
  { mat: "7495", nom: "MOUSSADAK", prenom: "ABDELLATIF" },
  { mat: "TC0061", nom: "AKIK", prenom: "AMINE" },
  { mat: "TC0058", nom: "RBIAA", prenom: "SAAD" },
  { mat: "7467", nom: "HAKIM", prenom: "HICHAM" },
  { mat: "TC0057", nom: "MIRE", prenom: "OTHMANE" },
  { mat: "6520", nom: "KHALAFI", prenom: "ABDELJALIL" },
  { mat: "6809", nom: "ABDERRAZIK", prenom: "TARIK" },
  { mat: "TC0002", nom: "ZHAR", prenom: "HICHAM" },
  { mat: "6924", nom: "RHOUZLANI", prenom: "AHMED" },
  { mat: "6143", nom: "SINDEL", prenom: "SAID" },
  { mat: "C07775", nom: "BOUNAIM", prenom: "EZZOUBAIR" },
  { mat: "TC0060", nom: "AYAD", prenom: "SOUFIANE" },
  { mat: "TC0064", nom: "ELHAMED", prenom: "ABDELKHALAK" },
  { mat: "7515", nom: "IHSANE", prenom: "TARIK" },
  { mat: "7532", nom: "ELOUNSSRI", prenom: "KAMAL" },
  { mat: "7798", nom: "RAJI", prenom: "MOHAMMED" },
  { mat: "C07770", nom: "ADDI", prenom: "ALLAE-DDINE" }
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
  { id: "cg1", driverId: rtgDriverIdByMatricule("7510"), dateDebut: "2026-08-10", dateFin: "2026-08-14", type: "Congé annuel", commentaire: "", utilisateur: "Admin", createdAt: "2026-07-20T09:00:00Z" },
  { id: "cg2", driverId: rtgDriverIdByMatricule("TC0003"), dateDebut: "2026-08-18", dateFin: "2026-08-20", type: "Congé annuel", commentaire: "", utilisateur: "Admin", createdAt: "2026-07-22T09:00:00Z" }
].filter(c => c.driverId);

const RTG_MALADIES = [
  { id: "ml1", driverId: rtgDriverIdByMatricule("6234"), dateDebut: "2026-08-05", dateFin: "2026-08-07", commentaire: "Certificat médical", utilisateur: "Admin", createdAt: "2026-08-05T08:00:00Z" }
].filter(m => m.driverId);

const RTG_ABSENCES = [];

const RTG_SEED = {
  drivers: RTG_DRIVERS,
  teams: RTG_TEAMS,
  config: RTG_CONFIG,
  conges: RTG_CONGES,
  maladies: RTG_MALADIES,
  absences: RTG_ABSENCES,
  manualOverrides: {},
  auditLog: []
};
