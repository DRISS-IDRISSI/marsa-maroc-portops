-- ==========================================
-- Migration 028 — Verrouillage du mot de passe par compte
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Certains comptes (ex. ZOUMHANE BRAHIM) ne doivent pas pouvoir changer
-- leur propre mot de passe (ni via "Mon compte", ni via "Mot de passe
-- oublié") — seul un ADMIN peut alors le faire, directement dans Supabase
-- (Authentication > Users).

alter table profiles add column if not exists password_locked boolean not null default false;

update profiles set password_locked = true where nom = 'ZOUMHANE BRAHIM';

-- Vérification.
select nom, username, role, password_locked from profiles where nom = 'ZOUMHANE BRAHIM';
