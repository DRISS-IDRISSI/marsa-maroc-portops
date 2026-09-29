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
// Envoi via Microsoft Graph (API REST, OAuth2) — compte technique Outlook
// marsamaroc.CES@outlook.fr, jeton déjà obtenu via oauth-outlook-setup et
// réutilisé ici tel quel (aucun nouveau secret à ajouter : MAIL_OAUTH_CLIENT_ID
// et la table mail_oauth_tokens, déjà configurés pour import-tos-moves —
// voir son en-tête pour le détail de la procédure d'inscription Azure AD
// + autorisation initiale).
//
// DÉPLOIEMENT (Dashboard Supabase, comme send-conge-email) :
//   Edge Functions > Create a new function > "send-credentials-email" >
//   coller ce fichier > Deploy.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_SCOPE = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access";

// Dupliqué à l'identique dans chaque Edge Function utilisant Graph — pas de
// module partagé entre fonctions, chacune reste déployable isolément
// (convention du projet, voir reset-and-send-credentials).
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

async function sendViaGraph(accessToken: string, { to, subject, html }: { to: string; subject: string; html: string }) {
  const resp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }]
      },
      saveToSentItems: "true"
    })
  });
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error("Envoi Graph échoué (" + resp.status + ") : " + (errJson.error ? errJson.error.message : ""));
  }
}

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
    const body = await req.json();
    const { to, driverName, username, password, appUrl, fleet } = body || {};
    if (!to || !username || !password || !appUrl) {
      return new Response(JSON.stringify({ error: "Champs requis manquants (to, username, password, appUrl)." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    const html = buildHtml({ driverName: driverName || "", username, password, appUrl, fleet });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const accessToken = await getGraphAccessToken(admin);
    await sendViaGraph(accessToken, { to, subject: "Vos identifiants — CES Driver Planner", html });

    return new Response(JSON.stringify({ ok: true }), { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
