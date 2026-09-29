-- ==========================================
-- Migration 031 — Correctif matricules SABIR / KHAIRALLAH (28/09/2026)
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- migration_029 utilisait des matricules mal lus sur une capture d'écran
-- (TC0027 au lieu de TCI027 pour SABIR, TC0783 au lieu de C07783 pour
-- KHAIRALLAH) — ces 2 lignes n'ont donc jamais été créées/mises à jour, et
-- une ancienne affectation (motif d'import différent) est restée en place,
-- ignorée pour l'affichage de zone (planningEngine.js, "zoneFromImport").

insert into manual_overrides (date, driver_id, status, shift, zone, motif, details)
select '2026-09-28', d.id, 'PRESENT', 'S1', 'MAERSK', 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR AZZAM (correctif matricule)'
from drivers d where d.matricule = 'TCI027'
on conflict (date, driver_id) do update set status = excluded.status, shift = excluded.shift, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

insert into manual_overrides (date, driver_id, status, shift, zone, motif, details)
select '2026-09-28', d.id, 'PRESENT', 'S2', 'P80', 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR YAGOUBI (correctif matricule)'
from drivers d where d.matricule = 'C07783'
on conflict (date, driver_id) do update set status = excluded.status, shift = excluded.shift, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- Vérification.
select d.matricule, d.nom, mo.shift, mo.status, mo.zone, mo.motif
from manual_overrides mo
join drivers d on d.id = mo.driver_id
where mo.date = '2026-09-28' and d.matricule in ('TCI027', 'C07783');
