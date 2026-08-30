// ==========================================
// RTG DRIVER PLANNER — Données de référence (seed)
// Extraites des plannings Excel fournis (GR AZZAM, GR YAGOUBI, groupe TC3PC)
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
  offShift3Dimanche: true,
  exceptionDimancheLundi: true,
  shiftRotationCycleDefault: ["S1", "S3", "S2"],
  // Lundi de la semaine de référence utilisée pour caler la rotation des shifts.
  referenceWeekStart: "2026-07-27",
  // Date à partir de laquelle les rotations de zone/vacation sont calculées ;
  // driver.initialZone / driver.initialVacation s'appliquent exactement à cette date.
  rotationReferenceDate: "2026-08-01"
};

// Rotation des shifts par équipe : S1 → S3 → S2 (cycle de 3 semaines).
// Chaque équipe démarre à une position différente du cycle à la semaine de référence.
const RTG_TEAMS = [
  { id: "A", nom: "Équipe A", shiftCycle: ["S1", "S3", "S2"] },
  { id: "B", nom: "Équipe B", shiftCycle: ["S3", "S2", "S1"] },
  { id: "C", nom: "Équipe C", shiftCycle: ["S2", "S1", "S3"] }
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

// Équipe A — d'après la fiche GR AZZAM (Shift 1, 31/07/2026)
const RTG_TEAM_A_RAW = [
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
  { mat: "TC0057", nom: "MIRE", prenom: "OTHMANE" }
];

// Équipe B — d'après le planning GR YAGOUBI
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
  { mat: "C07713", nom: "SMIDI", prenom: "ABDERRAHMANE" }
];

// Équipe C — d'après le planning ROPOS RTGs (groupe TC3PC)
const RTG_TEAM_C_RAW = [
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
  { mat: "C07707", nom: "HAITOU", prenom: "ZAKARIA" }
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
