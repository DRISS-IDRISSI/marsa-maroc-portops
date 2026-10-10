-- ==========================================
-- RTG DRIVER PLANNER — Migration : correction manuelle exceptionnelle du
-- rattachement login TOS ↔ conducteur
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Le rattachement automatique (voir import-tos-moves/index.ts) déduit le
-- login TOS attendu à partir du nom/prénom du conducteur. Certains comptes
-- TOS, créés manuellement il y a longtemps, ont une orthographe légèrement
-- différente du nom officiel (ex. "EL GHANNAMI" dans l'appli vs
-- "melghannamtc3" côté TOS, sans le "i" final) — la règle automatique ne
-- peut alors pas deviner la correspondance.
--
-- Ce champ optionnel permet de corriger ces cas ponctuels une fois pour
-- toutes : laissé vide, la règle automatique s'applique normalement ;
-- rempli, il prime et sert directement de login TOS pour ce conducteur.

alter table drivers add column if not exists login_tos text;

-- Vérification.
select count(*) as drivers_ok from drivers;

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
