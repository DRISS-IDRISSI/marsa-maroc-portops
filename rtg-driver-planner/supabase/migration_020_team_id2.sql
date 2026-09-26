-- ==========================================
-- Migration 020 — Équipe secondaire (team_id_2) pour Responsable de Shift /
-- Chef d'Escale : binôme de responsables couvrant RTG ET CC sur le même
-- shift (ex. BAHOUS/AZZAM, HADDAZI/BAKKALI, HOUSSAM/EDDAOUIDI) — demande
-- explicite de l'exploitant : "chaque shift a deux responsables qui
-- travaillent mutuellement, même si l'un est affecté au TC3PC et l'autre au
-- TCE, ils doivent avoir l'accès au CC et au RTG".
--
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
-- ==========================================

-- 1) Colonne team_id_2 sur profiles (équipe secondaire, autre flotte,
--    optionnelle — NULL pour la quasi-totalité des comptes).
alter table profiles add column if not exists team_id_2 text references teams(id);

-- 2) Fonction utilitaire : équipe secondaire de l'utilisateur courant.
create or replace function current_user_team2() returns text
language sql stable security definer set search_path = public as $$
  select team_id_2 from profiles where id = auth.uid();
$$;

-- 3) is_own_team(driver_id) couvre désormais team_id ET team_id_2 — se
--    propage automatiquement à toutes les policies qui l'utilisent déjà
--    (conges_write, heures_exceptionnelles_write, mouvements_manuels_write,
--    manual_overrides_select/write, audit_log_select...), sans les
--    modifier une par une.
create or replace function is_own_team(p_driver_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from drivers
    where id = p_driver_id
    and (team_id = current_user_team() or (current_user_team2() is not null and team_id = current_user_team2()))
  );
$$;

-- 4) drivers_select / drivers_write comparent team_id = current_user_team()
--    directement (sans passer par is_own_team) — à mettre à jour explicitement.
drop policy if exists "drivers_select" on drivers;
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() in ('RESPONSABLE_SHIFT', 'CHEF_ESCALE') and (team_id = current_user_team() or (current_user_team2() is not null and team_id = current_user_team2())))
      or is_own_team_via_driver(id)
    )
  );

drop policy if exists "drivers_write" on drivers;
create policy "drivers_write" on drivers for all
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and (team_id = current_user_team() or (current_user_team2() is not null and team_id = current_user_team2())))
    )
  )
  with check (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and (team_id = current_user_team() or (current_user_team2() is not null and team_id = current_user_team2())))
    )
  );
