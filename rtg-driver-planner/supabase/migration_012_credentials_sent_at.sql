-- ==========================================
-- RTG DRIVER PLANNER — Migration : horodatage du dernier envoi d'identifiants
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Permet d'afficher durablement "Envoyé le ..." sur la page Utilisateurs
-- (au lieu d'un statut perdu dès qu'on change de page) après l'envoi des
-- identifiants (création de compte ou "Renvoyer identifiants").

alter table profiles add column if not exists credentials_sent_at timestamptz;
