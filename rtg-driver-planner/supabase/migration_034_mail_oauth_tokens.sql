-- ==========================================
-- RTG DRIVER PLANNER — Migration : jetons OAuth2 Microsoft (Outlook/Graph)
-- ==========================================
-- Stocke le refresh_token (et le dernier access_token mis en cache, pour
-- éviter d'en redemander un neuf à chaque appel) du compte technique
-- Outlook (marsamaroc.CES@outlook.fr), utilisé par Microsoft Graph pour
-- lire les rapports TOS (import-tos-moves) et envoyer les emails (les 5
-- autres Edge Functions d'envoi). Une SEULE ligne, id='outlook'.
--
-- Pourquoi une table plutôt qu'un secret Edge Functions : Microsoft fait
-- tourner (rotate) le refresh_token à chaque rafraîchissement — il faut
-- donc pouvoir RÉÉCRIRE sa valeur depuis le code (via la clé service_role,
-- déjà disponible dans chaque fonction), ce qu'un secret ne permet pas
-- (lecture seule côté fonction, écriture uniquement depuis le Dashboard).
--
-- À exécuter dans Supabase : Project > SQL Editor > New query.
-- ==========================================

create table if not exists mail_oauth_tokens (
  id text primary key,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table mail_oauth_tokens enable row level security;
-- Aucune policy : accessible uniquement via la clé service_role (utilisée
-- par les Edge Functions), qui contourne RLS — jamais exposée au frontend.
