// ==========================================
// RTG DRIVER PLANNER — Edge Function : import automatique des mouvements
// RTG depuis le rapport TOS "DRIVER MOVES PER SHIFT"
// ==========================================
// Le TOS (système d'exploitation du terminal — hors de tout accès direct
// pour cette application) envoie un email avec ce rapport en pièce jointe
// .xls à la fin de CHAQUE shift (S1/S2/S3). L'exploitant a mis en place une
// règle de transfert automatique sur sa boîte professionnelle vers une boîte
// dédiée (Outlook, marsamaroc.CES@outlook.fr), lue ici via l'API Microsoft
// Graph (HTTPS, OAuth2) — PAS en IMAP classique. Historique des essais
// écartés avant d'arriver à cette solution : Gmail (compte
// gestioneffectif@gmail.com bloqué par Google, vérification téléphonique
// impossible), Yahoo (création de compte bloquée par la vérification
// téléphonique), iCloud (Mail iCloud indisponible sans appareil Apple
// physique), et l'IMAP classique d'Outlook.com lui-même (mot de passe
// d'application refusé — "Login is disabled", Microsoft imposant
// l'authentification OAuth2 pour l'accès protocole). Microsoft Graph
// (API REST moderne, disponible nativement pour un compte Outlook
// personnel une fois un tenant Azure AD créé) contourne cette dernière
// limite : plus besoin d'IMAP du tout, juste des appels HTTPS authentifiés
// par un jeton OAuth2 rafraîchi automatiquement (voir getGraphAccessToken
// ci-dessous, jeton géré dans la table mail_oauth_tokens — voir
// migration_034 et la fonction oauth-outlook-setup pour l'obtenir la
// première fois).
//
// Déclenchée par pg_cron (voir migration_009_cron_import_tos_moves.sql)
// toutes les 5 minutes : liste les emails reçus dans les derniers jours
// dont le sujet contient "DRIVER MOVES PER SHIFT", parse la pièce jointe
// .xls — DEUX onglets, un par flotte : "RTG" et "SC" (Straddle Carrier, le
// nom technique du chariot cavalier — flotte "CC" dans cette application)
// — et enregistre une ligne par conducteur x engin dans la table
// mouvements_tos, pour les deux flottes.
//
// Rattachement conducteur : le rapport identifie chaque conducteur par un
// LOGIN TOS (ex. "mcharihtc3"), jamais par son matricule. Convention confirmée
// par l'exploitant : LOGIN = 1ère lettre du PRÉNOM + NOM (sans accents/espaces,
// en minuscules) + suffixe du terminal — mais ce suffixe DIFFÈRE selon la
// flotte (vérifié sur un rapport réel) : "tc3" pour les conducteurs RTG (ex.
// "aabouelfathtc3"), "tce" pour les conducteurs CC (ex. "aadditce") — voir
// LOGIN_SUFFIX_BY_FLEET. Le rattachement est donc déterministe : pour chaque
// conducteur actif, on calcule son login
// attendu et on le compare au LOGIN du rapport — aucune table de correspondance
// à maintenir à la main. La comparaison se fait TOUJOURS au sein de la même
// flotte que l'onglet en cours (un conducteur RTG et un conducteur CC
// homonymes ne sont jamais comparés entre eux, même s'ils partagent le même
// login dérivé — l'un des deux n'apparaît de toute façon jamais dans cet
// onglet). Un login sans correspondance dans sa flotte (ou ambigu, si jamais
// 2 conducteurs actifs de la même flotte partageaient le même login dérivé)
// est importé quand même (driver_id = null, match_note renseigné) pour rester
// visible et corrigeable plutôt que d'être silencieusement perdu.
//
// Les emails traités sont recherchés par DATE (derniers jours), pas par
// statut lu/non lu : le statut "lu" d'un email peut changer à tout moment
// (n'importe quelle consultation de la boîte via l'interface webmail marque
// l'email comme lu), ce qui le ferait disparaître définitivement de la
// recherche si on se basait dessus. Comme l'insertion des mouvements est
// une upsert avec contrainte anti-doublon (login_tos, date_travail, shift,
// engin), retraiter plusieurs fois le même email ne crée aucun doublon —
// c'est donc sans risque de le revoir à chaque exécution pendant sa fenêtre
// de rétention. MAIS le RE-TRAITEMENT COMPLET (téléchargement + parsing
// XLSX de la pièce jointe) de TOUS les emails de la fenêtre à CHAQUE
// exécution (toutes les 5 min) est coûteux en CPU ; avec 7 jours × 3 shifts
// d'accumulés, ce coût grossit et a fini par dépasser le budget CPU de la
// fonction (erreurs "CPU Time exceeded" observées en pratique, causant
// l'échec silencieux de TOUT l'import, y compris des shifts jamais encore
// importés). Pour rester sans risque de perte (toujours rebalayer la
// fenêtre par date, jamais par statut lu) SANS reparser ce qui est déjà en
// base, chaque email est d'abord identifié par son Message-ID (issu de la
// liste initiale, sans appel supplémentaire) et comparé à
// mouvements_tos.source_message_id déjà connus pour cette même fenêtre :
// seul un email VRAIMENT nouveau déclenche le téléchargement de la pièce
// jointe et le parsing complet.
//
// Secrets nécessaires (Project Settings > Edge Functions > Secrets) :
//   - MAIL_OAUTH_CLIENT_ID : Application (client) ID de l'inscription
//     Azure AD "CES Driver Planner Mail" (voir oauth-outlook-setup pour la
//     procédure complète d'inscription + autorisation initiale).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut, déjà
// disponibles automatiquement.
//
// DÉPLOIEMENT : Edge Functions > Create a new function > "import-tos-moves" >
// coller ce fichier > Deploy. Puis exécuter migration_008_mouvements_tos.sql
// (table), migration_009_cron_import_tos_moves.sql (planification) et
// migration_034_mail_oauth_tokens.sql (jetons OAuth2) — et avoir déjà
// exécuté oauth-outlook-setup au moins une fois (voir son en-tête).

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SUBJECT_FILTER = "DRIVER MOVES PER SHIFT";
// Rapport horaire "Quay Crane and RTG Moves per hour" (pièce jointe
// REP_RTG_MOVES_HOURLY_*.xls) : cadence des RTG sur une fenêtre glissante de 60 min.
const HOURLY_SUBJECT = "RTG MOVES PER HOUR";
// Alertes push de cadence horaire DÉSACTIVÉES (demande exploitant : alertes uniquement
// pour les sessions TOS restées ouvertes en fin de vacation / fin de shift). Le rapport
// horaire reste importé et consultable dans l'onglet "Cadence RTG".
const CADENCE_ALERTS_ENABLED = false;
const GRAPH_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_SCOPE = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access";

