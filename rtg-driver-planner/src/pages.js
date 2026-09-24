const { useState, useMemo, useEffect, useRef } = React;
const { useNavigate, useSearchParams } = ReactRouterDOM;

function useRtgState() {
  const [state, setState] = useState(RTGStore.get());
  useEffect(() => RTGStore.subscribe(setState), []);
  return state;
}

// ==========================================
// Import Excel du planning réel (Repos + Congés) — §33
// Charge la bibliothèque SheetJS à la demande (pas au chargement de l'appli,
// pour ne pas alourdir le PWA pour un usage occasionnel réservé à l'ADMIN/
// RESPONSABLE) et transforme un fichier "PLANNING_MENSUEL_RTG..." (même
// format que les plannings réels fournis par l'exploitant : une feuille
// "SHIFT <équipe>" avec une ligne d'en-tête de dates et, par conducteur, un
// code par jour — "R" = repos, "C"/"CG" = congé, "M" = maladie) en repos
// manuels + périodes de congé importables via RTGStore.
// ==========================================
let _xlsxLoadPromise = null;
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxLoadPromise) return _xlsxLoadPromise;
  _xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("Impossible de charger la bibliothèque de lecture Excel (connexion internet requise)."));
    document.head.appendChild(script);
  });
  return _xlsxLoadPromise;
}

const IMPORT_REPOS_CODES = ["R"];
const IMPORT_CONGE_CODES = ["C", "CG", "CONGE", "CONGÉ"];
const IMPORT_MALADIE_CODES = ["M", "MALADIE"];

// Fusionne une liste de jours du mois en plages de jours consécutifs —
// ex. [1,2,3,7,8] -> [[1,3],[7,8]] — pour créer le minimum de périodes de
// congé (comme le fait un usager via la page Congés).
function mergeConsecutiveDays(days) {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  const ranges = [];
  let start = null, prev = null;
  sorted.forEach(d => {
    if (start === null) { start = d; prev = d; return; }
    if (d === prev + 1) { prev = d; return; }
    ranges.push([start, prev]);
    start = d; prev = d;
  });
  if (start !== null) ranges.push([start, prev]);
  return ranges;
}

// Normalise pour comparer un nom d'équipe à un nom de feuille sans être
// sensible aux accents/casse/espaces multiples (ex. "GR EDDAOUIDI" doit
// correspondre à la feuille "SHIFT GR EDDAOUIDI").
function normalizeForMatch(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Un fichier peut couvrir une seule équipe (une seule feuille "SHIFT ...")
// ou les 3 shifts à la fois (une feuille "SHIFT <équipe>" par équipe) :
// dans ce second cas, on sélectionne précisément celle de l'équipe en cours
// d'import — jamais juste "la première feuille SHIFT trouvée". Partagé par
// parseRepoCongeExcel (repos/congés) et parseConducteursFromShiftExcel
// (création en masse des conducteurs, § module Chariots Cavalier) : même
// fichier, même feuille, deux lectures différentes.
function selectShiftSheet(workbook, teamNom) {
  const shiftSheets = workbook.SheetNames.filter(n => /^shift/i.test(n.trim()));
  const teamKey = normalizeForMatch(teamNom);
  if (shiftSheets.length <= 1) return shiftSheets[0] || workbook.SheetNames[0];
  const matches = shiftSheets.filter(n => teamKey && normalizeForMatch(n).indexOf(teamKey) !== -1);
  if (matches.length !== 1) {
    throw new Error("Ce fichier contient plusieurs feuilles \"SHIFT ...\" (" + shiftSheets.join(", ") + ") et aucune ne correspond clairement à l'équipe « " + teamNom + " ». Vérifiez le nom de l'équipe ou le fichier.");
  }
  return matches[0];
}

// Matricule reconnu par motif (lettres puis chiffres, ex. C07231, TC0036,
// J05034, D07005) — utilisé par parseConducteursFromShiftExcel pour repérer
// une ligne de conducteur sans dépendre des colonnes de dates (inutiles
// pour cette lecture-là, voir plus bas).
const MATRICULE_PATTERN = /^[A-Za-z]{1,3}\d{3,7}$/;

// Lit la même feuille "SHIFT <équipe>" (colonne A = matricule, B = nom,
// C = prénom) que parseRepoCongeExcel, mais pour CRÉER les conducteurs de
// l'équipe plutôt que pour importer repos/congés — évite de redemander à
// l'exploitant un fichier séparé rien que pour la liste des matricules
// (§ module Chariots Cavalier, équipes créées avec 0 conducteur tant que
// personne n'a été ajouté manuellement).
function parseConducteursFromShiftExcel(workbook, teamNom, existingDrivers) {
  const XLSX = window.XLSX;
  const sheetName = selectShiftSheet(workbook, teamNom);
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const existingByMatricule = {};
  existingDrivers.forEach(d => { existingByMatricule[String(d.matricule).trim().toUpperCase()] = d; });

  const toCreate = [], alreadyExisting = [], invalid = [];
  const seen = new Set();
  rows.forEach(row => {
    const matCell = row[0], nomCell = row[1], prenomCell = row[2];
    if (matCell === null || matCell === undefined) return;
    const mat = String(matCell).trim();
    if (!MATRICULE_PATTERN.test(mat)) return;
    const key = mat.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (existingByMatricule[key]) {
      alreadyExisting.push({ matricule: mat, nom: existingByMatricule[key].nom, prenom: existingByMatricule[key].prenom });
      return;
    }
    const nom = String(nomCell || "").trim();
    const prenom = String(prenomCell || "").trim();
    if (!nom) { invalid.push({ matricule: mat, reason: "nom manquant" }); return; }
    toCreate.push({ matricule: mat, nom: nom, prenom: prenom });
  });

  return { sheetName: sheetName, toCreate: toCreate, alreadyExisting: alreadyExisting, invalid: invalid };
}

// Repère la ligne d'en-tête d'une feuille "SHIFT <équipe>" : celle qui
// contient le plus de cellules-dates correspondant au mois/année ciblés (le
// fichier réel peut couvrir plusieurs mois sur la même feuille — ex. GR
// HOUSSAM, août ET septembre côte à côte). On lit le numéro de série Excel
// BRUT (pas de conversion cellDates de SheetJS en objets Date : sa
// construction interne peut introduire une ambiguïté de fuseau horaire —
// décalage d'un jour déjà observé en pratique) et on le convertit nous-mêmes
// en UTC, formule standard et déterministe (25569 = écart entre l'époque
// Excel et l'époque Unix, en jours). Partagé par parseRepoCongeExcel et
// parseVacationLabelExcel (même feuille, même repérage de colonnes).
function detectDayColumns(rows, month, year, sheetName) {
  const excelSerialToUTCDate = serial => new Date(Math.round((serial - 25569) * 86400 * 1000));
  let headerRowIdx = -1, dayColumns = [];
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cols = [];
    (rows[i] || []).forEach((cell, colIdx) => {
      if (typeof cell !== "number" || cell < 20000 || cell > 80000) return;
      const d = excelSerialToUTCDate(cell);
      if (d.getUTCFullYear() === year && (d.getUTCMonth() + 1) === month) {
        cols.push({ day: d.getUTCDate(), colIdx: colIdx });
      }
    });
    if (cols.length > dayColumns.length) { dayColumns = cols; headerRowIdx = i; }
  }
  if (headerRowIdx === -1 || dayColumns.length === 0) {
    throw new Error("Impossible de trouver les colonnes de dates pour " + RAPPORT_MOIS_LABELS_P[month - 1] + " " + year + " dans la feuille « " + sheetName + " ».");
  }
  const seenDays = {};
  dayColumns = dayColumns.filter(c => {
    if (seenDays[c.day]) return false;
    seenDays[c.day] = true;
    return true;
  }).sort((a, b) => a.day - b.day);
  return { headerRowIdx: headerRowIdx, dayColumns: dayColumns };
}

// Le matricule affiché dans l'appli n'est pas toujours écrit à l'identique
// dans le fichier Excel réel de l'exploitant (préfixes différents — ex.
// appli "A00913" / fichier "913", appli "J05183" / fichier "JO5183") : on
// tente d'abord une correspondance exacte, puis par la partie numérique du
// matricule (chiffres uniquement, zéros de tête ignorés), puis en dernier
// recours par nom+prénom — chaque conducteur n'est apparié qu'une fois.
// Partagé par parseRepoCongeExcel et parseVacationLabelExcel.
function buildDriverMatcher(drivers) {
  const normalizeNumeric = m => {
    if (m === null || m === undefined) return null;
    const digits = String(m).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
    return digits === "" ? null : digits;
  };
  const normalizeName = (nom, prenom) => (String(nom || "") + " " + String(prenom || ""))
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/\s+/g, " ");

  const byMatricule = {}, byNumeric = {}, byName = {};
  drivers.forEach(d => {
    byMatricule[String(d.matricule).trim().toUpperCase()] = d;
    const num = normalizeNumeric(d.matricule);
    if (num) (byNumeric[num] = byNumeric[num] || []).push(d);
    const nameKey = normalizeName(d.nom, d.prenom);
    if (nameKey.trim()) byName[nameKey] = d;
  });

  return (matRaw, nomRaw, prenomRaw) => {
    const exact = byMatricule[String(matRaw).trim().toUpperCase()];
    if (exact) return { driver: exact, via: "matricule" };
    const num = normalizeNumeric(matRaw);
    if (num && byNumeric[num] && byNumeric[num].length === 1) return { driver: byNumeric[num][0], via: "numérique" };
    const nameKey = normalizeName(nomRaw, prenomRaw);
    if (nameKey.trim() && byName[nameKey]) return { driver: byName[nameKey], via: "nom" };
    return null;
  };
}

function parseRepoCongeExcel(workbook, drivers, month, year, teamNom) {
  const XLSX = window.XLSX;
  const sheetName = selectShiftSheet(workbook, teamNom);
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const { headerRowIdx, dayColumns } = detectDayColumns(rows, month, year, sheetName);
  const matchDriver = buildDriverMatcher(drivers);

  const codesByDriverDay = {};
  const dayHasAnyCode = {};
  const unknownCodes = [];
  const unmatchedMatricules = new Set();
  const matchedDriverIds = new Set();
  const fallbackMatches = [];
  // Ordre des lignes du fichier (par conducteur) — pour pouvoir réafficher
  // le Planning mensuel de l'appli dans le même ordre que le fichier réel
  // et faciliter la comparaison ligne à ligne.
  const orderByDriver = {};
  let orderCounter = 0;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const matCell = row[0];
    const nomCell = row[1];
    const prenomCell = row[2];
    if (typeof nomCell === "string" && /NOMBRE DE PRESENT|Vacation/i.test(nomCell)) continue;
    if (matCell === null || matCell === undefined || String(matCell).trim() === "") continue;
    // Sous les blocs de conducteurs, certains fichiers ajoutent une légende
    // ("LÉGENDE" / "Case vide" / "R" / "C" / "M" / "Note ..." en colonne A) :
    // un vrai matricule contient toujours au moins un chiffre, pas ces libellés.
    if (!/\d/.test(String(matCell))) continue;
    const found = matchDriver(matCell, nomCell, prenomCell);
    if (!found) { unmatchedMatricules.add(String(matCell).trim() + (nomCell ? " (" + nomCell + ")" : "")); continue; }
    const driver = found.driver;
    if (found.via !== "matricule") fallbackMatches.push({ matriculeFichier: String(matCell).trim(), matriculeAppli: driver.matricule, nom: driver.nom, prenom: driver.prenom, via: found.via });
    matchedDriverIds.add(driver.id);
    orderByDriver[driver.id] = orderCounter++;
    const codesByDay = codesByDriverDay[driver.id] = codesByDriverDay[driver.id] || {};
    dayColumns.forEach(({ day, colIdx }) => {
      const raw = row[colIdx];
      const code = (raw === null || raw === undefined || String(raw).trim() === "") ? null : String(raw).trim().toUpperCase();
      codesByDay[day] = code;
      if (code !== null) dayHasAnyCode[day] = true;
    });
  }

  // Jour où AUCUN conducteur reconnu de l'équipe n'a de code (R/C/M) : un jour
  // chômé pour TOUTE l'équipe (ex. dimanche du 3ème shift, cf.
  // offShift3Dimanche), pas un jour "présent" comme une case vide ordinaire —
  // la case y est vide pour tout le monde, y compris un conducteur en réalité
  // en congé/maladie ce jour-là (le fichier ne le distingue pas). Sans ce
  // traitement, un congé/une maladie qui traverse un tel jour serait scindé à
  // tort en deux périodes distinctes (cas réel observé : EL MOUHAJIR, GR
  // HADDAZI, jour du 3ème shift dimanche chômé).
  const universallyBlankDays = new Set(dayColumns.map(c => c.day).filter(day => !dayHasAnyCode[day]));
  const bridgeGaps = days => {
    const set = new Set(days);
    let changed = true;
    while (changed) {
      changed = false;
      universallyBlankDays.forEach(day => {
        if (!set.has(day) && set.has(day - 1) && set.has(day + 1)) { set.add(day); changed = true; }
      });
    }
    return Array.from(set);
  };

  const reposByDriver = {};
  const congeByDriver = {};
  const presentByDriver = {};
  const maladieByDriver = {};
  Object.keys(codesByDriverDay).forEach(driverId => {
    const driver = drivers.find(d => d.id === driverId);
    const codesByDay = codesByDriverDay[driverId];
    const rawConge = [], rawMaladie = [];
    Object.keys(codesByDay).forEach(dayStr => {
      const day = parseInt(dayStr, 10);
      const code = codesByDay[day];
      if (code === null) {
        // Case vide = "Conducteur présent" (légende du fichier réel), SAUF un
        // jour chômé pour toute l'équipe (voir ci-dessus) qui ne signifie rien
        // de particulier pour ce conducteur.
        if (!universallyBlankDays.has(day)) (presentByDriver[driverId] = presentByDriver[driverId] || []).push(day);
        return;
      }
      if (IMPORT_REPOS_CODES.indexOf(code) !== -1) {
        (reposByDriver[driverId] = reposByDriver[driverId] || []).push(day);
      } else if (IMPORT_CONGE_CODES.indexOf(code) !== -1) {
        rawConge.push(day);
      } else if (IMPORT_MALADIE_CODES.indexOf(code) !== -1) {
        rawMaladie.push(day);
      } else {
        unknownCodes.push({ matricule: driver ? driver.matricule : driverId, day: day, code: code });
      }
    });
    if (rawConge.length) congeByDriver[driverId] = bridgeGaps(rawConge);
    if (rawMaladie.length) maladieByDriver[driverId] = bridgeGaps(rawMaladie);
  });

  const congeRanges = [];
  Object.keys(congeByDriver).forEach(driverId => {
    mergeConsecutiveDays(congeByDriver[driverId]).forEach(([start, end]) => {
      congeRanges.push({
        driverId: driverId,
        dateDebut: RTGDate.toISO(RTGDate.makeDate(year, month, start)),
        dateFin: RTGDate.toISO(RTGDate.makeDate(year, month, end))
      });
    });
  });

  const maladieRanges = [];
  Object.keys(maladieByDriver).forEach(driverId => {
    mergeConsecutiveDays(maladieByDriver[driverId]).forEach(([start, end]) => {
      maladieRanges.push({
        driverId: driverId,
        dateDebut: RTGDate.toISO(RTGDate.makeDate(year, month, start)),
        dateFin: RTGDate.toISO(RTGDate.makeDate(year, month, end))
      });
    });
  });

  const reposDays = [];
  Object.keys(reposByDriver).forEach(driverId => {
    reposByDriver[driverId].forEach(day => {
      reposDays.push({ driverId: driverId, iso: RTGDate.toISO(RTGDate.makeDate(year, month, day)) });
    });
  });

  const presentDays = [];
  Object.keys(presentByDriver).forEach(driverId => {
    presentByDriver[driverId].forEach(day => {
      presentDays.push({ driverId: driverId, iso: RTGDate.toISO(RTGDate.makeDate(year, month, day)) });
    });
  });

  // Repère de vérification affiché dans l'aperçu, pour comparer visuellement
  // les colonnes détectées à celles du fichier réel (ligne + lettre de
  // colonne Excel) SANS attendre un import complet — sert à détecter
  // immédiatement une éventuelle ligne d'en-tête mal choisie (ex. décalage
  // d'un jour déjà observé en pratique sur un fichier).
  const dayColumnsInfo = dayColumns.map(c => ({ day: c.day, col: XLSX.utils.encode_col(c.colIdx) }));

  return {
    sheetName: sheetName,
    headerRowNumber: headerRowIdx + 1,
    dayColumnsInfo: dayColumnsInfo,
    matchedCount: matchedDriverIds.size,
    unmatchedMatricules: Array.from(unmatchedMatricules),
    fallbackMatches: fallbackMatches,
    congeRanges: congeRanges,
    maladieRanges: maladieRanges,
    reposDays: reposDays,
    presentDays: presentDays,
    orderByDriver: orderByDriver,
    unknownCodes: unknownCodes
  };
}

