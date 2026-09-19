-- ==========================================
-- RTG DRIVER PLANNER — Migration : mouvements RTG saisis manuellement
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Certains mouvements réalisés par les conducteurs ne remontent pas dans le
-- rapport TOS (mouvements manuels non tracés par le système). Cette table
-- permet à un responsable de les ajouter à la main, par conducteur et par
-- jour — fusionnés avec les mouvements importés automatiquement dans tous
-- les rapports existants (Mouvements RTG, onglet Rapports).

create table if not exists mouvements_manuels (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null references drivers(id) on delete cascade,
  date_travail date not null,
  shift text,
  nombre_in integer not null default 0,
  nombre_out integer not null default 0,
  nombre_move integer not null default 0,
  nombre_shifting integer not null default 0,
  nombre_disch integer not null default 0,
  nombre_load integer not null default 0,
  nombre_autre integer not null default 0,
  commentaire text,
  utilisateur text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists mouvements_manuels_driver_date_idx on mouvements_manuels (driver_id, date_travail);

alter table mouvements_manuels enable row level security;

-- Même règle que les autres données par conducteur (congés, heures
-- exceptionnelles...) : ADMIN/RESPONSABLE voient/modifient tout,
-- RESPONSABLE_SHIFT limité à sa propre équipe, un CONDUCTEUR voit (lecture
-- seule) les entrées de sa propre équipe.
create policy "mouvements_manuels_select" on mouvements_manuels for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "mouvements_manuels_write" on mouvements_manuels for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

-- Vérification.
select count(*) as mouvements_manuels_ok from mouvements_manuels;

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
