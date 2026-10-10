-- Correction ponctuelle : BENHERREF (TCI046) doit être à MSC, pas MAERSK, le 28/09/2026.
update manual_overrides set zone = 'MSC', updated_at = now()
where date = '2026-09-28' and driver_id = (select id from drivers where matricule = 'TCI046');

select d.matricule, d.nom, mo.zone from manual_overrides mo join drivers d on d.id = mo.driver_id
where mo.date = '2026-09-28' and d.matricule = 'TCI046';
