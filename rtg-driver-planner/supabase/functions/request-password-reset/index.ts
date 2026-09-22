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
//      l'envoie par email (SMTP Gmail, mêmes secrets que send-conge-email).
//   4. Répond TOUJOURS un message générique de succès, que l'identifiant
//      existe ou non et qu'un email ait pu être envoyé ou non — pour ne
//      jamais révéler si un identifiant donné correspond à un compte réel.
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut,
// automatiquement disponibles dans toute Edge Function du projet — rien à
// configurer en plus de GMAIL_USER / GMAIL_APP_PASSWORD (déjà en place pour
// send-conge-email).
//
// DÉPLOIEMENT (Dashboard Supabase, comme send-conge-email) :
//   Edge Functions > Create a new function > "request-password-reset" >
//   coller ce fichier > Deploy. Aucun nouveau secret à ajouter.

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GMAIL_USER = Deno.env.get("GMAIL_USER");
const GMAIL_APP_PASSWORD = Deno.env.get("GMAIL_APP_PASSWORD");

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

async function sendResetEmail(to, username, tempPassword, isConducteur) {
  const client = new SMTPClient({
    connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } }
  });
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
  await client.send({ from: GMAIL_USER, to: to, subject: "Réinitialisation de votre mot de passe — CES Driver Planner", content: content });
  await client.close();
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const jsonHeaders = Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
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

    await sendResetEmail(targetEmail, profile.username, tempPassword, profile.role === "CONDUCTEUR");

    return new Response(JSON.stringify(GENERIC_RESPONSE), { headers: jsonHeaders });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }), { status: 500, headers: jsonHeaders });
  }
});
