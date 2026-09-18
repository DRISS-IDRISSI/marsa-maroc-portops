-- ==========================================
-- RTG DRIVER PLANNER — Migration : Solde de congé annuel (§40)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Idempotent.
--
-- Règle métier confirmée par l'exploitant : chaque conducteur acquiert 26
-- jours ouvrables de congé par an (dimanche compté comme jour travaillé,
-- seuls les jours fériés marocains sont exclus du décompte). Le solde non
-- consommé d'une année est reportable sur l'année suivante, puis expire
-- (droit valable 2 ans maximum).
--
-- L'appli ne connaît pas l'historique RH antérieur à sa mise en service :
-- ces deux colonnes sont saisies manuellement UNE FOIS par un ADMIN à partir
-- des archives existantes, puis le solde se recalcule automatiquement
-- chaque année à partir des congés déjà enregistrés dans l'appli (voir
-- CongeBalanceEngine côté frontend).
-- ==========================================

alter table drivers add column if not exists conge_solde_report integer;
alter table drivers add column if not exists conge_solde_report_annee integer;

comment on column drivers.conge_solde_report is 'Solde de congé reporté (jours ouvrables), saisi manuellement par un ADMIN à partir des archives RH — hors droit annuel normal de conge_solde_report_annee.';
comment on column drivers.conge_solde_report_annee is 'Année à laquelle s''applique conge_solde_report — le solde se recalcule automatiquement à partir de cette année.';

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
