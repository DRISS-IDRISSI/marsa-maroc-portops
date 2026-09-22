// ==========================================
// RTG DRIVER PLANNER — Edge Function : import automatique des mouvements
// RTG depuis le rapport TOS "DRIVER MOVES PER SHIFT"
// ==========================================
// Le TOS (système d'exploitation du terminal — hors de tout accès direct
// pour cette application) envoie un email avec ce rapport en pièce jointe
// .xls à la fin de CHAQUE shift (S1/S2/S3). L'exploitant a mis en place une
// règle de transfert automatique sur sa boîte professionnelle vers une boîte
// Gmail dédiée (marsamarocrth@gmail.com), lue ici en IMAP.
//
// Déclenchée par pg_cron (voir migration_009_cron_import_tos_moves.sql)
// toutes les 5 minutes : se connecte à la boîte Gmail dédiée, cherche les
// emails NON LUS dont le sujet contient "DRIVER MOVES PER SHIFT", parse la
// pièce jointe .xls (uniquement l'onglet "RTG" — l'onglet "SC", chariots
// élévateurs, est hors périmètre de cette application), et enregistre une
// ligne par conducteur x engin dans la table mouvements_tos.
//
// Rattachement conducteur : le rapport identifie chaque conducteur par un
// LOGIN TOS (ex. "mcharihtc3"), jamais par son matricule. Convention confirmée
// par l'exploitant : LOGIN = 1ère lettre du PRÉNOM + NOM (sans accents/espaces,
// en minuscules) + suffixe du terminal ("tc3" pour TC3PC). Le rattachement est
// donc déterministe : pour chaque conducteur actif, on calcule son login
// attendu et on le compare au LOGIN du rapport — aucune table de correspondance
// à maintenir à la main. Un login sans correspondance (ou ambigu, si jamais 2
// conducteurs actifs partageaient le même login dérivé) est importé quand même
// (driver_id = null, match_note renseigné) pour rester visible et corrigeable
// plutôt que d'être silencieusement perdu.
//
// Les emails traités sont recherchés par DATE (derniers jours), pas par
// statut lu/non lu : le statut "lu" d'un email peut changer à tout moment
// (n'importe quelle consultation de la boîte via l'interface Gmail marque
// l'email comme lu), ce qui le ferait disparaître définitivement de la
// recherche si on se basait dessus. Comme l'insertion des mouvements est
// une upsert avec contrainte anti-doublon (login_tos, date_travail, shift,
// engin), retraiter plusieurs fois le même email ne crée aucun doublon —
// c'est donc sans risque de le revoir à chaque exécution pendant sa fenêtre
// de rétention.
//
// Secrets nécessaires (Project Settings > Edge Functions > Secrets) :
//   - TOS_GMAIL_USER : marsamarocrth@gmail.com
//   - TOS_GMAIL_APP_PASSWORD : mot de passe d'application Gmail de ce compte
//     (2FA à activer sur ce compte, puis générer un mot de passe d'application
//     — même procédure que pour GMAIL_APP_PASSWORD utilisé pour l'envoi).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut, déjà
// disponibles automatiquement.
//
// DÉPLOIEMENT : Edge Functions > Create a new function > "import-tos-moves" >
// coller ce fichier > Deploy. Puis exécuter migration_008_mouvements_tos.sql
// (table) et migration_009_cron_import_tos_moves.sql (planification).

import { createClient } from "npm:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1";
import { simpleParser } from "npm:mailparser@3";
import * as XLSX from "npm:xlsx@0.18.5";

const RTG_SHEET_NAME = "RTG";
const SUBJECT_FILTER = "DRIVER MOVES PER SHIFT";

function stripAccents(s: string) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizeForLogin(s: string) {
  return stripAccents(s || "").toLowerCase().replace(/[^a-z]/g, "");
}

// Convention confirmée par l'exploitant : 1ère lettre du prénom + nom complet
// (sans accents/espaces/tirets) + suffixe du terminal.
function deriveTosLogin(driver: { nom: string; prenom: string }) {
  const p = normalizeForLogin(driver.prenom);
  const n = normalizeForLogin(driver.nom);
  if (!p || !n) return null;
  return p.charAt(0) + n + "tc3";
}

function excelDateToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return s.slice(0, 10) || null;
}