// Rafraîchit (et met en cache en base, avec une marge de sécurité de 2 min)
// l'access_token Microsoft Graph à partir du refresh_token stocké — voir
// migration_034_mail_oauth_tokens.sql et oauth-outlook-setup pour l'obtenir
// la première fois. Dupliqué à l'identique dans chaque Edge Function
// utilisant Graph (send-conge-email, etc.) — pas de module partagé entre
// fonctions, chacune reste déployable isolément (convention du projet).
async function getGraphAccessToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const clientId = Deno.env.get("MAIL_OAUTH_CLIENT_ID");
  if (!clientId) throw new Error("MAIL_OAUTH_CLIENT_ID non configuré (Project Settings > Edge Functions > Secrets).");
  const { data: row, error } = await admin.from("mail_oauth_tokens").select("*").eq("id", "outlook").maybeSingle();
  if (error) throw new Error("Lecture du jeton OAuth2 Outlook échouée : " + error.message);
  if (!row) throw new Error("Aucun jeton OAuth2 Outlook enregistré — exécutez d'abord oauth-outlook-setup (voir son en-tête).");
  if (row.access_token && row.access_token_expires_at && new Date(row.access_token_expires_at).getTime() > Date.now() + 120000) {
    return row.access_token;
  }
  const resp = await fetch(GRAPH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
      scope: GRAPH_SCOPE
    })
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error("Rafraîchissement du jeton OAuth2 Outlook échoué : " + (json.error_description || json.error || resp.status));
  const expiresAt = new Date(Date.now() + (json.expires_in || 3600) * 1000).toISOString();
  await admin.from("mail_oauth_tokens").update({
    access_token: json.access_token,
    access_token_expires_at: expiresAt,
    refresh_token: json.refresh_token || row.refresh_token,
    updated_at: new Date().toISOString()
  }).eq("id", "outlook");
  return json.access_token;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Seuls S1/S2/S3 existent réellement sur ce terminal (3 vacations/jour) — un
// "S4" (ou toute autre valeur) déjà rencontré dans le rapport TOS vient
// systématiquement d'une erreur de frappe côté saisie TOS, jamais d'une
// vraie 4ème vacation. Comme "shift" fait partie de la clé anti-doublon
// (login_tos, date_travail, shift, engin), une correction manuelle a
// posteriori du fichier Excel (S4 -> S3) puis un renvoi n'écrase PAS la
// ligne S4 déjà importée — elle AJOUTE une ligne S3 à côté, et les deux se
// cumulent dans les totaux affichés (mouvement fantôme constaté en
// pratique sur ABOU EL FATH). On empêche donc toute ligne à shift invalide
// d'entrer en base dès l'import, et on nettoie celles déjà présentes à
// chaque exécution (même logique que mouvements_tos_logins_ignores).
const VALID_SHIFTS = new Set(["S1", "S2", "S3"]);

// Un onglet par flotte : nom de l'onglet dans le .xls, valeur attendue de la
// colonne TYPE_ENGIN sur ses lignes, et flotte correspondante côté
// application (teams.type_engin) pour restreindre le rattachement — voir
// l'en-tête du fichier.
const SHEETS: { sheetName: string; typeEnginValue: string; fleet: "RTG" | "CC" }[] = [
  { sheetName: "RTG", typeEnginValue: "RTG", fleet: "RTG" },
  { sheetName: "SC", typeEnginValue: "SC", fleet: "CC" }
];

// Déduit la flotte d'un code engin déjà enregistré (mouvements_tos.engin), pour
// l'auto-réparation ci-dessous — même convention que inferEnginFleet côté UI
// (pages2.js) : un code commençant par "RTG" est de la flotte RTG, tout le
// reste (codes SC/CC) est de la flotte CC.
function fleetForEngin(engin: string): "RTG" | "CC" {
  return /^RTG/i.test(engin || "") ? "RTG" : "CC";
}

function stripAccents(s: string) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForLogin(s: string) {
  return stripAccents(s || "").toLowerCase().replace(/[^a-z]/g, "");
}

// Convention confirmée par l'exploitant : 1ère lettre du prénom + nom complet
// (sans accents/espaces/tirets) + suffixe du terminal — MAIS ce suffixe n'est
// PAS le même pour les deux flottes (contrairement à ce que laissait entendre
// la documentation d'origine) : "tc3" pour les conducteurs RTG (ex.
// "aabouelfathtc3"), "tce" pour les conducteurs CC (ex. "aadditce") — vérifié
// directement sur un rapport TOS réel.
const LOGIN_SUFFIX_BY_FLEET: Record<"RTG" | "CC", string> = { RTG: "tc3", CC: "tce" };
function deriveTosLogin(driver: { nom: string; prenom: string }, fleet: "RTG" | "CC") {
  const p = normalizeForLogin(driver.prenom);
  const n = normalizeForLogin(driver.nom);
  if (!p || !n) return null;
  return p.charAt(0) + n + LOGIN_SUFFIX_BY_FLEET[fleet];
}

function excelDateToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return s.slice(0, 10) || null;
}

