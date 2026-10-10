-- ==========================================
-- RTG DRIVER PLANNER — Migration : Conducteur voit le planning de son
-- équipe (§39)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Idempotent. Prérequis : migration_002_conducteur_role.sql déjà exécutée.
--
-- Objectif : demande explicite de l'exploitant — un conducteur doit pouvoir
-- consulter (en LECTURE SEULE) le Planning mensuel et l'Affectation du jour
-- de SA PROPRE ÉQUIPE (comme le fait déjà un Responsable de Shift), pas
-- seulement sa propre ligne. Pour que ces pages affichent correctement le
-- statut (repos/congé/maladie/absence) de CHAQUE conducteur de l'équipe, il
-- faut que les tables correspondantes soient lisibles pour toute l'équipe,
-- pas juste pour le conducteur lui-même.
--
-- IMPORTANT — ceci n'accorde AUCUN droit d'ÉCRITURE supplémentaire : seules
-- les policies "_select" sont modifiées ci-dessous. Un CONDUCTEUR reste
-- incapable de créer/modifier/supprimer quoi que ce soit pour un autre
-- conducteur (les policies "_write" existantes ne sont pas touchées).
-- ==========================================

-- Un conducteur (autre que soi-même) appartient-il à la même équipe que le
-- CONDUCTEUR actuellement connecté ? Fonction dédiée à la LECTURE (jamais
-- utilisée dans une policy d'écriture) pour ne jamais élargir accidentellement
-- les droits de modification via is_own_team (qui, elle, sert aussi aux
-- policies _write de RESPONSABLE_SHIFT).
create or replace function is_own_team_via_driver(p_driver_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_role() = 'CONDUCTEUR' and exists (
    select 1 from drivers d
    where d.id = p_driver_id
    and d.team_id = (select team_id from drivers where id = current_user_driver())
  );
$$;

-- ---------- drivers : un CONDUCTEUR voit toute SON équipe (plus seulement
-- lui-même — remplace la policy de migration_002).
drop policy if exists "drivers_select" on drivers;
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and team_id = current_user_team())
      or is_own_team_via_driver(id)
    )
  );

-- ---------- conges / maladies / absences / heures_exceptionnelles /
-- feries_mouvements / manual_overrides : un CONDUCTEUR voit toute SON
-- équipe (nécessaire pour que Planning mensuel/Affectation du jour
-- affichent le bon statut pour chaque collègue — sinon un collègue en congé
-- apparaîtrait à tort comme "présent"). Remplace le "OU" plus étroit
-- (driver_id = current_user_driver()) de migration_002/003 : voir son
-- équipe entière inclut trivialement de se voir soi-même.
drop policy if exists "conges_select" on conges;
create policy "conges_select" on conges for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

drop policy if exists "maladies_select" on maladies;
create policy "maladies_select" on maladies for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

drop policy if exists "absences_select" on absences;
create policy "absences_select" on absences for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

drop policy if exists "heures_exceptionnelles_select" on heures_exceptionnelles;
create policy "heures_exceptionnelles_select" on heures_exceptionnelles for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

drop policy if exists "feries_mouvements_select" on feries_mouvements;
create policy "feries_mouvements_select" on feries_mouvements for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

drop policy if exists "manual_overrides_select" on manual_overrides;
create policy "manual_overrides_select" on manual_overrides for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));

-- ---------- Pas de changement ----------
-- Aucune policy d'écriture (_write, "for all") n'est modifiée : un
-- CONDUCTEUR ne peut toujours rien créer/modifier/supprimer pour un autre
-- conducteur. Le bucket "justificatifs-conges" (migration_003) n'est pas
-- non plus élargi : un conducteur ne peut toujours ouvrir QUE son propre
-- justificatif, jamais celui d'un collègue.

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
