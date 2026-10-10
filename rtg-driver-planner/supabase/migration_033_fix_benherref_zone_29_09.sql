-- Correction ponctuelle : BENHERREF (TCI046) doit être à MAERSK le 29/09/2026
-- (jamais deux zones consécutives : il était à MSC le 28/09, cf. migration_032).
-- Cette valeur correspond d'ailleurs à ce que le moteur de rotation CDI
-- (CerCdiRotationEngine) calcule déjà automatiquement comme zone suggérée ce
-- jour-là -- cette correction ne sert donc qu'à écraser une saisie manuelle
-- existante qui serait erronée pour le 29/09. Si aucune ligne n'existe encore
-- pour cette date, la requête UPDATE ne fait rien (l'appli affichera alors
-- directement la suggestion automatique MAERSK, sans besoin d'override).
update manual_overrides set zone = 'MAERSK', updated_at = now()
where date = '2026-09-29' and driver_id = (select id from drivers where matricule = 'TCI046');

select d.matricule, d.nom, mo.date, mo.shift, mo.status, mo.zone
from manual_overrides mo join drivers d on d.id = mo.driver_id
where mo.date = '2026-09-29' and d.matricule = 'TCI046';