// Date+heure du rapport TOS ("06/10/2026 07:35:27" ou objet Date) -> chaîne
// "YYYY-MM-DD HH:MM:SS" (timestamp SANS fuseau, heure locale du terminal,
// telle qu'affichée dans le rapport), ou null si vide/illisible.
function toDateTimeText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
  }
  const m = String(v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6] || "00"}` : null;
}

// Shift RÉEL d'une session TOS (déduit de l'heure de login, tolérance 10 min ;
// à défaut de login, logout - 60 min) et heure de FIN de ce shift, en
// millisecondes "heure locale du terminal" (même repère que les timestamps
// du rapport, lus comme de l'UTC). Le rapport étiquette une session de nuit
// (login 03:02) "S1" parce qu'elle touche la fenêtre S1 : seul le login fait foi.
function sessionShiftInfoText(login: string | null, logout: string | null): { shift: string; endMs: number } | null {
  const parse = (t: string) => Date.parse(t.replace(" ", "T") + "Z");
  let refMs: number | null = null;
  if (login) refMs = parse(login);
  else if (logout) refMs = parse(logout) - 60 * 60 * 1000;
  if (refMs == null || isNaN(refMs)) return null;
  const adj = new Date(refMs + 10 * 60 * 1000);
  const h = adj.getUTCHours();
  const endOf = (addDays: number, hour: number) => Date.UTC(adj.getUTCFullYear(), adj.getUTCMonth(), adj.getUTCDate() + addDays, hour, 0, 0);
  if (h >= 7 && h < 15) return { shift: "S1", endMs: endOf(0, 15) };
  if (h >= 15 && h < 23) return { shift: "S2", endMs: endOf(0, 23) };
  return { shift: "S3", endMs: endOf(h >= 23 ? 1 : 0, 7) };
}

// "Maintenant" à Casablanca, dans le même repère (composantes locales lues comme UTC).
function nowCasablancaMs(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(new Date());
  const g = (t: string) => Number(parts.find(p => p.type === t)!.value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
}

// Date/heure d'une cellule du rapport horaire (Date, numéro de série Excel ou
// texte "jj/mm/aaaa hh:mm:ss") -> "YYYY-MM-DD HH:MM:00" arrondi à la minute
// (heure locale du terminal, lue comme de l'UTC).
function cadenceTime(v: unknown): string | null {
  let ms: number | null = null;
  if (v instanceof Date) ms = v.getTime();
  else if (typeof v === "number" && Number.isFinite(v)) ms = Math.round((v - 25569) * 86400000);
  else if (typeof v === "string") {
    const t = toDateTimeText(v);
    if (t) ms = Date.parse(t.replace(" ", "T") + "Z");
  }
  if (ms == null || isNaN(ms)) return null;
  const d = new Date(Math.round(ms / 60000) * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

// Lecture du rapport horaire RTG : fenêtre glissante, totaux, et une ligne par
// RTG (deux blocs RTG01-07 / RTG08-14 côte à côte). Repérage par le CONTENU
// des cellules (pas par des positions figées) pour résister à un décalage.
function parseCadenceWorkbook(wb: XLSX.WorkBook) {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true }) as unknown[][];
  let windowStart: string | null = null, windowEnd: string | null = null, generatedAt: string | null = null;
  let minMoves = 15;
  let totals: { total: number | null; vessel: number | null; yard: number | null; gate: number | null } = { total: null, vessel: null, yard: null, gate: null };
  const rtgRows: { rtg: string; moves: number; statut: string | null }[] = [];
  const num = (v: unknown) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  rows.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      const t = typeof cell === "string" ? cell.trim() : "";
      if (/^Rolling window/i.test(t)) {
        windowStart = cadenceTime(row[ci + 2]);
        const toIdx = row.findIndex((c, i) => i > ci && String(c).trim().toLowerCase() === "to");
        if (toIdx >= 0) windowEnd = cadenceTime(row[toIdx + 1]);
      } else if (/^Generated\s/i.test(t)) {
        const m = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (m) generatedAt = `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
      } else if (/Minimum:\s*(\d+)/i.test(t)) {
        minMoves = Number(t.match(/Minimum:\s*(\d+)/i)![1]);
      } else if (/^TOTAL RTG EVENTS/i.test(t)) {
        const vals = rows[ri + 1] || [];
        const idx = (label: RegExp) => row.findIndex(c => label.test(String(c).trim()));
        const at = (label: RegExp) => { const i = idx(label); return i >= 0 ? num(vals[i]) : null; };
        totals = { total: at(/^TOTAL RTG EVENTS/i), vessel: at(/^VESSEL RTG EVENTS/i), yard: at(/^YARD RTG EVENTS/i), gate: at(/^GATE/i) };
      } else if (/^RTG\d+$/i.test(t)) {
        const moves = num(row[ci + 1]);
        if (moves != null) rtgRows.push({ rtg: t.toUpperCase(), moves, statut: String(row[ci + 3] || "").trim().toUpperCase() || null });
      }
    });
  });
  return { windowStart, windowEnd, generatedAt, minMoves, totals, rtgRows };
}

