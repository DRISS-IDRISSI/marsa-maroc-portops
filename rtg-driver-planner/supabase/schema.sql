-- ==========================================
-- RTG DRIVER PLANNER — Schéma Supabase (PostgreSQL + RLS)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Ce script est idempotent-friendly (IF NOT EXISTS) mais est pensé pour être
-- exécuté UNE FOIS sur un projet neuf. Ne rien exécuter en production tant
-- que le plan de migration n'a pas été validé.
--
-- Correspondance avec l'état actuel (localStorage, src/data.js / store.js) :
--   drivers               -> table drivers
--   teams                 -> table teams
--   config                -> table app_config (une seule ligne, en JSONB)
--   conges                -> table conges
--   maladies              -> table maladies
--   absences              -> table absences
--   heuresExceptionnelles -> table heures_exceptionnelles
--   feriesMouvements      -> table feries_mouvements
--   manualOverrides       -> table manual_overrides
--   auditLog              -> table audit_log
--   users                 -> auth.users (Supabase Auth) + table profiles (rôle/équipe)
-- ==========================================

-- ---------- Extensions ----------
create extension if not exists "pgcrypto"; -- pour gen_random_uuid()

-- ---------- Équipes ----------
create table if not exists teams (
  id text primary key,                 -- "A" / "B" / "C"
  nom text not null,                   -- "GR BAKKALI", etc. (renommable via l'appli)
  shift_cycle text[] not null          -- ex. {S3,S2,S1}
);

-- ---------- Conducteurs ----------
create table if not exists drivers (
  id text primary key,                 -- ex. "A_C06491" (conservé identique à l'existant)
  matricule text not null unique,
  nom text not null,
  prenom text not null,
  email text,                          -- personnel, pour les notifications de congé (§38)
  team_id text references teams(id),
  initial_shift text,
  initial_zone text,
  initial_vacation text,
  statut text,
  date_entree date,
  date_sortie date,
  observation text,
  actif boolean not null default true,
  -- motif de départ : RETRAITE / CHANGEMENT_POSTE / AGENT_SUSPENDU (voir DEPART_MOTIF_LABELS, pages2.js)
  motif_depart text,
  -- Ordre d'affichage dans le Planning mensuel (§35) : rempli automatiquement
  -- par l'import Excel du planning réel (ordre des lignes du fichier), pour
  -- que l'appli et le fichier de l'exploitant se comparent ligne à ligne.
  -- NULL = pas encore importé, ce conducteur reste affiché après les autres.
  ordre_affichage integer,
  -- Solde de congé annuel (§40) : conge_solde_report = reliquat (jours
  -- ouvrables) reportable depuis avant la mise en service de l'appli, saisi
  -- manuellement par un ADMIN à partir des archives RH ; conge_solde_report_annee
  -- = année à laquelle ce reliquat s'applique. Le solde se recalcule ensuite
  -- automatiquement chaque année à partir des congés enregistrés dans
  -- l'appli (voir CongeBalanceEngine côté frontend).
  conge_solde_report integer,
  conge_solde_report_annee integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Profils utilisateurs (comptes applicatifs, liés à Supabase Auth) ----------
-- Un utilisateur Supabase Auth (auth.users) = un compte de connexion.
-- Cette table ajoute nom/rôle/équipe, invisibles de auth.users.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  nom text not null,
  role text not null check (role in ('ADMIN', 'RESPONSABLE', 'RESPONSABLE_SHIFT', 'CONDUCTEUR')),
  team_id text references teams(id),   -- uniquement pertinent si role = RESPONSABLE_SHIFT
  driver_id text references drivers(id), -- uniquement pertinent si role = CONDUCTEUR (§37)
  actif boolean not null default true,
  -- Email personnel (ADMIN/RESPONSABLE/RESPONSABLE_SHIFT) pour "mot de passe
  -- oublié" (§41) — pour un CONDUCTEUR, l'email vient de drivers.email via
  -- driver_id, ce champ reste vide.
  email text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_driver_id_unique on profiles(driver_id) where driver_id is not null;

-- ---------- Congés / Maladies / Absences (même forme, 3 tables comme l'existant) ----------
-- conges a un workflow d'approbation en plus (§38) : une demande envoyée en
-- libre-service par un conducteur entre en EN_ATTENTE (justificatif à
-- l'appui, cf. bucket storage "justificatifs-conges" plus bas) et n'a AUCUN
-- effet sur le planning tant qu'elle n'est pas VALIDE (voir
-- AbsenceEngine.activeConges, src/engines/absenceEngine.js). Un congé saisi
-- directement par un responsable reste VALIDE dès sa création (valeur par
-- défaut), comme avant.
create table if not exists conges (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null references drivers(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  type text,
  commentaire text,
  utilisateur text,                    -- nom affiché (historique), redondant avec created_by
  created_by uuid references auth.users(id),
  statut text not null default 'VALIDE' check (statut in ('EN_ATTENTE', 'VALIDE', 'REFUSE')),
  justificatif_path text,              -- chemin dans le bucket storage "justificatifs-conges"
  motif_refus text,
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists maladies (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null references drivers(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  commentaire text,
  utilisateur text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists absences (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null references drivers(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  type text check (type in ('ABSENCE', 'FORMATION')),
  commentaire text,
  utilisateur text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- Heures exceptionnelles (§29) ----------
create table if not exists heures_exceptionnelles (
  id uuid primary key default gen_random_uuid(),
  driver_id text not null references drivers(id) on delete cascade,
  date_debut date not null,
  date_fin date not null,
  type text not null check (type in ('DOUBLAGE', 'FERIE_TRAVAILLE', 'DIMANCHE_S3')),
  heures numeric not null,
  commentaire text,
  utilisateur text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- Mouvements réalisés un jour férié, par conducteur (§31) ----------
create table if not exists feries_mouvements (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id text not null references drivers(id) on delete cascade,
  mouvements integer not null,
  commentaire text,
  utilisateur text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, driver_id)
);

-- ---------- Affectations manuelles (remplacements, etc.) ----------
create table if not exists manual_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  driver_id text not null references drivers(id) on delete cascade,
  shift text,
  vacation text,
  zone text,
  status text,
  start_time text,
  end_time text,
  motif text,                          -- ex. "Remplacement"
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (date, driver_id)
);

-- ---------- Journal d'audit ----------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  date timestamptz not null default now(),
  utilisateur text,
  driver_id text,
  matricule text,
  action text not null,
  details text
);

-- ---------- Configuration applicative (RTG_CONFIG) ----------
-- Une seule ligne : zones, shifts, vacations, jours fériés, règles métier...
create table if not exists app_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ==========================================
-- FONCTIONS UTILITAIRES (pour les politiques RLS)
-- ==========================================
-- SECURITY DEFINER : ces fonctions lisent `profiles` avec les droits du
-- propriétaire, pour éviter toute récursion RLS lors de leur usage DANS des
-- policies sur `profiles` elle-même.

create or replace function current_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function current_user_team() returns text
language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid();
$$;

create or replace function current_user_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select actif from profiles where id = auth.uid()), false);
$$;

-- Un conducteur est-il dans l'équipe de l'utilisateur courant ?
create or replace function is_own_team(p_driver_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from drivers where id = p_driver_id and team_id = current_user_team()
  );
$$;

-- Conducteur rattaché au compte courant (role = CONDUCTEUR uniquement — §37).
create or replace function current_user_driver() returns text
language sql stable security definer set search_path = public as $$
  select driver_id from profiles where id = auth.uid();
$$;

-- Un conducteur (autre que soi-même) est-il dans la même équipe que le
-- CONDUCTEUR actuellement connecté ? — §39, demande explicite de
-- l'exploitant : un conducteur voit le planning de toute son équipe, pas
-- seulement sa propre ligne. Fonction dédiée à la LECTURE, jamais utilisée
-- dans une policy d'écriture (contrairement à is_own_team, partagée avec
-- les policies _write de RESPONSABLE_SHIFT) — pour ne jamais élargir
-- accidentellement un droit de modification.
create or replace function is_own_team_via_driver(p_driver_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select current_user_role() = 'CONDUCTEUR' and exists (
    select 1 from drivers d
    where d.id = p_driver_id
    and d.team_id = (select team_id from drivers where id = current_user_driver())
  );
$$;

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================
-- Principe : ADMIN et RESPONSABLE voient/modifient tout. RESPONSABLE_SHIFT ne
-- voit/modifie que les données de SA propre équipe. Tout accès exige un compte
-- actif (current_user_active()). Personne d'anonyme (non authentifié) n'a accès
-- à rien : aucune policy ci-dessous n'autorise le rôle "anon".

alter table teams enable row level security;
alter table drivers enable row level security;
alter table profiles enable row level security;
alter table conges enable row level security;
alter table maladies enable row level security;
alter table absences enable row level security;
alter table heures_exceptionnelles enable row level security;
alter table feries_mouvements enable row level security;
alter table manual_overrides enable row level security;
alter table audit_log enable row level security;
alter table app_config enable row level security;

-- ---------- teams ----------
create policy "teams_select" on teams for select
  using (auth.role() = 'authenticated' and current_user_active());

create policy "teams_write" on teams for all
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'))
  with check (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

-- ---------- drivers ----------
create policy "drivers_select" on drivers for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and team_id = current_user_team())
      or is_own_team_via_driver(id)
    )
  );

create policy "drivers_write" on drivers for all
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and team_id = current_user_team())
    )
  )
  with check (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and team_id = current_user_team())
    )
  );