function toInt(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

Deno.serve(async _req => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const tosUser = Deno.env.get("TOS_GMAIL_USER");
  const tosPassword = Deno.env.get("TOS_GMAIL_APP_PASSWORD");
  if (!tosUser || !tosPassword) {
    return new Response(JSON.stringify({ ok: false, error: "TOS_GMAIL_USER / TOS_GMAIL_APP_PASSWORD non configurés." }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // Uniquement les conducteurs de la flotte RTG : ce rapport ("DRIVER MOVES
  // PER SHIFT", onglet RTG) ne concerne jamais la flotte CC. Sans ce filtre,
  // un conducteur CC homonyme d'un conducteur RTG (même 1ère lettre de
  // prénom + même nom, ex. deux "ADDI") produit le même login dérivé que le
  // conducteur RTG et rend le rattachement faussement ambigu, alors que le
  // conducteur CC n'apparaît jamais dans ce rapport.
  const { data: drivers, error: driversError } = await admin
    .from("drivers")
    .select("id,nom,prenom,actif,login_tos,teams!inner(type_engin)")
    .eq("actif", true)
    .eq("teams.type_engin", "RTG");
  if (driversError) {
    return new Response(JSON.stringify({ ok: false, error: "Chargement conducteurs échoué : " + driversError.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // login TOS attendu -> liste des driver_id qui y correspondent (normalement
  // 1 seul ; plus d'un = ambiguïté à signaler). Un login_tos saisi à la main
  // sur la fiche conducteur (cas d'un compte TOS orthographié différemment du
  // nom officiel) prime sur la déduction automatique.
  const loginMap = new Map<string, string[]>();
  (drivers || []).forEach(d => {
    const login = (d.login_tos && d.login_tos.trim()) ? d.login_tos.trim().toLowerCase() : deriveTosLogin(d);
    if (!login) return;
    if (!loginMap.has(login)) loginMap.set(login, []);
    loginMap.get(login)!.push(d.id);
  });

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

  // Auto-réparation : des lignes déjà en base non rattachées (driver_id null,
  // ex. importées avant qu'un "Login TOS" correctif soit renseigné sur la
  // fiche conducteur) sont retentées à chaque exécution — sans ça, une
  // correction faite après coup ne s'appliquerait qu'aux imports futurs,
  // jamais à l'historique déjà importé.
  let reconciledRows = 0;
  const { data: unmatchedRows } = await admin.from("mouvements_tos").select("id, login_tos").is("driver_id", null);
  for (const row of unmatchedRows || []) {
    const matches = loginMap.get(row.login_tos) || [];
    if (matches.length !== 1) continue;
    const { error: reconcileError } = await admin.from("mouvements_tos").update({ driver_id: matches[0], match_note: null }).eq("id", row.id);
    if (!reconcileError) reconciledRows++;
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: tosUser, pass: tosPassword },
    logger: false
  });

  let processedEmails = 0;
  let importedRows = 0;
  let skippedNoAttachment = 0;
  const unmatchedLogins = new Set<string>();
  const errors: string[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Fenêtre de recherche large (7 jours) : couvre les week-ends et les
      // éventuels retards d'acheminement, sans dépendre du statut lu/non lu.
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 7);
      const uids: number[] = await client.search({ since, subject: SUBJECT_FILTER }, { uid: true });

      for (const uid of uids) {
        let markSeen = false;
        try {
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.source) { continue; }

          const parsed = await simpleParser(msg.source);
          const xlsAttachment = (parsed.attachments || []).find(a => /\.xls$/i.test(a.filename || ""));

          if (!xlsAttachment) {
            skippedNoAttachment++;
            markSeen = true; // pour la propreté visuelle de la boîte, sans effet sur le traitement
          } else {
            const wb = XLSX.read(xlsAttachment.content, { type: "buffer", cellDates: true });
            const sheet = wb.Sheets[RTG_SHEET_NAME];
            if (!sheet) {
              throw new Error(`Onglet "${RTG_SHEET_NAME}" introuvable dans la pièce jointe.`);
            }
            // Les 2 premières lignes du fichier TOS sont des titres ; l'en-tête
            // des colonnes est à la 3ème ligne (index 2).
            const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 2, defval: null });

            const records = [];
            for (const row of rows) {
              if (String(row.TYPE_ENGIN || "").toUpperCase() !== "RTG") continue;
              const rawLogin = String(row.LOGIN || "").trim().toLowerCase();
              if (!rawLogin || ignoredLogins.has(rawLogin)) continue;
              const dateTravail = excelDateToIso(row.DATE_TRAVAIL);
              if (!dateTravail) continue;

              const matches = loginMap.get(rawLogin) || [];
              let driverId: string | null = null;
              let matchNote: string | null = null;
              if (matches.length === 1) {
                driverId = matches[0];
              } else if (matches.length === 0) {
                matchNote = "Aucun conducteur RTG actif ne correspond à ce login.";
                unmatchedLogins.add(rawLogin);
              } else {
                matchNote = "Plusieurs conducteurs RTG actifs correspondent à ce login (ambigu) : " + matches.join(", ");
                unmatchedLogins.add(rawLogin);
              }

              records.push({
                driver_id: driverId,
                login_tos: rawLogin,
                date_travail: dateTravail,
                shift: String(row.SHIFT || ""),
                engin: String(row.ENGIN || ""),
                facility: row.FACILITY ? String(row.FACILITY) : null,
                nombre_in: toInt(row.NOMBRE_IN),
                nombre_out: toInt(row.NOMBRE_OUT),
                nombre_move: toInt(row.NOMBRE_MOVE),
                nombre_shifting: toInt(row.NOMBRE_SHIFTING),
                nombre_disch: toInt(row.NOMBRE_DISCH),
                nombre_load: toInt(row.NOMBRE_LOAD),
                nombre_autre: toInt(row.NOMBRE_AUTRE),
                total_mvmt: toInt(row.TOTAL_MVMT),
                match_note: matchNote,
                source_message_id: parsed.messageId || null
              });
            }

            if (records.length > 0) {
              const { error: upsertError } = await admin
                .from("mouvements_tos")
                .upsert(records, { onConflict: "login_tos,date_travail,shift,engin" });
              if (upsertError) throw new Error("Insertion échouée : " + upsertError.message);
              importedRows += records.length;
            }
            markSeen = true;
          }
        } catch (e) {
          errors.push(`Email uid=${uid} : ` + (e instanceof Error ? e.message : String(e)));
        }

        if (markSeen) {
          try { await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }); } catch { /* non bloquant */ }
        }
        processedEmails++;
      }
    } finally {
      lock.release();
    }
  } catch (e) {
    errors.push("Connexion IMAP : " + (e instanceof Error ? e.message : String(e)));
  } finally {
    try { await client.logout(); } catch { /* déjà déconnecté */ }
  }

  return new Response(JSON.stringify({
    ok: errors.length === 0,
    processedEmails,
    skippedNoAttachment,
    importedRows,
    reconciledRows,
    ignoredRowsDeleted,
    unmatchedLogins: Array.from(unmatchedLogins),
    errors
  }), { headers: { "Content-Type": "application/json" } });
});
