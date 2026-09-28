-- ==========================================
-- Migration 027 — Assainissement des comptes Responsable de Shift /
-- Chef d'Escale : complète l'accès RTG+CC+CER de 3 comptes existants dont
-- une case équipe (team_id_2 ou team_id_3) était restée vide.
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Rappel des 3 shifts CER et de leurs équipes RTG/CC/CER :
--   Shift RTG 'A' (GR BAKKALI)    / CC_GR_HADDAZI  / CER_GR_BAKKALI_HADDAZI
--   Shift RTG 'B' (GR EDDAOUIDI)  / CC_GR_HOUSSAM  / CER_GR_EDDAOUIDI_HOUSSAM
--   Shift RTG 'C' (GR AZZAM)      / CC_GR_BAHOUS   / CER_GR_AZZAM_BAHOUS
--
-- 1) AZZAM ABDERRAZZAK (RESPONSABLE_SHIFT, shift C) : avait RTG + CER,
--    il manquait CC.
update profiles set team_id_2 = 'CC_GR_BAHOUS'
where nom = 'AZZAM ABDERRAZZAK' and team_id_2 is null;

-- 2) HADDAZI ABDELLAH (RESPONSABLE_SHIFT, shift A) : n'avait que CER,
--    il manquait RTG et CC.
update profiles set team_id_2 = 'A', team_id_3 = 'CC_GR_HADDAZI'
where nom = 'HADDAZI ABDELLAH' and team_id_2 is null;

-- 3) DEBBAB MOHAMED (CHEF_ESCALE, shift C) : avait CC + CER, il manquait RTG.
update profiles set team_id_2 = 'C'
where nom = 'DEBBAB MOHAMED' and team_id_2 is null;

-- Vérification.
select nom, role, team_id, team_id_2, team_id_3
from profiles
where nom in ('AZZAM ABDERRAZZAK', 'HADDAZI ABDELLAH', 'DEBBAB MOHAMED')
order by nom;
