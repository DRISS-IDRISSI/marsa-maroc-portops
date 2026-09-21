-- ==========================================
-- RTG DRIVER PLANNER — Migration : nombre de mouvements sur un Over Time
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Permet de saisir, en plus des heures, le nombre de mouvements RTG
-- réalisés pendant un doublage / jour férié travaillé / 3ème shift
-- dimanche — champ optionnel, à saisir manuellement (le TOS ne distingue
-- pas ces mouvements du reste du shift).

alter table heures_exceptionnelles add column if not exists mouvements integer;