-- ---------- profiles ----------
-- Chacun voit son propre profil ; ADMIN voit/gère tout le monde.
create policy "profiles_select_self" on profiles for select
  using (id = auth.uid() or current_user_role() = 'ADMIN');

create policy "profiles_write_admin" on profiles for all
  using (current_user_role() = 'ADMIN')
  with check (current_user_role() = 'ADMIN');

-- ---------- conges / maladies / absences / heures_exceptionnelles (même règle) ----------
create policy "conges_select" on conges for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "conges_write" on conges for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));
-- Un CONDUCTEUR peut créer SA PROPRE demande, toujours EN_ATTENTE (jamais
-- s'auto-valider) — §38. Se combine en OR avec "conges_write" ci-dessus
-- (plusieurs policies permissives sur une même commande), sans l'élargir :
-- un conducteur n'a accès qu'à ce cas précis.
create policy "conges_insert_self" on conges for insert
  with check (
    current_user_active() and current_user_role() = 'CONDUCTEUR'
    and driver_id = current_user_driver() and statut = 'EN_ATTENTE'
  );

create policy "maladies_select" on maladies for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "maladies_write" on maladies for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

create policy "absences_select" on absences for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "absences_write" on absences for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

create policy "heures_exceptionnelles_select" on heures_exceptionnelles for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "heures_exceptionnelles_write" on heures_exceptionnelles for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

create policy "feries_mouvements_select" on feries_mouvements for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "feries_mouvements_write" on feries_mouvements for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

create policy "manual_overrides_select" on manual_overrides for select
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id) or is_own_team_via_driver(driver_id)));
create policy "manual_overrides_write" on manual_overrides for all
  using (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)))
  with check (current_user_active() and (current_user_role() in ('ADMIN', 'RESPONSABLE') or is_own_team(driver_id)));

