-- ==========================================
-- Cadence horaire des RTG — rapport TOS "Quay Crane and RTG Moves per hour"
-- (pièce jointe REP_RTG_MOVES_HOURLY_*.xls, envoyée chaque heure).
-- Une ligne par (fin de fenêtre glissante de 60 min, RTG).
-- Alimentée par la fonction Edge import-tos-moves (service_role).
-- ==========================================
create table if not exists cadence_rtg_horaire (
  id bigint generated always as identity primary key,
  window_start timestamp not null,
  window_end timestamp not null,
  rtg text not null,
  moves integer not null default 0,
  statut text,                       -- OK / LOW - ALERT / CHECK ASSIGN.
  min_moves integer not null default 15,
  total_events integer,
  vessel_events integer,
  yard_events integer,
  gate_events integer,
  generated_at timestamp,
  source_message_id text,
  created_at timestamptz not null default now(),
  unique (window_end, rtg)
);
create index if not exists cadence_rtg_horaire_window_idx on cadence_rtg_horaire (window_end);

alter table cadence_rtg_horaire enable row level security;
drop policy if exists "cadence_rtg_select" on cadence_rtg_horaire;
create policy "cadence_rtg_select" on cadence_rtg_horaire for select
  using (
    current_user_active() and
    current_user_role() in ('ADMIN', 'RESPONSABLE', 'RESPONSABLE_SHIFT', 'CHEF_ESCALE')
  );
-- Écriture : uniquement la fonction Edge (service_role contourne RLS).

select count(*) as cadence_rtg_ok from cadence_rtg_horaire;
