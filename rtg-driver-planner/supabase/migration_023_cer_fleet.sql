-- ==========================================
-- RTG DRIVER PLANNER — Migration : flotte CER (Conducteur Engin Roulant)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query, EN UNE FOIS.
--
-- Ajoute une 3ème flotte complète (au même niveau que RTG et CC), avec la
-- même profondeur fonctionnelle : équipes à rotation de shift (S1→S3→S2,
-- même moteur ShiftRotationEngine que RTG/CC), rotation automatique de
-- poste par file d'attente (CerPosteRotationEngine, § code applicatif —
-- même mécanique que CC, mais SANS notion de vacation V1/V2, qui n'existe
-- pas pour CER — demande explicite de l'exploitant).
--
-- 1) Élargit la contrainte type_engin (migration_015) pour autoriser 'CER'.
-- 2) Crée les 3 équipes TITULAIRES (rotation réelle S1/S2/S3, calée sur le
--    planning réel communiqué le 28/09/2026 — fichier
--    "PLANING_CER_SEPTEMBRE_2026_DES_3_SHIFTS.xlsx") + 1 équipe "GR CDI"
--    (shift_cycle vide : les conducteurs CDI suivent EXACTEMENT le même
--    principe que les stagiaires CC — jamais de rotation automatique,
--    affectés manuellement au jour le jour sur le shift qui a besoin de
--    renfort, jamais le 3ème shift — confirmé explicitement par
--    l'exploitant).
-- 3) Crée les 37 conducteurs (26 titulaires + 11 CDI) avec leurs matricule/
--    nom/prénom réels, tels que relevés sur ce même fichier.
--
-- Idempotent (ON CONFLICT DO NOTHING) : peut être rejouée sans dupliquer.

alter table teams drop constraint if exists teams_type_engin_check;
alter table teams add constraint teams_type_engin_check
  check (type_engin in ('RTG', 'CC', 'CER'));

-- ---------- Équipes ----------
-- shift_cycle calé sur le planning réel de la semaine du 31/08/2026 (voir
-- config.referenceWeekStart = '2026-07-27' dans data.js) :
--   GR BAKKALI-HADDAZI  : S1 cette semaine-là → {S3,S2,S1}
--   GR EDDAOUIDI-HOUSSAM: S3 cette semaine-là → {S2,S1,S3}
--   GR AZZAM-BAHOUS     : S2 cette semaine-là → {S1,S3,S2}
insert into teams (id, nom, shift_cycle, type_engin) values
  ('CER_GR_BAKKALI_HADDAZI', 'GR BAKKALI-HADDAZI', array['S3','S2','S1'], 'CER'),
  ('CER_GR_EDDAOUIDI_HOUSSAM', 'GR EDDAOUIDI-HOUSSAM', array['S2','S1','S3'], 'CER'),
  ('CER_GR_AZZAM_BAHOUS', 'GR AZZAM-BAHOUS', array['S1','S3','S2'], 'CER'),
  ('CER_GR_CDI', 'GR CDI', array[]::text[], 'CER')
on conflict (id) do nothing;

