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
-- Fréquence : toutes les 5 minutes. Le TOS envoie un rapport à la fin de
-- chaque shift (S1/S2/S3, horaires précis non garantis) ; un intervalle
-- court réduit le délai avant que le mouvement soit visible dans l'appli.
-- Le job est très léger (quelques emails max par passage, dédoublonnés
-- par contrainte en base), donc sans risque à cette fréquence.
-- ==========================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('import-tos-moves') where exists (
  select 1 from cron.job where jobname = 'import-tos-moves'
);

select cron.schedule(
  'import-tos-moves',
  '*/5 * * * *',
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