-- ---------- audit_log ----------
-- Lecture : ADMIN/RESPONSABLE voient tout, RESPONSABLE_SHIFT voit les entrées
-- de ses conducteurs (driver_id nullable pour les actions générales -> visibles
-- uniquement par ADMIN/RESPONSABLE dans ce cas).
create policy "audit_log_select" on audit_log for select
  using (
    current_user_active() and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (driver_id is not null and is_own_team(driver_id))
    )
  );
-- Écriture : tout utilisateur actif peut ajouter une entrée (l'app le fait
-- automatiquement à chaque action), jamais modifier/supprimer.
create policy "audit_log_insert" on audit_log for insert
  with check (current_user_active());

-- ---------- app_config ----------
-- Lecture pour tout compte actif, écriture réservée à ADMIN/RESPONSABLE.
create policy "app_config_select" on app_config for select
  using (current_user_active());
create policy "app_config_write" on app_config for all
  using (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'))
  with check (current_user_active() and current_user_role() in ('ADMIN', 'RESPONSABLE'));

-- ---------- Stockage des justificatifs de congé (bucket privé — §38) ----------
-- Chemin des fichiers : <driver_id>/<horodatage>-<nom>. Mêmes règles de
-- visibilité que la table conges : Admin/Responsable voient tout,
-- Responsable de Shift son équipe, Conducteur uniquement lui-même (et ne
-- peut déposer que dans son propre dossier).
insert into storage.buckets (id, name, public)
  values ('justificatifs-conges', 'justificatifs-conges', false)
  on conflict (id) do nothing;

create policy "conges_justificatifs_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'justificatifs-conges' and current_user_active()
    and current_user_role() = 'CONDUCTEUR'
    and (storage.foldername(name))[1] = current_user_driver()
  );

create policy "conges_justificatifs_select" on storage.objects for select
  using (
    bucket_id = 'justificatifs-conges' and current_user_active()
    and (
      current_user_role() in ('ADMIN', 'RESPONSABLE')
      or (current_user_role() = 'RESPONSABLE_SHIFT' and is_own_team((storage.foldername(name))[1]))
      or (current_user_role() = 'CONDUCTEUR' and (storage.foldername(name))[1] = current_user_driver())
    )
  );

-- ==========================================
-- FIN DU SCHÉMA
-- Prochaine étape : créer le premier compte ADMIN dans Supabase Auth, puis
-- lui insérer une ligne correspondante dans `profiles` (voir script de
-- migration séparé, migration_import.sql / migration.md).
-- ==========================================