function toInt(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

Deno.serve(async _req => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let accessToken: string;
  try {
    accessToken = await getGraphAccessToken(admin);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // Tous les conducteurs actifs, des deux flottes — mais le rattachement d'un
  // login se fait TOUJOURS au sein d'une seule flotte à la fois (voir
  // buildLoginMap ci-dessous), jamais tous conducteurs confondus : sans ça,
  // un conducteur CC homonyme d'un conducteur RTG (même 1ère lettre de
  // prénom + même nom, ex. deux "ADDI") produirait le même login dérivé que
  // son homonyme et rendrait le rattachement faussement ambigu, alors que
  // chacun n'apparaît que dans l'onglet de sa propre flotte.
  const { data: drivers, error: driversError } = await admin
    .from("drivers")
    .select("id,nom,prenom,actif,login_tos,team_id,teams!inner(type_engin)")
    .eq("actif", true);
  if (driversError) {
    return new Response(JSON.stringify({ ok: false, error: "Chargement conducteurs échoué : " + driversError.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // Selon la version de PostgREST/supabase-js, une ressource imbriquée
  // to-one (teams!inner(...)) peut être renvoyée soit comme un objet, soit
  // comme un tableau à un élément — gérer les deux formes explicitement
  // plutôt que de supposer l'une d'elles est CRITIQUE ici : une mauvaise
  // supposition rend cette fonction silencieuse (aucune erreur), avec pour
  // conséquence que TOUS les conducteurs sont exclus des deux flottes, donc
  // plus AUCUN login ne correspond jamais à personne — et l'upsert plus bas
  // écrase alors le rattachement déjà correct des lignes déjà importées
  // (driver_id remis à null) à chaque exécution du cron.
  function driverFleet(d: { teams: unknown }): string | null {
    const t = Array.isArray(d.teams) ? d.teams[0] : d.teams;
    return (t && (t as { type_engin?: string }).type_engin) || null;
  }

  // login TOS attendu -> liste des driver_id qui y correspondent (normalement
  // 1 seul ; plus d'un = ambiguïté à signaler). Un login_tos saisi à la main
  // sur la fiche conducteur (cas d'un compte TOS orthographié différemment du
  // nom officiel) prime sur la déduction automatique.
  function buildLoginMap(fleetDrivers: typeof drivers, fleet: "RTG" | "CC") {
    const loginMap = new Map<string, string[]>();
    (fleetDrivers || []).forEach(d => {
      const login = (d.login_tos && d.login_tos.trim()) ? d.login_tos.trim().toLowerCase() : deriveTosLogin(d, fleet);
      if (!login) return;
      if (!loginMap.has(login)) loginMap.set(login, []);
      loginMap.get(login)!.push(d.id);
    });
    return loginMap;
  }

  const loginMapByFleet: Record<"RTG" | "CC", Map<string, string[]>> = {
    RTG: buildLoginMap((drivers || []).filter(d => driverFleet(d) === "RTG"), "RTG"),
    CC: buildLoginMap((drivers || []).filter(d => driverFleet(d) === "CC"), "CC")
  };

  // Garde-fou : si malgré tout aucun conducteur n'est reconnu dans AUCUNE des
  // deux flottes alors que la table drivers n'est pas vide, quelque chose ne
  // va pas dans la forme des données renvoyées par la requête ci-dessus —
  // mieux vaut échouer bruyamment que de continuer et écraser silencieusement
  // le rattachement déjà correct de toutes les lignes existantes.
  if ((drivers || []).length > 0 && loginMapByFleet.RTG.size === 0 && loginMapByFleet.CC.size === 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Aucun conducteur reconnu dans une flotte (RTG ou CC) alors que " + (drivers || []).length + " conducteur(s) actif(s) existent — anomalie dans la forme des données renvoyées par la requête 'drivers'. Import annulé par sécurité (aucune écriture effectuée)."
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  // Logins volontairement ignorés (ex. conducteur tracteur ayant ponctuellement
  // opéré un RTG) — jamais insérés, et toute ligne déjà importée pour l'un
  // d'eux est supprimée ci-dessous.
  const { data: ignoredLoginRows } = await admin.from("mouvements_tos_logins_ignores").select("login_tos");
  const ignoredLogins = new Set((ignoredLoginRows || []).map(r => r.login_tos));

  let ignoredRowsDeleted = 0;
  if (ignoredLogins.size > 0) {
    const { data: deleted } = await admin.from("mouvements_tos").delete().in("login_tos", Array.from(ignoredLogins)).select("id");
    ignoredRowsDeleted = (deleted || []).length;
  }

  // Auto-nettoyage des lignes à shift invalide déjà en base (voir VALID_SHIFTS
  // ci-dessus) — couvre à la fois l'historique déjà importé avant ce correctif
  // et toute ligne qui aurait pu se glisser par un autre chemin.
  const { data: invalidShiftDeleted } = await admin
    .from("mouvements_tos")
    .delete()
    .not("shift", "in", `(${Array.from(VALID_SHIFTS).join(",")})`)
    .select("id");
  const invalidShiftRowsDeleted = (invalidShiftDeleted || []).length;

  // Auto-réparation : des lignes déjà en base non rattachées (driver_id null,
  // ex. importées avant qu'un "Login TOS" correctif soit renseigné sur la
  // fiche conducteur) sont retentées à chaque exécution — sans ça, une
  // correction faite après coup ne s'appliquerait qu'aux imports futurs,
  // jamais à l'historique déjà importé. Faite PAR LOT (une requête par login
  // distinct plutôt qu'une requête par ligne) : avec plusieurs centaines de
  // lignes non rattachées (ex. après un import massif ou un incident), une
  // réparation ligne par ligne peut dépasser le temps d'exécution de la
  // fonction avant même d'avoir traité les emails du jour.
  // PostgREST plafonne une réponse .select() à 1000 lignes par défaut : sans
  // pagination explicite, un incident ou un import massif laissant plus de
  // 1000 lignes non rattachées en base ferait toujours revenir le MÊME
  // premier millier à chaque exécution — les logins situés au-delà ne
  // seraient alors JAMAIS réparés, peu importe le nombre de passages du cron.
  // Plafond de pages (20 × 1000 = 20 000 lignes non rattachées scannées max
  // par exécution) : une ligne dont le login ne correspondra JAMAIS à un
  // conducteur (ex. login d'un ancien conducteur parti) resterait sinon
  // scannée indéfiniment à CHAQUE exécution (toutes les 5 min), un coût qui
  // grossit avec le temps sans jamais se résorber — contributeur probable,
  // avec le re-parsing des emails déjà importés (voir plus haut), aux erreurs
  // "CPU Time exceeded" observées en pratique. Un plafond n'empêche pas la
  // réparation de progresser d'exécution en exécution (les lignes réparées
  // sortent du filtre driver_id IS NULL), juste le pire des cas.
  let reconciledRows = 0;
  const reconcileTargets = new Map<string, { loginTos: string; fleet: "RTG" | "CC"; driverId: string }>();
  const PAGE_SIZE = 1000;
  const MAX_RECONCILE_PAGES = 20;
  for (let offset = 0, page_num = 0; page_num < MAX_RECONCILE_PAGES; offset += PAGE_SIZE, page_num++) {
    const { data: page } = await admin.from("mouvements_tos").select("login_tos, engin").is("driver_id", null)
      .range(offset, offset + PAGE_SIZE - 1);
    (page || []).forEach(row => {
      const fleet = fleetForEngin(row.engin);
      const matches = loginMapByFleet[fleet].get(row.login_tos) || [];
      if (matches.length !== 1) return;
      reconcileTargets.set(fleet + "|" + row.login_tos, { loginTos: row.login_tos, fleet, driverId: matches[0] });
    });
    if (!page || page.length < PAGE_SIZE) break;
  }
  for (const target of reconcileTargets.values()) {
    let q = admin.from("mouvements_tos").update({ driver_id: target.driverId, match_note: null })
      .eq("login_tos", target.loginTos).is("driver_id", null);
    q = target.fleet === "RTG" ? q.ilike("engin", "RTG%") : q.not("engin", "ilike", "RTG%");
    const { data: updated, error: reconcileError } = await q.select("id");
    if (!reconcileError) reconciledRows += (updated || []).length;
  }

  // Fenêtre de recherche large (7 jours) : couvre les week-ends et les
  // éventuels retards d'acheminement, sans dépendre du statut lu/non lu.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  // Message-ID déjà importés sur cette fenêtre — un seul SELECT léger (une
  // colonne, pas le contenu des rapports) pour éviter de re-télécharger et
  // re-parser la pièce jointe de chaque email déjà traité à CHAQUE exécution
  // (voir l'en-tête du fichier).
  const { data: alreadyImportedRows } = await admin
    .from("mouvements_tos")
    .select("source_message_id")
    .not("source_message_id", "is", null)
    .gte("date_travail", since.toISOString().slice(0, 10));
  const alreadyImportedMessageIds = new Set((alreadyImportedRows || []).map(r => r.source_message_id));

  // Rapports horaires RTG déjà importés (évite de re-télécharger la pièce jointe).
  const cadenceKnownIds = new Set<string>();
  try {
    const { data: cadKnown } = await admin.from("cadence_rtg_horaire").select("source_message_id")
      .not("source_message_id", "is", null).gte("window_end", since.toISOString().slice(0, 10));
    (cadKnown || []).forEach((r: { source_message_id: string }) => cadenceKnownIds.add(r.source_message_id));
  } catch { /* table absente : migration_038 pas encore exécutée */ }
  let cadenceImported = 0;
  let processedEmails = 0;
  let pushAlertsSent = 0;
  const debugRecent: { recu?: string; objet: string; pieceJointe: boolean; retenu: boolean }[] = [];
  let importedRows = 0;
  let skippedNoAttachment = 0;
  let skippedAlreadyImported = 0;
  let skippedInvalidShift = 0;
  const invalidShiftSamples = new Set<string>();
  const unmatchedLogins = new Set<string>();
  const errors: string[] = [];

  try {
    // Liste des emails de la fenêtre (avec pagination Graph via @odata.nextLink) —
    // filtrés côté serveur par date, puis par sujet côté client (le champ
    // "subject" n'est pas fiable en $filter/contains sur cet endpoint pour
    // tous les tenants ; un simple test .includes() en local est plus robuste
    // et le volume de cette boîte technique dédiée reste faible).
    const sinceIso = since.toISOString();
    let url: string | null =
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages` +
      `?$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}` +
      `&$select=id,subject,receivedDateTime,internetMessageId,hasAttachments` +
      `&$orderby=receivedDateTime desc&$top=50`;

    type GraphMessage = { id: string; subject?: string; internetMessageId?: string; hasAttachments?: boolean; receivedDateTime?: string };
    const matchingMessages: GraphMessage[] = [];

    while (url) {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = await resp.json();
      if (!resp.ok) {
        errors.push("Listage des emails échoué : " + (json.error ? json.error.message : resp.status));
        break;
      }
      ((json.value || []) as GraphMessage[]).forEach(m => {
        // Sujet "DRIVER MOVES PER SHIFT" (email TOS d'origine) — OU email SANS
        // objet avec pièce jointe (cas d'un transfert manuel qui a perdu son
        // sujet, "(sans objet)") : retenu aussi, la pièce jointe est alors
        // vérifiée par son NOM ci-dessous avant tout traitement.
        const subj = (m.subject || "").trim();
        const matched = !!m.hasAttachments && (subj.toUpperCase().includes(SUBJECT_FILTER) || subj.toUpperCase().includes(HOURLY_SUBJECT) || subj === "");
        if (matched) matchingMessages.push(m);
        if (debugRecent.length < 10) debugRecent.push({ recu: m.receivedDateTime, objet: subj || "(sans objet)", pieceJointe: !!m.hasAttachments, retenu: matched });
      });
      url = json["@odata.nextLink"] || null;
    }

    for (const message of matchingMessages) {
      let markRead = false;
      try {
        const messageId = message.internetMessageId || null;
        if (messageId && (alreadyImportedMessageIds.has(messageId) || cadenceKnownIds.has(messageId))) {
          skippedAlreadyImported++;
          processedEmails++;
          continue;
        }

        const attResp = await fetch(
          `https://graph.microsoft.com/v1.0/me/messages/${message.id}/attachments`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const attJson = await attResp.json();
        if (!attResp.ok) throw new Error("Récupération des pièces jointes échouée : " + (attJson.error ? attJson.error.message : attResp.status));

        const noSubject = !(message.subject || "").trim();
        const xlsAttachment = ((attJson.value || []) as { name?: string; contentBytes?: string }[])
          .find(a => /\.xls$/i.test(a.name || "") && a.contentBytes && (!noSubject || /DRIVER.?MOVES|LATEST.?SHIFT/i.test(a.name || "")));

        const cadenceAtt = ((attJson.value || []) as { name?: string; contentBytes?: string }[])
          .find(a => /\.xls$/i.test(a.name || "") && a.contentBytes && /MOVES_?HOURLY|RTG_?MOVES/i.test(a.name || ""));

        if (cadenceAtt) {
          // ---- Rapport horaire de cadence des RTG ----
          const cwb = XLSX.read(base64ToBytes(cadenceAtt.contentBytes!), { type: "array", cellDates: true });
          const cad = parseCadenceWorkbook(cwb);
          if (!cad.windowEnd || cad.rtgRows.length === 0) throw new Error("Rapport horaire RTG illisible (fenêtre ou lignes RTG introuvables).");
          const cadRecords = cad.rtgRows.map(r => ({
            window_start: cad.windowStart || cad.windowEnd,
            window_end: cad.windowEnd,
            rtg: r.rtg,
            moves: r.moves,
            statut: r.statut,
            min_moves: cad.minMoves,
            total_events: cad.totals.total,
            vessel_events: cad.totals.vessel,
            yard_events: cad.totals.yard,
            gate_events: cad.totals.gate,
            generated_at: cad.generatedAt,
            source_message_id: messageId
          }));
          const { error: cadError } = await admin.from("cadence_rtg_horaire").upsert(cadRecords, { onConflict: "window_end,rtg" });
          if (cadError) throw new Error("Insertion cadence RTG échouée : " + cadError.message);
          cadenceImported += cadRecords.length;

          // Alerte AUTOMATIQUE aux responsables : au moins un RTG sous le minimum
          // (statut "LOW - ALERT") sur une fenêtre récente — une seule fois par
          // fenêtre (verrou tos_passation_alertes). "CHECK ASSIGN." (aucun
          // mouvement : engin à l'arrêt/non affecté) n'alerte pas.
          try {
            const endMs = Date.parse(cad.windowEnd.replace(" ", "T") + "Z");
            const ageMs = nowCasablancaMs() - endMs;
            const low = cad.rtgRows.filter(r => r.statut && r.statut.includes("LOW"));
            if (CADENCE_ALERTS_ENABLED && low.length > 0 && ageMs >= 0 && ageMs <= 90 * 60 * 1000) {
              const { error: claimErr } = await admin.from("tos_passation_alertes").insert({ cle: `cadence|${cad.windowEnd}` });
              if (!claimErr) {
                const hh = (t: string) => t.slice(11, 16).replace(":", "h");
                const cadTitle = `Cadence RTG faible (${hh(cad.windowStart || cad.windowEnd)}–${hh(cad.windowEnd)})`;
                const cadBody = low.map(r => `${r.rtg} : ${r.moves}/${cad.minMoves}`).join(" · ");
                const cadTag = "cadence-rtg-" + cad.windowEnd;
                const sbUrl = Deno.env.get("SUPABASE_URL");
                const authH = { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` };
                // Responsables de l'équipe en poste (+ ADMIN/RESPONSABLE) via tos-passation-alert ;
                // à défaut, repli : ADMIN/RESPONSABLE seulement.
                let routed = false;
                try {
                  const rr = await fetch(`${sbUrl}/functions/v1/tos-passation-alert`, {
                    method: "POST", headers: authH,
                    body: JSON.stringify({ mode: "cadence", windowEnd: cad.windowEnd, title: cadTitle, body: cadBody, tag: cadTag })
                  });
                  const rj = await rr.json().catch(() => ({}));
                  routed = rr.ok && rj.sent > 0;
                } catch { /* repli ci-dessous */ }
                if (!routed) {
                  await fetch(`${sbUrl}/functions/v1/send-push-notification`, {
                    method: "POST", headers: authH,
                    body: JSON.stringify({ target: "conge_reviewers", title: cadTitle, body: cadBody, url: "./", tag: cadTag })
                  });
                }
                pushAlertsSent++;
              }
            }
          } catch (e) {
            console.error("Alerte cadence RTG (non bloquant) :", e);
          }
          markRead = true;
        } else if (!xlsAttachment) {
          skippedNoAttachment++;
          markRead = true; // pour la propreté visuelle de la boîte, sans effet sur le traitement
        } else {
          const bytes = base64ToBytes(xlsAttachment.contentBytes!);
          const wb = XLSX.read(bytes, { type: "array", cellDates: true });

          const records = [];
          let anySheetFound = false;
          for (const cfg of SHEETS) {
            const sheet = wb.Sheets[cfg.sheetName];
            if (!sheet) continue;
            anySheetFound = true;
            const loginMap = loginMapByFleet[cfg.fleet];
            // Les 2 premières lignes du fichier TOS sont des titres ; l'en-tête
            // des colonnes est à la 3ème ligne (index 2).
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 2, defval: null });

            for (const row of rows) {
              if (String(row.TYPE_ENGIN || "").toUpperCase() !== cfg.typeEnginValue) continue;
              const rawLogin = String(row.LOGIN || "").trim().toLowerCase();
              if (!rawLogin || ignoredLogins.has(rawLogin)) continue;
              const dateTravail = excelDateToIso(row.DATE_TRAVAIL);
              if (!dateTravail) continue;

              const shift = String(row.SHIFT || "").trim().toUpperCase();
              if (!VALID_SHIFTS.has(shift)) {
                skippedInvalidShift++;
                invalidShiftSamples.add(`${rawLogin} ${dateTravail} shift="${shift}"`);
                continue;
              }

              const matches = loginMap.get(rawLogin) || [];
              let driverId: string | null = null;
              let matchNote: string | null = null;
              if (matches.length === 1) {
                driverId = matches[0];
              } else if (matches.length === 0) {
                matchNote = `Aucun conducteur ${cfg.fleet} actif ne correspond à ce login.`;
                unmatchedLogins.add(rawLogin);
              } else {
                matchNote = `Plusieurs conducteurs ${cfg.fleet} actifs correspondent à ce login (ambigu) : ` + matches.join(", ");
                unmatchedLogins.add(rawLogin);
              }

              records.push({
                driver_id: driverId,
                login_tos: rawLogin,
                date_travail: dateTravail,
                // trim + majuscules — même normalisation que rawLogin
                // ci-dessus. Sans ça, une différence d'espace ou de casse
                // entre deux générations du même rapport TOS (ex. "RTG01"
                // vs "RTG01 ", ou "S3" vs "s3") fait échouer la contrainte
                // unique (login_tos, date_travail, shift, engin) : au lieu
                // de METTRE À JOUR la ligne existante, l'upsert en crée une
                // SECONDE, invisible en tant que doublon (chaque ligne a
                // l'air normale isolément) mais dont les valeurs sont
                // ADDITIONNÉES au moment de l'affichage (regroupement par
                // conducteur) — constaté en pratique : un conducteur dont
                // le rapport corrigé montrait exactement le double de ses
                // vrais mouvements.
                shift,
                engin: String(row.ENGIN || "").trim().toUpperCase(),
                facility: row.FACILITY ? String(row.FACILITY) : null,
                nombre_in: toInt(row.NOMBRE_IN),
                nombre_out: toInt(row.NOMBRE_OUT),
                nombre_move: toInt(row.NOMBRE_MOVE),
                nombre_shifting: toInt(row.NOMBRE_SHIFTING),
                nombre_disch: toInt(row.NOMBRE_DISCH),
                nombre_load: toInt(row.NOMBRE_LOAD),
                nombre_autre: toInt(row.NOMBRE_AUTRE),
                total_mvmt: toInt(row.TOTAL_MVMT),
                heure_login: toDateTimeText(row.HEURE_LOGIN),
                heure_logout: toDateTimeText(row.HEURE_LOGOUT),
                premier_mvmt: toDateTimeText(row.PREMIER_MVMT),
                dernier_mvmt: toDateTimeText(row.DERNIER_MVMT),
                duree_min: Number.isFinite(Number(row.DUREE_MIN)) ? Number(row.DUREE_MIN) : null,
                statut_session: row.STATUT_SESSION ? String(row.STATUT_SESSION).trim().toUpperCase() : null,
                nb_sessions: toInt(row.NB_SESSIONS),
                match_note: matchNote,
                source_message_id: messageId
              });
            }
          }

          if (!anySheetFound) {
            throw new Error(`Aucun onglet reconnu (${SHEETS.map(s => `"${s.sheetName}"`).join(" / ")}) dans la pièce jointe.`);
          }

          // Insertion PAR PAQUETS plutôt qu'en un seul upsert géant : un
          // rapport consolidé multi-jours peut facilement dépasser un
          // millier de lignes (RTG + SC confondus) en une seule pièce
          // jointe — un paquet qui échoue (taille, verrou temporaire...)
          // ne doit pas faire perdre les paquets déjà insérés avec succès.
          const CHUNK_SIZE = 200;
          // Deux familles de lignes, upsertées SÉPARÉMENT : (1) lignes AVEC
          // colonnes de session (format "REP_LATESTSHIFT…", sans objet) ; (2)
          // lignes SANS ces colonnes (ancien format "DRIVER MOVES PER SHIFT") —
          // pour celles-ci on OMET les 7 colonnes de session, sinon l'upsert les
          // remettait à NULL et EFFAÇAIT les horaires déjà importés par l'autre
          // email (les deux emails du même shift se réécrasaient en boucle :
          // horaires qui apparaissent puis disparaissent).
          const withSession = records.filter(r => r.statut_session);
          const withoutSession = records.filter(r => !r.statut_session).map(r => {
            // deno-lint-ignore no-unused-vars
            const { heure_login, heure_logout, premier_mvmt, dernier_mvmt, duree_min, statut_session, nb_sessions, ...rest } = r;
            return rest;
          });
          for (const list of [withSession, withoutSession]) {
            for (let i = 0; i < list.length; i += CHUNK_SIZE) {
              const chunk = list.slice(i, i + CHUNK_SIZE);
              const { error: upsertError } = await admin
                .from("mouvements_tos")
                .upsert(chunk, { onConflict: "login_tos,date_travail,shift,engin" });
              if (upsertError) {
                errors.push(`Email id=${message.id} (paquet ${i}-${i + chunk.length}) : Insertion échouée : ` + upsertError.message);
                continue;
              }
              importedRows += chunk.length;
            }
          }

          // Alerte PUSH au conducteur qui n'a pas fermé sa session TOS à la
          // fin de son shift RÉEL (session OUVERTE alors que ce shift est
          // terminé) : une notification par conducteur et par email traité
          // (chaque email n'est traité qu'une fois — pas de répétition toutes
          // les 5 min). Best-effort : jamais bloquant pour l'import.
          try {
            const nowMs = nowCasablancaMs();
            const byDriver = new Map<string, string[]>();
            for (const rec of records) {
              if (!rec.driver_id || rec.statut_session !== "OPEN" || !rec.heure_login) continue;
              const info = sessionShiftInfoText(rec.heure_login, rec.heure_logout);
              // Alerte seulement pour un shift qui vient de se terminer (moins de
              // 3 h) : un ancien rapport retraité (fenêtre de 7 jours) ne doit
              // JAMAIS réveiller des conducteurs pour une session d'un autre jour.
              if (!info || nowMs < info.endMs || nowMs - info.endMs > 3 * 60 * 60 * 1000) continue;
              // ANTI-RÉPÉTITION : une alerte par (conducteur, jour, shift, engin),
              // quel que soit l'email qui la porte. Sans ça, deux emails portant
              // les MÊMES lignes (rapport d'origine + transfert) se repassent la
              // main à chaque exécution (source_message_id réécrit par l'un puis
              // par l'autre) et ré-alertent toutes les 5 minutes. La clé unique
              // de tos_passation_alertes (migration_037) sert de verrou.
              const claimKey = `unclosed|${rec.driver_id}|${rec.date_travail}|${info.shift}|${rec.engin}`;
              const { error: claimError } = await admin.from("tos_passation_alertes").insert({ cle: claimKey });
              if (claimError) continue; // déjà alerté (ou table absente)
              const list = byDriver.get(rec.driver_id) || [];
              list.push(`${info.shift} (${rec.engin})`);
              byDriver.set(rec.driver_id, list);
            }
            // Alerte aux RESPONSABLES : ADMIN/RESPONSABLE (toutes équipes) +
            // RESPONSABLE_SHIFT de l'équipe du conducteur — même périmètre que
            // les demandes de congé (target "conge_reviewers", send-push-
            // notification), un message regroupé par équipe.
            const driverInfo = new Map<string, { nom: string; prenom: string; teamId: string | null }>();
            for (const d of (drivers || []) as { id: string; nom: string; prenom: string; team_id: string | null }[]) {
              driverInfo.set(d.id, { nom: d.nom, prenom: d.prenom, teamId: d.team_id });
            }
            const byTeam = new Map<string, string[]>();
            for (const [driverId, shifts] of byDriver) {
              const info = driverInfo.get(driverId);
              if (!info || !info.teamId) continue;
              const list = byTeam.get(info.teamId) || [];
              list.push(`${info.nom} ${info.prenom} (${shifts.join(", ")})`);
              byTeam.set(info.teamId, list);
            }
            for (const [teamId, names] of byTeam) {
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
                },
                body: JSON.stringify({
                  target: "conge_reviewers", teamId,
                  title: names.length + " session(s) TOS non fermée(s)",
                  body: names.join(" · "),
                  url: "./", tag: "tos-sessions-resp-" + teamId + "-" + (records[0] ? records[0].date_travail : "")
                })
              });
              pushAlertsSent++;
            }
            for (const [driverId, shifts] of byDriver) {
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-push-notification`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
                },
                body: JSON.stringify({
                  target: "driver", driverId,
                  title: "Session TOS non fermée",
                  body: "Vous n'avez pas fermé votre session à la fin du shift : " + shifts.join(", ") + ". Pensez à vous déconnecter du TOS.",
                  url: "./", tag: "tos-session-" + driverId + "-" + (records[0] ? records[0].date_travail : "")
                })
              });
              pushAlertsSent++;
            }
          } catch (e) {
            console.error("Alerte push session non fermée (non bloquant) :", e);
          }

          // Alerte AUTOMATIQUE de passation : les conducteurs qui PRENNENT LA
          // SUITE (V2 du même shift, ou V1 du shift suivant, déduits de
          // l'heure de fin de la fenêtre du rapport) sont prévenus que la
          // session de l'engin est restée ouverte — voir tos-passation-alert.
          // Best-effort : jamais bloquant pour l'import.
          try {
            const firstSheet = wb.Sheets[wb.SheetNames[0]];
            const topRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, range: 0, defval: "" });
            const windowText = String((topRows[1] || [])[0] || "");
            const wm = windowText.match(/<\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
            if (wm) {
              const windowEnd = `${wm[3]}-${wm[2]}-${wm[1]} ${wm[4]}:${wm[5]}:${wm[6] || "00"}`;
              const endMs = Date.parse(windowEnd.replace(" ", "T") + "Z");
              const recentWindow = nowCasablancaMs() - endMs <= 3 * 60 * 60 * 1000 && nowCasablancaMs() >= endMs;
              const engins: Record<string, string[]> = { RTG: [], CC: [] };
              for (const rec of records) {
                if (rec.statut_session !== "OPEN" || !rec.heure_login) continue;
                // ouverte dans les 10 dernières minutes = arrivée de la relève, pas un oubli
                if (Date.parse(rec.heure_login.replace(" ", "T") + "Z") >= endMs - 10 * 60 * 1000) continue;
                (/^RTG/i.test(rec.engin) ? engins.RTG : engins.CC).push(rec.engin);
              }
              engins.RTG = [...new Set(engins.RTG)].sort();
              engins.CC = [...new Set(engins.CC)].sort();
              if (recentWindow && (engins.RTG.length > 0 || engins.CC.length > 0)) {
                // NON BLOQUANT : le calcul du planning (tos-passation-alert) est
                // lourd ; l'import ne doit JAMAIS attendre sa fin (risque de
                // dépasser le temps imparti et de perdre le traitement des
                // emails suivants). On lance l'appel et on poursuit ; waitUntil
                // (si disponible) le laisse finir après la réponse.
                const passationCall = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/tos-passation-alert`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
                  body: JSON.stringify({ windowEnd, engins })
                }).then(r => r.text()).catch(err => console.error("tos-passation-alert :", err));
                // deno-lint-ignore no-explicit-any
                const rt = (globalThis as any).EdgeRuntime;
                if (rt && typeof rt.waitUntil === "function") rt.waitUntil(passationCall);
                else await Promise.race([passationCall, new Promise(res => setTimeout(res, 8000))]);
                pushAlertsSent++;
              }
            }
          } catch (e) {
            console.error("Alerte passation (non bloquant) :", e);
          }
          markRead = true;
        }
      } catch (e) {
        errors.push(`Email id=${message.id} : ` + (e instanceof Error ? e.message : String(e)));
      }

      if (markRead) {
        try {
          await fetch(`https://graph.microsoft.com/v1.0/me/messages/${message.id}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true })
          });
        } catch { /* non bloquant */ }
      }
      processedEmails++;
    }
  } catch (e) {
    errors.push("Import Graph : " + (e instanceof Error ? e.message : String(e)));
  }

  return new Response(JSON.stringify({
    ok: errors.length === 0,
    processedEmails,
    pushAlertsSent,
    cadenceImported,
    version: "2026-10-07-cadence-rtg-sans-alerte",
    debugRecent,
    skippedNoAttachment,
    skippedAlreadyImported,
    skippedInvalidShift,
    invalidShiftSamples: Array.from(invalidShiftSamples),
    importedRows,
    reconciledRows,
    ignoredRowsDeleted,
    invalidShiftRowsDeleted,
    unmatchedLogins: Array.from(unmatchedLogins),
    errors
  }), { headers: { "Content-Type": "application/json" } });
});
