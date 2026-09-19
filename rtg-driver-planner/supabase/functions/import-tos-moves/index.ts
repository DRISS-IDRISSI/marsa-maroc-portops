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
// toutes les ~30 minutes : se connecte à la boîte Gmail dédiée, cherche les
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
// Un email n'est marqué comme LU qu'après un import réussi (ou s'il ne
// contient clairement aucune pièce jointe .xls pertinente) — en cas d'erreur
// (pièce jointe illisible, etc.), il reste NON LU pour être retenté au
// prochain passage, et l'erreur remonte dans la réponse de la fonction.
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

  const { data: drivers, error: driversError } = await admin.from("drivers").select("id,nom,prenom,actif").eq("actif", true);
  if (driversError) {
    return new Response(JSON.stringify({ ok: false, error: "Chargement conducteurs échoué : " + driversError.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  // login TOS attendu -> liste des driver_id qui y correspondent (normalement
  // 1 seul ; plus d'un = ambiguïté à signaler).
  const loginMap = new Map<string, string[]>();
  (drivers || []).forEach(d => {
    const login = deriveTosLogin(d);
    if (!login) return;
    if (!loginMap.has(login)) loginMap.set(login, []);
    loginMap.get(login)!.push(d.id);
  });

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
      const uids: number[] = await client.search({ seen: false, subject: SUBJECT_FILTER }, { uid: true });

      for (const uid of uids) {
        let markSeen = false;
        try {
          const msg = await client.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg || !msg.source) { continue; }

          const parsed = await simpleParser(msg.source);
          const xlsAttachment = (parsed.attachments || []).find(a => /\.xls$/i.test(a.filename || ""));

          if (!xlsAttachment) {
            skippedNoAttachment++;
            markSeen = true; // rien à faire pour cet email, pas la peine d'y revenir
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
              if (!rawLogin) continue;
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
    unmatchedLogins: Array.from(unmatchedLogins),
    errors
  }), { headers: { "Content-Type": "application/json" } });
});
