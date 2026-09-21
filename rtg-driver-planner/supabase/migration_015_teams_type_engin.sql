-- ==========================================
-- RTG DRIVER PLANNER — Migration : type d'engin par équipe (RTG / CC)
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Prépare le module "Chariots Cavalier" (CC), qui tourne dans la même
-- application que le module RTG. Les deux flottes partagent exactement le
-- même modèle de données (équipes, conducteurs, congés, maladies, absences,
-- heures exceptionnelles, mouvements...) — seule la logique d'affectation
-- (règles + zones) diffère selon le type d'engin. Ce champ permet donc de
-- distinguer, au niveau équipe, à quelle flotte elle appartient.
--
-- Toutes les équipes existantes (RTG) passent automatiquement à 'RTG' :
-- aucun impact sur les données/l'app actuelles.

alter table teams add column if not exists type_engin text not null default 'RTG'
  check (type_engin in ('RTG', 'CC'));
