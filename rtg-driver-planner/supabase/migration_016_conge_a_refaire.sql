-- ==========================================
-- RTG DRIVER PLANNER — Migration 016 : statut "À refaire" pour les congés
-- ==========================================
-- Ajoute un 4ème statut 'A_REFAIRE' à la table conges (§ bouton "Refaire"
-- sur la page Congés, à côté de Valider/Refuser/Supprimer) : permet à un
-- Responsable de demander à un conducteur de renvoyer sa demande (ex.
-- justificatif illisible/déformé) sans passer par le contournement manuel
-- Refuser + Supprimer + lui redemander verbalement. Le conducteur voit
-- alors une alerte sur "Mes congés" (statut + motif) et peut renvoyer une
-- nouvelle demande normalement : c'est un INSERT d'une nouvelle ligne,
-- toujours EN_ATTENTE — la policy RLS "conges_insert_self" (migration_003)
-- n'a donc besoin d'AUCUNE modification, l'ancienne ligne A_REFAIRE reste
-- simplement comme historique jusqu'à suppression par le Responsable.
--
-- À exécuter dans Supabase > SQL Editor (comme les migrations précédentes).

alter table conges drop constraint if exists conges_statut_check;
alter table conges add constraint conges_statut_check
  check (statut in ('EN_ATTENTE', 'VALIDE', 'REFUSE', 'A_REFAIRE'));
