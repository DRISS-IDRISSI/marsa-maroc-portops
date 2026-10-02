-- ==========================================
-- RTG DRIVER PLANNER — Migration : rôle CONDUCTEUR (§37)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Idempotent : peut être ré-exécuté sans risque (drop/create if exists).
--
-- Objectif de cette étape : permettre de créer un compte de connexion par
-- conducteur, avec un accès RESTREINT à ses seules propres données
-- (lecture seule). La demande de congé en libre-service (upload du
-- justificatif, validation par le Responsable de Shift, email de
-- confirmation) fera l'objet d'une migration séparée, une fois les emails
-- personnels des conducteurs disponibles et l'envoi d'email configuré.
-- ==========================================

-- ---------- profiles : lien vers un conducteur précis ----------
-- Pertinent uniquement quand role = 'CONDUCTEUR' (comme team_id pour
-- RESPONSABLE_SHIFT). Un conducteur ne peut avoir qu'UN SEUL compte (index
-- unique partiel : les NULL, pour tous les autres rôles, ne sont pas
-- concernés par l'unicité).
alter table profiles add column if not exists driver_id text references drivers(id);
create unique index if not exists profiles_driver_id_unique on profiles(driver_id) where driver_id is not null;

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('ADMIN', 'RESPONSABLE', 'RESPONSABLE_SHIFT', 'CONDUCTEUR'));

-- ---------- fonction utilitaire RLS ----------
create or replace function current_user_driver() returns text
language sql stable security definer set search_path = public as $$
  select driver_id from profiles where id = auth.uid();
$$;

-- ---------- drivers : un CONDUCTEUR voit sa propre fiche ----------
drop policy if exists "drivers_select" on drivers;
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and team_id = current_user_team())
      or (current_user_role() = 'CONDUCTEUR' and id = current_user_driver())
    )
  );

-- ---------- conges / maladies / absences / heures_exceptionnelles /
-- feries_mouvements / manual_overrides : LECTURE SEULE de ses propres
-- données pour un CONDUCTEUR. L'écriture (_write policies) reste inchangée,
-- réservée à Admin/Responsable/Responsable de Shift — pas de libre-service
-- tant que le workflow d'approbation n'existe pas.
drop policy if exists "conges_select" on conges;
create policy "conges_select" on conges for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

drop policy if exists "maladies_select" on maladies;
create policy "maladies_select" on maladies for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

drop policy if exists "absences_select" on absences;
create policy "absences_select" on absences for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

drop policy if exists "heures_exceptionnelles_select" on heures_exceptionnelles;
create policy "heures_exceptionnelles_select" on heures_exceptionnelles for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

drop policy if exists "feries_mouvements_select" on feries_mouvements;
create policy "feries_mouvements_select" on feries_mouvements for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

drop policy if exists "manual_overrides_select" on manual_overrides;
create policy "manual_overrides_select" on manual_overrides for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or (current_user_role() = 'CONDUCTEUR' and driver_id = current_user_driver())));

-- ---------- Pas de changement nécessaire ----------
-- teams_select / app_config_select : déjà ouvertes à tout compte actif
-- (nécessaire pour que le moteur de planification calcule le planning côté
-- client) — un CONDUCTEUR en profite aussi, sans risque (config/équipes ne
-- sont pas des données personnelles).
-- profiles_select_self : déjà limitée à "id = auth.uid() OU rôle ADMIN" —
-- un CONDUCTEUR ne voit donc déjà que son propre profil.
-- Aucune policy d'écriture (_write) n'est accordée au rôle CONDUCTEUR nulle
-- part : un compte conducteur ne peut donc RIEN modifier pour l'instant.

-- ==========================================
-- FIN DE LA MIGRATION
-- Prochaine étape : créer les comptes via l'appli (Utilisateurs > "Comptes
-- conducteurs" > "Créer les comptes manquants"), puis distribuer les
-- identifiants/mots de passe générés à chaque conducteur.
-- ==========================================
