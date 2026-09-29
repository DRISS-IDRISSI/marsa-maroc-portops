// ==========================================
// RTG DRIVER PLANNER — Edge Function utilitaire : autorisation OAuth2
// Outlook (Microsoft Graph), flux "device code"
// ==========================================
// Fonction à USAGE PONCTUEL (une seule fois à l'installation, puis en cas
// de révocation du jeton) — pas appelée par pg_cron ni par le frontend.
// Sert uniquement à obtenir le premier refresh_token (stocké ensuite dans
// la table mail_oauth_tokens, voir migration_034) à partir duquel toutes
// les autres fonctions (import-tos-moves, send-*) rafraîchissent leur
// propre access_token.
//
// Le flux "device code" est le seul adapté ici : aucune page web de
// callback à héberger (contrairement au flux "authorization code"
// classique), juste un code à saisir manuellement sur microsoft.com/devicelogin
// depuis n'importe quel navigateur — utilisable entièrement depuis le
// bouton "Test" du Dashboard Supabase.
//
// Secret nécessaire : MAIL_OAUTH_CLIENT_ID (l'Application (client) ID de
// l'inscription Azure AD "CES Driver Planner Mail" — Supported account
// types = comptes personnels + organisationnels, "Allow public client
// flows" = Yes, permissions Microsoft Graph déléguées Mail.ReadWrite /
// Mail.Send / offline_access).
//
// UTILISATION (bouton "Test" de cette fonction, Dashboard Supabase) :
//   1. Body : {"action":"start"} > Send Request.
//      La réponse contient verification_uri, user_code et device_code.
//   2. Ouvrez verification_uri dans un navigateur, saisissez user_code,
//      connectez-vous avec le compte Outlook technique, acceptez les
//      permissions demandées.
//   3. Body : {"action":"poll","deviceCode":"<device_code de l'étape 1>"}
//      > Send Request. Tant que la connexion (étape 2) n'est pas terminée,
//      la réponse indique {"status":"authorization_pending"} — relancez le
//      même appel toutes les 5-10 secondes jusqu'à {"ok":true} (le
//      refresh_token est alors enregistré en base, la configuration est
//      terminée) ou une erreur explicite.
//
// DÉPLOIEMENT : Edge Functions > Create a new function > "oauth-outlook-setup"
// > coller ce fichier > Deploy. Puis exécuter migration_034_mail_oauth_tokens.sql.

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const DEVICE_CODE_ENDPOINT = "https://login.microsoftonline.com/common/oauth2/v2.0/devicecode";
const SCOPES = "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send offline_access";

Deno.serve(async req => {
  const clientId = Deno.env.get("MAIL_OAUTH_CLIENT_ID");
  if (!clientId) {
    return new Response(JSON.stringify({ error: "MAIL_OAUTH_CLIENT_ID non configuré (Project Settings > Edge Functions > Secrets)." }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body && body.action;

    if (action === "start") {
      const resp = await fetch(DEVICE_CODE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, scope: SCOPES })
      });
      const json = await resp.json();
      if (!resp.ok) {
        return new Response(JSON.stringify({ error: "Demande device_code échouée : " + (json.error_description || json.error) }),
          { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        verification_uri: json.verification_uri,
        user_code: json.user_code,
        device_code: json.device_code,
        expires_in: json.expires_in,
        interval: json.interval,
        message: json.message
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (action === "poll") {
      const deviceCode = body && body.deviceCode;
      if (!deviceCode) {
        return new Response(JSON.stringify({ error: "deviceCode manquant dans le body." }),
          { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: clientId,
          device_code: deviceCode
        })
      });
      const json = await resp.json();
      if (!resp.ok) {
        // authorization_pending (pas encore connecté) / slow_down (patienter
        // plus longtemps) ne sont pas des échecs — le responsable n'a
        // simplement pas encore terminé l'étape 2, à relancer plus tard.
        if (json.error === "authorization_pending" || json.error === "slow_down") {
          return new Response(JSON.stringify({ ok: false, status: json.error }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: false, error: "Échec : " + (json.error_description || json.error) }),
          { status: 500, headers: { "Content-Type": "application/json" } });
      }

      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const expiresAt = new Date(Date.now() + (json.expires_in || 3600) * 1000).toISOString();
      const { error: upsertError } = await admin.from("mail_oauth_tokens").upsert({
        id: "outlook",
        refresh_token: json.refresh_token,
        access_token: json.access_token,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      });
      if (upsertError) {
        return new Response(JSON.stringify({ ok: false, error: "Jeton obtenu mais enregistrement échoué : " + upsertError.message }),
          { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ ok: true, message: "Jeton Outlook enregistré — configuration terminée." }),
        { headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "action inconnue (attendu : \"start\" ou \"poll\")." }),
      { status: 400, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
