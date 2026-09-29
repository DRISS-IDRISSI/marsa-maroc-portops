// ==========================================
// RTG DRIVER PLANNER — Edge Function : email de confirmation de congé
// ==========================================
// Envoie un email au conducteur (adresse renseignée sur sa fiche) quand son
// Responsable de Shift valide ou refuse sa demande de congé. Appelée
// automatiquement par le frontend (RTGStore.validateCongeRequest, store.js)
// juste après la mise à jour du statut en base — voir ce fichier pour le
// payload exact envoyé.
//
// Envoi via SMTP Outlook.com (compte technique dédié) avec un "mot de passe
// d'application" — PAS le mot de passe normal du compte (nécessite la
// validation en 2 étapes activée sur ce compte, voir account.live.com >
// Security > "Add another way to sign in" > mot de passe d'application).
// Migré depuis Gmail (compte gestioneffectif@gmail.com bloqué par Google —
// vérification téléphonique impossible à finaliser), puis depuis une
// tentative Yahoo (création de compte bloquée par la vérification
// téléphonique côté Yahoo). ⚠️ Microsoft impose de plus en plus
// l'authentification "moderne" (OAuth2) pour l'accès SMTP/IMAP par mot de
// passe sur Outlook.com — si l'authentification échoue malgré un mot de
// passe d'application correct, il faudra probablement passer par un
// enregistrement d'application Azure AD + flux OAuth2 (XOAUTH2), plus
// complexe que le simple couple utilisateur/mot de passe utilisé ici.
// Vérifiez aussi que POP/IMAP est bien activé côté Outlook.com (Paramètres
// > Mail > Synchroniser le courrier > "Laisser les appareils et applications
// utiliser POP"/IMAP), désactivé par défaut.
//
// DÉPLOIEMENT (sans CLI, depuis le Dashboard Supabase — comme les migrations
// SQL) :
//   1. Project > Edge Functions > Create a new function > nommez-la
//      "send-conge-email" > collez le contenu de ce fichier > Deploy.
//   2. Project > Edge Functions > Secrets (ou Manage secrets) > ajoutez :
//        MAIL_USER = l'adresse Outlook choisie (ex. xxx@outlook.com)
//        MAIL_APP_PASSWORD = le mot de passe d'application Outlook (PAS le
//        mot de passe normal du compte) — ne JAMAIS coller ce mot de passe
//        ailleurs qu'ici.
// Tant que ces 2 secrets ne sont pas configurés, la fonction répond une
// erreur explicite (voir plus bas) — la validation/refus du congé côté
// appli continue de fonctionner normalement (l'échec d'envoi d'email
// n'empêche jamais la validation elle-même, voir store.js).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const MAIL_USER = Deno.env.get("MAIL_USER");
const MAIL_APP_PASSWORD = Deno.env.get("MAIL_APP_PASSWORD");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function buildMessage({ driverName, dateDebut, dateFin, decision, motifRefus }) {
  const subject = decision === "VALIDE" ? "Votre demande de congé a été validée"
    : decision === "REFUSE" ? "Votre demande de congé a été refusée"
    : "Votre demande de congé est à refaire";
  const lignes = [`Bonjour ${driverName || ""},`, ""];
  if (decision === "VALIDE") {
    lignes.push(`Votre demande de congé du ${dateDebut} au ${dateFin} a été VALIDÉE par votre responsable.`);
  } else if (decision === "REFUSE") {
    lignes.push(`Votre demande de congé du ${dateDebut} au ${dateFin} a été REFUSÉE par votre responsable.`);
    if (motifRefus) lignes.push("", `Motif : ${motifRefus}`);
  } else {
    lignes.push(`Votre responsable vous demande de REFAIRE votre demande de congé du ${dateDebut} au ${dateFin} (ex. justificatif illisible).`);
    if (motifRefus) lignes.push("", `Motif : ${motifRefus}`);
    lignes.push("", "Merci de renvoyer une nouvelle demande depuis l'application, rubrique \"Mes congés\".");
  }
  lignes.push("", "Ceci est un message automatique — merci de ne pas y répondre. Pour toute question ou information, contactez M. FELLAH.", "", "CES Driver Planner — Marsa Maroc TC3PC");
  return { subject, content: lignes.join("\n") };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    if (!MAIL_USER || !MAIL_APP_PASSWORD) {
      throw new Error("MAIL_USER / MAIL_APP_PASSWORD non configurés (Project Settings > Edge Functions > Secrets).");
    }
    const body = await req.json();
    const { to, driverName, dateDebut, dateFin, decision, motifRefus } = body || {};
    if (!to || !dateDebut || !dateFin || (decision !== "VALIDE" && decision !== "REFUSE" && decision !== "A_REFAIRE")) {
      return new Response(JSON.stringify({ error: "Champs requis manquants ou invalides." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    const { subject, content } = buildMessage({ driverName, dateDebut, dateFin, decision, motifRefus });

    const client = new SMTPClient({
      connection: {
        hostname: "smtp-mail.outlook.com",
        port: 587,
        tls: false,
        auth: { username: MAIL_USER, password: MAIL_APP_PASSWORD }
      }
    });
    await client.send({ from: MAIL_USER, to: to, subject: subject, content: content });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
