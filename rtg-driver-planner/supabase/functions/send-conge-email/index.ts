// ==========================================
// RTG DRIVER PLANNER — Edge Function : email de confirmation de congé
// ==========================================
// Envoie un email au conducteur (adresse renseignée sur sa fiche) quand son
// Responsable de Shift valide ou refuse sa demande de congé. Appelée
// automatiquement par le frontend (RTGStore.validateCongeRequest, store.js)
// juste après la mise à jour du statut en base — voir ce fichier pour le
// payload exact envoyé.
//
// Envoi via SMTP Gmail (compte technique dédié, ex. marsamarocrth@gmail.com)
// avec un "mot de passe d'application" Gmail — PAS le mot de passe normal du
// compte (Gmail exige une validation en 2 étapes pour en générer un, voir
// myaccount.google.com/apppasswords).
//
// DÉPLOIEMENT (sans CLI, depuis le Dashboard Supabase — comme les migrations
// SQL) :
//   1. Project > Edge Functions > Create a new function > nommez-la
//      "send-conge-email" > collez le contenu de ce fichier > Deploy.
//   2. Project > Edge Functions > Secrets (ou Manage secrets) > ajoutez :
//        GMAIL_USER = marsamarocrth@gmail.com (ou l'adresse choisie)
//        GMAIL_APP_PASSWORD = le mot de passe d'application Gmail (16
//        caractères, PAS le mot de passe normal du compte) — ne JAMAIS
//        coller ce mot de passe ailleurs qu'ici.
// Tant que ces 2 secrets ne sont pas configurés, la fonction répond une
// erreur explicite (voir plus bas) — la validation/refus du congé côté
// appli continue de fonctionner normalement (l'échec d'envoi d'email
// n'empêche jamais la validation elle-même, voir store.js).

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER");
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

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
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD non configurés (Project Settings > Edge Functions > Secrets).");
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
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD }
      }
    });
    await client.send({ from: GMAIL_USER, to: to, subject: subject, content: content });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
