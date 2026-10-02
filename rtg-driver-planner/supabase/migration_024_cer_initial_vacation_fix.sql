-- ==========================================
-- RTG DRIVER PLANNER — Correctif : repos CER synchronisés sur toute l'équipe
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Bug : les conducteurs CER (migration_023) ont été créés avec
-- initial_vacation = NULL (puisque CER n'a pas de vacation V1/V2 — § data.js
-- fleetHasVacation). Mais restDayEngine.js suppose PARTOUT que chaque
-- conducteur appartient à un bloc "V1" ou "V2" pour plafonner/répartir le
-- nombre de repos pris le même jour (groupSizes, dayUsage, capForGroup...) :
-- avec NULL, ce plafond ne s'applique plus DU TOUT pour ces conducteurs, qui
-- finissent tous par choisir exactement les mêmes jours de repos (toute
-- l'équipe au repos un jour sur deux) au lieu d'être répartis normalement.
--
-- Correctif : place tous les conducteurs CER d'une même équipe dans un SEUL
-- bloc interne "V1" (jamais affiché — la flotte CER n'affiche aucune
-- vacation nulle part dans l'appli) pour que le moteur de repos les traite
-- comme un bloc normal de la taille réelle de l'équipe, correctement
-- plafonné/tourné jour par jour. Idempotent.

update drivers set initial_vacation = 'V1'
where team_id in ('CER_GR_BAKKALI_HADDAZI', 'CER_GR_EDDAOUIDI_HOUSSAM', 'CER_GR_AZZAM_BAHOUS', 'CER_GR_CDI')
  and (initial_vacation is null or initial_vacation not in ('V1', 'V2'));

-- Vérification (doit renvoyer 0 lignes).
select id, matricule, nom, initial_vacation from drivers
where team_id in ('CER_GR_BAKKALI_HADDAZI', 'CER_GR_EDDAOUIDI_HOUSSAM', 'CER_GR_AZZAM_BAHOUS', 'CER_GR_CDI')
  and (initial_vacation is null or initial_vacation not in ('V1', 'V2'));
