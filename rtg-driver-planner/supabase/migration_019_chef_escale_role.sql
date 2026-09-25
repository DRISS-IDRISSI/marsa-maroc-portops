-- ==========================================
-- RTG DRIVER PLANNER — Migration : nouveau rôle CHEF_ESCALE
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
--
-- Demande explicite de l'exploitant : chaque shift compte 3 "chefs
-- d'escale" (postés aux CC, qui affectent les postes QUAI/PARC au jour le
-- jour — Affectation du jour) et 2 "responsables de shift" (accès plus
-- large). Le chef d'escale a le droit d'affecter les postes (comme un
-- RESPONSABLE_SHIFT), mais N'A PAS le droit de :
--   - gérer les congés (conges)
--   - saisir des mouvements manuels (mouvements_manuels)
--   - saisir des Over Times (heures_exceptionnelles)
--
-- 1) Nouvelle valeur de rôle autorisée.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('ADMIN', 'RESPONSABLE', 'RESPONSABLE_SHIFT', 'CHEF_ESCALE', 'CONDUCTEUR'));

-- 2) Lecture des conducteurs de SA propre équipe (indispensable pour voir
--    l'Affectation du jour) — jusqu'ici réservée littéralement à
--    RESPONSABLE_SHIFT, CHEF_ESCALE doit avoir le même accès en LECTURE.
--    L'écriture (drivers_write, fiche conducteur) reste réservée à
--    RESPONSABLE_SHIFT — modifier un dossier conducteur (matricule, motif
--    de départ...) reste une action RH, pas un chef d'escale.
drop policy if exists "drivers_select" on drivers;
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() in ('RESPONSABLE_SHIFT', 'CHEF_ESCALE') and team_id = current_user_team())
      or is_own_team_via_driver(id)
    )
  );

-- 3) Congés / Over Times / mouvements manuels : is_own_team(driver_id) seul
--    ne suffit plus à exclure CHEF_ESCALE (cette fonction ne vérifie que
--    l'équipe, pas le rôle) — un rôle EXPLICITE 'RESPONSABLE_SHIFT' est
--    maintenant requis pour ces 3 tables en ÉCRITURE. La LECTURE
--    (conges_select/heures_exceptionnelles_select/mouvements_manuels_select)
--    reste inchangée (déjà via is_own_team, sans restriction de rôle) : un
--    chef d'escale peut toujours CONSULTER ces informations, seule la
--    saisie/modification lui est interdite.
drop policy if exists "conges_write" on conges;
create policy "conges_write" on conges for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))));

drop policy if exists "heures_exceptionnelles_write" on heures_exceptionnelles;
create policy "heures_exceptionnelles_write" on heures_exceptionnelles for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))));

drop policy if exists "mouvements_manuels_write" on mouvements_manuels;
create policy "mouvements_manuels_write" on mouvements_manuels for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team(driver_id))));

-- manual_overrides_write (Affectation du jour — assignation des postes)
-- N'EST PAS modifiée : elle utilise déjà is_own_team(driver_id) SANS
-- restriction de rôle, donc CHEF_ESCALE en profite automatiquement dès
-- qu'un team_id lui est affecté — c'est exactement l'action qu'il doit
-- pouvoir faire.

-- Vérification.
select count(*) as profiles_ok from profiles;

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
