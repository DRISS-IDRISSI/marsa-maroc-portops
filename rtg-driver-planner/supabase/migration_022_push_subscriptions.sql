-- ==========================================
-- Migration 022 — Notifications push (PWA) : congés à valider + réponse
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Stocke les abonnements Web Push (un par appareil/navigateur sur lequel un
-- utilisateur a activé les notifications, cf. bouton "Activer les
-- notifications" — RTGStore.subscribeToPush, store.js). Un même utilisateur
-- peut avoir plusieurs abonnements (téléphone + ordinateur) : chacun reçoit
-- la notification indépendamment.
--
-- Utilisée par l'Edge Function "send-push-notification" (service role,
-- lecture SANS RLS) pour retrouver les abonnements des destinataires — côté
-- client, un utilisateur ne gère que SA PROPRE ligne (RLS ci-dessous).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- Un utilisateur ne voit/gère que ses propres abonnements (un de ses
-- appareils) — la lecture "tous utilisateurs confondus" nécessaire à l'envoi
-- se fait exclusivement via la clé service role de l'Edge Function, qui
-- contourne RLS.
create policy "push_subscriptions_own" on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
