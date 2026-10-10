-- ==========================================
-- Migration 021 — Chef d'Escale : retire l'accès (même en LECTURE) aux
-- mouvements des conducteurs (CC et RTG)
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Demande explicite de l'exploitant : "les chefs d'escale n'ont pas le
-- droit d'accéder aux mouvements des conducteurs CC et RTG". Jusqu'ici
-- (migration_019), la LECTURE de mouvements_tos/mouvements_manuels restait
-- ouverte à CHEF_ESCALE via is_own_team(driver_id) (qui ne vérifie que
-- l'équipe, pas le rôle) — seule la SAISIE manuelle lui était interdite.
-- Cette migration ajoute la même restriction de rôle EXPLICITE que pour
-- l'écriture : seul RESPONSABLE_SHIFT (en plus d'ADMIN/RESPONSABLE et du
-- CONDUCTEUR concerné) peut désormais consulter ces deux tables.

drop policy if exists "mouvements_tos_select" on mouvements_tos;
create policy "mouvements_tos_select" on mouvements_tos for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (driver_id is not null and ((current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id)) or is_own_team_via_driver(driver_id)))
    )
  );

drop policy if exists "mouvements_manuels_select" on mouvements_manuels;
create policy "mouvements_manuels_select" on mouvements_manuels for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))
      or is_own_team_via_driver(driver_id)
    )
  );
