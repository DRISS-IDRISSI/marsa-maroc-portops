-- ==========================================
-- Migration 029 — Affectation réelle du 28/09/2026 (3 shifts CER)
-- comme point de départ de la rotation automatique
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Source : 3 documents papier "État d'affectation des conducteurs"
-- (Chariots Élévateurs, TC3PC) du 28/09/2026 :
--   GR AZZAM   (SHIFT 1) = équipe CER_GR_AZZAM_BAHOUS
--   GR QADIRI  (SHIFT 3) = équipe CER_GR_BAKKALI_HADDAZI
--   GR YAGOUBI (SHIFT 2) = équipe CER_GR_EDDAOUIDI_HOUSSAM
--
-- Motif volontairement DIFFÉRENT de RTG_IMPORT_OVERRIDE_MOTIF
-- ("Import planning réel (Excel)", store.js) : ce motif précis fait
-- ignorer la zone importée par planningEngine.js pour la flotte CC/CER
-- (retombe sur la zone AUTO calculée) — l'inverse de ce qu'on veut ici,
-- où cette affectation réelle doit justement SERVIR de référence à la
-- rotation automatique à partir du 29/09.

-- ---------- GR AZZAM_BAHOUS (titulaires, SHIFT 1) ----------
insert into manual_overrides (date, driver_id, status, zone, motif, details)
select '2026-09-28', d.id, v.status, v.zone, 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR AZZAM'
from (values
  ('TCI040', 'PRESENT', 'P74'),
  ('TC0075', 'PRESENT', 'P74'),
  ('TCI033', 'PRESENT', 'MAERSK'),
  ('TC0085', 'PRESENT', 'MSC'),
  ('TC0082', 'REPOS', null),
  ('TC0090', 'PRESENT', 'COSCO'),
  ('TC0027', 'PRESENT', 'MAERSK'),
  ('TC0087', 'PRESENT', 'MSC'),
  ('TC0072', 'CONGE', null)
) as v(matricule, status, zone)
join drivers d on d.matricule = v.matricule
on conflict (date, driver_id) do update set status = excluded.status, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- ---------- GR BAKKALI_HADDAZI (titulaires, SHIFT 3) ----------
insert into manual_overrides (date, driver_id, status, zone, motif, details)
select '2026-09-28', d.id, v.status, v.zone, 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR QADIRI'
from (values
  ('C07847', 'REPOS', null),
  ('TC0084', 'REPOS', null),
  ('TCI032', 'PRESENT', 'P74'),
  ('TCI026', 'REPOS', null),
  ('C07846', 'PRESENT', 'P74'),
  ('C07220', 'PRESENT', 'P80'),
  ('TCI028', 'PRESENT', 'P80'),
  ('C07789', 'PRESENT', 'P80'),
  ('TCI035', 'CONGE', null)
) as v(matricule, status, zone)
join drivers d on d.matricule = v.matricule
on conflict (date, driver_id) do update set status = excluded.status, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- ---------- GR EDDAOUIDI_HOUSSAM (titulaires, SHIFT 2) ----------
insert into manual_overrides (date, driver_id, status, zone, motif, details)
select '2026-09-28', d.id, v.status, v.zone, 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier GR YAGOUBI'
from (values
  ('C07845', 'PRESENT', 'P74'),
  ('TCI037', 'PRESENT', 'P74'),
  ('TC0783', 'PRESENT', 'P80'),
  ('C07402', 'PRESENT', 'P80'),
  ('TCI022', 'PRESENT', 'P80'),
  ('TCI031', 'REPOS', null),
  ('TC0803', 'REPOS', null),
  ('TC0081', 'PRESENT', 'PARC')
) as v(matricule, status, zone)
join drivers d on d.matricule = v.matricule
on conflict (date, driver_id) do update set status = excluded.status, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- ---------- CDI en renfort ce jour-là (shift + zone saisis explicitement,
-- les CDI n'ont pas de shift automatique) ----------
insert into manual_overrides (date, driver_id, status, shift, zone, motif, details)
select '2026-09-28', d.id, 'PRESENT', v.shift, v.zone, 'Affectation réelle du 28/09/2026 (référence rotation CER)', 'Import papier CDI en renfort'
from (values
  ('TCI059', 'S1', 'COSCO'),
  ('TCI046', 'S1', 'MAERSK'),
  ('TCI054', 'S1', 'MSC'),
  ('TCI048', 'S1', 'MAERSK'),
  ('TCI055', 'S2', 'PARC'),
  ('TCI060', 'S2', 'PARC'),
  ('TCI053', 'S2', 'PARC'),
  ('TCI047', 'S2', 'PARC'),
  ('TCI051', 'S2', 'PARC')
) as v(matricule, shift, zone)
join drivers d on d.matricule = v.matricule
on conflict (date, driver_id) do update set status = excluded.status, shift = excluded.shift, zone = excluded.zone, motif = excluded.motif, details = excluded.details, updated_at = now();

-- Vérification.
select mo.date, t.nom as equipe, d.matricule, d.nom, d.prenom, mo.shift, mo.status, mo.zone
from manual_overrides mo
join drivers d on d.id = mo.driver_id
left join teams t on t.id = d.team_id
where mo.date = '2026-09-28' and mo.motif = 'Affectation réelle du 28/09/2026 (référence rotation CER)'
order by t.nom, d.nom;
