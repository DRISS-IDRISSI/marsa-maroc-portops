-- ==========================================
-- RTG DRIVER PLANNER — Migration : logins TOS à ignorer définitivement
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Certains logins du rapport TOS ne correspondent à aucun conducteur RTG
-- de l'appli sans que ce soit une erreur à corriger (ex. un conducteur
-- tracteur ayant ponctuellement opéré un RTG) — inutile de les signaler
-- comme "non rattaché" à chaque import. Un login ici est :
--   1. Ignoré par "import-tos-moves" (jamais inséré dans mouvements_tos) ;
--   2. Nettoyé automatiquement de l'historique déjà importé (lignes
--      driver_id = null existantes) au prochain passage du cron.

create table if not exists mouvements_tos_logins_ignores (
  login_tos text primary key,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table mouvements_tos_logins_ignores enable row level security;

create policy "mouvements_tos_logins_ignores_select" on mouvements_tos_logins_ignores for select
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

create policy "mouvements_tos_logins_ignores_write" on mouvements_tos_logins_ignores for all
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'))
  with check (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

-- Vérification.
select count(*) as mouvements_tos_logins_ignores_ok from mouvements_tos_logins_ignores;

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
