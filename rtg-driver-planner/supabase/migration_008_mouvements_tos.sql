-- ==========================================
-- RTG DRIVER PLANNER — Migration : mouvements RTG importés depuis le
-- rapport TOS ("DRIVER MOVES PER SHIFT"), reçu par email à la fin de
-- chaque shift et relayé automatiquement vers une boîte Gmail dédiée
-- (gestioneffectif@gmail.com), lue par la fonction Supabase
-- "import-tos-moves" (voir supabase/functions/import-tos-moves/index.ts).
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.

create table if not exists mouvements_tos (
  id uuid primary key default gen_random_uuid(),
  driver_id text references drivers(id) on delete set null,
  login_tos text not null,
  date_travail date not null,
  shift text not null,
  engin text not null,
  facility text,
  nombre_in integer not null default 0,
  nombre_out integer not null default 0,
  nombre_move integer not null default 0,
  nombre_shifting integer not null default 0,
  nombre_disch integer not null default 0,
  nombre_load integer not null default 0,
  nombre_autre integer not null default 0,
  total_mvmt integer not null default 0,
  match_note text,           -- renseigné seulement si login_tos n'a pas pu être rattaché à un conducteur (driver_id alors null)
  source_message_id text,    -- Message-ID de l'email TOS d'origine, pour diagnostic
  created_at timestamptz not null default now(),
  -- Empêche la duplication si le même rapport est importé deux fois
  -- (relance manuelle, email TOS renvoyé) : une nouvelle importation avec
  -- les mêmes clés MET À JOUR la ligne plutôt que d'en créer une deuxième.
  unique (login_tos, date_travail, shift, engin)
);

create index if not exists mouvements_tos_driver_date_idx on mouvements_tos (driver_id, date_travail);

alter table mouvements_tos enable row level security;

-- Lecture : même règle que les autres données par conducteur (congés,
-- heures exceptionnelles...) — ADMIN/RESPONSABLE voient tout,
-- RESPONSABLE_SHIFT voit son équipe, un CONDUCTEUR voit sa propre équipe
-- (is_own_team_via_driver gère déjà le cas driver_id — mais ici driver_id
-- peut être NULL pour une ligne non rattachée : dans ce cas, seuls
-- ADMIN/RESPONSABLE la voient, pour pouvoir la corriger).
create policy "mouvements_tos_select" on mouvements_tos for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (driver_id is not null and (is_own_team(driver_id) or is_own_team_via_driver(driver_id)))
    )
  );

-- Écriture réservée à ADMIN/RESPONSABLE (correction manuelle exceptionnelle,
-- ex. rattacher une ligne non reconnue) — l'import automatique passe par le
-- service_role de la fonction Edge, qui contourne RLS.
create policy "mouvements_tos_write" on mouvements_tos for all
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'))
  with check (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

-- Vérification.
select count(*) as mouvements_tos_ok from mouvements_tos;

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
