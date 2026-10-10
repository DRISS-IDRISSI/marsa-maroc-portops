-- ==========================================
-- Migration 035 — Corrige le matricule de FITAH (C07803, pas TC0803)
-- ==========================================
-- migration_029 utilisait le matricule "TC0803" pour FITAH (GR
-- EDDAOUIDI-HOUSSAM) — son vrai matricule est "C07803". La jointure
-- "join drivers d on d.matricule = v.matricule" n'a donc trouvé aucune
-- correspondance : sa ligne du 28/09/2026 (REPOS) n'a JAMAIS été insérée
-- dans manual_overrides. Le même mauvais matricule était codé en dur dans
-- CER_BOOTSTRAP_ORDER (cerPosteRotationEngine.js, déjà corrigé dans le
-- code) — ce qui faisait passer FITAH après TABII dans la file de départ
-- CER au lieu d'avant, contrairement à l'ordre réel du papier.
--
-- À exécuter dans Supabase Dashboard > SQL Editor.

insert into manual_overrides (date, driver_id, status, zone, motif, details)
select '2026-09-28', d.id, 'REPOS', null, 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR YAGOUBI (correction matricule FITAH)'
from drivers d
where d.matricule = 'C07803'
on conflict (date, driver_id) do update set status = excluded.status, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- Vérification.
select mo.date, d.matricule, d.nom, d.prenom, mo.shift, mo.status, mo.zone
from manual_overrides mo join drivers d on d.id = mo.driver_id
where mo.date = '2026-09-28' and d.matricule = 'C07803';
