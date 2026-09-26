-- ==========================================
-- RTG DRIVER PLANNER — Migration : envoi automatique quotidien de
-- l'Affectation du jour à 06h00 (heure du Maroc)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- ⚠️ AVANT DE COLLER CE FICHIER, remplacez les deux valeurs entre
-- <...> ci-dessous par les vôtres :
--   1. <VOTRE_PROJECT_REF> — visible dans l'URL de votre projet Supabase
--      (ex. rqhjabwqjxlmjdicgyqy.supabase.co -> project ref =
--      rqhjabwqjxlmjdicgyqy).
--   2. <VOTRE_SERVICE_ROLE_KEY> — Project Settings > API > "service_role"
--      (cliquez "Reveal" pour l'afficher). C'est une clé SECRÈTE, à ne
--      JAMAIS coller ailleurs que dans cette requête SQL exécutée une
--      seule fois ici (jamais dans un fichier du dépôt, jamais dans le
--      chat) — une fois la requête exécutée, cette page peut être fermée,
--      la clé reste stockée seulement dans la définition du job pg_cron,
--      visible uniquement depuis ce même SQL Editor (accès déjà réservé
--      aux administrateurs du projet).
--
-- Prérequis : la fonction "daily-affectation-email" doit déjà être
-- déployée (Edge Functions > Create a new function) avant que ce cron ne
-- se déclenche pour la première fois — voir
-- supabase/functions/daily-affectation-email/index.ts.
-- ==========================================

-- Extensions nécessaires pour programmer un appel HTTP périodique.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Supprime un job existant du même nom avant de le recréer (idempotent —
-- permet de relancer cette migration après une modification, ex. changer
-- l'heure, sans dupliquer le job).
select cron.unschedule('daily-affectation-email') where exists (
  select 1 from cron.job where jobname = 'daily-affectation-email'
);

-- 05:00 UTC = 06:00 au Maroc la majeure partie de l'année (heure d'été
-- permanente, UTC+1). EXCEPTION connue : pendant le Ramadan, le Maroc
-- repasse temporairement à UTC+0 — l'email partirait alors à 05h00 locale
-- au lieu de 06h00 ces semaines-là. Si cette précision devient gênante,
-- prévenez-moi : la programmation peut être ajustée chaque année juste
-- avant/après le Ramadan avec un simple re-run de cette migration (changer
-- "0 5" en "0 6" pour ces semaines, puis revenir à "0 5" ensuite).
select cron.schedule(
  'daily-affectation-email',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://<VOTRE_PROJECT_REF>.supabase.co/functions/v1/daily-affectation-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <VOTRE_SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);

-- Vérification : doit afficher le job "daily-affectation-email" avec son
-- planning ('0 5 * * *') et active = true.
select jobid, jobname, schedule, active from cron.job where jobname = 'daily-affectation-email';

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
