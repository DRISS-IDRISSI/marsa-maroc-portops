// ==========================================
// RTG DRIVER PLANNER — Edge Function : "Mot de passe oublié"
// ==========================================
// Appelée depuis l'écran de connexion (LoginPage, components.js), SANS que
// l'utilisateur soit authentifié — seul son "Identifiant" est envoyé.
//
// Principe (mot de passe temporaire par email, pas de lien à cliquer — plus
// simple à opérer pour une appli statique sans page de callback dédiée) :
//   1. Recherche le profil correspondant à l'identifiant (via la clé
//      service_role, qui contourne les policies RLS — jamais exposée au
//      frontend, uniquement disponible ici côté serveur).
//   2. Détermine l'email associé : celui de drivers.email pour un compte
//      CONDUCTEUR (rattaché via profiles.driver_id), sinon profiles.email
//      (ADMIN/RESPONSABLE/RESPONSABLE_SHIFT — migration_006).
//   3. Si un compte actif avec un email est trouvé : génère un mot de passe
//      temporaire, l'applique directement via l'API Admin Auth, puis
//      l'envoie par email (Microsoft Graph, même jeton OAuth2 que
//      import-tos-moves).
//   4. Répond TOUJOURS un message générique de succès, que l'identifiant
//      existe ou non et qu'un email ait pu être envoyé ou non — pour ne
//      jamais révéler si un identifiant donné correspond à un compte réel.
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut,
// automatiquement disponibles dans toute Edge Function du projet — rien à
// configurer en plus de MAIL_OAUTH_CLIENT_ID (déjà en place pour
// import-tos-moves).
//
// DÉPLOIEMENT (Dashboard Supabase, comme send-conge-email) :
//   Edge Functions > Create a new function > "request-password-reset" >
//   coller ce fichier > Deploy. Aucun nouveau secret à ajouter.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GRAPH_TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_SCOPE = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access";

// Dupliqué à l'identique dans chaque Edge Function utilisant Graph — pas de
// module partagé entre fonctions, chacune reste déployable isolément.
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const GENERIC_RESPONSE = { ok: true, message: "Si un compte correspond à cet identifiant, un email a été envoyé à l'adresse enregistrée." };

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function sendResetEmail(admin: ReturnType<typeof createClient>, to: string, username: string, tempPassword: string, isConducteur: boolean) {
  const content = [
    "Bonjour,",
    "",
    `Un nouveau mot de passe temporaire a été généré pour votre compte CES Driver Planner (identifiant : ${username}) :`,
    "",
    `Mot de passe temporaire : ${tempPassword}`,
    "",
    "Connectez-vous avec ce mot de passe, puis changez-le immédiatement depuis \"Mon compte\" dans l'application.",
    "",
    "Si vous n'êtes pas à l'origine de cette demande, contactez un administrateur.",
    "",
    "Ceci est un message automatique — merci de ne pas y répondre." + (isConducteur ? " Pour toute question ou information, contactez M. FELLAH." : ""),
    "",
    "CES Driver Planner — Marsa Maroc TC3PC"
  ].join("\n");
  const accessToken = await getGraphAccessToken(admin);
  const resp = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: "Réinitialisation de votre mot de passe — CES Driver Planner",
        body: { contentType: "Text", content },
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

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const jsonHeaders = Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Configuration incomplète (secrets manquants).");
    }
    const body = await req.json();
    const username = ((body && body.username) || "").trim();
    if (!username) {
      return new Response(JSON.stringify({ error: "Identifiant requis." }), { status: 400, headers: jsonHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: profile } = await admin.from("profiles").select("id,username,role,driver_id,email,actif").ilike("username", username).maybeSingle();

    // Toujours la même réponse, que le compte existe ou non (évite de
    // révéler si un identifiant donné est valide — énumération de comptes).
    if (!profile || profile.actif === false) {
      return new Response(JSON.stringify(GENERIC_RESPONSE), { headers: jsonHeaders });
    }

    let targetEmail = profile.email || null;
    if (profile.role === "CONDUCTEUR" && profile.driver_id) {
      const { data: driver } = await admin.from("drivers").select("email").eq("id", profile.driver_id).maybeSingle();
      targetEmail = driver && driver.email ? driver.email : null;
    }
    if (!targetEmail) {
      return new Response(JSON.stringify(GENERIC_RESPONSE), { headers: jsonHeaders });
    }

    const tempPassword = generateTempPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, { password: tempPassword });
    if (updateError) { console.error(updateError); throw updateError; }

    await sendResetEmail(admin, targetEmail, profile.username, tempPassword, profile.role === "CONDUCTEUR");

    return new Response(JSON.stringify(GENERIC_RESPONSE), { headers: jsonHeaders });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }), { status: 500, headers: jsonHeaders });
  }
});
