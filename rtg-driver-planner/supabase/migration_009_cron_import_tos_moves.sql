-- ==========================================
-- RTG DRIVER PLANNER — Migration : planification de l'import automatique
-- des mouvements RTG depuis le rapport TOS (boîte Gmail dédiée)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- ⚠️ AVANT DE COLLER CE FICHIER, remplacez les deux valeurs entre
-- <...> ci-dessous par les vôtres (même procédure que
-- migration_007_cron_affectation_email.sql) :
--   1. <VOTRE_PROJECT_REF>
--   2. <VOTRE_SERVICE_ROLE_KEY> — clé SECRÈTE, jamais collée ailleurs.
--
-- Prérequis :
--   - La table mouvements_tos doit déjà exister (migration_008).
--   - La fonction "import-tos-moves" doit déjà être déployée (Edge
--     Functions > Create a new function).
--   - Les secrets TOS_GMAIL_USER et TOS_GMAIL_APP_PASSWORD doivent déjà
--     être configurés (Edge Functions > Secrets).
--
-- Fréquence : toutes les 30 minutes. Le TOS envoie un rapport à la fin de
-- chaque shift (S1/S2/S3, horaires précis non garantis) — un intervalle de
-- 30 min capture les 3 rapports quotidiens avec un délai raisonnable, sans
-- dépendre d'une heure d'envoi exacte. Un passage qui ne trouve aucun
-- nouvel email ne fait rien (recherche des emails NON LUS uniquement).
-- ==========================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('import-tos-moves') where exists (
  select 1 from cron.job where jobname = 'import-tos-moves'
);

select cron.schedule(
  'import-tos-moves',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://<VOTRE_PROJECT_REF>.supabase.co/functions/v1/import-tos-moves',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VOTRE_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);

-- Vérification : doit afficher le job "import-tos-moves" avec son
-- planning ('*/30 * * * *') et active = true.
select jobid, jobname, schedule, active from cron.job where jobname = 'import-tos-moves';

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
