-- Anti-doublon des alertes automatiques de passation TOS (fonction
-- tos-passation-alert) : une ligne par (fenêtre de rapport | flotte).
create table if not exists tos_passation_alertes (
  cle text primary key,
  created_at timestamptz not null default now()
);
alter table tos_passation_alertes enable row level security;
-- Aucune policy : table lue/écrite uniquement par la fonction Edge (service_role).
