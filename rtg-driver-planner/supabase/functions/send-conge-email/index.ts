// ==========================================
// RTG DRIVER PLANNER — Edge Function : email de confirmation de congé
// ==========================================
// Envoie un email au conducteur (adresse renseignée sur sa fiche) quand son
// Responsable de Shift valide ou refuse sa demande de congé. Appelée
// automatiquement par le frontend (RTGStore.validateCongeRequest, store.js)
// juste après la mise à jour du statut en base — voir ce fichier pour le
// payload exact envoyé.
//
// Envoi via l'API transactionnelle Brevo (HTTPS, pas de SMTP) — plus aucune
// boîte mail technique à créer/gérer pour l'ENVOI (contrairement à
// import-tos-moves, qui lit les rapports TOS par email et a donc toujours
// besoin d'une vraie boîte en IMAP). Adopté après une série de blocages sur
// des boîtes mail classiques : Gmail (compte bloqué par Google, vérification
// téléphonique impossible), Yahoo (création de compte bloquée par la
// vérification téléphonique), Outlook.com (IMAP bloqué par leur politique
// d'authentification moderne, SMTP en échec côté bibliothèque denomailer,
// Azure AD inaccessible pour l'OAuth2), iCloud (Mail iCloud indisponible
// sans appareil Apple physique). Brevo ne nécessite qu'une adresse email
// "expéditeur" déjà vérifiable par un simple code reçu dans une boîte de
// réception normale (Gmail, Yahoo webmail...), aucun accès SMTP/IMAP requis
// pour ça.
//
// DÉPLOIEMENT (sans CLI, depuis le Dashboard Supabase — comme les migrations
// SQL) :
//   1. Créez un compte sur brevo.com (gratuit, 300 emails/jour), puis
//      Settings > SMTP & API > API Keys > "Generate a new API key".
//      Campaigns > Senders, Domains & Dedicated IPs > Senders > ajoutez
//      l'adresse d'envoi souhaitée (ex. marsamaroc.CES@yahoo.com) > un code
//      à 6 chiffres est envoyé à cette adresse, entrez-le pour la vérifier
//      (lisez-le simplement dans la boîte de réception web, pas besoin
//      d'IMAP/SMTP pour cette étape).
//   2. Project > Edge Functions > Create a new function > nommez-la
//      "send-conge-email" > collez le contenu de ce fichier > Deploy.
//   3. Project > Edge Functions > Secrets (ou Manage secrets) > ajoutez :
//        BREVO_API_KEY = la clé API générée à l'étape 1.
//        MAIL_USER = l'adresse expéditrice vérifiée dans Brevo à l'étape 1.
// Tant que ces 2 secrets ne sont pas configurés, la fonction répond une
// erreur explicite (voir plus bas) — la validation/refus du congé côté
// appli continue de fonctionner normalement (l'échec d'envoi d'email
// n'empêche jamais la validation elle-même, voir store.js).

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");
const MAIL_USER = Deno.env.get("MAIL_USER");

async function sendViaBrevo({ to, subject, text, html }: { to: string; subject: string; text?: string; html?: string }) {
  const body: Record<string, unknown> = {
    sender: { email: MAIL_USER, name: "CES Driver Planner" },
    to: [{ email: to }],
    subject
  };
  if (html) body.htmlContent = html;
  if (text) body.textContent = text;
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY!, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    throw new Error("Envoi Brevo échoué (" + resp.status + ") : " + (await resp.text()));
  }
}

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
    if (!MAIL_USER || !BREVO_API_KEY) {
      throw new Error("MAIL_USER / BREVO_API_KEY non configurés (Project Settings > Edge Functions > Secrets).");
    }
    const body = await req.json();
    const { to, driverName, dateDebut, dateFin, decision, motifRefus } = body || {};
    if (!to || !dateDebut || !dateFin || (decision !== "VALIDE" && decision !== "REFUSE" && decision !== "A_REFAIRE")) {
      return new Response(JSON.stringify({ error: "Champs requis manquants ou invalides." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    const { subject, content } = buildMessage({ driverName, dateDebut, dateFin, decision, motifRefus });

    await sendViaBrevo({ to, subject, text: content });

    return new Response(JSON.stringify({ ok: true }), { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
