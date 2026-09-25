// ==========================================
// RTG DRIVER PLANNER — Edge Function : email d'identifiants à un conducteur
// ==========================================
// Envoie à un conducteur (adresse fournie dans le payload, en général
// drivers.email) son identifiant + mot de passe temporaire, le lien de
// l'application, comment l'installer sur son téléphone (PWA) et un mode
// d'emploi rapide. Appelée depuis le frontend (RTGStore.sendCredentialsEmail,
// store.js) juste après la création d'un compte CONDUCTEUR — c'est le SEUL
// moment où le mot de passe en clair est encore connu (Supabase Auth ne le
// stocke jamais en clair, il ne peut donc pas être renvoyé plus tard).
//
// Réutilise GMAIL_USER / GMAIL_APP_PASSWORD (déjà configurés pour
// send-conge-email / daily-affectation-email) — aucun nouveau secret à
// ajouter.
//
// DÉPLOIEMENT (Dashboard Supabase, comme send-conge-email) :
//   Edge Functions > Create a new function > "send-credentials-email" >
//   coller ce fichier > Deploy.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GMAIL_USER = Deno.env.get("GMAIL_USER");
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function escapeHtml(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml({ driverName, username, password, appUrl, fleet }: { driverName: string; username: string; password: string; appUrl: string; fleet?: string }) {
  const safeName = escapeHtml(driverName);
  const safeUsername = escapeHtml(username);
  const safePassword = escapeHtml(password);
  const safeUrl = escapeHtml(appUrl);
  const mouvementsLabel = fleet === "CC" ? "mouvements" : "mouvements RTG";
  return `
  <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #0f172a;">Bienvenue sur CES Driver Planner</h2>
    <p>Bonjour ${safeName},</p>
    <p>Un accès à l'application <strong>CES Driver Planner</strong> (planning, mouvements, congés) a été créé pour vous. Voici vos identifiants :</p>
    <table style="border-collapse: collapse; margin: 12px 0;">
      <tr><td style="padding: 6px 12px; border: 1px solid #cbd5e1; font-weight: bold;">Identifiant</td><td style="padding: 6px 12px; border: 1px solid #cbd5e1; font-family: monospace;">${safeUsername}</td></tr>
      <tr><td style="padding: 6px 12px; border: 1px solid #cbd5e1; font-weight: bold;">Mot de passe</td><td style="padding: 6px 12px; border: 1px solid #cbd5e1; font-family: monospace;">${safePassword}</td></tr>
    </table>
    <p style="color: #b91c1c;">Ce mot de passe est temporaire — changez-le dès votre première connexion depuis "Mon compte" dans l'application.</p>

    <p><a href="${safeUrl}" style="display: inline-block; background: #f97316; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 8px; font-weight: bold;">Ouvrir l'application</a></p>
    <p style="font-size: 13px; color: #475569;">Ou copiez ce lien dans votre navigateur : ${safeUrl}</p>

    <h3 style="color: #0f172a; margin-top: 24px;">Installer l'application sur votre téléphone</h3>
    <p><strong>Sur Android (Chrome) :</strong></p>
    <ol style="font-size: 14px;">
      <li>Ouvrez le lien ci-dessus dans Chrome.</li>
      <li>Appuyez sur le menu ⋮ (3 points) en haut à droite.</li>
      <li>Choisissez "Ajouter à l'écran d'accueil" (ou "Installer l'application").</li>
      <li>Validez — une icône apparaît sur votre écran d'accueil, comme une application normale.</li>
    </ol>
    <p><strong>Sur iPhone (Safari) :</strong></p>
    <ol style="font-size: 14px;">
      <li>Ouvrez le lien ci-dessus dans Safari (pas Chrome).</li>
      <li>Appuyez sur l'icône de partage (carré avec une flèche vers le haut).</li>
      <li>Choisissez "Sur l'écran d'accueil".</li>
      <li>Validez — une icône apparaît sur votre écran d'accueil.</li>
    </ol>

    <h3 style="color: #0f172a; margin-top: 24px;">Ce que vous pouvez faire dans l'application</h3>
    <ul style="font-size: 14px;">
      <li><strong>Mon planning</strong> : consulter votre planning mensuel et vos vacations.</li>
      <li><strong>Mes mouvements</strong> : voir le détail de vos ${mouvementsLabel} importés depuis le TOS.</li>
      <li><strong>Congés / Maladies / Absences</strong> : déposer une demande de congé, voir son statut, et le solde restant.</li>
      <li><strong>Mon compte</strong> : changer votre mot de passe.</li>
    </ul>

    <p style="margin-top: 24px; font-size: 12px; color: #64748b;">Ceci est un message automatique — merci de ne pas y répondre. En cas de problème de connexion, contactez votre Responsable de Shift. Pour toute question ou information, contactez l'administrateur Mr FELLAH IDRISSI DRISS.</p>
    <p style="font-size: 12px; color: #64748b;">CES Driver Planner — Marsa Maroc TC3PC</p>
  </div>`;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD non configurés (Project Settings > Edge Functions > Secrets).");
    }
    const body = await req.json();
    const { to, driverName, username, password, appUrl, fleet } = body || {};
    if (!to || !username || !password || !appUrl) {
      return new Response(JSON.stringify({ error: "Champs requis manquants (to, username, password, appUrl)." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    const html = buildHtml({ driverName: driverName || "", username, password, appUrl, fleet });

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD }
      }
    });
    await client.send({ from: GMAIL_USER, to: to, subject: "Vos identifiants — CES Driver Planner", content: "auto", html });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