// Lit la ligne "VACATION 1 OU 2" du fichier réel — la VÉRITÉ TERRAIN, tenue à
// la main par l'exploitant, de la vacation (V1/V2) EFFECTIVEMENT montrée par
// chaque bloc de conducteurs ("VACATION A" / "VACATION B") un jour donné.
// Sert à corriger VacationRotationEngine quand son calcul (cascade en
// pointeur+parité depuis rotationReferenceDate) diverge de la réalité —
// constaté en pratique sur GR HADDAZI (§ demande explicite de l'exploitant :
// "corriger les vacations"), sans qu'il ait été possible d'isoler une règle
// de gel unique qui explique tous les écarts observés. Plutôt que de
// deviner cette règle, on importe directement la valeur réelle comme override
// manuel — même logique que le "jour de départ" CC (ccPosteRotationEngine) :
// la saisie réelle prime sur la simulation.
//
// Structure attendue (une par bloc, répétée pour chaque équipe) :
//   ligne "VACATION A" (ou B)      <- ouvre le bloc
//   lignes conducteurs (matricule, nom, prénom, R/C/vide par jour...)
//   ligne "NBR DE PRESENT"         <- ignorée ici
//   ligne "VACATION 1 OU 2"        <- ferme le bloc, "1" ou "2" par jour
// Tout ce qui suit la dernière ligne "VACATION 1 OU 2" (ex. le mini-tableau
// des stagiaires cavaliers, dupliqué sur chaque feuille) est hors bloc et
// ignoré, puisqu'aucun bloc n'est plus "ouvert" à ce stade du parcours.
function parseVacationLabelExcel(workbook, drivers, month, year, teamNom) {
  const XLSX = window.XLSX;
  const sheetName = selectShiftSheet(workbook, teamNom);
  const ws = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const { headerRowIdx, dayColumns } = detectDayColumns(rows, month, year, sheetName);
  const matchDriver = buildDriverMatcher(drivers);

  const blocks = [];
  let currentBlock = null;
  // Balaie TOUTE la feuille depuis le début, pas seulement après la ligne
  // d'en-tête (headerRowIdx) : le libellé "VACATION A" du tout premier bloc
  // est sur la ligne juste AU-DESSUS de l'en-tête (même ligne que "SHIFT 1"/
  // "SHIFT 3"/... — constaté en pratique), donc AVANT elle. Sans conséquence
  // pour les lignes qui précèdent : aucun matricule ne peut s'y trouver
  // (currentBlock reste null jusqu'au premier "VACATION A/B" rencontré).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    // Le libellé se trouve tantôt en colonne A, tantôt en colonne B selon
    // l'équipe (mise en forme du fichier non uniforme d'une feuille à
    // l'autre — constaté en pratique) : on regarde les deux.
    const label = (typeof row[0] === "string" ? row[0] : (typeof row[1] === "string" ? row[1] : "")).trim();
    if (/^VACATION\s*[AB]$/i.test(label)) {
      currentBlock = { driverIds: [], vacationByDay: {} };
      blocks.push(currentBlock);
      continue;
    }
    if (/VACATION\s*1\s*OU\s*2/i.test(label)) {
      if (currentBlock) {
        dayColumns.forEach(({ day, colIdx }) => {
          const v = row[colIdx];
          if (v === 1 || v === 2) currentBlock.vacationByDay[day] = v;
        });
        currentBlock = null;
      }
      continue;
    }
    if (!currentBlock) continue;
    const matCell = row[0];
    if (matCell === null || matCell === undefined || !MATRICULE_PATTERN.test(String(matCell).trim())) continue;
    const found = matchDriver(matCell, row[1], row[2]);
    if (found) currentBlock.driverIds.push(found.driver.id);
  }

  const corrections = [];
  blocks.forEach(block => {
    Object.keys(block.vacationByDay).forEach(dayStr => {
      const day = parseInt(dayStr, 10);
      const vacation = block.vacationByDay[day] === 1 ? "V1" : "V2";
      const iso = RTGDate.toISO(RTGDate.makeDate(year, month, day));
      block.driverIds.forEach(driverId => corrections.push({ driverId: driverId, iso: iso, vacation: vacation }));
    });
  });

  return {
    sheetName: sheetName,
    blocksFound: blocks.length,
    driversInBlocks: blocks.reduce((n, b) => n + b.driverIds.length, 0),
    corrections: corrections,
    // Composition RÉELLE des blocs ("VACATION A" = blocks[0], "VACATION B" =
    // blocks[1]...) — sert à corriger driver.initialVacation quand la
    // création en masse des conducteurs (parseConducteursFromShiftExcel,
    // pages2.js) l'a affecté par simple parité de position dans la feuille
    // (i % 2 === 0 ? "V1" : "V2") au lieu du VRAI bloc physique du fichier :
    // ça mélange deux conducteurs de blocs différents sous la même étiquette
    // V1/V2, ce qui fausse à la fois l'affichage (groupe Vacation 1/2 du
    // Planning Mensuel) ET la file QUAI/PARC (CcPosteRotationEngine.ccBlockKey,
    // qui utilise justement teamId+initialVacation pour ne jamais séparer un
    // bloc réel) — constaté en pratique sur GR HOUSSAM (TOURI, bloc A réel,
    // affiché à tort dans le groupe "Vacation 2").
    blocks: blocks.map(b => b.driverIds.slice())
  };
}

