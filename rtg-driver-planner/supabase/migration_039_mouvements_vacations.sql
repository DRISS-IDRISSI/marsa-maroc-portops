-- ==========================================
-- RTG DRIVER PLANNER — Migration 039 : mouvements par vacation
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Fichier mensuel "DRIVER MOVE" de l'exploitant : par conducteur et par jour,
-- le nombre de mouvements réalisés dans chacune des 6 vacations
-- (S1 V1 07-11 / V2 11-15, S2 V1 15-19 / V2 19-23, S3 V1 23-03 / V2 03-07 —
-- S3 affecté au jour de début). Sert à détecter les DOUBLAGES : mouvements
-- réalisés hors de la vacation officielle du planning (> 15 le même jour =
-- doublage). Importé depuis Rapports > Fériés, 3ème shift & doublages.

create table if not exists mouvements_vacations (
  id bigint generated always as identity primary key,
  driver_id text references drivers(id) on delete cascade,
  login_tos text not null,
  date_travail date not null,
  shift text not null check (shift in ('S1', 'S2', 'S3')),
  vacation text not null check (vacation in ('V1', 'V2')),
  mouvements integer not null default 0,
  source_fichier text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (login_tos, date_travail, shift, vacation)
);

create index if not exists mouvements_vacations_date_idx on mouvements_vacations (date_travail);
create index if not exists mouvements_vacations_driver_date_idx on mouvements_vacations (driver_id, date_travail);

alter table mouvements_vacations enable row level security;

drop policy if exists "mouvements_vacations_select" on mouvements_vacations;
create policy "mouvements_vacations_select" on mouvements_vacations for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

-- Import / remplacement : ADMIN et RESPONSABLE uniquement.
drop policy if exists "mouvements_vacations_write" on mouvements_vacations;
create policy "mouvements_vacations_write" on mouvements_vacations for all
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'))
  with check (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

select count(*) as mouvements_vacations_ok from mouvements_vacations;
