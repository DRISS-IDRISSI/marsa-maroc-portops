-- ==========================================
-- Ajoute "DETACHEMENT" aux valeurs autorisées de absences.type
-- (jusqu'ici limité à 'ABSENCE'/'FORMATION' — schema.sql ligne 128).
-- Sans cette migration, tout insert avec type='DETACHEMENT' échoue avec une
-- erreur 400 (violation de contrainte CHECK) — constaté en pratique lors de
-- l'import Excel d'un conducteur en détachement (code "D").
-- ==========================================

alter table absences drop constraint if exists absences_type_check;
alter table absences add constraint absences_type_check
  check (type in ('ABSENCE', 'FORMATION', 'DETACHEMENT'));
