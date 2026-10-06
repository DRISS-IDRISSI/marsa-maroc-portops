-- ==========================================
-- RTG DRIVER PLANNER — Migration 036 : sessions TOS
-- Heures de login/logout, premier/dernier mouvement, durée et statut de
-- session (CLOSED / OPEN / NO_LOGIN_EVENT) issus du rapport TOS "DRIVER
-- MOVES PER SHIFT" — colonnes déjà présentes dans le fichier mais jamais
-- enregistrées jusqu'ici. Servent à l'onglet "Sessions & alertes" (Mouvements)
-- et à l'alerte "session non fermée en fin de shift".
-- À exécuter dans Supabase : SQL Editor > New query. Puis REDÉPLOYER la
-- fonction Edge import-tos-moves (Dashboard > Edge Functions).
-- ==========================================
alter table mouvements_tos add column if not exists heure_login timestamp;
alter table mouvements_tos add column if not exists heure_logout timestamp;
alter table mouvements_tos add column if not exists premier_mvmt timestamp;
alter table mouvements_tos add column if not exists dernier_mvmt timestamp;
alter table mouvements_tos add column if not exists duree_min numeric;
alter table mouvements_tos add column if not exists statut_session text;
alter table mouvements_tos add column if not exists nb_sessions integer;
