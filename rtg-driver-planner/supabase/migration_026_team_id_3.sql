-- ==========================================
-- Migration 026 — Équipe tertiaire (team_id_3) pour Responsable de Shift /
-- Chef d'Escale, et rattachement des binômes existants à leur équipe CER
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Chaque binôme de responsables (RTG + CC, migration_020_team_id2.sql) a
-- déjà team_id ET team_id_2 occupés. Avec l'arrivée de la 3ème flotte CER
-- (migration_023), ces mêmes binômes ont en plus besoin d'accéder à leur
-- équipe CER — d'où une 3ème équipe optionnelle, team_id_3, sur le même
-- principe que team_id_2.
--
-- Binômes CER confirmés par l'exploitant :
--   BAKKALI / HADDAZI    → GR BAKKALI-HADDAZI
--   AZZAM / BAHOUS       → GR AZZAM-BAHOUS
--   EDDAOUIDI / HOUSSAM  → GR EDDAOUIDI-HOUSSAM

-- 1) Colonne team_id_3 sur profiles.
alter table profiles add column if not exists team_id_3 text references teams(id);

-- 2) Fonction utilitaire : équipe tertiaire de l'utilisateur courant.
create or replace function current_user_team3() returns text
language sql stable security definer set search_path = public as $$
  select team_id_3 from profiles where id = auth.uid();
$$;

-- 3) is_own_team(driver_id) couvre désormais team_id, team_id_2 ET team_id_3.
create or replace function is_own_team(p_driver_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from drivers
    where id = p_driver_id
    and (
      team_id = current_user_team()
      or (current_user_team2() is not null and team_id = current_user_team2())
      or (current_user_team3() is not null and team_id = current_user_team3())
    )
  );
$$;

-- 4) drivers_select / drivers_write comparent team_id directement (sans
--    passer par is_own_team) — à mettre à jour explicitement, comme pour
--    team_id_2 dans migration_020.
drop policy if exists "drivers_select" on drivers;
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() in ('RESPONSABLE_SHIFT', 'CHEF_ESCALE') and (
        team_id = current_user_team()
        or (current_user_team2() is not null and team_id = current_user_team2())
        or (current_user_team3() is not null and team_id = current_user_team3())
      ))
      or is_own_team_via_driver(id)
    )
  );

drop policy if exists "drivers_write" on drivers;
create policy "drivers_write" on drivers for all
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and (
        team_id = current_user_team()
        or (current_user_team2() is not null and team_id = current_user_team2())
        or (current_user_team3() is not null and team_id = current_user_team3())
      ))
    )
  )
  with check (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and (
        team_id = current_user_team()
        or (current_user_team2() is not null and team_id = current_user_team2())
        or (current_user_team3() is not null and team_id = current_user_team3())
      ))
    )
  );

-- 5) Rattache les 8 comptes existants du binôme concerné à leur équipe CER.
update profiles set team_id_3 = 'CER_GR_BAKKALI_HADDAZI' where nom in ('ABOUZAMOU AIMAD', 'BAKKALI YASSIN', 'MAHBOUBI SAID');
update profiles set team_id_3 = 'CER_GR_AZZAM_BAHOUS' where nom in ('AZZAM ABDERRAZZAK', 'BAHOUS YASSIN', 'DEBBAB MOHAMED', 'ELFATOIKI ABDESSADEK');
update profiles set team_id_3 = 'CER_GR_EDDAOUIDI_HOUSSAM' where nom in ('EDDAOUIDI RACHID');

-- Vérification.
select nom, role, team_id, team_id_2, team_id_3 from profiles
where role in ('RESPONSABLE_SHIFT', 'CHEF_ESCALE')
order by nom;
