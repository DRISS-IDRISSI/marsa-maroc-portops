// ==========================================
// RTG DRIVER PLANNER — Edge Function : réinitialiser + renvoyer les identifiants
// ==========================================
// Appelée par un ADMIN depuis la page Utilisateurs, pour un compte qui existe
// DÉJÀ (donc dont le mot de passe d'origine n'est plus récupérable — Supabase
// Auth ne le stocke jamais en clair). Génère un nouveau mot de passe
// temporaire, l'applique via l'API Admin Auth, puis envoie un email complet
// (identifiants + lien de l'appli + installation PWA + mode d'emploi), avec
// le même contenu que "send-credentials-email" (création d'un nouveau
// compte) — dupliqué ici pour que chaque Edge Function reste déployable
// isolément (pas de module partagé entre fonctions).
//
// Contrôle d'accès : le frontend transmet automatiquement le jeton de la
// session en cours (Authorization: Bearer <jwt utilisateur>) via
// supabase.functions.invoke — on vérifie ici que ce jeton correspond bien à
// un profil avec role = 'ADMIN' avant de toucher au compte visé. Sans ce
// contrôle, n'importe quel utilisateur connecté pourrait réinitialiser le
// mot de passe de n'importe qui.
//
// Réutilise GMAIL_USER / GMAIL_APP_PASSWORD (déjà configurés) — aucun
// nouveau secret à ajouter. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
// SUPABASE_ANON_KEY sont des secrets par défaut, déjà disponibles.
//
// DÉPLOIEMENT (Dashboard Supabase, comme les autres Edge Functions) :
//   Edge Functions > Create a new function > "reset-and-send-credentials" >
//   coller ce fichier > Deploy.

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

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function escapeHtml(s: string) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Le mode d'emploi doit correspondre à ce que le rôle du compte peut
// réellement faire — un Responsable/Admin n'a pas les mêmes usages qu'un
// conducteur (ex. il valide des congés, il ne "dépose" pas de demande).
function featureListHtml(role: string) {
  if (role === "CONDUCTEUR") {
    return `
      <li><strong>Mon planning</strong> : consulter votre planning mensuel et vos vacations.</li>
      <li><strong>Mes mouvements</strong> : voir le détail de vos mouvements RTG importés depuis le TOS.</li>
      <li><strong>Congés / Maladies / Absences</strong> : déposer une demande de congé, voir son statut, et le solde restant.</li>
      <li><strong>Mon compte</strong> : changer votre mot de passe.</li>`;
  }
  if (role === "RESPONSABLE_SHIFT") {
    return `
      <li><strong>Affectation du jour</strong> : consulter et ajuster l'affectation de votre équipe.</li>
      <li><strong>Planning mensuel</strong> : planning de votre équipe.</li>
      <li><strong>Congés / Maladies / Absences</strong> : valider ou refuser les demandes de votre équipe.</li>
      <li><strong>Mouvements RTG</strong> : mouvements de votre équipe.</li>
      <li><strong>Mon compte</strong> : changer votre mot de passe.</li>`;
  }
  // RESPONSABLE ou ADMIN : accès à toutes les équipes.
  return `
      <li><strong>Planning mensuel / Affectation du jour</strong> : toutes les équipes.</li>
      <li><strong>Conducteurs</strong> : gestion des fiches conducteurs.</li>
      <li><strong>Congés / Maladies / Absences</strong> : validation, toutes équipes.</li>
      <li><strong>Mouvements RTG</strong> : suivi des imports TOS, toutes équipes.</li>
      <li><strong>Rapports</strong> : exports et rapports RH.</li>${role === "ADMIN" ? `
      <li><strong>Utilisateurs</strong> : gestion des comptes et rôles.</li>` : ""}
      <li><strong>Mon compte</strong> : changer votre mot de passe.</li>`;
}

function buildHtml({ driverName, username, password, appUrl, role }: { driverName: string; username: string; password: string; appUrl: string; role: string }) {
  const safeName = escapeHtml(driverName);
  const safeUsername = escapeHtml(username);
  const safePassword = escapeHtml(password);
  const safeUrl = escapeHtml(appUrl);
  const contactLine = role === "CONDUCTEUR"
    ? "En cas de problème de connexion, contactez votre Responsable de Shift."
    : "En cas de problème de connexion, contactez un administrateur de l'application.";
  return `
  <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto;">
    <h2 style="color: #0f172a;">Vos identifiants — RTG Driver Planner</h2>
    <p>Bonjour ${safeName},</p>
    <p>Voici vos identifiants pour l'application <strong>RTG Driver Planner</strong> (planning, mouvements, congés) :</p>
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
    <ul style="font-size: 14px;">${featureListHtml(role)}
    </ul>

    <p style="margin-top: 24px; font-size: 12px; color: #64748b;">Ceci est un message automatique — merci de ne pas y répondre. ${contactLine}</p>
    <p style="font-size: 12px; color: #64748b;">RTG Driver Planner — Marsa Maroc TC3PC</p>
  </div>`;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const jsonHeaders = Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
      throw new Error("Configuration incomplète (secrets manquants).");
    }
    const authHeader = req.headers.get("Authorization") || "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!callerJwt) {
      return new Response(JSON.stringify({ error: "Non authentifié." }), { status: 401, headers: jsonHeaders });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: callerAuth, error: callerAuthError } = await admin.auth.getUser(callerJwt);
    if (callerAuthError || !callerAuth || !callerAuth.user) {
      return new Response(JSON.stringify({ error: "Session invalide." }), { status: 401, headers: jsonHeaders });
    }
    const { data: callerProfile } = await admin.from("profiles").select("role,actif").eq("id", callerAuth.user.id).maybeSingle();
    if (!callerProfile || callerProfile.actif === false || callerProfile.role !== "ADMIN") {
      return new Response(JSON.stringify({ error: "Réservé aux administrateurs." }), { status: 403, headers: jsonHeaders });
    }

    const body = await req.json();
    const targetUserId = (body && body.targetUserId) || "";
    const appUrl = (body && body.appUrl) || "";
    if (!targetUserId || !appUrl) {
      return new Response(JSON.stringify({ error: "targetUserId et appUrl requis." }), { status: 400, headers: jsonHeaders });
    }

    const { data: target } = await admin.from("profiles").select("id,username,nom,role,driver_id,email,actif").eq("id", targetUserId).maybeSingle();
    if (!target || target.actif === false) {
      return new Response(JSON.stringify({ error: "Compte introuvable ou inactif." }), { status: 404, headers: jsonHeaders });
    }

    let targetEmail = target.email || null;
    let driverName = target.nom || "";
    if (target.role === "CONDUCTEUR" && target.driver_id) {
      const { data: driver } = await admin.from("drivers").select("email,nom,prenom").eq("id", target.driver_id).maybeSingle();
      targetEmail = driver && driver.email ? driver.email : null;
      if (driver) driverName = driver.nom + " " + driver.prenom;
    }
    if (!targetEmail) {
      return new Response(JSON.stringify({ error: "Aucun email renseigné pour ce compte." }), { status: 400, headers: jsonHeaders });
    }

    const tempPassword = generateTempPassword();
    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, { password: tempPassword });
    if (updateError) { console.error(updateError); throw updateError; }

    const html = buildHtml({ driverName, username: target.username, password: tempPassword, appUrl, role: target.role });
    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: GMAIL_USER, password: GMAIL_APP_PASSWORD } }
    });
    await client.send({ from: GMAIL_USER, to: targetEmail, subject: "Vos identifiants — RTG Driver Planner", content: "auto", html });
    await client.close();

    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }), { status: 500, headers: jsonHeaders });
  }
});