-- ---------- Conducteurs — GR BAKKALI-HADDAZI (titulaires, shift initial S3) ----------
-- initial_vacation = 'V1' pour TOUS (bloc interne unique, jamais affiché —
-- § migration_024 : requis par restDayEngine.js pour plafonner/répartir
-- correctement les repos, même en l'absence de vraie notion de vacation).
insert into drivers (id, matricule, nom, prenom, team_id, initial_shift, initial_zone, initial_vacation, statut, date_entree, actif) values
  ('CER_GR_BAKKALI_HADDAZI_C07220', 'C07220', 'DAOUDI', 'MUSTAPHA', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_C07789', 'C07789', 'JAADI', 'YASSINE', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_C07846', 'C07846', 'TAMDY', 'OTHMAN', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_C07847', 'C07847', 'ZIRARI', 'ADIL', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_TC0084', 'TC0084', 'JAAOUANI', 'SOUFIANE', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_TCI026', 'TCI026', 'JAWBALY', 'FAHD', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_TCI028', 'TCI028', 'SAHBANI', 'AYOUB', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_TCI032', 'TCI032', 'MABROUK', 'MUSTAPHA', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_BAKKALI_HADDAZI_TCI035', 'TCI035', 'FAKIRI', 'MOHAMED', 'CER_GR_BAKKALI_HADDAZI', 'S3', 'PARC', 'V1', 'PRESENT', '2026-09-01', true)
on conflict (id) do nothing;

-- ---------- Conducteurs — GR EDDAOUIDI-HOUSSAM (titulaires, shift initial S2) ----------
insert into drivers (id, matricule, nom, prenom, team_id, initial_shift, initial_zone, initial_vacation, statut, date_entree, actif) values
  ('CER_GR_EDDAOUIDI_HOUSSAM_TCI022', 'TCI022', 'HADIQ', 'HICHAM', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_C07783', 'C07783', 'KHAIRALLAH', 'BOUCHAIB', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_TCI037', 'TCI037', 'MOUFAKIR', 'FAKHREDDINE', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_C07845', 'C07845', 'QUASSID', 'ALI', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_C07402', 'C07402', 'ABADA', 'ABDELILLAH', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_TCI031', 'TCI031', 'AZZAM', 'MOHAMED', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_TC0081', 'TC0081', 'TABII', 'MOUNIR', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_EDDAOUIDI_HOUSSAM_C07803', 'C07803', 'FITAH', 'MUSTAPHA', 'CER_GR_EDDAOUIDI_HOUSSAM', 'S2', 'PARC', 'V1', 'PRESENT', '2026-09-01', true)
on conflict (id) do nothing;

-- ---------- Conducteurs — GR AZZAM-BAHOUS (titulaires, shift initial S1) ----------
insert into drivers (id, matricule, nom, prenom, team_id, initial_shift, initial_zone, initial_vacation, statut, date_entree, actif) values
  ('CER_GR_AZZAM_BAHOUS_TC0075', 'TC0075', 'MAHTOUCH', 'ABDERRAHMAN', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TC0082', 'TC0082', 'CHAMKHA', 'AYOUB', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TC0085', 'TC0085', 'WADIF', 'MOHAMED', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TC0087', 'TC0087', 'CHAHSOURIER', 'MOHAMED', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TC0090', 'TC0090', 'EL IDRISSI', 'ANOUAR', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TCI027', 'TCI027', 'SABIR', 'MOHAMED ALI', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TCI033', 'TCI033', 'EL BAKHTI', 'JAMALEDDINE', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TCI040', 'TCI040', 'LAOURCH', 'AYOUB', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_AZZAM_BAHOUS_TC0072', 'TC0072', 'ETTAM', 'AZIZ', 'CER_GR_AZZAM_BAHOUS', 'S1', 'PARC', 'V1', 'PRESENT', '2026-09-01', true)
on conflict (id) do nothing;

-- ---------- Conducteurs CDI — GR CDI (pas de shift/rotation automatique) ----------
insert into drivers (id, matricule, nom, prenom, team_id, initial_shift, initial_zone, initial_vacation, statut, date_entree, actif) values
  ('CER_GR_CDI_TCI055', 'TCI055', 'BENADIF', 'ABDELKRIM', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI046', 'TCI046', 'BENHERREF', 'SAFOUANE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI041', 'TCI041', 'EL BOURANI', 'MOHAMED', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI054', 'TCI054', 'GHARBI', 'AMINE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI060', 'TCI060', 'GOURAGUINE', 'DRISS', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI052', 'TCI052', 'HALLAL', 'OMAR', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI059', 'TCI059', 'MASRAR', 'NOUR-EDDINE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI048', 'TCI048', 'NAIM', 'AMINE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI053', 'TCI053', 'NOUHAIR', 'ADNANE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI047', 'TCI047', 'OUALJI', 'ABDERRAHMANE', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true),
  ('CER_GR_CDI_TCI051', 'TCI051', 'OUARDHANI', 'ABDELHAMID', 'CER_GR_CDI', null, 'PARC', 'V1', 'PRESENT', '2026-09-01', true)
on conflict (id) do nothing;

-- Vérification.
select type_engin, count(*) from teams group by type_engin order by type_engin;
select t.nom, count(d.id) as nb_conducteurs from teams t left join drivers d on d.team_id = t.id where t.type_engin = 'CER' group by t.nom order by t.nom;