function ImportPlanningModal({ team, month, year, drivers, state, planning, onClose }) {
  const [step, setStep] = useState("pick");
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [congeResult, setCongeResult] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [vacationParsed, setVacationParsed] = useState(null);
  const [vacationParseError, setVacationParseError] = useState("");
  const [vacationApplyResult, setVacationApplyResult] = useState(null);
  const [blockApplyResult, setBlockApplyResult] = useState(null);

  const doReset = async () => {
    setStep("resetting");
    try {
      const result = await RTGStore.resetImportedRestData(team.id, month, year);
      setResetResult(result);
      setStep("resetDone");
    } catch (e) {
      setError(e.message || String(e));
      setStep("error");
    }
  };

  const doFullReset = async () => {
    setStep("resetting");
    try {
      const result = await RTGStore.resetMonthPlanningToBlank(team.id, month, year);
      setResetResult(result);
      setStep("resetDone");
    } catch (e) {
      setError(e.message || String(e));
      setStep("error");
    }
  };

  const [staleVacationResult, setStaleVacationResult] = useState(null);
  const doClearStaleVacation = async () => {
    setStep("resetting");
    try {
      const result = await RTGStore.bulkClearStaleVacationOverrides(team.id, month, year);
      setStaleVacationResult(result);
      setStep("staleVacationDone");
    } catch (e) {
      setError(e.message || String(e));
      setStep("error");
    }
  };

  const handleFile = async file => {
    setStep("parsing");
    setError("");
    try {
      await loadXlsxLib();
      const buf = await file.arrayBuffer();
      // Pas de cellDates: true — parseRepoCongeExcel lit les numéros de série
      // Excel bruts et les convertit lui-même en UTC (voir plus haut), pour
      // éviter toute ambiguïté de fuseau horaire dans la conversion interne
      // de SheetJS en objets Date.
      const wb = window.XLSX.read(buf, { type: "array" });
      setParsed(parseRepoCongeExcel(wb, drivers, month, year, team.nom));
      // Analysée en même temps (même fichier, même feuille) mais séparément :
      // une éventuelle erreur ici (structure de bloc "VACATION A/B" non
      // reconnue) ne doit jamais bloquer le flux repos/congés déjà fiable —
      // l'étape vacation est juste proposée en moins à la fin (voir "done").
      try {
        setVacationParsed(parseVacationLabelExcel(wb, drivers, month, year, team.nom));
        setVacationParseError("");
      } catch (e) {
        setVacationParsed(null);
        setVacationParseError(e.message || String(e));
      }
      setStep("preview");
    } catch (e) {
      setError(e.message || String(e));
      setStep("error");
    }
  };

  const congesToApply = useMemo(() => {
    if (!parsed) return [];
    return parsed.congeRanges.filter(r => !state.conges.some(c => c.driverId === r.driverId && c.dateDebut === r.dateDebut && c.dateFin === r.dateFin));
  }, [parsed, state.conges]);

  const maladiesToApply = useMemo(() => {
    if (!parsed) return [];
    return parsed.maladieRanges.filter(r => !state.maladies.some(m => m.driverId === r.driverId && m.dateDebut === r.dateDebut && m.dateFin === r.dateFin));
  }, [parsed, state.maladies]);

  // Case vide dans le fichier réel = conducteur présent ce jour-là : si
  // l'appli a de son côté un repos ce même jour (auto OU déjà forcé
  // manuellement — ex. un essai laissé par une édition case-par-case
  // antérieure, un import précédent, etc.), ce repos est erroné au regard
  // du planning réel et doit être annulé (remis en présence, avec le
  // shift/vacation/zone naturels de la rotation). Corriger aussi les REPOS
  // MANUAL est nécessaire : sinon un repos isolé déjà présent sur le jour
  // adjacent au vrai jour de repos du fichier (peu importe son origine)
  // bloque à tort l'application du bon jour comme "2 repos consécutifs"
  // (cas réel observé : AGUELMOUK — repos figé au 05/09 empêchait le 04/09,
  // le vrai jour, d'être appliqué). On ne touche jamais un jour à statut
  // fixe (congé/maladie/absence/formation/férié) : seul un REPOS est corrigé.
  const presenceCorrectionsToApply = useMemo(() => {
    if (!parsed || !planning) return [];
    return parsed.presentDays.filter(({ driverId, iso }) => {
      const day = planning.days.find(d => d.iso === iso);
      const a = day && day.assignments.find(x => x.driverId === driverId);
      if (!a) return false;
      if (a.status === "REPOS") return true;
      // Répare une correction précédente laissée sans zone par un bug déjà
      // corrigé (voir historique) : un import déjà passé par ici a pu créer
      // une correction manuelle PRESENT sans zone valide.
      if (a.status === "PRESENT" && a.source === "MANUAL" && !a.zone) return true;
      return false;
    });
  }, [parsed, planning]);

  // Ne force un repos manuel que si le planning actuellement calculé ce
  // jour-là n'est pas déjà REPOS, et jamais par-dessus une donnée fixe déjà
  // en place (congé/maladie/absence/formation/férié) — on ne veut jamais
  // faire disparaître une information déjà correcte dans l'appli. Vérifie
  // aussi qu'ajouter ce repos ne crée pas 2 repos consécutifs pour ce
  // conducteur (règle absolue, vérifiée sur données réelles — §RestDayEngine) :
  // les jours en conflit sont écartés, jamais appliqués silencieusement.
  const { reposToApply, reposConflicts } = useMemo(() => {
    if (!parsed || !planning) return { reposToApply: [], reposConflicts: [] };
    const candidates = parsed.reposDays.filter(({ driverId, iso }) => {
      const day = planning.days.find(d => d.iso === iso);
      const a = day && day.assignments.find(x => x.driverId === driverId);
      if (!a) return true;
      // Un REPOS déjà MANUEL sur ce jour est définitivement figé — inutile
      // de le réécrire. Un REPOS simplement AUTO qui tombe par coïncidence
      // sur le bon jour n'est PAS un statut figé : le quota mensuel du
      // conducteur est recalculé dynamiquement, et écrire d'autres repos ou
      // congés manuels ailleurs dans son mois peut faire disparaître ce
      // repos auto (le quota se retrouvant déjà satisfait par les jours
      // manuels) — déjà observé en pratique (AGUELMOUK : le 04/09, auto-
      // correct au moment de l'aperçu, redevenait "Travail" une fois les
      // autres jours du mois forcés). Il faut donc le figer en MANUEL lui
      // aussi, même s'il est "déjà correct" à cet instant précis.
      if (a.status === "REPOS" && a.source === "MANUAL") return false;
      if (["CONGE", "MALADIE", "ABSENCE", "FORMATION", "FERIE"].indexOf(a.status) !== -1) return false;
      return true;
    });

    const finalReposDaysByDriver = {};
    const dayOf = iso => RTGDate.parseISO(iso).getUTCDate();
    planning.days.forEach(day => {
      day.assignments.forEach(a => {
        if (a.status === "REPOS") (finalReposDaysByDriver[a.driverId] = finalReposDaysByDriver[a.driverId] || new Set()).add(dayOf(day.iso));
      });
    });
    presenceCorrectionsToApply.forEach(({ driverId, iso }) => {
      if (finalReposDaysByDriver[driverId]) finalReposDaysByDriver[driverId].delete(dayOf(iso));
    });
    candidates.forEach(({ driverId, iso }) => {
      (finalReposDaysByDriver[driverId] = finalReposDaysByDriver[driverId] || new Set()).add(dayOf(iso));
    });

    const toApply = [], conflicts = [];
    candidates.forEach(item => {
      const day = dayOf(item.iso);
      const set = finalReposDaysByDriver[item.driverId] || new Set();
      if (set.has(day - 1) || set.has(day + 1)) conflicts.push(item);
      else toApply.push(item);
    });
    return { reposToApply: toApply, reposConflicts: conflicts };
  }, [parsed, planning, presenceCorrectionsToApply]);

  // Réordonne les conducteurs de l'appli dans le même ordre que les lignes
  // du fichier, pour comparer facilement le Planning mensuel affiché avec
  // le fichier réel ligne à ligne.
  const orderCorrectionsToApply = useMemo(() => {
    if (!parsed) return [];
    return Object.keys(parsed.orderByDriver)
      .map(driverId => ({ driverId: driverId, ordre: parsed.orderByDriver[driverId] }))
      .filter(({ driverId, ordre }) => {
        const d = drivers.find(x => x.id === driverId);
        return d && d.ordreAffichage !== ordre;
      });
  }, [parsed, drivers]);

  // Bloc réel (VACATION A/B) de chaque conducteur, d'après le fichier —
  // corrige driver.initialVacation quand la création en masse des
  // conducteurs (pages2.js, ImportConducteursModal.apply) l'a affecté par
  // simple parité de position dans la feuille (i % 2, sans notion de bloc)
  // au lieu du vrai bloc physique : deux conducteurs de blocs réels
  // différents se retrouvent alors par hasard sous la même étiquette V1/V2,
  // ce qui fausse le groupe Vacation 1/2 affiché ET la file QUAI/PARC (CC),
  // qui s'appuie sur ce même champ (ccBlockKey) pour ne jamais séparer un
  // bloc réel. Constaté en pratique sur GR HOUSSAM (TOURI, bloc A réel,
  // affiché à tort dans le groupe "Vacation 2" à la place de HOMMANE, bloc B).
  const blockCorrectionsToApply = useMemo(() => {
    if (!vacationParsed || !vacationParsed.blocks || vacationParsed.blocks.length !== 2) return [];
    const [blockA, blockB] = vacationParsed.blocks;
    const currentLabel = driverId => {
      const d = drivers.find(x => x.id === driverId);
      return d ? (d.initialVacation === "V2" ? "V2" : "V1") : null;
    };
    // Teste les deux étiquetages possibles (bloc A=V1/bloc B=V2, ou l'inverse)
    // et retient celui qui demande le MOINS de changements — le sens exact
    // (V1 ou V2) n'a aucune importance pour la file QUAI/PARC, seule compte
    // la cohésion du bloc réel (jamais mélanger A et B sous la même étiquette).
    const countMismatches = (labelA, labelB) => {
      let n = 0;
      blockA.forEach(id => { if (currentLabel(id) !== labelA) n++; });
      blockB.forEach(id => { if (currentLabel(id) !== labelB) n++; });
      return n;
    };
    const [labelA, labelB] = countMismatches("V1", "V2") <= countMismatches("V2", "V1") ? ["V1", "V2"] : ["V2", "V1"];
    const corrections = [];
    blockA.forEach(id => { if (currentLabel(id) !== labelA) corrections.push({ driverId: id, to: labelA }); });
    blockB.forEach(id => { if (currentLabel(id) !== labelB) corrections.push({ driverId: id, to: labelB }); });
    return corrections;
  }, [vacationParsed, drivers]);

  const applyBlockCorrections = async () => {
    setStep("applyingBlock");
    const total = blockCorrectionsToApply.length;
    setProgress({ done: 0, total: total });
    let done = 0, errors = 0;
    for (const r of blockCorrectionsToApply) {
      try {
        await RTGStore.updateDriver(r.driverId, { initialVacation: r.to });
      } catch (e) { console.error(e); errors++; }
      done++; setProgress({ done: done, total: total });
    }
    setBlockApplyResult({ applied: blockCorrectionsToApply.length - errors, errors: errors });
    setStep("blockDone");
  };

  // Corrections de vacation (V1/V2) tirées de la ligne "VACATION 1 OU 2" du
  // fichier réel (parseVacationLabelExcel) — ne garder que les jours où le
  // conducteur est PRÉSENT (une vacation n'a pas de sens sinon, déjà à null)
  // ET où la valeur réelle diffère du calcul automatique actuel
  // (VacationRotationEngine), pour ne créer une affectation manuelle que là
  // où c'est nécessaire.
  const vacationCorrectionsToApply = useMemo(() => {
    if (!vacationParsed || !planning) return [];
    return vacationParsed.corrections.filter(({ driverId, iso, vacation }) => {
      const day = planning.days.find(d => d.iso === iso);
      const a = day && day.assignments.find(x => x.driverId === driverId);
      return a && a.status === "PRESENT" && a.vacation !== vacation;
    });
  }, [vacationParsed, planning]);

  const applyVacationCorrections = async () => {
    setStep("applyingVacation");
    const total = vacationCorrectionsToApply.length;
    setProgress({ done: 0, total: total });
    let done = 0, errors = 0;
    for (const r of vacationCorrectionsToApply) {
      try {
        const day = planning.days.find(d => d.iso === r.iso);
        const a = day.assignments.find(x => x.driverId === r.driverId);
        const vacDef = (state.config.vacations[a.shift] || []).find(v => v.id === r.vacation);
        // Conserve le shift/zone/poste déjà calculés (inchangés par la
        // vacation) — seuls la vacation et l'horaire qui en dépend changent.
        // setManualOverride REMPLACE la ligne entière : reprendre les autres
        // champs tels quels est indispensable pour ne pas les effacer à tort.
        const override = { status: "PRESENT", shift: a.shift, vacation: r.vacation, zone: a.zone, startTime: vacDef ? vacDef.start : a.startTime, endTime: vacDef ? vacDef.end : a.endTime };
        await RTGStore.setManualOverride(r.iso, r.driverId, override, RTG_IMPORT_OVERRIDE_MOTIF, "vacation réelle (fichier, ligne \"VACATION 1 OU 2\") — " + team.nom + " — " + r.iso);
      } catch (e) { console.error(e); errors++; }
      done++; setProgress({ done: done, total: total });
    }
    setVacationApplyResult({ applied: vacationCorrectionsToApply.length - errors, errors: errors });
    setStep("vacationDone");
  };

  // Congés ET maladies sont créés dans une étape à part, AVANT de calculer
  // les repos à forcer : RestDayEngine (placement automatique des repos)
  // tient compte de ces deux statuts figés pour exclure ces jours et
  // réduire le quota mensuel du conducteur — tant qu'ils n'ont pas été
  // effectivement écrits en base et que l'appli n'a pas recalculé le
  // planning en conséquence, reposToApply/reposConflicts raisonnent encore
  // sur l'ancien planning (sans eux), qui peut placer ou voir des repos
  // automatiques à des jours qui n'existeront plus une fois pris en compte
  // — d'où des rejets "2 repos consécutifs" fantômes ou des repos qui se
  // replacent ailleurs (cas réel observé : SMIDI, gros congé de 13 jours,
  // le repos du 14/09 rejeté à tort puis réapparu plus loin dans le mois).
  // Passer par une étape séparée, avec un nouveau rendu entre les deux,
  // garantit que le planning utilisé pour calculer les repos reflète déjà
  // les congés/maladies de cet import.
  const applyFixedAbsences = async () => {
    setStep("applyingConges");
    const total = congesToApply.length + maladiesToApply.length;
    setProgress({ done: 0, total: total });
    let done = 0, congeErrors = 0, maladieErrors = 0;
    for (const r of congesToApply) {
      try {
        await RTGStore.addConge({ driverId: r.driverId, dateDebut: r.dateDebut, dateFin: r.dateFin, commentaire: RTG_IMPORT_CONGE_COMMENT });
      } catch (e) { console.error(e); congeErrors++; }
      done++; setProgress({ done: done, total: total });
    }
    for (const r of maladiesToApply) {
      try {
        await RTGStore.addMaladie({ driverId: r.driverId, dateDebut: r.dateDebut, dateFin: r.dateFin, commentaire: RTG_IMPORT_MALADIE_COMMENT });
      } catch (e) { console.error(e); maladieErrors++; }
      done++; setProgress({ done: done, total: total });
    }
    setCongeResult({ congesCreated: congesToApply.length - congeErrors, maladiesCreated: maladiesToApply.length - maladieErrors, congeErrors: congeErrors, maladieErrors: maladieErrors });
    setStep("congesApplied");
  };

  const applyRest = async () => {
    setStep("applying");
    const total = reposToApply.length + presenceCorrectionsToApply.length + orderCorrectionsToApply.length;
    setProgress({ done: 0, total: total });
    let done = 0, reposErrors = 0, presenceErrors = 0, orderErrors = 0;
    for (const r of reposToApply) {
      try {
        await RTGStore.setManualOverride(r.iso, r.driverId, { status: "REPOS", shift: null, vacation: null, zone: null, startTime: null, endTime: null }, RTG_IMPORT_OVERRIDE_MOTIF, team.nom + " — " + r.iso);
      } catch (e) { console.error(e); reposErrors++; }
      done++; setProgress({ done: done, total: total });
    }
    // Zones déjà occupées par créneau (jour+shift+vacation), pour ne jamais
    // donner à un conducteur corrigé ici (REPOS -> PRESENT) la même zone
    // qu'un autre conducteur déjà présent ce jour-là sur le même créneau —
    // ZoneBalancingEngine (répartition de groupe) a déjà tourné pour ces
    // autres présents SANS savoir que ce conducteur-ci allait s'y ajouter
    // (son statut AUTO était REPOS au moment de ce calcul), donc lui donner
    // une zone "individuelle" (rotation seule) peut entrer en collision avec
    // une zone déjà prise, ou doubler la zone A alors que d'autres zones
    // restent libres (cas réel observé : GR AZZAM, zone A occupée par 2
    // conducteurs, zones D/H inoccupées). Rempli une fois par créneau à
    // partir du planning actuel, puis mis à jour au fil des corrections de
    // cette boucle pour éviter aussi les collisions entre elles.
    const slotZoneCounts = {};
    for (const r of presenceCorrectionsToApply) {
      try {
        const date = RTGDate.parseISO(r.iso);
        const driver = drivers.find(d => d.id === r.driverId);
        const shift = ShiftRotationEngine.getTeamShiftForDate(team, date, state.config);
        const vacation = VacationRotationEngine.getVacationForDate(driver, date, state, team);
        const vacDef = (state.config.vacations[shift] || []).find(v => v.id === vacation);

        const slotKey = r.iso + "_" + shift + "_" + vacation;
        if (!slotZoneCounts[slotKey]) {
          const day = planning.days.find(d => d.iso === r.iso);
          const counts = {};
          (day ? day.assignments : [])
            .filter(a => a.status === "PRESENT" && a.shift === shift && a.vacation === vacation && a.zone)
            .forEach(a => { counts[a.zone] = (counts[a.zone] || 0) + 1; });
          slotZoneCounts[slotKey] = counts;
        }
        const counts = slotZoneCounts[slotKey];
        const zoneList = zonesForFleet(state.config, (team && team.typeEngin) || "RTG") || [];
        const others = zoneList.slice(1); // B..H — la zone A n'est jamais prioritaire en premier.
        // Même ordre de doublement que ZoneBalancingEngine (DOUBLING_ORDER) :
        // d'abord toute zone B-H encore totalement libre, puis — au-delà de
        // 8 présents sur ce créneau — celle qui a REÇU LE MOINS de doublons
        // jusqu'ici, départagée par cet ordre (D, C, B, E, F, G, H, puis A en
        // tout dernier).
        const doublingOrder = DOUBLING_ORDER.filter(z => others.indexOf(z) !== -1)
          .concat(others.filter(z => DOUBLING_ORDER.indexOf(z) === -1))
          .concat([zoneList[0]]);
        let zone = others.find(z => !counts[z]);
        if (!zone) {
          const minCount = Math.min(...doublingOrder.map(z => counts[z] || 0));
          zone = doublingOrder.find(z => (counts[z] || 0) === minCount);
        }
        if (!zone) {
          // Cas extrême (zoneList vide) : repli sur la rotation individuelle habituelle.
          zone = ZoneRotationEngine.getExpectedZoneForDate(driver, date, state, state.teams);
        }
        counts[zone] = (counts[zone] || 0) + 1;

        const override = { status: "PRESENT", shift: shift, vacation: vacation, zone: zone, startTime: vacDef ? vacDef.start : null, endTime: vacDef ? vacDef.end : null };
        await RTGStore.setManualOverride(r.iso, r.driverId, override, RTG_IMPORT_OVERRIDE_MOTIF, "repos annulé (présent réel) — " + team.nom + " — " + r.iso);
      } catch (e) { console.error(e); presenceErrors++; }
      done++; setProgress({ done: done, total: total });
    }
    for (const r of orderCorrectionsToApply) {
      try {
        await RTGStore.updateDriver(r.driverId, { ordreAffichage: r.ordre });
      } catch (e) { console.error(e); orderErrors++; }
      done++; setProgress({ done: done, total: total });
    }
    setApplyResult({
      reposApplied: reposToApply.length - reposErrors,
      presenceCorrected: presenceCorrectionsToApply.length - presenceErrors,
      orderUpdated: orderCorrectionsToApply.length - orderErrors,
      reposErrors: reposErrors, presenceErrors: presenceErrors, orderErrors: orderErrors
    });
    setStep("done");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={["applying", "applyingConges", "applyingVacation", "applyingBlock", "resetting"].indexOf(step) !== -1 ? undefined : onClose}>
      <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-slate-900 font-semibold text-sm">Importer Repos &amp; Congés depuis Excel</h3>
          {["applying", "applyingConges", "applyingVacation", "applyingBlock", "resetting"].indexOf(step) === -1 && <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><i className="fas fa-xmark"></i></button>}
        </div>
        <p className="text-xs text-slate-400 mb-3">Équipe <span className="text-slate-900 font-medium">{team.nom}</span> — {RAPPORT_MOIS_LABELS_P[month - 1]} {year}</p>

        {step === "pick" && (
          <div>
            <p className="text-xs text-slate-400 mb-3">Sélectionnez le fichier Excel (.xlsx) du planning réel : les repos (« R ») seront forcés manuellement et les congés (« C ») créés comme périodes de congé, uniquement pour les conducteurs de cette équipe et ce mois.</p>
            <input type="file" accept=".xlsx" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} className="block w-full text-xs text-slate-600" />
            <div className="mt-4 pt-3 border-t border-slate-200 space-y-1.5">
              <button onClick={() => setStep("resetConfirm")} className="block text-[11px] text-red-400 hover:text-red-700 underline">
                Réinitialiser les repos/congés déjà importés pour cette équipe et ce mois
              </button>
              <button onClick={() => setStep("fullResetConfirm")} className="block text-[11px] text-red-400 hover:text-red-700 underline">
                Remise à zéro complète du planning (repos + congés + maladies, y compris modifications manuelles) pour cette équipe et ce mois
              </button>
              <button onClick={() => setStep("staleVacationConfirm")} className="block text-[11px] text-sky-400 hover:text-sky-700 underline">
                Corriger les vacations (V1/V2) devenues obsolètes après une mise à jour du moteur, pour cette équipe et ce mois
              </button>
            </div>
          </div>
        )}

        {step === "staleVacationConfirm" && (
          <div className="space-y-3">
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <i className="fas fa-triangle-exclamation mr-1.5"></i>Recherche, parmi les affectations manuelles "Présent" de <span className="text-slate-900 font-medium">{team.nom}</span> — {RAPPORT_MOIS_LABELS_P[month - 1]} {year}, celles dont la vacation (V1/V2) ne correspond plus au calcul automatique à jour, et les supprime (le calcul automatique corrigé s'applique alors). Les repos, congés et remplacements forcés manuellement ne sont jamais touchés.
            </p>
            <div className="flex gap-2">
              <button onClick={doClearStaleVacation} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Rechercher et corriger</button>
              <button onClick={() => setStep("pick")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        )}

        {step === "staleVacationDone" && staleVacationResult && (
          <div className="space-y-2 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{staleVacationResult.cleared} affectation(s) obsolète(s) corrigée(s) sur {staleVacationResult.checked} vérifiée(s).</p>
            <button onClick={() => setStep("pick")} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Fermer</button>
          </div>
        )}

        {step === "resetConfirm" && (
          <div className="space-y-3">
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              <i className="fas fa-triangle-exclamation mr-1.5"></i>Ceci supprime tous les repos forcés et congés créés par un import Excel pour <span className="text-slate-900 font-medium">{team.nom}</span> — {RAPPORT_MOIS_LABELS_P[month - 1]} {year}, pour repartir d'une base propre avant de réimporter. Les autres modifications (Remplacement, édition manuelle case par case sans import, congés saisis normalement) ne sont pas touchées.
            </p>
            <div className="flex gap-2">
              <button onClick={doReset} className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700">Confirmer la suppression</button>
              <button onClick={() => setStep("pick")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        )}

        {step === "fullResetConfirm" && (
          <div className="space-y-3">
            <p className="text-xs text-red-700 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <i className="fas fa-triangle-exclamation mr-1.5"></i><span className="font-semibold">Action plus radicale.</span> Ceci supprime TOUTES les affectations manuelles (import Excel, équilibrage V1/V2 case par case, remplacement...), TOUS les congés et TOUTES les maladies touchant <span className="text-slate-900 font-medium">{team.nom}</span> — {RAPPORT_MOIS_LABELS_P[month - 1]} {year}. Le planning redevient entièrement calculé par l'algorithme (aucune trace manuelle) avant réimport. Utile si une modification manuelle antérieure fausse encore le résultat après une réinitialisation simple.
            </p>
            <div className="flex gap-2">
              <button onClick={doFullReset} className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700">Confirmer la remise à zéro complète</button>
              <button onClick={() => setStep("pick")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        )}

        {step === "resetting" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Suppression en cours…</p>}

        {step === "resetDone" && resetResult && (
          <div className="space-y-2 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{resetResult.overridesDeleted} affectation(s), {resetResult.congesDeleted} congé(s){resetResult.maladiesDeleted !== undefined ? " et " + resetResult.maladiesDeleted + " maladie(s)" : ""} supprimé(s).</p>
            <button onClick={() => setStep("pick")} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Importer maintenant</button>
          </div>
        )}

        {step === "parsing" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Analyse du fichier…</p>}

        {step === "error" && (
          <div>
            <p className="text-sm text-red-700 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
            <button onClick={() => setStep("pick")} className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-600 hover:text-white">Réessayer</button>
          </div>
        )}

        {step === "preview" && parsed && (
          <div className="space-y-3 text-xs text-slate-600">
            <p>Feuille utilisée : <span className="text-slate-900">{parsed.sheetName}</span> (ligne d'en-tête : {parsed.headerRowNumber})</p>
            <p className="text-slate-500">Vérification colonnes détectées — jour 1 : colonne {parsed.dayColumnsInfo[0] && parsed.dayColumnsInfo[0].col} ; jour {parsed.dayColumnsInfo.length}: colonne {parsed.dayColumnsInfo[parsed.dayColumnsInfo.length - 1] && parsed.dayColumnsInfo[parsed.dayColumnsInfo.length - 1].col}. Comparez avec le fichier Excel avant d'appliquer si un doute persiste.</p>
            <p>{parsed.matchedCount} conducteur(s) de l'équipe reconnu(s) dans le fichier.</p>
            {parsed.unmatchedMatricules.length > 0 && (
              <p className="text-amber-400">Matricules non reconnus dans cette équipe : {parsed.unmatchedMatricules.join(", ")}</p>
            )}
            {parsed.fallbackMatches.length > 0 && (
              <p className="text-sky-700">Matricule différent mais conducteur reconnu par {parsed.fallbackMatches[0].via === "nom" ? "nom" : "numéro"} : {parsed.fallbackMatches.map(f => f.nom + " " + f.prenom + " (fichier " + f.matriculeFichier + " → appli " + f.matriculeAppli + ")").join(", ")}</p>
            )}
            <p><span className="text-slate-900 font-semibold">{congesToApply.length}</span> plage(s) de congé à créer{parsed.congeRanges.length !== congesToApply.length ? " (" + (parsed.congeRanges.length - congesToApply.length) + " déjà existante(s), ignorée(s))" : ""}.</p>
            <p><span className="text-slate-900 font-semibold">{maladiesToApply.length}</span> plage(s) de maladie à créer{parsed.maladieRanges.length !== maladiesToApply.length ? " (" + (parsed.maladieRanges.length - maladiesToApply.length) + " déjà existante(s), ignorée(s))" : ""}.</p>
            {parsed.unknownCodes.length > 0 && (
              <p className="text-amber-400">Codes non reconnus ignorés : {parsed.unknownCodes.slice(0, 8).map(u => u.matricule + "/j" + u.day + "=" + u.code).join(", ")}{parsed.unknownCodes.length > 8 ? "…" : ""}</p>
            )}
            <p className="text-slate-500">
              <i className="fas fa-circle-info mr-1.5"></i>Congés et maladies sont créés d'abord, séparément : le calcul des repos à forcer doit se baser sur le planning déjà à jour avec ces statuts figés (ils réduisent le quota de repos et libèrent des jours), sans quoi des repos peuvent être rejetés ou mal placés à tort.
            </p>
            <div className="flex gap-2 pt-2">
              {(congesToApply.length > 0 || maladiesToApply.length > 0) ? (
                <button onClick={applyFixedAbsences} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Créer congés/maladies et continuer</button>
              ) : (
                <button onClick={() => setStep("previewRepos")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Continuer</button>
              )}
              <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        )}

        {step === "applyingConges" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Création des congés/maladies en cours… {progress.done}/{progress.total}</p>}

        {step === "congesApplied" && congeResult && (
          <div className="space-y-3 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{congeResult.congesCreated} congé(s) et {congeResult.maladiesCreated} maladie(s) créé(s).</p>
            {(congeResult.congeErrors > 0 || congeResult.maladieErrors > 0) && <p className="text-red-700">{congeResult.congeErrors + congeResult.maladieErrors} erreur(s) — voir la console.</p>}
            <button onClick={() => setStep("previewRepos")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Continuer vers les repos</button>
          </div>
        )}

        {step === "previewRepos" && parsed && (
          <div className="space-y-3 text-xs text-slate-600">
            <p><span className="text-slate-900 font-semibold">{reposToApply.length}</span> repos à forcer manuellement{parsed.reposDays.length !== reposToApply.length + reposConflicts.length ? " (" + (parsed.reposDays.length - reposToApply.length - reposConflicts.length) + " déjà correct(s), ignoré(s))" : ""}.</p>
            {reposConflicts.length > 0 && (
              <p className="text-red-700">
                <i className="fas fa-triangle-exclamation mr-1.5"></i>{reposConflicts.length} repos NON appliqué(s) car ils créeraient 2 repos consécutifs (règle absolue) : {reposConflicts.slice(0, 8).map(c => {
                  const d = drivers.find(x => x.id === c.driverId);
                  return (d ? d.nom : c.driverId) + "/" + c.iso.slice(8, 10);
                }).join(", ")}{reposConflicts.length > 8 ? "…" : ""} — à vérifier manuellement.
              </p>
            )}
            <p><span className="text-slate-900 font-semibold">{presenceCorrectionsToApply.length}</span> repos actuellement présents dans l'appli (auto ou déjà forcés manuellement) seront annulés (remis en présence), car le fichier indique que le conducteur travaillait ce jour-là.</p>
            <details className="text-slate-500">
              <summary className="cursor-pointer hover:text-slate-600">Détail des repos détectés dans le fichier, par conducteur (vérification)</summary>
              <div className="mt-1.5 max-h-48 overflow-y-auto space-y-0.5">
                {(() => {
                  const toApplyKeys = new Set(reposToApply.map(r => r.driverId + "_" + r.iso));
                  const conflictKeys = new Set(reposConflicts.map(r => r.driverId + "_" + r.iso));
                  return parsed.reposDays.slice().sort((a, b) => a.iso.localeCompare(b.iso)).map((r, idx) => {
                    const d = drivers.find(x => x.id === r.driverId);
                    const key = r.driverId + "_" + r.iso;
                    let verdict, cls;
                    if (conflictKeys.has(key)) { verdict = "REJETÉ (conflit 2 repos consécutifs)"; cls = "text-red-700"; }
                    else if (toApplyKeys.has(key)) { verdict = "sera forcé"; cls = "text-emerald-400"; }
                    else { verdict = "déjà correct, ignoré"; cls = "text-slate-500"; }
                    return <div key={idx} className={cls}>{(d ? d.matricule + " " + d.nom : r.driverId)} — {r.iso.slice(8, 10)}/{r.iso.slice(5, 7)} — {verdict}</div>;
                  });
                })()}
              </div>
            </details>
            <p><span className="text-slate-900 font-semibold">{orderCorrectionsToApply.length}</span> conducteur(s) seront réordonnés dans le Planning mensuel pour correspondre à l'ordre des lignes du fichier.</p>
            <div className="flex gap-2 pt-2">
              <button onClick={applyRest} disabled={reposToApply.length === 0 && presenceCorrectionsToApply.length === 0 && orderCorrectionsToApply.length === 0} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">Appliquer</button>
              <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        )}

        {step === "applying" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Application en cours… {progress.done}/{progress.total}</p>}

        {step === "done" && applyResult && (
          <div className="space-y-2 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{congeResult ? congeResult.congesCreated + " congé(s) et " + congeResult.maladiesCreated + " maladie(s) créé(s), " : ""}{applyResult.reposApplied} repos forcé(s), {applyResult.presenceCorrected} repos auto annulé(s) (remis en présence), {applyResult.orderUpdated} conducteur(s) réordonné(s).</p>
            {(applyResult.reposErrors > 0 || applyResult.presenceErrors > 0 || applyResult.orderErrors > 0) && <p className="text-red-700">{applyResult.reposErrors + applyResult.presenceErrors + applyResult.orderErrors} erreur(s) — voir la console.</p>}
            {vacationParsed ? (
              <button onClick={() => setStep("previewBlock")} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Continuer vers les blocs et vacations (V1/V2)</button>
            ) : (
              vacationParseError && <p className="text-slate-500"><i className="fas fa-circle-info mr-1.5"></i>Ligne "VACATION 1 OU 2" non exploitée ({vacationParseError}).</p>
            )}
            <button onClick={onClose} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-600 hover:text-white">Fermer</button>
          </div>
        )}

        {step === "previewBlock" && vacationParsed && (
          <div className="space-y-3 text-xs text-slate-600">
            <p className="text-slate-500">
              <i className="fas fa-circle-info mr-1.5"></i>Vérifie que chaque conducteur a bien l'étiquette V1/V2 de son VRAI bloc physique ("VACATION A"/"VACATION B" du fichier) — une création en masse antérieure a pu l'affecter par simple parité de position, mélangeant par erreur des conducteurs de blocs différents (ce qui fausse aussi le groupe Vacation 1/2 affiché et la file QUAI/PARC).
            </p>
            <p><span className="text-slate-900 font-semibold">{blockCorrectionsToApply.length}</span> conducteur(s) seront réaffecté(s) à leur vrai bloc.</p>
            {blockCorrectionsToApply.length > 0 && (
              <details className="text-slate-500">
                <summary className="cursor-pointer hover:text-slate-600">Détail (vérification)</summary>
                <div className="mt-1.5 max-h-48 overflow-y-auto space-y-0.5">
                  {blockCorrectionsToApply.map((r, idx) => {
                    const d = drivers.find(x => x.id === r.driverId);
                    return <div key={idx}>{(d ? d.matricule + " " + d.nom : r.driverId)} — {(d ? d.initialVacation : "?")} → {r.to}</div>;
                  })}
                </div>
              </details>
            )}
            <div className="flex gap-2 pt-2">
              {blockCorrectionsToApply.length > 0 ? (
                <button onClick={applyBlockCorrections} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Appliquer</button>
              ) : (
                <button onClick={() => setStep("previewVacation")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Continuer</button>
              )}
              <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Fermer</button>
            </div>
          </div>
        )}

        {step === "applyingBlock" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Correction des blocs en cours… {progress.done}/{progress.total}</p>}

        {step === "blockDone" && blockApplyResult && (
          <div className="space-y-2 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{blockApplyResult.applied} conducteur(s) réaffecté(s) à leur vrai bloc.</p>
            {blockApplyResult.errors > 0 && <p className="text-red-700">{blockApplyResult.errors} erreur(s) — voir la console.</p>}
            <button onClick={() => setStep("previewVacation")} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Continuer vers les vacations (V1/V2)</button>
          </div>
        )}

        {step === "previewVacation" && vacationParsed && (
          <div className="space-y-3 text-xs text-slate-600">
            <p className="text-slate-500">
              <i className="fas fa-circle-info mr-1.5"></i>Lit la ligne "VACATION 1 OU 2" du fichier (vérité terrain tenue à la main par l'exploitant) pour chaque bloc "VACATION A"/"VACATION B", et corrige la vacation (V1/V2) affichée par l'appli quand elle diverge du calcul automatique.
            </p>
            <p>{vacationParsed.blocksFound} bloc(s) détecté(s) ({vacationParsed.driversInBlocks} conducteur(s) au total).</p>
            <p><span className="text-slate-900 font-semibold">{vacationCorrectionsToApply.length}</span> jour(s)/conducteur(s) où la vacation réelle diffère du calcul automatique et sera corrigée{vacationParsed.corrections.length !== vacationCorrectionsToApply.length ? " (" + (vacationParsed.corrections.length - vacationCorrectionsToApply.length) + " déjà correct(s) ou non applicable(s), ignoré(s))" : ""}.</p>
            {vacationCorrectionsToApply.length > 0 && (
              <details className="text-slate-500">
                <summary className="cursor-pointer hover:text-slate-600">Détail des corrections (vérification)</summary>
                <div className="mt-1.5 max-h-48 overflow-y-auto space-y-0.5">
                  {vacationCorrectionsToApply.slice().sort((a, b) => a.iso.localeCompare(b.iso)).map((r, idx) => {
                    const d = drivers.find(x => x.id === r.driverId);
                    return <div key={idx}>{(d ? d.matricule + " " + d.nom : r.driverId)} — {r.iso.slice(8, 10)}/{r.iso.slice(5, 7)} → {r.vacation}</div>;
                  })}
                </div>
              </details>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={applyVacationCorrections} disabled={vacationCorrectionsToApply.length === 0} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">Appliquer</button>
              <button onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Fermer</button>
            </div>
          </div>
        )}

        {step === "applyingVacation" && <p className="text-sm text-slate-600"><i className="fas fa-spinner fa-spin mr-2"></i>Correction des vacations en cours… {progress.done}/{progress.total}</p>}

        {step === "vacationDone" && vacationApplyResult && (
          <div className="space-y-2 text-xs">
            <p className="text-emerald-400"><i className="fas fa-circle-check mr-1.5"></i>{vacationApplyResult.applied} vacation(s) corrigée(s).</p>
            {vacationApplyResult.errors > 0 && <p className="text-red-700">{vacationApplyResult.errors} erreur(s) — voir la console.</p>}
            <button onClick={onClose} className="mt-2 px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-600 hover:text-white">Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Utilisateur connecté (§30) — null si personne n'est connecté (AuthGate
// affiche alors l'écran de connexion à la place de l'appli).
function useCurrentUser() {
  const state = useRtgState();
  return state.users.find(u => u.id === state.currentUserId) || null;
}

const ROLE_LABELS = { ADMIN: "Administrateur", RESPONSABLE: "Responsable Exploitation", RESPONSABLE_SHIFT: "Responsable de Shift", CONDUCTEUR: "Conducteur" };

// Un Responsable de Shift ne voit/agit que sur SON équipe (teamId) ; les autres
// rôles (Admin, Responsable) ont accès à toutes les équipes — §30.
function isShiftRestricted(user) {
  return !!user && user.role === "RESPONSABLE_SHIFT";
}

// Un Conducteur n'a accès qu'à un jeu de pages restreint : "Mon planning",
// "Mes congés" (§37/§38), et — comme un Responsable de Shift, mais en
// lecture seule — Planning mensuel et Affectation du jour de SON équipe
// (§39, demande explicite de l'exploitant : le conducteur veut voir le
// planning de son shift, pas seulement sa propre ligne).
function isDriverRestricted(user) {
  return !!user && user.role === "CONDUCTEUR";
}

// Vrai pour RESPONSABLE_SHIFT (équipe) ET CONDUCTEUR (déduite de sa fiche
// conducteur) — les deux rôles dont l'accès à Planning mensuel/Affectation
// du jour se limite à UNE équipe. Le Conducteur reste en lecture seule
// (canEditPlanning ne liste pas CONDUCTEUR — voir PlanningMensuel).
function isTeamRestricted(user) {
  return isShiftRestricted(user) || isDriverRestricted(user);
}

// Équipe effective pour ce filtrage : team_id direct pour RESPONSABLE_SHIFT,
// déduite de la fiche conducteur liée pour CONDUCTEUR.
function restrictedTeamId(user, state) {
  if (isShiftRestricted(user)) return user.teamId;
  if (isDriverRestricted(user)) {
    const driver = state.drivers.find(d => d.id === user.driverId);
    return driver ? driver.teamId : null;
  }
  return null;
}

// Équipes visibles compte tenu de la flotte sélectionnée (bascule RTG/CC,
// barre latérale — § module Chariots Cavalier) ET de la restriction
// éventuelle à une seule équipe (Responsable de Shift / Conducteur) : les
// deux filtres sont indépendants, un compte restreint voit toujours SA
// équipe, quelle que soit la flotte affichée par ailleurs.
function fleetTeams(state, restrictedTeamIdValue) {
  if (restrictedTeamIdValue) return state.teams.filter(t => t.id === restrictedTeamIdValue);
  return state.teams.filter(t => (t.typeEngin || "RTG") === state.currentFleet);
}

function fleetTeamIdSet(state, restrictedTeamIdValue) {
  return new Set(fleetTeams(state, restrictedTeamIdValue).map(t => t.id));
}

// ==========================================
// Codes / légende
// ==========================================
const RTG_STATUS_META = {
  PRESENT: { code: "C", label: "Travail", className: "bg-amber-500/25 text-amber-700 border-amber-500/40" },
  REPOS: { code: "R", label: "Repos", className: "bg-rose-500/20 text-rose-700 border-rose-500/30" },
  CONGE: { code: "CG", label: "Congé", className: "bg-orange-600/30 text-orange-700 border-orange-600/40" },
  MALADIE: { code: "M", label: "Maladie", className: "bg-purple-600/30 text-purple-700 border-purple-600/40" },
  ABSENCE: { code: "A", label: "Absence", className: "bg-red-600/30 text-red-700 border-red-600/40" },
  FORMATION: { code: "F", label: "Formation", className: "bg-blue-600/30 text-blue-700 border-blue-600/40" },
  OFF: { code: "OFF", label: "Off (Shift 3 dimanche)", className: "bg-slate-950 text-slate-500 border-slate-800" },
  FERIE: { code: "FÉR", label: "Jour férié (chômé)", className: "bg-indigo-500/25 text-indigo-700 border-indigo-500/40" }
};

// Couleurs pastel (imprimables — consommation d'encre raisonnable) pour le
// rapport Planning mensuel papier/PDF, reprenant l'esprit des couleurs déjà
// utilisées à l'écran (RTG_STATUS_META) pour chaque statut. PRESENT n'a pas
// de couleur : la case reste vierge (volontairement, cf. VacationGroupTablePrintable).
const PRINT_STATUS_BG = {
  REPOS: "#fecdd3",
  CONGE: "#fed7aa",
  MALADIE: "#e9d5ff",
  ABSENCE: "#fecaca",
  FORMATION: "#bfdbfe",
  OFF: "#e2e8f0",
  FERIE: "#c7d2fe"
};

// Styles pour les rapports imprimables ("papier" clair, indépendant du thème
// sombre de l'appli) — même convention que le Rapport RH (pages2.js).
const PRINT_TH = "px-2 py-1.5 text-left font-semibold border-b-2 border-slate-300 whitespace-nowrap";
const PRINT_TH_CENTER = PRINT_TH + " text-center";
const PRINT_TD = "px-2 py-1 border-b border-slate-200 whitespace-nowrap";
const PRINT_TD_CENTER = PRINT_TD + " text-center";
// Variante sans "whitespace-nowrap" (autorise le retour à la ligne) pour les
// colonnes Nom/Prénom/Équipe d'un tableau à largeurs de colonnes FIXES
// (table-layout: fixed) — un nom un peu long doit passer à la ligne plutôt
// que déborder de sa colonne et casser l'alignement avec le tableau d'à côté.
const PRINT_TD_WRAP = "px-2 py-1 border-b border-slate-200 break-words";
// Lignes alternées blanc / bleu ciel sur les tableaux imprimables de
// conducteurs — demande explicite de l'exploitant, pour mieux distinguer
// visuellement chaque ligne sur un rapport papier/PDF. Fusionné avec la
// couleur d'alerte "vacation en surnombre" (texte rouge) quand elle
// s'applique — les deux peuvent coexister sur une même ligne.
const PRINT_ROW_ALT_BG = "#e0f2fe";
function printRowStyle(index, vacationBalanceAlert) {
  const style = {};
  if (index % 2 === 1) style.backgroundColor = PRINT_ROW_ALT_BG;
  if (vacationBalanceAlert) style.color = "#b91c1c";
  return style;
}
// Variante compacte (Planning mensuel imprimable) : bordures fines partout
// (comme le modèle Excel réel) et espacement minimal, pour faire tenir un
// mois complet (jusqu'à 31 jours) sur une seule page malgré un nombre de
// conducteurs important.
const PRINT_TH_XS = "border border-slate-400 px-1 py-1 text-left font-semibold whitespace-nowrap align-middle";
const PRINT_TD_XS = "border border-slate-300 px-1 py-1 whitespace-nowrap align-middle";
const PRINT_TD_XS_CENTER = PRINT_TD_XS + " text-center";
const RAPPORT_MOIS_LABELS_P = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

// Export Excel des rapports — CSV avec séparateur ";" (convention Excel FR,
// où "," est le séparateur décimal) et BOM UTF-8 pour que les accents
// s'affichent correctement à l'ouverture dans Excel.
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers, ...rows].map(r => r.map(escape).join(";"));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ExportExcelButton({ onClick }) {
  return (
    <button onClick={onClick} className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
      <i className="fas fa-file-excel mr-1.5"></i>Excel
    </button>
  );
}

// Export PDF direct (§ rapports imprimables) — remplace le bouton "Imprimer"
// (qui ne faisait qu'ouvrir la boîte de dialogue d'impression du navigateur,
// où "Enregistrer en PDF" n'était qu'une option parmi d'autres) par un vrai
// téléchargement de fichier .pdf en un clic : capture le bloc "papier" du
// rapport (html2canvas) puis l'insère dans un document PDF paysage A4
// (jsPDF), sur autant de pages que nécessaire. Chargées à la demande
// (comme SheetJS pour l'import Excel) pour ne pas alourdir le chargement
// initial de l'appli pour un usage occasionnel.
let _pdfLibsPromise = null;
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Impossible de charger " + src + " (connexion internet requise)."));
    document.head.appendChild(script);
  });
}
function loadPdfLibs() {
  if (window.jspdf && window.html2canvas) return Promise.resolve();
  if (_pdfLibsPromise) return _pdfLibsPromise;
  _pdfLibsPromise = Promise.all([
    loadScriptOnce("https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"),
    loadScriptOnce("https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js")
  ]);
  return _pdfLibsPromise;
}

// Rend temporairement visible un bloc "papier" (print-report, normalement
// display:none à l'écran, affiché seulement par la règle @media print —
// html2canvas ne peut capturer que ce qui est effectivement rendu), le
// capture en PNG, puis remet son état d'origine dans tous les cas (y compris
// en cas d'erreur). Largeur forcée pendant la capture : sinon un enfant plus
// large que le contenu principal (ex. le titre de l'en-tête) peut élargir
// tout le conteneur capturé, laissant un vide à droite du contenu réel une
// fois étiré à la page.
async function captureNodeAsPng(node, forceWidth) {
  // Toujours forcer une largeur explicite (1200px par défaut) pendant la
  // capture — jamais laisser le nœud sans largeur : un bloc normalement
  // display:none, rendu position:fixed hors-écran sans largeur fixée,
  // n'a pas de base fiable pour résoudre son width:auto (dépend du
  // navigateur/moteur de rendu) — peut donner un canvas ENORME (fichier PDF
  // final de plusieurs dizaines de Mo) ou au contraire réduit à son contenu
  // le plus étroit (rendu minuscule dans un coin de la page une fois
  // "fit-to-page"), selon le cas. Bug de régression réel rencontré ici :
  // exportNodesAsPdf appelait cette fonction SANS 3ème argument.
  const width = forceWidth || 1200;
  const prevDisplay = node.style.display, prevPosition = node.style.position;
  const prevLeft = node.style.left, prevTop = node.style.top, prevWidth = node.style.width;
  const wasHidden = getComputedStyle(node).display === "none";
  if (wasHidden) {
    node.style.position = "fixed";
    node.style.left = "-10000px";
    node.style.top = "0";
    node.style.width = width + "px";
    node.style.display = "block";
  }
  try {
    // windowWidth/windowHeight = les dimensions RÉELLES du nœud (scrollWidth/
    // scrollHeight), pas celles de la fenêtre du navigateur au moment de la
    // capture : sans ça, html2canvas contraint son rendu interne à la
    // largeur de la fenêtre visible, et un nœud plus large qu'elle (ex. un
    // document A4 de 210mm affiché à côté d'une barre latérale qui réduit
    // d'autant la largeur disponible) ressort avec un rapport largeur/hauteur
    // faussé — déformé une fois étiré sur une page PDF (addFittedImageToPage).
    const canvas = await window.html2canvas(node, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true,
      windowWidth: node.scrollWidth, windowHeight: node.scrollHeight
    });
    // PNG (sans perte) plutôt que JPEG : un rapport tableau (texte fin,
    // bordures 1px) devient flou/crénelé en JPEG dès qu'on l'étire pour
    // remplir la page — texte qui paraît "dans une autre police" et
    // colonnes qui semblent désalignées. Le PNG reste net à n'importe quel
    // facteur d'agrandissement.
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally {
    if (wasHidden) {
      node.style.display = prevDisplay;
      node.style.position = prevPosition;
      node.style.left = prevLeft;
      node.style.top = prevTop;
      node.style.width = prevWidth;
    }
  }
}

// Place une image capturée sur la page COURANTE d'un jsPDF déjà créé, en
// l'étirant pour occuper toute la LARGEUR de la page et la hauteur autant que
// possible sans dépasser un étirement vertical de maxStretch : un tableau
// compact et large mais peu haut laisserait sinon un grand vide sous le
// rapport à proportions d'origine conservées. Mais un étirement NON borné
// (proportions ignorées) crée un effet de moiré sur les bordures fines
// répétées du tableau (lignes floues/mal alignées, bandes colorées en
// alternance) une fois la page rendue — d'où la limite. Le vide résiduel
// éventuel (table courte, peu de conducteurs) est centré verticalement
// plutôt que collé en haut.
function addFittedImageToPage(pdf, img) {
  const pageWidthMm = pdf.internal.pageSize.getWidth(), pageHeightMm = pdf.internal.pageSize.getHeight();
  const margin = 5;
  const usableWidthMm = pageWidthMm - margin * 2, usableHeightMm = pageHeightMm - margin * 2;
  const imgHeightMm = usableWidthMm * img.height / img.width;
  const maxStretch = 1.8;
  const targetHeightMm = Math.min(usableHeightMm, imgHeightMm * maxStretch);
  const yOffset = margin + (usableHeightMm - targetHeightMm) / 2;
  pdf.addImage(img.dataUrl, "PNG", margin, yOffset, usableWidthMm, targetHeightMm);
}

async function exportNodeAsPdf(node, filename, opts) {
  const fitOnePage = !!(opts && opts.fitOnePage);
  const forceWidth = opts && "forceWidth" in opts ? opts.forceWidth : 1200;
  const orientation = (opts && opts.orientation) || "landscape";
  await loadPdfLibs();
  const img = await captureNodeAsPng(node, forceWidth);
  const { jsPDF } = window.jspdf;
  // compress:true = indispensable : sans elle, jsPDF écrit l'image capturée
  // (PNG, avec canal alpha) TELLE QUELLE dans le flux du PDF, sans la moindre
  // compression — un comble pour un PNG. Constaté concrètement : un PDF de
  // 12+ Mo pour un simple formulaire A4, dont la taille correspondait
  // EXACTEMENT à largeur × hauteur × (3+1) octets (RGB + alpha bruts). Cette
  // option active la compression deflate de TOUS les flux du document.
  const pdf = new jsPDF({ orientation: orientation, unit: "mm", format: "a4", compress: true });

  if (fitOnePage) {
    addFittedImageToPage(pdf, img);
    pdf.save(filename);
    return;
  }

  const pageWidthMm = pdf.internal.pageSize.getWidth(), pageHeightMm = pdf.internal.pageSize.getHeight();
  const margin = 5;
  const usableWidthMm = pageWidthMm - margin * 2, usableHeightMm = pageHeightMm - margin * 2;
  const imgWidthMm = usableWidthMm;
  const imgHeightMm = imgWidthMm * img.height / img.width;
  let heightLeftMm = imgHeightMm, offsetMm = 0;
  pdf.addImage(img.dataUrl, "PNG", margin, margin, imgWidthMm, imgHeightMm);
  heightLeftMm -= usableHeightMm;
  while (heightLeftMm > 0) {
    offsetMm += usableHeightMm;
    pdf.addPage();
    pdf.addImage(img.dataUrl, "PNG", margin, margin - offsetMm, imgWidthMm, imgHeightMm);
    heightLeftMm -= usableHeightMm;
  }
  pdf.save(filename);
}

// Un PDF, une page PAR nœud fourni — CHAQUE nœud occupe sa propre page en
// entier (fit-to-page, cf. addFittedImageToPage), jamais étalé sur plusieurs
// pages ni mélangé avec le nœud suivant. Utilisé par l'Affectation du jour
// pour qu'un shift donné (une seule équipe, § en-tête de section) tienne
// toujours sur UNE SEULE page — demande explicite de l'exploitant — au lieu
// d'un découpage arbitraire à cheval sur deux pages en cas de repos/congés
// nombreux ce jour-là.
async function exportNodesAsPdf(nodes, filename, forceWidth, orientation) {
  await loadPdfLibs();
  const { jsPDF } = window.jspdf;
  // compress:true : voir le commentaire équivalent dans exportNodeAsPdf —
  // sans cette option, jsPDF stocke les images capturées sans compression.
  const pdf = new jsPDF({ orientation: orientation || "landscape", unit: "mm", format: "a4", compress: true });
  for (let i = 0; i < nodes.length; i++) {
    const img = await captureNodeAsPng(nodes[i], forceWidth);
    if (i > 0) pdf.addPage();
    addFittedImageToPage(pdf, img);
  }
  pdf.save(filename);
}

function ExportPdfButton({ onClick, busy }) {
  return (
    <button onClick={onClick} disabled={busy} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
      <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-file-pdf"} mr-1.5`}></i>{busy ? "Génération…" : "PDF"}
    </button>
  );
}

function PrintHeader({ subtitle, count, countLabel }) {
  const generatedAt = new Date();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
      <div className="flex items-center gap-3 min-w-0">
        <img src="icons/tc3pc-logo.jpg" alt="TC3PC" className="h-9 w-auto shrink-0" />
        {/* Sans whitespace-nowrap : sur une page plus étroite (export
            portrait, § AffectationDuJour), ce titre long se met à la ligne
            au lieu de déborder sur le bloc "Généré le..." à droite — bug
            corrigé, signalé par l'exploitant (chevauchement visible). */}
        <div className="min-w-0">
          <div className="text-base sm:text-lg font-bold">TC3PC — Terminal à Conteneurs 3 du Port de Casablanca</div>
          <div className="text-xs sm:text-sm text-slate-600">{subtitle}</div>
        </div>
      </div>
      <div className="sm:text-right text-xs text-slate-500 shrink-0">
        <div>Généré le {generatedAt.toLocaleDateString("fr-FR")} à {generatedAt.toLocaleTimeString("fr-FR")}</div>
        {count != null && <div>{count} {countLabel}{count > 1 ? "s" : ""}</div>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {Object.entries(RTG_STATUS_META).map(([key, meta]) => (
        <span key={key} className={`px-2 py-1 rounded border ${meta.className}`}>{meta.code} = {meta.label}</span>
      ))}
    </div>
  );
}

function MonthYearTeamPicker({ month, setMonth, year, setYear, teamId, setTeamId, teams, detailLevel, setDetailLevel, lockTeam, lockMonth }) {
  const months = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  return (
    <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-slate-200 p-4">
      {lockMonth ? (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mois</label>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900">{months[month - 1]} {year}</div>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mois</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900">
              {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Année</label>
            <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-24 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" />
          </div>
        </>
      )}
      {!lockTeam && (
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Équipe</label>
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900">
          <option value="all">Toutes les équipes</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
        </select>
      </div>
      )}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Détail</label>
        <div className="flex gap-1">
          {[["code","C"],["vacation","V1"],["zone","V1/A"]].map(([k,l]) => (
            <button key={k} onClick={() => setDetailLevel(k)}
              className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${detailLevel === k ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValidationBanner({ validation }) {
  if (!validation) return null;
  if (validation.valid) {
    return (
      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 text-sm font-medium">
        <i className="fas fa-circle-check"></i> Planning valide — aucune anomalie détectée
      </div>
    );
  }
  return (
    <details className="bg-red-500/10 border border-red-500/30 text-red-700 rounded-xl px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium flex items-center gap-2">
        <i className="fas fa-triangle-exclamation"></i> {validation.count} anomalie{validation.count > 1 ? "s" : ""} détectée{validation.count > 1 ? "s" : ""}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr className="text-left border-b border-red-500/20">
              <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Matricule</th><th className="py-1 pr-3">Conducteur</th>
              <th className="py-1 pr-3">Anomalie</th><th className="py-1 pr-3">Attendu</th><th className="py-1 pr-3">Trouvé</th>
            </tr>
          </thead>
          <tbody>
            {validation.anomalies.slice(0, 200).map((a, i) => (
              <tr key={i} className="border-b border-red-500/10">
                <td className="py-1 pr-3 whitespace-nowrap">{a.date === "—" ? "—" : a.date.slice(8,10) + "/" + a.date.slice(5,7)}</td>
                <td className="py-1 pr-3">{a.matricule}</td>
                <td className="py-1 pr-3 whitespace-nowrap">{a.nom} {a.prenom}</td>
                <td className="py-1 pr-3">{a.type}</td>
                <td className="py-1 pr-3">{a.attendu}</td>
                <td className="py-1 pr-3">{a.trouve}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Cell({ assignment, detailLevel, onEdit, frameCls }) {
  const weekStartCls = frameCls || "";
  if (!assignment) return <td className={`border border-slate-200/60 bg-slate-50/40 ${weekStartCls}`}></td>;
  const meta = RTG_STATUS_META[assignment.status] || { code: assignment.status, className: "text-slate-400" };
  // Jour de travail (PRESENT) : case vierge, comme sur le rapport imprimable —
  // le code "C" (Travail) ne s'affiche plus, pour éviter la confusion avec
  // "CG" (Congé).
  let text = assignment.status === "PRESENT" ? "" : meta.code;
  if (assignment.status === "PRESENT" && detailLevel !== "code") {
    const parts = [];
    if (assignment.vacation) parts.push(assignment.vacation);
    if (detailLevel === "zone" && assignment.zone) parts.push(assignment.zone);
    text = parts.length ? parts.join("/") : "";
  }
  const isManual = assignment.source === "MANUAL";
  const title = (assignment.shift ? `${assignment.shift} ${assignment.startTime || ""}-${assignment.endTime || ""} · Zone ${assignment.zone || "-"}` : meta.label) + (isManual ? " · Modifié manuellement" : "") + (onEdit ? " · Cliquer pour modifier" : "");
  // Repos et Congé mis en avant (gras) — les deux statuts qu'un responsable
  // cherche à repérer en priorité en balayant la grille du regard.
  const emphasized = assignment.status === "REPOS" || assignment.status === "CONGE";
  return (
    <td
      className={`border border-slate-200/60 text-center text-[11px] ${emphasized ? "font-bold" : "font-semibold"} px-1 py-1.5 ${meta.className} ${onEdit ? "cursor-pointer hover:brightness-125" : ""} ${weekStartCls}`}
      title={title}
      onClick={onEdit}
    >
      {text}
    </td>
  );
}

// Case cliquable + modale de modification manuelle du planning (§32) — permet
// à l'ADMIN / RESPONSABLE / RESPONSABLE_SHIFT de forcer le statut/vacation/zone
// d'un conducteur pour un jour donné, notamment pour équilibrer à la main les
// vacations V1/V2 quand l'algorithme automatique ne suffit pas.
const EDITABLE_STATUSES = ["PRESENT", "REPOS", "CONGE", "MALADIE", "ABSENCE", "FORMATION", "OFF"];

// Chaque zone de stockage RTG (A-H) est physiquement divisée en 2 blocs ; un
// conducteur peut être affecté à toute la zone (seul, se déplaçant entre les
// 2 blocs) ou à un seul bloc (zone doublée, ex. "01B"/"02B" — même convention
// de préfixe que ZoneBalancingEngine.assignZonesForSlot). Le sélecteur manuel
// doit pouvoir choisir ces 3 formes pour chaque zone, pas seulement la lettre
// seule, sinon impossible de forcer à la main un conducteur sur un bloc précis
// d'une zone doublée. Sans objet pour la flotte CC (postes physiques 1
// conducteur, PARC/AUTORISE — pas de notion de "bloc" à doubler).
function buildManualZoneOptions(zones, fleet) {
  const options = [];
  (zones || []).forEach(z => {
    if (fleet === "RTG") {
      options.push({ value: z, label: `${z} — zone entière (1 seul conducteur)` });
      options.push({ value: "01" + z, label: `01${z} — bloc 1` });
      options.push({ value: "02" + z, label: `02${z} — bloc 2` });
    } else {
      options.push({ value: z, label: z });
    }
  });
  return options;
}

function AssignmentEditModal({ driver, iso, assignment, config, teams, onClose }) {
  const team = teams.find(t => t.id === driver.teamId);
  const fleet = (team && team.typeEngin) || "RTG";
  const fleetZones = zonesForFleet(config, fleet);
  const [status, setStatus] = useState(assignment.status);
  const [vacation, setVacation] = useState(assignment.vacation || "V1");
  const [zone, setZone] = useState(assignment.zone || fleetZones[0]);
  const [saving, setSaving] = useState(false);
  const isManual = assignment.source === "MANUAL";

  const shift = assignment.shift || (team ? ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.parseISO(iso), config) : null);
  const vacDefs = shift ? (config.vacations[shift] || []) : [];
  const zoneOptions = buildManualZoneOptions(fleetZones, fleet);

  const save = async () => {
    setSaving(true);
    try {
      let override;
      if (status === "PRESENT") {
        // "V1+V2" (journée complète, 8h) — cas des stagiaires cavaliers, qui ne
        // sont pas rattachés à une seule vacation de 4h comme les titulaires.
        // Horaire = début de V1 jusqu'à fin de V2 du shift.
        let startTime = null, endTime = null;
        if (vacation === "V1+V2") {
          startTime = vacDefs.length ? vacDefs[0].start : null;
          endTime = vacDefs.length ? vacDefs[vacDefs.length - 1].end : null;
        } else {
          const vacDef = vacDefs.find(v => v.id === vacation);
          startTime = vacDef ? vacDef.start : null;
          endTime = vacDef ? vacDef.end : null;
        }
        override = { status: "PRESENT", shift: shift, vacation: vacation, zone: zone, startTime: startTime, endTime: endTime };
      } else {
        override = { status: status, shift: null, vacation: null, zone: null, startTime: null, endTime: null };
      }
      await RTGStore.setManualOverride(iso, driver.id, override, "Modification manuelle du planning", "équilibrage V1/V2 le " + iso);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const resetToAuto = async () => {
    setSaving(true);
    try {
      await RTGStore.deleteManualOverride(iso, driver.id, "le " + iso);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="mb-3">
          <div className="text-slate-900 font-semibold text-sm">{driver.matricule} — {driver.nom} {driver.prenom}</div>
          <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(iso))}{isManual ? " · déjà modifié manuellement" : ""}</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Statut</label>
            <select className={FIELD_CLS} value={status} onChange={e => setStatus(e.target.value)}>
              {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{(RTG_STATUS_META[s] || {}).label || s}</option>)}
            </select>
          </div>
          {status === "PRESENT" && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={LABEL_CLS}>Vacation</label>
                <select className={FIELD_CLS} value={vacation} onChange={e => setVacation(e.target.value)}>
                  {vacDefs.map(v => <option key={v.id} value={v.id}>{v.id} ({v.start}-{v.end})</option>)}
                  {vacDefs.length > 0 && <option value="V1+V2">Journée complète — V1+V2 (stagiaire 8h)</option>}
                </select>
              </div>
              <div className="flex-1">
                <label className={LABEL_CLS}>Zone</label>
                <select className={FIELD_CLS} value={zone} onChange={e => setZone(e.target.value)}>
                  {zoneOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mt-3">
          <i className="fas fa-triangle-exclamation mr-1.5"></i>Cette modification remplace l'affectation automatique pour ce conducteur, ce jour-là uniquement.
        </p>
        <div className="flex gap-2 mt-4">
          <button disabled={saving} onClick={save} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">Enregistrer</button>
          {isManual && <button disabled={saving} onClick={resetToAuto} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-600 hover:text-white disabled:opacity-50">Revenir à l'auto</button>}
          <button disabled={saving} onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white ml-auto disabled:opacity-50">Fermer</button>
        </div>
      </div>
    </div>
  );
}

// Table d'un seul groupe de vacation (V1 ou V2) au sein d'une équipe — mêmes
// colonnes que le modèle Excel réel fourni (bloc de conducteurs suivi d'une
// ligne "Nombre de présent" par jour), avec cellules cliquables si l'usager
// a le droit de modifier le planning à la main (§32).
function VacationGroupTable({ label, drivers, planning, detailLevel, config, onEditCell, team }) {
  const nav = useNavigate();
  const goToDriver = matricule => nav("/conducteurs?q=" + encodeURIComponent(matricule) + "&open=" + encodeURIComponent(matricule));
  // Regroupe les jours consécutifs sous le même shift (rotation hebdomadaire
  // par équipe) pour une ligne d'en-tête fusionnée "Shift 1/2/3" au-dessus
  // des dates, comme sur le planning Excel réel de l'exploitant.
  const shiftRuns = useMemo(() => {
    if (!team) return null;
    const runs = [];
    planning.days.forEach(day => {
      const shiftId = ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.parseISO(day.iso), config);
      const last = runs[runs.length - 1];
      if (last && last.shiftId === shiftId) {
        last.count++;
      } else {
        runs.push({ shiftId: shiftId, count: 1 });
      }
    });
    return runs;
  }, [planning, config, team]);
  // Premier/dernier jour de chaque "semaine" (segment) — shiftRuns quand
  // l'équipe est connue (une semaine = une rotation de shift), sinon un
  // découpage lundi-dimanche générique — pour ENCADRER chaque semaine
  // (bordures gauche/droite marquées) au lieu du simple trait de séparation
  // d'origine, sur le modèle des blocs Vacation de l'Affectation du jour.
  const weekBounds = useMemo(() => {
    const starts = new Set(), ends = new Set();
    if (team && shiftRuns) {
      let idx = 0;
      shiftRuns.forEach(run => {
        starts.add(idx);
        ends.add(idx + run.count - 1);
        idx += run.count;
      });
      return { starts, ends };
    }
    planning.days.forEach((day, i) => {
      if (i === 0 || RTGDate.isMonday(RTGDate.parseISO(day.iso))) starts.add(i);
      const isLast = i === planning.days.length - 1;
      const nextIsMonday = !isLast && RTGDate.isMonday(RTGDate.parseISO(planning.days[i + 1].iso));
      if (isLast || nextIsMonday) ends.add(i);
    });
    return { starts, ends };
  }, [team, shiftRuns, planning.days]);
  const weekFrameCls = i => `${weekBounds.starts.has(i) ? "border-l-2 border-l-slate-400" : ""} ${weekBounds.ends.has(i) ? "border-r-2 border-r-slate-400" : ""}`;
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[11px] font-bold text-orange-400 uppercase tracking-wider mb-1.5 px-0.5">{label} <span className="text-slate-500 font-normal normal-case">({drivers.length} conducteur{drivers.length > 1 ? "s" : ""})</span></div>
      {drivers.length === 0 ? (
        <p className="text-xs text-slate-500 italic px-0.5 mb-2">Aucun conducteur dans ce groupe.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border-2 border-slate-300 shadow-md">
          <table className="border-collapse text-xs w-full">
            <thead>
              {shiftRuns && (
                <tr className="bg-slate-50">
                  <th className="sticky left-0 bg-slate-50 border border-slate-200/60 px-2 py-2 text-left text-slate-600 z-10" rowSpan="2">Mat</th>
                  <th className="sticky left-14 bg-slate-50 border border-slate-200/60 px-2 py-2 text-left text-slate-600 z-10 min-w-[90px] sm:min-w-[110px]" rowSpan="2">Nom</th>
                  <th className="hidden sm:table-cell border border-slate-200/60 px-2 py-2 text-left text-slate-600 min-w-[90px]" rowSpan="2">Prénom</th>
                  {shiftRuns.map((run, i) => (
                    <th key={i} colSpan={run.count} className="border-2 border-slate-400 bg-slate-50 px-1 py-1.5 text-center text-slate-400 text-[10px] font-semibold uppercase">{(config.shifts.find(s => s.id === run.shiftId) || {}).label || run.shiftId}</th>
                  ))}
                </tr>
              )}
              <tr className="bg-slate-50">
                {!shiftRuns && <th className="sticky left-0 bg-slate-50 border border-slate-200/60 px-2 py-2 text-left text-slate-600 z-10">Mat</th>}
                {!shiftRuns && <th className="sticky left-14 bg-slate-50 border border-slate-200/60 px-2 py-2 text-left text-slate-600 z-10 min-w-[90px] sm:min-w-[110px]">Nom</th>}
                {!shiftRuns && <th className="hidden sm:table-cell border border-slate-200/60 px-2 py-2 text-left text-slate-600 min-w-[90px]">Prénom</th>}
                {planning.days.map((day, i) => {
                  const holiday = HolidayEngine.getEffectiveHoliday(RTGDate.parseISO(day.iso), team, config);
                  return (
                    <th key={day.iso} className={`border border-slate-200/60 px-1 sm:px-1.5 py-2 min-w-[26px] sm:min-w-[34px] ${holiday ? "bg-indigo-500/20 text-indigo-700" : "text-slate-400"} ${weekFrameCls(i)}`} title={holiday ? holiday.label : undefined}>
                      {String(day.day).padStart(2, "0")}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {drivers.map(driver => (
                <tr key={driver.id} className="hover:bg-marine-600/10">
                  <td className="sticky left-0 bg-white border border-slate-200/60 px-2 py-1.5 text-slate-600 z-10">{driver.matricule}</td>
                  <td className="sticky left-14 bg-white border border-slate-200/60 px-2 py-1.5 text-slate-900 font-medium z-10"><button onClick={() => goToDriver(driver.matricule)} className="hover:underline text-left" title="Voir la fiche et l'historique de ce conducteur">{driver.nom}</button></td>
                  <td className="hidden sm:table-cell border border-slate-200/60 px-2 py-1.5 text-slate-400">{driver.prenom}</td>
                  {planning.days.map((day, i) => {
                    const a = day.assignments.find(x => x.driverId === driver.id);
                    return <Cell key={day.iso} assignment={a} detailLevel={detailLevel} onEdit={onEditCell ? () => onEditCell(driver, day.iso, a) : undefined} frameCls={weekFrameCls(i)} />;
                  })}
                </tr>
              ))}
              <tr className="bg-slate-50/70 font-bold">
                <td className="sticky left-0 bg-slate-50/70 border border-slate-200/60 px-2 py-1.5 text-slate-600 z-10" colSpan="1">—</td>
                <td className="sticky left-14 bg-slate-50/70 border border-slate-200/60 px-2 py-1.5 text-slate-900 z-10" colSpan="1">Nombre de présent</td>
                <td className="hidden sm:table-cell border border-slate-200/60 px-2 py-1.5"></td>
                {planning.days.map((day, i) => {
                  const count = drivers.reduce((n, driver) => {
                    const a = day.assignments.find(x => x.driverId === driver.id);
                    return n + (a && a.status === "PRESENT" ? 1 : 0);
                  }, 0);
                  return <td key={day.iso} className={`border border-slate-200/60 text-center text-[11px] text-slate-900 px-1 py-1.5 ${weekFrameCls(i)}`}>{count}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanningGrid({ planning, drivers, detailLevel, config, teams, canEdit }) {
  const [editing, setEditing] = useState(null);
  const onEditCell = canEdit ? (driver, iso, assignment) => assignment && setEditing({ driver: driver, iso: iso, assignment: assignment }) : undefined;

  const teamIds = teams.filter(t => drivers.some(d => d.teamId === t.id)).map(t => t.id);

  return (
    <div>
      <p className="sm:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir tous les jours</p>
      {canEdit && (
        <p className="text-[11px] text-sky-700 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 mb-3">
          <i className="fas fa-pen mr-1.5"></i>Cliquez sur une case pour modifier manuellement l'affectation d'un conducteur et équilibrer les vacations.
        </p>
      )}
      {teamIds.map(teamId => {
        const team = teams.find(t => t.id === teamId);
        const teamDrivers = drivers.filter(d => d.teamId === teamId);
        const v1 = teamDrivers.filter(d => d.initialVacation !== "V2");
        const v2 = teamDrivers.filter(d => d.initialVacation === "V2");
        return (
          <div key={teamId} className="mb-6 last:mb-0">
            {teamIds.length > 1 && <h3 className="text-slate-900 font-semibold text-sm mb-2">{team ? team.nom : teamId}</h3>}
            <VacationGroupTable label="Vacation 1" drivers={v1} planning={planning} detailLevel={detailLevel} config={config} onEditCell={onEditCell} team={team} />
            <VacationGroupTable label="Vacation 2" drivers={v2} planning={planning} detailLevel={detailLevel} config={config} onEditCell={onEditCell} team={team} />
          </div>
        );
      })}
      {editing && (
        <AssignmentEditModal driver={editing.driver} iso={editing.iso} assignment={editing.assignment} config={config} teams={teams} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// La colonne Zone sert double emploi : la zone d'affectation si le
// conducteur est présent, sinon son statut (Repos/Congé/Maladie/Absence/
// Formation) — demande explicite de l'exploitant, pour intégrer présents ET
// absents d'une même vacation dans UN SEUL tableau plutôt qu'un bloc "Repos
// & congés" séparé.
function ZoneOrStatutBadge({ a }) {
  if (a.status === "PRESENT") {
    return <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-700 font-bold">{a.zone}</span>;
  }
  const meta = RTG_STATUS_META[a.status] || { label: a.status, className: "bg-slate-700/40 text-slate-600 border-slate-600/40" };
  return <span className={`px-1.5 py-0.5 rounded border ${meta.className}`}>{meta.label}</span>;
}

function ShiftBlock({ title, icon, rows, onEditRow }) {
  const nav = useNavigate();
  const goToDriver = matricule => nav("/conducteurs?q=" + encodeURIComponent(matricule) + "&open=" + encodeURIComponent(matricule));
  // Bordure plus marquée + ombre (au lieu du simple border-slate-200 des
  // autres cartes) : ce bloc est toujours affiché à côté d'un autre (V1 à
  // côté de V2, § grid-cols-2) — les deux se confondaient l'un dans l'autre
  // sur le fond clair, sans repère visuel net entre les deux.
  return (
    <div className="bg-white rounded-xl border-2 border-slate-300 shadow-md p-4">
      <div className="flex items-center gap-2 mb-3">
        <i className={`fas ${icon} text-orange-400 text-sm`}></i>
        <h3 className="text-slate-900 text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-slate-500">{rows.length} conducteur{rows.length > 1 ? "s" : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Aucun conducteur affecté.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr className="text-left border-b border-slate-200">
                <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="hidden sm:table-cell py-1.5 pr-3">Prénom</th>
                <th className="hidden sm:table-cell py-1.5 pr-3">Équipe</th><th className="py-1.5 pr-3">Vacation</th><th className="hidden sm:table-cell py-1.5 pr-3">Horaire</th>
                <th className="py-1.5 pr-3">Zone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.driverId} className={`border-b border-slate-200/50 ${a.vacationBalanceAlert ? "bg-red-500/10" : ""}`}
                  title={a.vacationBalanceAlert ? "Cette vacation reste en excédent par rapport à l'autre — à faire passer exceptionnellement dans l'autre vacation si possible." : undefined}>
                  <td className="py-1.5 pr-3 text-slate-600">{a.matricule}</td>
                  <td className={`py-1.5 pr-3 font-medium ${a.vacationBalanceAlert ? "text-red-700" : "text-slate-900"}`}>
                    <button onClick={() => goToDriver(a.matricule)} className="hover:underline text-left" title="Voir la fiche et l'historique de ce conducteur">{a.nom}</button>
                    {a.vacationBalanceAlert && <i className="fas fa-triangle-exclamation ml-1.5 text-red-400" title="Vacation en surnombre"></i>}
                  </td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-600">{a.prenom}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.teamNom}</td>
                  <td className="py-1.5 pr-3">{a.vacation ? <span className={`px-1.5 py-0.5 rounded ${a.vacationBalanceAlert ? "bg-red-500/20 text-red-700 font-bold" : "bg-marine-600/20 text-marine-700"}`}>{a.vacation}</span> : "—"}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.startTime ? `${a.startTime}–${a.endTime}` : "—"}</td>
                  <td className={`py-1.5 pr-3 ${onEditRow ? "cursor-pointer hover:brightness-125" : ""}`}
                    onClick={onEditRow ? () => onEditRow(a) : undefined}
                    title={onEditRow ? "Cliquer pour modifier l'affectation de ce conducteur" : undefined}>
                    <ZoneOrStatutBadge a={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Recherche rapide d'un conducteur depuis le tableau de bord — évite d'avoir
// à défiler la liste complète des conducteurs pour en retrouver un.
function DriverSearchBox({ state, shiftRestricted, currentUser, todayAssignments }) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const pool = shiftRestricted ? state.drivers.filter(d => d.teamId === currentUser.teamId) : state.drivers;
  const q = query.trim().toLowerCase();
  const results = q
    ? pool.filter(d => d.matricule.toLowerCase().includes(q) || d.nom.toLowerCase().includes(q) || d.prenom.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const goTo = driver => { nav("/conducteurs?q=" + encodeURIComponent(driver.matricule)); setQuery(""); };

  return (
    <div className="relative">
      <div className="relative">
        <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un conducteur (matricule, nom...)"
          className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900" />
      </div>
      {q && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
          {results.length === 0 && <div className="px-3 py-2 text-xs text-slate-500 italic">Aucun conducteur trouvé.</div>}
          {results.map(d => {
            const a = todayAssignments.find(x => x.driverId === d.id);
            const team = state.teams.find(t => t.id === d.teamId);
            const meta = a ? (RTG_STATUS_META[a.status] || { label: a.status }) : null;
            return (
              <button key={d.id} type="button" onClick={() => goTo(d)}
                className="w-full text-left px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex items-center justify-between gap-2">
                <span><span className="text-slate-400">{d.matricule}</span> — <span className="text-slate-900 font-medium">{d.nom} {d.prenom}</span></span>
                <span className="text-slate-400 shrink-0">{team ? team.nom : d.teamId}{meta ? " · " + meta.label : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 1. Accueil
// ==========================================
function Home() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const nav = useNavigate();
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  // Ne considérer que les équipes/conducteurs de la flotte sélectionnée
  // (bascule RTG/CC) — un compte restreint (Responsable de Shift) reste sur
  // sa propre équipe quelle que soit cette bascule.
  const restrictedId = shiftRestricted ? currentUser.teamId : null;
  const fTeams = fleetTeams(rawState, restrictedId);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  // Challenge Rendement (§ demande exploitant) : un Responsable (de Shift ou
  // non) voit le champion de CHAQUE équipe de la flotte, pas seulement la
  // sienne — contrairement à la restriction habituelle de cette page pour un
  // compte restreint, volontaire ici. Filtré sur la flotte RÉELLEMENT
  // affichée dans le widget (celle de sa propre équipe s'il est restreint,
  // PAS forcément rawState.currentFleet — sinon décalage possible si la
  // bascule globale ne correspond pas à sa flotte).
  const rendementFleet = shiftRestricted && state.teams[0] ? (state.teams[0].typeEngin || "RTG") : rawState.currentFleet;
  const allFleetTeams = useMemo(() => rawState.teams.filter(t => (t.typeEngin || "RTG") === rendementFleet), [rawState.teams, rendementFleet]);

  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const todayIso = RTGDate.toISO(RTGDate.makeDate(year, month, Math.min(today.getUTCDate(), planning.days.length)));
  const todayAssignments = useMemo(() => {
    const all = PlanningEngine.generateDailyAssignments(todayIso, state);
    return shiftRestricted ? all.filter(a => a.teamId === currentUser.teamId) : all;
  }, [state, todayIso, shiftRestricted, currentUser]);

  const counts = { PRESENT: 0, REPOS: 0, CONGE: 0, MALADIE: 0, ABSENCE: 0, FORMATION: 0, OFF: 0 };
  todayAssignments.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

  const byTeam = (shiftRestricted ? state.teams.filter(t => t.id === currentUser.teamId) : state.teams).map(t => ({
    team: t,
    shift: ShiftRotationEngine.getTeamShiftForDate(t, RTGDate.parseISO(todayIso), state.config)
  }));

  const validation = shiftRestricted
    ? (() => {
        const anomalies = planning.validation.anomalies.filter(a => {
          const d = state.drivers.find(dr => dr.id === a.driverId);
          return d && d.teamId === currentUser.teamId;
        });
        return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
      })()
    : planning.validation;

  // Alerte "demandes de congé en attente" (§38, libre-service conducteur) —
  // portée à l'Accueil pour qu'un Responsable/Admin la remarque sans avoir à
  // ouvrir la page Congés ; un Responsable de Shift ne voit que sa propre
  // équipe, comme partout ailleurs sur cette page.
  const pendingConges = useMemo(() => rawState.conges.filter(c => {
    if (c.statut !== "EN_ATTENTE") return false;
    const d = state.drivers.find(dr => dr.id === c.driverId);
    if (!d) return false;
    return !shiftRestricted || d.teamId === currentUser.teamId;
  }), [rawState.conges, state.drivers, shiftRestricted, currentUser]);

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">CES Driver Planner{!shiftRestricted ? " — " + rawState.currentFleet : ""}</h1>
        <p className="text-slate-500 text-sm mt-0.5">Gestion des conducteurs — Terminal à conteneurs — {RTGDate.formatFr(RTGDate.parseISO(todayIso))}{shiftRestricted ? " — " + byTeam[0].team.nom : ""}</p>
      </div>

      <DriverSearchBox state={state} shiftRestricted={shiftRestricted} currentUser={currentUser} todayAssignments={todayAssignments} />

      <RendementLeaderboard fleet={rendementFleet} teams={allFleetTeams} />

      {pendingConges.length > 0 && (
        <button onClick={() => nav("/conges")} className="w-full text-left flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl px-4 py-3 text-sm hover:bg-amber-500/15 transition-all">
          <i className="fas fa-bell text-amber-400"></i>
          <span className="font-medium">
            {pendingConges.length} demande{pendingConges.length > 1 ? "s" : ""} de congé en attente de validation
          </span>
          <span className="text-amber-400/80 truncate">
            — {pendingConges.slice(0, 3).map(c => driverLabel(state, c.driverId).split(" — ")[1] || driverLabel(state, c.driverId)).join(", ")}{pendingConges.length > 3 ? "…" : ""}
          </span>
          <i className="fas fa-arrow-right ml-auto shrink-0"></i>
        </button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICard icon="fa-user-check" label="Présents" value={counts.PRESENT} color="green" />
        <KPICard icon="fa-bed" label="Repos" value={counts.REPOS} color="blue" />
        <KPICard icon="fa-umbrella-beach" label="Congés" value={counts.CONGE} color="orange" />
        <KPICard icon="fa-briefcase-medical" label="Maladies" value={counts.MALADIE} color="purple" />
        <KPICard icon="fa-user-slash" label="Absences" value={counts.ABSENCE} color="red" />
        <KPICard icon="fa-graduation-cap" label="Formations" value={counts.FORMATION} color="blue" />
        <KPICard icon="fa-power-off" label="Off (S3 dim.)" value={counts.OFF} color="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {byTeam.map(({ team, shift }) => (
          <div key={team.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{team.nom}</div>
            <div className="text-2xl font-bold text-slate-900">{shift}</div>
            <div className="text-xs text-slate-400 mt-1">{(state.config.shifts.find(s => s.id === shift) || {}).start} – {(state.config.shifts.find(s => s.id === shift) || {}).end}</div>
          </div>
        ))}
      </div>

      <ValidationBanner validation={validation} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => nav("/planning")} className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-orange-300 transition-all flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-marine-500 to-marine-700 flex items-center justify-center text-white text-lg"><i className="fas fa-calendar-alt"></i></div>
          <div>
            <div className="text-slate-900 font-semibold text-sm">Planning mensuel</div>
            <div className="text-xs text-slate-500">Vue complète du mois par équipe, rotation shift/zone/vacation</div>
          </div>
        </button>
        <button onClick={() => nav("/affectation")} className="text-left bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:border-orange-300 transition-all flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-lg"><i className="fas fa-clipboard-list"></i></div>
          <div>
            <div className="text-slate-900 font-semibold text-sm">Affectation du jour</div>
            <div className="text-xs text-slate-500">3 shifts × 2 vacations, zones et horaires pour une date donnée</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 2. Planning mensuel
// ==========================================
// Table imprimable d'un seul groupe de vacation (V1 ou V2) — même modèle que
// le fichier Excel réel de l'exploitant : uniquement repos/congé/maladie/
// absence/formation/OFF/férié (code court), les jours PRESENT restent VIERGES
// (pas de shift/vacation/zone — volontairement omis, cf. en-tête de
// PlanningGridPrintable), avec une ligne "Nombre de présent" par jour.
function VacationGroupTablePrintable({ label, drivers, planning, config, team }) {
  // Regroupe les jours consécutifs sous le même shift (rotation hebdomadaire
  // par équipe) pour la ligne d'en-tête fusionnée "SHIFT 1/2/3", comme dans
  // le planning Excel réel de l'exploitant.
  const shiftRuns = useMemo(() => {
    if (!team) return null;
    const runs = [];
    planning.days.forEach(day => {
      const shiftId = ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.parseISO(day.iso), config);
      const last = runs[runs.length - 1];
      if (last && last.shiftId === shiftId) {
        last.count++;
      } else {
        runs.push({ shiftId: shiftId, count: 1 });
      }
    });
    return runs;
  }, [planning, config, team]);
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[9px] font-bold uppercase tracking-wide mb-0.5">{label} — {drivers.length} conducteur{drivers.length > 1 ? "s" : ""}</div>
      {drivers.length === 0 ? (
        <p className="text-[8px] italic text-slate-500 mb-1">Aucun conducteur dans ce groupe.</p>
      ) : (
        <table className="border-collapse text-[9px] mb-1 w-full">
          <thead>
            {shiftRuns && (
              <tr>
                <th className={PRINT_TH_XS} rowSpan="2">Mat</th>
                <th className={PRINT_TH_XS} rowSpan="2">Nom</th>
                <th className={PRINT_TH_XS} rowSpan="2">Prénom</th>
                {shiftRuns.map((run, i) => (
                  <th key={i} colSpan={run.count} className={PRINT_TH_XS + " text-center"}>{(config.shifts.find(s => s.id === run.shiftId) || {}).label || run.shiftId}</th>
                ))}
                <th className={PRINT_TH_XS + " text-center"} rowSpan="2">Total repos</th>
              </tr>
            )}
            <tr>
              {!shiftRuns && <th className={PRINT_TH_XS}>Mat</th>}
              {!shiftRuns && <th className={PRINT_TH_XS}>Nom</th>}
              {!shiftRuns && <th className={PRINT_TH_XS}>Prénom</th>}
              {planning.days.map(day => {
                const holiday = HolidayEngine.getEffectiveHoliday(RTGDate.parseISO(day.iso), team, config);
                return <th key={day.iso} className={PRINT_TH_XS + " text-center"} style={holiday ? { backgroundColor: PRINT_STATUS_BG.FERIE } : undefined} title={holiday ? holiday.label : undefined}>{String(day.day).padStart(2, "0")}</th>;
              })}
              {!shiftRuns && <th className={PRINT_TH_XS + " text-center"}>Total repos</th>}
            </tr>
          </thead>
          <tbody>
            {drivers.map(driver => {
              const totalRepos = planning.days.reduce((n, day) => {
                const a = day.assignments.find(x => x.driverId === driver.id);
                return n + (a && a.status === "REPOS" ? 1 : 0);
              }, 0);
              return (
                <tr key={driver.id}>
                  <td className={PRINT_TD_XS}>{driver.matricule}</td>
                  <td className={PRINT_TD_XS + " font-medium"}>{driver.nom}</td>
                  <td className={PRINT_TD_XS}>{driver.prenom}</td>
                  {planning.days.map(day => {
                    const a = day.assignments.find(x => x.driverId === driver.id);
                    const isPresent = !a || a.status === "PRESENT";
                    const code = isPresent ? "" : ((RTG_STATUS_META[a.status] || {}).code || a.status);
                    const bg = isPresent ? undefined : PRINT_STATUS_BG[a.status];
                    return <td key={day.iso} className={PRINT_TD_XS_CENTER} style={bg ? { backgroundColor: bg } : undefined}>{code}</td>;
                  })}
                  <td className={PRINT_TD_XS_CENTER + " font-bold"}>{totalRepos}</td>
                </tr>
              );
            })}
            <tr className="font-bold">
              <td className={PRINT_TD_XS} colSpan="3">Nombre de présent</td>
              {planning.days.map(day => {
                const count = drivers.reduce((n, driver) => {
                  const a = day.assignments.find(x => x.driverId === driver.id);
                  return n + (a && a.status === "PRESENT" ? 1 : 0);
                }, 0);
                return <td key={day.iso} className={PRINT_TD_XS_CENTER}>{count}</td>;
              })}
              <td className={PRINT_TD_XS_CENTER}></td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// Version imprimable du planning mensuel — visible uniquement à
// l'impression / export PDF. Format compact repris du modèle Excel réel de
// l'exploitant : conducteurs séparés par vacation (V1/V2) avec ligne
// "Nombre de présent" par jour, AUCUN détail d'affectation (shift/vacation/
// zone) — seuls repos, congés, maladies, absences, formations et OFF/férié
// sont indiqués (avec une couleur pastel par statut, reprise de l'écran),
// tout le reste (présent) reste vierge — pour tenir sur une seule page
// malgré un mois complet.
function PlanningGridPrintable({ planning, drivers, config, teams }) {
  const teamIds = teams.filter(t => drivers.some(d => d.teamId === t.id)).map(t => t.id);
  return (
    <div>
      {teamIds.map(teamId => {
        const team = teams.find(t => t.id === teamId);
        const teamDrivers = drivers.filter(d => d.teamId === teamId);
        const v1 = teamDrivers.filter(d => d.initialVacation !== "V2");
        const v2 = teamDrivers.filter(d => d.initialVacation === "V2");
        return (
          <div key={teamId} className="mb-2 last:mb-0">
            {teamIds.length > 1 && <div className="text-[10px] font-bold mb-0.5">{team ? team.nom : teamId}</div>}
            <VacationGroupTablePrintable label="Vacation 1" drivers={v1} planning={planning} config={config} team={team} />
            <VacationGroupTablePrintable label="Vacation 2" drivers={v2} planning={planning} config={config} team={team} />
          </div>
        );
      })}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[7px] text-slate-600">
        {Object.entries(RTG_STATUS_META).filter(([key]) => key !== "PRESENT").map(([key, meta]) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 border border-slate-400" style={{ backgroundColor: PRINT_STATUS_BG[key] }}></span>
            {meta.code} = {meta.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlanningMensuel() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  // isTeamRestricted couvre RESPONSABLE_SHIFT ET CONDUCTEUR (§39, demande
  // explicite de l'exploitant : le conducteur voit le planning de son
  // équipe, en lecture seule) — restrictedTeamId déduit l'équipe pour
  // chacun (team_id direct, ou celle de la fiche conducteur liée).
  const shiftRestricted = isTeamRestricted(currentUser);
  const ownTeamId = restrictedTeamId(currentUser, rawState);
  // Ne considérer que les équipes/conducteurs de la flotte sélectionnée
  // (bascule RTG/CC) — un compte restreint reste sur sa propre équipe quelle
  // que soit cette bascule.
  const fTeams = fleetTeams(rawState, shiftRestricted ? ownTeamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  // ADMIN, RESPONSABLE (Exploitation) et RESPONSABLE_SHIFT peuvent forcer
  // manuellement une affectation depuis cette grille, notamment pour
  // équilibrer à la main les vacations V1/V2 quand l'algorithme ne suffit
  // pas (§32) — RESPONSABLE_SHIFT reste de toute façon cantonné à sa
  // propre équipe via effectiveTeamId/lockTeam ci-dessous. CONDUCTEUR n'y
  // figure pas : lecture seule, jamais d'édition.
  const canEditPlanning = !!currentUser && ["ADMIN", "RESPONSABLE", "RESPONSABLE_SHIFT"].indexOf(currentUser.role) !== -1;
  // L'import Excel modifie potentiellement des dizaines d'affectations d'un
  // coup : réservé à l'ADMIN/RESPONSABLE (pas au RESPONSABLE_SHIFT), à la
  // différence de l'édition case par case ci-dessus.
  const canBulkImport = !!currentUser && ["ADMIN", "RESPONSABLE"].indexOf(currentUser.role) !== -1;
  // Un CONDUCTEUR ne peut consulter que le mois EN COURS (demande explicite
  // de l'exploitant) — le sélecteur mois/année est masqué (lockMonth) et
  // l'état initial (déjà le mois courant) n'est jamais modifié pour ce rôle.
  const monthLocked = isDriverRestricted(currentUser);
  const [showImport, setShowImport] = useState(false);
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState(shiftRestricted ? ownTeamId : "all");
  const [detailLevel, setDetailLevel] = useState("vacation");

  const effectiveTeamId = shiftRestricted ? ownTeamId : teamId;
  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  // Trie par ordreAffichage (rempli par l'import Excel — §35) pour que la
  // grille se compare ligne à ligne avec le fichier réel de l'exploitant ;
  // les conducteurs sans ordre défini restent à la fin, dans leur ordre
  // d'origine (tri stable).
  const drivers = useMemo(() => state.drivers
    .filter(d => d.actif !== false && (effectiveTeamId === "all" || d.teamId === effectiveTeamId))
    .slice()
    .sort((a, b) => {
      const oa = a.ordreAffichage, ob = b.ordreAffichage;
      if (oa == null && ob == null) return 0;
      if (oa == null) return 1;
      if (ob == null) return -1;
      return oa - ob;
    }), [state.drivers, effectiveTeamId]);

  const validation = shiftRestricted
    ? (() => {
        const anomalies = planning.validation.anomalies.filter(a => {
          const d = state.drivers.find(dr => dr.id === a.driverId);
          return d && d.teamId === ownTeamId;
        });
        return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
      })()
    : planning.validation;

  const exportExcel = () => {
    const headers = ["Mat", "Nom", "Prénom", "Équipe", ...planning.days.map(day => String(day.day).padStart(2, "0"))];
    const rows = drivers.map(driver => {
      const cells = planning.days.map(day => {
        const a = day.assignments.find(x => x.driverId === driver.id);
        if (!a) return "";
        const meta = RTG_STATUS_META[a.status] || { code: a.status };
        if (a.status === "PRESENT") return [a.vacation, a.zone].filter(Boolean).join("-") || meta.code;
        return meta.code;
      });
      return [driver.matricule, driver.nom, driver.prenom, driver.teamId, ...cells];
    });
    downloadCSV(`planning-mensuel-${RAPPORT_MOIS_LABELS_P[month - 1]}-${year}.csv`, headers, rows);
  };

  const printRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    if (!printRef.current) return;
    setPdfBusy(true);
    try {
      await exportNodeAsPdf(printRef.current, `planning-mensuel-${RAPPORT_MOIS_LABELS_P[month - 1]}-${year}.pdf`, { fitOnePage: true, forceWidth: 1450 });
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Planning mensuel {shiftRestricted && state.teams[0] ? (state.teams[0].typeEngin || "RTG") : rawState.currentFleet}</h1>
          <p className="text-slate-400 text-sm mt-0.5">Généré automatiquement par le moteur de planification (shift / zone / vacation / repos)</p>
        </div>
        <div className="flex gap-2">
          {canBulkImport && effectiveTeamId !== "all" && (
            <button onClick={() => setShowImport(true)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 text-white hover:bg-sky-700">
              <i className="fas fa-file-import mr-1.5"></i>Importer Excel
            </button>
          )}
          <ExportPdfButton onClick={exportPdf} busy={pdfBusy} />
          <ExportExcelButton onClick={exportExcel} />
        </div>
      </div>

      {canBulkImport && effectiveTeamId === "all" && (
        <p className="text-[11px] text-slate-500 print:hidden">Sélectionnez une équipe précise pour importer un planning réel (Repos/Congés) depuis Excel.</p>
      )}

      <div className="print:hidden">
        <MonthYearTeamPicker month={month} setMonth={setMonth} year={year} setYear={setYear} teamId={effectiveTeamId} setTeamId={setTeamId} teams={state.teams} detailLevel={detailLevel} setDetailLevel={setDetailLevel} lockTeam={shiftRestricted} lockMonth={monthLocked} />
      </div>

      {showImport && effectiveTeamId !== "all" && (
        <ImportPlanningModal
          team={state.teams.find(t => t.id === effectiveTeamId)}
          month={month} year={year} drivers={drivers} state={state} planning={planning}
          onClose={() => setShowImport(false)}
        />
      )}

      <div className="print:hidden">
        <ValidationBanner validation={validation} />
      </div>

      <div className="print:hidden">
        <PlanningGrid planning={planning} drivers={drivers} detailLevel={detailLevel} config={state.config} teams={state.teams} canEdit={canEditPlanning} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 print:hidden">
        <Legend />
      </div>

      {/* Rapport imprimable — noir sur blanc, indépendant du thème sombre de l'appli. */}
      <div ref={printRef} className="print-report bg-white text-slate-900 rounded-xl p-0">
        <PrintHeader
          subtitle={"Rapport de planning mensuel — RTG — " + RAPPORT_MOIS_LABELS_P[month - 1] + " " + year + (effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : "")}
          count={drivers.length} countLabel="conducteur"
        />
        <PlanningGridPrintable planning={planning} drivers={drivers} config={state.config} teams={state.teams} />
      </div>
    </div>
  );
}

// ==========================================
// Mouvements réalisés un jour férié, PAR CONDUCTEUR PRÉSENT (§31) — un jour
// férié est chômé (statut FERIE pour tous), sauf pour un conducteur avec un
// enregistrement "jour férié travaillé" (§29), qui apparaît alors PRÉSENT :
// c'est pour lui qu'on saisit le nombre de mouvements réalisés ce jour-là.
// ==========================================
function FerieMouvementsRow({ dateStr, driverId, label }) {
  const existing = RTGStore.getFerieMouvements(dateStr, driverId);
  const [value, setValue] = useState(existing ? String(existing.mouvements) : "");
  const [comment, setComment] = useState(existing ? existing.commentaire || "" : "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const rec = RTGStore.getFerieMouvements(dateStr, driverId);
    setValue(rec ? String(rec.mouvements) : "");
    setComment(rec ? rec.commentaire || "" : "");
    setSaved(false);
  }, [dateStr, driverId]);

  const save = () => {
    const n = Number(value);
    if (!value || isNaN(n) || n < 0) return;
    RTGStore.setFerieMouvements(dateStr, driverId, n, comment);
    setSaved(true);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 py-2 border-b border-slate-200/50 last:border-0">
      <div className="text-xs text-slate-600 font-medium w-40 shrink-0">{label}</div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mouvements réalisés</label>
        <input type="number" min="0" value={value} onChange={e => { setValue(e.target.value); setSaved(false); }}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 w-28" />
      </div>
      <div className="flex-1 min-w-[140px]">
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Commentaire</label>
        <input value={comment} onChange={e => { setComment(e.target.value); setSaved(false); }}
          className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 w-full" />
      </div>
      <button onClick={save} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Enregistrer</button>
      {saved && <span className="text-xs text-emerald-400"><i className="fas fa-circle-check mr-1"></i>Enregistré</span>}
    </div>
  );
}

function FerieMouvementsPanel({ dateStr, presentDrivers }) {
  if (presentDrivers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-1">
          <i className="fas fa-truck-ramp-box text-orange-400 text-sm"></i>
          <h3 className="text-slate-900 text-sm font-semibold">Mouvements réalisés — jour férié</h3>
        </div>
        <p className="text-xs text-slate-500 italic">Aucun conducteur présent ce jour férié (aucun enregistrement "jour férié travaillé" — page Over Time).</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-2 mb-2">
        <i className="fas fa-truck-ramp-box text-orange-400 text-sm"></i>
        <h3 className="text-slate-900 text-sm font-semibold">Mouvements réalisés — jour férié</h3>
      </div>
      {presentDrivers.map(a => <FerieMouvementsRow key={a.driverId} dateStr={dateStr} driverId={a.driverId} label={a.matricule + " — " + a.nom + " " + a.prenom} />)}
    </div>
  );
}

// Version imprimable (noir sur blanc) d'un bloc vacation.
// showTeamColumn=false quand le rapport est déjà groupé par shift (une seule
// équipe par shift, mentionnée dans l'en-tête de la section — cf.
// AffectationDuJour) : répéter l'équipe sur chaque ligne y est alors pur
// doublon. Reste à `true` par défaut (ex. rapport jour férié, qui liste
// toutes les équipes ensemble sans section par shift).
// Largeurs de colonnes FIXES (table-layout: fixed) — demande explicite de
// l'exploitant : sans largeurs fixes, chaque tableau <table> (un par
// vacation V1/V2) redimensionne ses colonnes selon SON PROPRE contenu,
// indépendamment de l'autre — les colonnes Prénom/Vacation/Zone ne
// s'alignaient donc plus verticalement avec celles de l'autre tableau juste
// en dessous. Deux jeux de largeurs (avec/sans la colonne Équipe) pour que
// le total reste 100% dans les deux cas. Colonne "Horaire" retirée : déjà
// indiquée dans le titre de la section (ex. "Vacation V1 · 07:00 → 11:00",
// identique pour toute la vacation) — même doublon que la colonne Équipe.
const SHIFT_BLOCK_COL_W = {
  withTeam: { mat: "10%", nom: "20%", prenom: "18%", equipe: "17%", vacation: "12%", zone: "23%" },
  noTeam: { mat: "11%", nom: "24%", prenom: "21%", vacation: "14%", zone: "30%" }
};
function ShiftBlockPrintable({ title, rows, showTeamColumn = true }) {
  const w = showTeamColumn ? SHIFT_BLOCK_COL_W.withTeam : SHIFT_BLOCK_COL_W.noTeam;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">{title} — {rows.length} conducteur{rows.length > 1 ? "s" : ""}</div>
      {rows.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic mb-2">Aucun conducteur affecté.</p>
      ) : (
        <table className="w-full text-[13px] border-collapse mb-2" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th className={PRINT_TH} style={{ width: w.mat }}>Mat</th>
              <th className={PRINT_TH} style={{ width: w.nom }}>Nom</th>
              <th className={PRINT_TH} style={{ width: w.prenom }}>Prénom</th>
              {showTeamColumn && <th className={PRINT_TH} style={{ width: w.equipe }}>Équipe</th>}
              <th className={PRINT_TH_CENTER} style={{ width: w.vacation }}>Vacation</th>
              <th className={PRINT_TH_CENTER} style={{ width: w.zone }}>Zone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, idx) => {
              // Zone sert double emploi : zone d'affectation si présent,
              // sinon le statut (Repos/Congé/Maladie/Absence/Formation) —
              // demande explicite de l'exploitant (une seule liste par
              // vacation, présents et absents confondus).
              const zoneOrStatut = a.status === "PRESENT" ? a.zone : ((RTG_STATUS_META[a.status] || {}).label || a.status);
              return (
                <tr key={a.driverId} style={printRowStyle(idx, a.vacationBalanceAlert)}>
                  <td className={PRINT_TD}>{a.matricule}</td>
                  <td className={PRINT_TD_WRAP + " font-medium"}>{a.nom}{a.vacationBalanceAlert ? " (*)" : ""}</td>
                  <td className={PRINT_TD_WRAP}>{a.prenom}</td>
                  {showTeamColumn && <td className={PRINT_TD_WRAP}>{a.teamNom}</td>}
                  <td className={PRINT_TD_CENTER}>{a.vacation || "—"}</td>
                  <td className={PRINT_TD_CENTER}>{zoneOrStatut}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FerieMouvementsPrintable({ dateStr, presentDrivers }) {
  if (presentDrivers.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">Mouvements réalisés — jour férié</div>
      <table className="w-full text-[13px] border-collapse mb-2">
        <thead>
          <tr>
            <th className={PRINT_TH}>Mat</th><th className={PRINT_TH}>Nom</th><th className={PRINT_TH}>Prénom</th>
            <th className={PRINT_TH}>Mouvements</th><th className={PRINT_TH}>Commentaire</th>
          </tr>
        </thead>
        <tbody>
          {presentDrivers.map((a, idx) => {
            const rec = RTGStore.getFerieMouvements(dateStr, a.driverId);
            return (
              <tr key={a.driverId} style={printRowStyle(idx)}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}</td>
                <td className={PRINT_TD}>{a.prenom}</td>
                <td className={PRINT_TD_CENTER}>{rec ? rec.mouvements : "—"}</td>
                <td className={PRINT_TD}>{rec ? rec.commentaire || "" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReposCongesPrintable({ rows, showTeamColumn = true }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">Repos &amp; congés — {rows.length} conducteur{rows.length > 1 ? "s" : ""}</div>
      <table className="w-full text-[13px] border-collapse mb-2">
        <thead>
          <tr>
            <th className={PRINT_TH}>Mat</th><th className={PRINT_TH}>Nom</th><th className={PRINT_TH}>Prénom</th>
            {showTeamColumn && <th className={PRINT_TH}>Équipe</th>}
            <th className={PRINT_TH}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a, idx) => {
            const meta = RTG_STATUS_META[a.status] || { label: a.status };
            return (
              <tr key={a.driverId} style={printRowStyle(idx)}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}</td>
                <td className={PRINT_TD}>{a.prenom}</td>
                {showTeamColumn && <td className={PRINT_TD}>{a.teamNom}</td>}
                <td className={PRINT_TD}>{meta.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================
// 3. Affectation du jour
// ==========================================
// Le groupe "V1+V2" (journée complète) est réservé aux stagiaires (jamais de
// rotation automatique pour eux, cf. AssignmentEditModal/ccPosteRotationEngine)
// — affiché "Stagiaires" plutôt que le nom technique "V1+V2", pour
// correspondre à la colonne "STAGIAIRES" du modèle terrain (exploitant CC).
function vacationGroupTitle(vacation) {
  if (vacation.id === "V1+V2") return `Stagiaires · ${vacation.start} → ${vacation.end}`;
  return `Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`;
}

function AffectationDuJour() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  // isTeamRestricted couvre RESPONSABLE_SHIFT ET CONDUCTEUR (§39, demande
  // explicite de l'exploitant : le conducteur voit l'affectation du jour de
  // son équipe, en lecture seule — cette page n'a de toute façon aucune
  // action d'édition).
  const shiftRestricted = isTeamRestricted(currentUser);
  const ownTeamId = restrictedTeamId(currentUser, rawState);
  // Ne considérer que les équipes/conducteurs de la flotte sélectionnée
  // (bascule RTG/CC) — un compte restreint reste sur sa propre équipe quelle
  // que soit cette bascule.
  const fTeams = fleetTeams(rawState, shiftRestricted ? ownTeamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  // Un CONDUCTEUR ne peut consulter que la journée en cours et J+1 (demande
  // explicite de l'exploitant) — le sélecteur de date libre est remplacé par
  // deux boutons Aujourd'hui/Demain ci-dessous.
  const dateLocked = isDriverRestricted(currentUser);
  const todayIso = RTGDate.toISO(new Date());
  const tomorrowIso = RTGDate.toISO(RTGDate.addDays(new Date(), 1));
  // Pré-remplissage depuis l'Assistant intelligent (lien "Voir l'affectation"
  // sur une alerte datée — ?date=YYYY-MM-DD) : sinon, aujourd'hui par défaut.
  // Ignoré pour un CONDUCTEUR (qui n'accède de toute façon pas à l'Assistant
  // intelligent) si la date tombe hors de la plage autorisée.
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get("date");
  const initialDate = dateParam && (!dateLocked || dateParam === todayIso || dateParam === tomorrowIso) ? dateParam : todayIso;
  const [dateStr, setDateStr] = useState(initialDate);
  const [shiftFilter, setShiftFilter] = useState("all");
  // Flotte affichée (même calcul que Home()/PlanningMensuel) — sert à
  // détecter la flotte CC pour l'avertissement "prévisionnel" ci-dessous.
  const displayedFleet = shiftRestricted && rawState.teams.find(t => t.id === ownTeamId)
    ? (rawState.teams.find(t => t.id === ownTeamId).typeEngin || "RTG")
    : rawState.currentFleet;
  // Rotation QUAI/PARC CC (file d'attente, §ccPosteRotationEngine) : contrairement
  // à la rotation RTG (simple pointeur individuel par conducteur), une seule
  // absence non encore saisie pour demain peut rebattre l'ORDRE DE TOUTE
  // L'ÉQUIPE au-delà — on ne peut donc pas présenter un jour > demain comme
  // une affectation acquise tant que l'affectation réelle de demain n'est pas
  // connue (demande explicite de l'exploitant, §"ON PEUT PAS DIVINER l'AFFECTATION J+2").
  const isCcProjection = displayedFleet === "CC" && dateStr > tomorrowIso;

  const assignments = useMemo(() => {
    try {
      const all = PlanningEngine.generateDailyAssignments(dateStr, state);
      return shiftRestricted ? all.filter(a => a.teamId === ownTeamId) : all;
    } catch (e) { return []; }
  }, [state, dateStr, shiftRestricted, ownTeamId]);

  // Un Responsable de Shift (ou un Conducteur) n'a qu'une seule équipe donc
  // qu'un seul shift pertinent ce jour-là (les 2 autres sections seraient
  // vides) : on le détermine automatiquement plutôt que de proposer le
  // sélecteur.
  const dateObjForShift = RTGDate.parseISO(dateStr);
  const ownTeam = shiftRestricted ? state.teams.find(t => t.id === ownTeamId) : null;
  const ownShiftId = ownTeam ? ShiftRotationEngine.getTeamShiftForDate(ownTeam, dateObjForShift, state.config) : null;
  const effectiveShiftFilter = shiftRestricted ? ownShiftId : shiftFilter;
  const visibleShifts = effectiveShiftFilter === "all" ? state.config.shifts : state.config.shifts.filter(s => s.id === effectiveShiftFilter);

  const holiday = HolidayEngine.getHoliday(dateStr, state.config);

  const presentDrivers = assignments.filter(a => a.status === "PRESENT");

  // Un conducteur absent (repos, congé, maladie, absence, formation) reste
  // rattaché au shift de son équipe ce jour-là (le shift/vacation/zone ne
  // sont calculés par le moteur que pour les conducteurs présents) — on
  // retrouve donc ce shift via son équipe. Pour la vacation, il faut le
  // label AFFICHÉ ce jour précis par son bloc (VacationRotationEngine —
  // bascule quotidienne du bloc ENTIER), PAS driver.initialVacation tel
  // quel : ce dernier n'est que le label de départ du bloc à
  // rotationReferenceDate, il ne correspond au label du jour que certains
  // jours sur deux (bug corrigé : un absent d'un bloc affichant "V1"
  // aujourd'hui apparaissait sous "Vacation V2" — son identité fixe — alors
  // que ses collègues PRÉSENTS du même bloc, eux, apparaissaient bien sous
  // "Vacation V1", le label du jour).
  const ABSENT_STATUSES = ["REPOS", "CONGE", "MALADIE", "ABSENCE", "FORMATION"];
  const driverById = {};
  state.drivers.forEach(d => { driverById[d.id] = d; });
  const teamShiftMap = {};
  const dateObj = RTGDate.parseISO(dateStr);
  state.teams.forEach(t => { teamShiftMap[t.id] = ShiftRotationEngine.getTeamShiftForDate(t, dateObj, state.config); });
  const vacationLabelToday = {};
  state.drivers.forEach(d => { vacationLabelToday[d.id] = VacationRotationEngine.getVacationForDate(d, dateObj, state, state.teams.find(t => t.id === d.teamId)); });
  const absentByShift = {};
  state.config.shifts.forEach(s => {
    absentByShift[s.id] = assignments.filter(a => ABSENT_STATUSES.indexOf(a.status) !== -1 && teamShiftMap[a.teamId] === s.id);
  });

  // Même ordre que le Planning Mensuel (ordreAffichage, rempli par l'import
  // Excel — §35 ; nuls en dernier, tri stable sinon) — demande explicite de
  // l'exploitant : maintenant que présents ET absents partagent le même
  // tableau, ils doivent rester dans l'ordre habituel de l'équipe, pas
  // "présents d'abord puis absents en vrac à la fin".
  const byOrdreAffichage = (a, b) => {
    const oa = (driverById[a.driverId] || {}).ordreAffichage, ob = (driverById[b.driverId] || {}).ordreAffichage;
    if (oa == null && ob == null) return 0;
    if (oa == null) return 1;
    if (ob == null) return -1;
    return oa - ob;
  };
  // Flotte CC uniquement (demande explicite de l'exploitant) : l'ordre affiché
  // suit le rang réel dans la file QUAI/PARC du jour (CcPosteRotationEngine),
  // pas l'ordre habituel de l'équipe — ceux qui étaient au QUAI la veille (donc
  // repoussés en fin de file) apparaissent en bas, ceux qui remontent en tête
  // (repos/PARC/AUTORISE la veille) en haut, pour que le responsable affecte
  // les postes QUAI/PARC du jour simplement de haut en bas.
  const byCcRank = (a, b) => {
    const da = driverById[a.driverId], db = driverById[b.driverId];
    const ra = da ? CcPosteRotationEngine.getRankForDate(da, dateObj, state, state.teams) : null;
    const rb = db ? CcPosteRotationEngine.getRankForDate(db, dateObj, state, state.teams) : null;
    if (ra == null && rb == null) return byOrdreAffichage(a, b);
    if (ra == null) return 1;
    if (rb == null) return -1;
    return ra - rb;
  };
  const rowSort = displayedFleet === "CC" ? byCcRank : byOrdreAffichage;

  // Donner la main au responsable pour renseigner/corriger l'affectation du
  // jour même (poste QUAI/PARC pour un conducteur CC, zone pour un RTG) —
  // même modale et même permission que l'édition case par case du Planning
  // Mensuel (§32) : ADMIN/RESPONSABLE/RESPONSABLE_SHIFT seulement, jamais le
  // CONDUCTEUR (lecture seule). Demande explicite de l'exploitant : la
  // rotation automatique n'est qu'une PROPOSITION de priorité (cf. bandeau
  // "prévisionnel" ci-dessus) — c'est la saisie du jour même par le
  // responsable qui fait foi.
  const canEditPlanning = !!currentUser && ["ADMIN", "RESPONSABLE", "RESPONSABLE_SHIFT"].indexOf(currentUser.role) !== -1;
  const [editing, setEditing] = useState(null);
  const onEditRow = canEditPlanning ? (a) => {
    const driver = driverById[a.driverId];
    if (driver) setEditing({ driver: driver, iso: dateStr, assignment: a });
  } : undefined;

  const grouped = {};
  state.config.shifts.forEach(s => {
    const vacDefs = state.config.vacations[s.id] || [];
    grouped[s.id] = vacDefs.map(v => ({
      vacation: v,
      rows: assignments.filter(a => a.shift === s.id && a.vacation === v.id && a.status === "PRESENT")
        .concat(absentByShift[s.id].filter(a => vacationLabelToday[a.driverId] === v.id))
        .sort(rowSort)
    }));
    // "V1+V2" (journée complète, 8h — stagiaires cavaliers, cf. AssignmentEditModal) :
    // groupe à part, sinon ces affectations manuelles ne correspondent à aucune
    // vacation de 4h ci-dessus et disparaîtraient silencieusement de la page.
    const fullDayRows = assignments.filter(a => a.shift === s.id && a.vacation === "V1+V2" && a.status === "PRESENT").sort(byOrdreAffichage);
    if (fullDayRows.length > 0) {
      grouped[s.id].push({
        vacation: { id: "V1+V2", start: vacDefs.length ? vacDefs[0].start : "", end: vacDefs.length ? vacDefs[vacDefs.length - 1].end : "" },
        rows: fullDayRows
      });
    }
  });
  const offRows = assignments.filter(a => a.status === "OFF").sort(byOrdreAffichage);

  const exportExcel = () => {
    const suffix = effectiveShiftFilter !== "all" ? "-" + effectiveShiftFilter : "";
    if (holiday) {
      const headers = ["Mat", "Nom", "Prénom", "Équipe", "Mouvements réalisés", "Commentaire"];
      const rows = presentDrivers.map(a => {
        const rec = RTGStore.getFerieMouvements(dateStr, a.driverId);
        return [a.matricule, a.nom, a.prenom, a.teamNom, rec ? rec.mouvements : "", rec ? rec.commentaire || "" : ""];
      });
      downloadCSV(`affectation-${dateStr}-jour-ferie.csv`, headers, rows);
      return;
    }
    const headers = ["Shift", "Vacation", "Mat", "Nom", "Prénom", "Équipe", "Horaire", "Zone", "Statut"];
    const rows = [];
    visibleShifts.forEach(s => {
      grouped[s.id].forEach(({ vacation, rows: vrows }) => {
        vrows.forEach(a => {
          const statusLabel = (RTG_STATUS_META[a.status] || {}).label || a.status;
          rows.push([s.label, vacation.id, a.matricule, a.nom, a.prenom, a.teamNom,
            a.startTime ? `${a.startTime}-${a.endTime}` : "", a.zone || "",
            a.status === "PRESENT" ? "Présent" : statusLabel]);
        });
      });
    });
    if (offRows.length > 0 && (effectiveShiftFilter === "all" || effectiveShiftFilter === "S3")) {
      offRows.forEach(a => rows.push(["Shift 3", "", a.matricule, a.nom, a.prenom, a.teamNom, "", "", "OFF"]));
    }
    downloadCSV(`affectation-${dateStr}${suffix}.csv`, headers, rows);
  };

  // Un conteneur "papier" DISTINCT par shift (au lieu d'un seul bloc pour
  // tous les shifts visibles) : chaque shift n'a qu'une seule équipe (§
  // teamShiftMap ci-dessus — mentionnée dans l'en-tête de section plutôt que
  // répétée par ligne), et l'exploitant veut que CE shift tienne toujours
  // sur une seule page PDF, jamais à cheval sur deux si les repos/congés du
  // jour sont nombreux (voir exportNodesAsPdf — une page par nœud, chacune
  // "fit-to-page" indépendamment des autres).
  const holidayPrintRef = useRef(null);
  const shiftPrintRefs = useRef({});
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const suffix = effectiveShiftFilter !== "all" ? "-" + effectiveShiftFilter : "";
      const filename = `affectation-${dateStr}${suffix}.pdf`;
      // Portrait + capture plus étroite (800px au lieu de 1200) — demande
      // explicite de l'exploitant : ce rapport n'a plus que 5-6 colonnes
      // (Équipe/Horaire retirées), le format portrait laisse donc les noms
      // et zones s'imprimer avec un texte plus grand et plus lisible que
      // sur un format paysage large et peu rempli.
      if (holiday) {
        if (!holidayPrintRef.current) return;
        await exportNodeAsPdf(holidayPrintRef.current, filename, { fitOnePage: true, orientation: "portrait", forceWidth: 800 });
        return;
      }
      const nodes = visibleShifts.map(s => shiftPrintRefs.current[s.id]).filter(Boolean);
      if (nodes.length === 0) return;
      await exportNodesAsPdf(nodes, filename, 800, "portrait");
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Affectation du jour</h1>
          <p className="text-slate-400 text-sm mt-0.5">Sélectionnez une date, et éventuellement un shift, pour voir l'affectation détaillée</p>
        </div>
        <div className="flex gap-2">
          <ExportPdfButton onClick={exportPdf} busy={pdfBusy} />
          <ExportExcelButton onClick={exportExcel} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date</label>
          {dateLocked ? (
            <div className="flex gap-1">
              <button onClick={() => setDateStr(todayIso)}
                className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${dateStr === todayIso ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Aujourd'hui</button>
              <button onClick={() => setDateStr(tomorrowIso)}
                className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${dateStr === tomorrowIso ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Demain</button>
            </div>
          ) : (
            <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900" />
          )}
        </div>
        <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(dateStr))}</div>
        {!shiftRestricted && (
          <div className="ml-auto">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Shift à afficher</label>
            <div className="flex gap-1">
              <button onClick={() => setShiftFilter("all")}
                className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${shiftFilter === "all" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Tous</button>
              {state.config.shifts.map(s => (
                <button key={s.id} onClick={() => setShiftFilter(s.id)}
                  className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${shiftFilter === s.id ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {holiday && (
        <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 text-indigo-700 rounded-xl px-4 py-3 text-sm print:hidden">
          <i className="fas fa-star-and-crescent"></i> Jour férié — {holiday.label} — journée chômée, aucune affectation générée
        </div>
      )}

      {isCcProjection && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 text-amber-800 rounded-xl px-4 py-3 text-sm print:hidden">
          <i className="fas fa-triangle-exclamation mt-0.5"></i>
          <div>
            <p className="font-semibold">Affectation prévisionnelle — au-delà de demain</p>
            <p className="mt-0.5 text-amber-700">
              Tant que le responsable n'a pas saisi l'affectation réelle de demain ({RTGDate.formatFr(RTGDate.parseISO(tomorrowIso))}),
              la rotation QUAI/PARC affichée ici pour le {RTGDate.formatFr(RTGDate.parseISO(dateStr))} n'est qu'une simulation qui
              suppose qu'aucun imprévu (congé, maladie, absence) ne survient d'ici là. Un seul imprévu non encore saisi peut rebattre
              l'ordre de toute l'équipe : ce tableau se recalculera automatiquement au fur et à mesure des saisies réelles, jour après jour.
            </p>
          </div>
        </div>
      )}

      {holiday && (
        <div className="print:hidden">
          <FerieMouvementsPanel dateStr={dateStr} presentDrivers={presentDrivers} />
        </div>
      )}

      <div className="print:hidden space-y-4">
        {visibleShifts.map(s => (
          <div key={s.id} className="space-y-3 pb-4 border-b border-slate-200/60 last:border-0">
            <h2 className="text-sm font-bold text-orange-400 uppercase tracking-wider">{s.label} <span className="text-slate-500 font-normal">({s.start} → {s.end})</span></h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {grouped[s.id].map(({ vacation, rows }) => (
                <ShiftBlock key={vacation.id} title={vacationGroupTitle(vacation)} icon={vacation.id === "V1+V2" ? "fa-user-graduate" : "fa-clock"} rows={rows} onEditRow={onEditRow} />
              ))}
            </div>
          </div>
        ))}

        {offRows.length > 0 && (effectiveShiftFilter === "all" || effectiveShiftFilter === "S3") && (
          <ShiftBlock title="OFF — Shift 3 dimanche" icon="fa-power-off" rows={offRows} onEditRow={onEditRow} />
        )}
      </div>

      {editing && (
        <AssignmentEditModal driver={editing.driver} iso={editing.iso} assignment={editing.assignment} config={state.config} teams={state.teams} onClose={() => setEditing(null)} />
      )}

      {/* Rapport imprimable — noir sur blanc, indépendant du thème sombre de
          l'appli. Jour férié : un seul bloc/page. Sinon : UN BLOC PAR SHIFT
          (chacun sa propre équipe, mentionnée dans son en-tête), exporté
          ensuite une page PDF par bloc (cf. exportPdf/exportNodesAsPdf). */}
      {holiday ? (
        <div ref={holidayPrintRef} className="print-report bg-white text-slate-900 rounded-xl p-0">
          <PrintHeader
            subtitle={"Rapport d'affectation journalière — RTG — " + RTGDate.formatFr(RTGDate.parseISO(dateStr)) + (shiftRestricted ? " — " + (state.teams.find(t => t.id === ownTeamId) || {}).nom : "")}
            count={presentDrivers.length} countLabel="conducteur présent"
          />
          <div>
            <p className="text-xs mb-3">Jour férié — {holiday.label} — journée chômée, aucune affectation générée.</p>
            <FerieMouvementsPrintable dateStr={dateStr} presentDrivers={presentDrivers} />
            <ReposCongesPrintable rows={assignments.filter(a => a.status === "REPOS" || a.status === "CONGE")} />
          </div>
          <div className="mt-4 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
            Document généré automatiquement par CES Driver Planner.
          </div>
        </div>
      ) : (
        visibleShifts.map(s => {
          const shiftTeam = state.teams.find(t => teamShiftMap[t.id] === s.id);
          const includeOff = s.id === "S3" && offRows.length > 0;
          const shiftCount = grouped[s.id].reduce((n, g) => n + g.rows.length, 0) + (includeOff ? offRows.length : 0);
          return (
            <div key={s.id} ref={el => { shiftPrintRefs.current[s.id] = el; }} className="print-report bg-white text-slate-900 rounded-xl p-0">
              <PrintHeader
                subtitle={"Rapport d'affectation journalière — RTG — " + RTGDate.formatFr(RTGDate.parseISO(dateStr)) + " — " + s.label + (s.start ? ` (${s.start} → ${s.end})` : "") + (shiftTeam ? " — " + shiftTeam.nom : "")}
                count={shiftCount} countLabel="conducteur"
              />
              <div>
                {grouped[s.id].map(({ vacation, rows }) => (
                  <ShiftBlockPrintable key={vacation.id} title={vacationGroupTitle(vacation)} rows={rows} showTeamColumn={false} />
                ))}
                {includeOff && <ShiftBlockPrintable title="OFF — Shift 3 dimanche" rows={offRows} showTeamColumn={false} />}
              </div>
              <div className="mt-4 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
                Document généré automatiquement par CES Driver Planner.
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
