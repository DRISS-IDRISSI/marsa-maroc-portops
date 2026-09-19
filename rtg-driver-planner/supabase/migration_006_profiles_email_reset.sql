-- ==========================================
-- RTG DRIVER PLANNER — Migration : email de compte (mot de passe oublié)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Idempotent.
--
-- Permet "Mot de passe oublié ?" sur l'écran de connexion pour TOUS les
-- rôles (ADMIN / RESPONSABLE / RESPONSABLE_SHIFT / CONDUCTEUR) :
-- - Un compte CONDUCTEUR a déjà un email personnel via drivers.email
--   (rattaché par profiles.driver_id) — rien à ajouter pour lui.
-- - Un compte ADMIN/RESPONSABLE/RESPONSABLE_SHIFT n'a aujourd'hui aucun
--   email enregistré : cette colonne comble ce manque.
--
-- Utilisée par l'Edge Function request-password-reset (accès admin via
-- service_role, jamais exposée au frontend) pour savoir où envoyer le mot
-- de passe temporaire.
-- ==========================================

alter table profiles add column if not exists email text;

comment on column profiles.email is 'Email personnel (ADMIN/RESPONSABLE/RESPONSABLE_SHIFT) pour "mot de passe oublié" — pour un CONDUCTEUR, l''email vient de drivers.email via driver_id, ce champ reste vide.';

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
