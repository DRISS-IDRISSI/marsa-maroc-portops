-- ==========================================
-- Migration 030 — Correctif migration_029 : fixer aussi le SHIFT
-- ==========================================
-- À exécuter dans Supabase Dashboard > SQL Editor, en une fois.
--
-- Cause du bug (conducteurs invisibles sur Affectation du jour malgré un
-- statut PRESENT correctement enregistré) : planningEngine.js ne calcule
-- le shift automatique d'un titulaire QUE si son statut NATUREL (avant
-- toute correction manuelle) était déjà PRESENT ce jour-là. Pour plusieurs
-- conducteurs, le repos automatique (calcul mensuel) tombait justement le
-- 28/09 — la migration_029 forçait bien leur statut à PRESENT, mais sans
-- shift explicite ils ne correspondaient plus à aucun onglet Shift 1/2/3
-- et disparaissaient de l'affichage. On fixe ici le shift explicitement
-- pour les 3 équipes (comme déjà fait pour les CDI dans la migration_029).

update manual_overrides set shift = 'S1', updated_at = now()
where date = '2026-09-28' and driver_id in (
  select id from drivers where matricule in ('TCI040','TC0075','TCI033','TC0085','TC0082','TC0090','TC0027','TC0087','TC0072')
);

update manual_overrides set shift = 'S3', updated_at = now()
where date = '2026-09-28' and driver_id in (
  select id from drivers where matricule in ('C07847','TC0084','TCI032','TCI026','C07846','C07220','TCI028','C07789','TCI035')
);

update manual_overrides set shift = 'S2', updated_at = now()
where date = '2026-09-28' and driver_id in (
  select id from drivers where matricule in ('C07845','TCI037','TC0783','C07402','TCI022','TCI031','TC0803','TC0081')
);

-- Vérification.
select mo.date, t.nom as equipe, d.matricule, d.nom, d.prenom, mo.shift, mo.status, mo.zone
from manual_overrides mo
join drivers d on d.id = mo.driver_id
left join teams t on t.id = d.team_id
where mo.date = '2026-09-28' and mo.motif = 'Affectation réelle du 28/09/2026 (référence rotation CER)'
order by t.nom, d.nom;
