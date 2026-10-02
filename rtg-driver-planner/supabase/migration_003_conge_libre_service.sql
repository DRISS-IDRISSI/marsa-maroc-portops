-- ==========================================
-- RTG DRIVER PLANNER — Migration : congé en libre-service (§38)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query > coller > Run.
-- Idempotent : peut être ré-exécuté sans risque (add column/policy if not
-- exists, drop policy if exists avant recreate).
-- Prérequis : migration_002_conducteur_role.sql déjà exécutée (rôle
-- CONDUCTEUR, current_user_driver(), etc.).
--
-- Objectif : un conducteur peut envoyer sa propre demande de congé, avec
-- justificatif (photo/scan de la demande signée) à l'appui. Elle entre en
-- base avec le statut EN_ATTENTE et n'a AUCUN effet sur le planning tant
-- qu'un Responsable (Admin/Responsable/Responsable de Shift de son équipe)
-- ne l'a pas validée (VALIDE) ou refusée (REFUSE) — voir
-- AbsenceEngine.activeConges côté application, qui exclut EN_ATTENTE et
-- REFUSE du calcul du planning.
-- L'envoi de l'email de confirmation fera l'objet d'une migration séparée,
-- une fois le mot de passe d'application Gmail configuré côté Supabase
-- (Edge Function secret).
-- ==========================================

-- ---------- drivers : email personnel (notifications) ----------
alter table drivers add column if not exists email text;

-- ---------- conges : workflow d'approbation ----------
alter table conges add column if not exists statut text not null default 'VALIDE';
alter table conges drop constraint if exists conges_statut_check;
alter table conges add constraint conges_statut_check check (statut in ('EN_ATTENTE', 'VALIDE', 'REFUSE'));
alter table conges add column if not exists justificatif_path text;
alter table conges add column if not exists motif_refus text;
alter table conges add column if not exists validated_by uuid references auth.users(id);
alter table conges add column if not exists validated_at timestamptz;

-- ---------- conges : un CONDUCTEUR peut créer SA PROPRE demande, toujours
-- EN_ATTENTE (jamais s'auto-valider). La policy "conges_write" existante
-- (ADMIN/RESPONSABLE/RESPONSABLE_SHIFT de l'équipe) reste inchangée : c'est
-- elle qui couvre la saisie directe (auto-VALIDE) ET la validation/refus
-- (update du statut) d'une demande. Plusieurs policies permissives sur la
-- même commande (INSERT) se combinent en OR — un conducteur n'a donc accès
-- qu'à ce cas précis, rien de plus.
drop policy if exists "conges_insert_self" on conges;
create policy "conges_insert_self" on conges for insert
  with check (
    current_user_active() and current_user_role() = 'CONDUCTEUR'
    and driver_id = current_user_driver() and statut = 'EN_ATTENTE'
  );

-- ---------- Stockage des justificatifs (bucket privé) ----------
insert into storage.buckets (id, name, public)
  values ('justificatifs-conges', 'justificatifs-conges', false)
  on conflict (id) do nothing;

-- Chemin des fichiers : <driver_id>/<horodatage>-<nom>. Un CONDUCTEUR ne
-- peut déposer que dans SON PROPRE dossier ; la lecture suit exactement les
-- mêmes règles que la table conges (Admin/Responsable : tout ; Responsable
-- de Shift : son équipe ; Conducteur : lui-même).
drop policy if exists "conges_justificatifs_insert_own" on storage.objects;
create policy "conges_justificatifs_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'justificatifs-conges' and current_user_active()
    and current_user_role() = 'CONDUCTEUR'
    and (storage.foldername(name))[1] = current_user_driver()
  );

drop policy if exists "conges_justificatifs_select" on storage.objects;
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
-- FIN DE LA MIGRATION
-- Prochaine étape (séparée) : Edge Function d'envoi d'email de confirmation
-- une fois qu'une demande est validée/refusée, une fois le mot de passe
-- d'application Gmail déposé dans Supabase (Project Settings > Edge
-- Functions > Secrets), jamais dans le code ni dans cette conversation.
-- ==========================================
