// ==========================================
// RTG DRIVER PLANNER — Edge Function : notification push (PWA)
// ==========================================
// Envoie une notification Web Push aux appareils abonnés (table
// push_subscriptions) d'un ensemble de destinataires — deux usages, appelés
// automatiquement par le frontend (store.js) :
//
//   target: "conge_reviewers" — un conducteur vient de soumettre une
//     demande de congé (RTGStore.submitCongeRequest) : notifie les comptes
//     qui PEUVENT la valider (même périmètre que la policy RLS
//     "conges_write" — voir schema.sql) : ADMIN/RESPONSABLE (toutes
//     équipes), + RESPONSABLE_SHIFT de l'équipe concernée (team_id OU
//     team_id_2, binôme RTG/CC). Nécessite teamId.
//
//   target: "driver" — un Responsable vient de valider/refuser/renvoyer une
//     demande (RTGStore.validateCongeRequest) : notifie le compte
//     CONDUCTEUR (profiles.driver_id) rattaché à ce conducteur, s'il existe
//     et a activé les notifications. Nécessite driverId.
//
// Le calcul des destinataires (qui PEUT/DOIT être notifié) se fait ICI,
// côté serveur, avec la clé service role (lecture de `profiles` sans RLS) —
// un compte CONDUCTEUR qui soumet sa demande n'a lui-même AUCUN droit de
// lire la liste des Responsables (RLS), donc ce calcul ne peut pas se faire
// côté client comme pour l'email de confirmation (send-conge-email, qui lui
// n'a besoin que de l'adresse du conducteur concerné, déjà connue du
// Responsable qui valide).
//
// Best-effort par construction, comme send-conge-email : un abonnement
// expiré/invalide (410/404, ex. désinstallation de l'appli, notifications
// révoquées) est silencieusement supprimé de push_subscriptions plutôt que
// de faire échouer l'envoi aux AUTRES abonnés — jamais une erreur ici ne
// doit remonter jusqu'à bloquer la soumission/validation du congé elle-même
// côté frontend (voir store.js, appel toujours dans un try/catch).
//
// DÉPLOIEMENT (sans CLI, depuis le Dashboard Supabase) :
//   1. Exécuter migration_022_push_subscriptions.sql (table + RLS).
//   2. Project > Edge Functions > Create a new function > nommez-la
//      "send-push-notification" > collez le contenu de ce fichier > Deploy.
//   3. Project > Edge Functions > Secrets > ajoutez :
//        VAPID_PUBLIC_KEY  = (clé publique VAPID — même valeur que
//                             RTG_PUSH_VAPID_PUBLIC_KEY côté client, pages.js)
//        VAPID_PRIVATE_KEY = (clé privée VAPID — JAMAIS exposée côté client,
//                             ne la collez nulle part ailleurs)
//        VAPID_SUBJECT     = mailto:contact@example.com (email de contact,
//                             requis par la spec Web Push, jamais affiché à
//                             l'utilisateur)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY sont des secrets par défaut, déjà
// disponibles automatiquement.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT non configurés (Project Settings > Edge Functions > Secrets).");
    }
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const { target, teamId, driverId, title, body: message, url, tag } = body || {};
    if (!title || !message) {
      return new Response(JSON.stringify({ error: "title/body requis." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    let userIds: string[] = [];
    if (target === "conge_reviewers") {
      // Sans teamId : seuls ADMIN/RESPONSABLE (toutes équipes) sont ciblés
      // (alertes de cadence RTG, non rattachées à une équipe précise).
      // Même périmètre que la policy RLS "conges_write" (schema.sql) : ADMIN/
      // RESPONSABLE (toutes équipes) + RESPONSABLE_SHIFT de l'équipe concernée
      // (team_id OU team_id_2, binôme RTG/CC) — jamais CHEF_ESCALE, qui ne
      // peut pas valider un congé.
      const { data, error } = await admin.from("profiles").select("id, role, team_id, team_id_2")
        .eq("actif", true).in("role", ["ADMIN", "RESPONSABLE", "RESPONSABLE_SHIFT"]);
      if (error) throw error;
      userIds = (data || [])
        .filter(p => p.role === "ADMIN" || p.role === "RESPONSABLE" || (!!teamId && p.role === "RESPONSABLE_SHIFT" && (p.team_id === teamId || p.team_id_2 === teamId)))
        .map(p => p.id);
    } else if (target === "driver") {
      if (!driverId) throw new Error("driverId requis pour target=driver.");
      const { data, error } = await admin.from("profiles").select("id").eq("actif", true).eq("driver_id", driverId).eq("role", "CONDUCTEUR");
      if (error) throw error;
      userIds = (data || []).map(p => p.id);
    } else {
      return new Response(JSON.stringify({ error: "target invalide (attendu: conge_reviewers | driver)." }),
        { status: 400, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, recipients: 0, sent: 0, removed: 0 }),
        { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
    }

    const { data: subs, error: subsError } = await admin.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_key").in("user_id", userIds);
    if (subsError) throw subsError;

    const payload = JSON.stringify({ title, body: message, url: url || "/", tag: tag || undefined });

    let sent = 0, removed = 0;
    const staleIds: string[] = [];
    for (const sub of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        );
        sent++;
      } catch (e) {
        const status = e && (e.statusCode || (e.response && e.response.status));
        if (status === 404 || status === 410) staleIds.push(sub.id);
        else console.error("send-push-notification: échec d'envoi (non bloquant) :", e);
      }
    }
    if (staleIds.length > 0) {
      const { error: delError } = await admin.from("push_subscriptions").delete().in("id", staleIds);
      if (!delError) removed = staleIds.length;
    }

    return new Response(JSON.stringify({ ok: true, recipients: userIds.length, subscriptions: (subs || []).length, sent, removed }),
      { headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" }) });
  }
});
