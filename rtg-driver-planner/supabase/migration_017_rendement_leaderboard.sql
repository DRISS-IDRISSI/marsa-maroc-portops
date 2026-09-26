-- ==========================================
-- RTG DRIVER PLANNER — Migration : classement "Challenge Rendement"
-- ==========================================
-- À exécuter dans Supabase : Project > SQL Editor > New query.
--
-- Le classement (Top 10 par flotte, mois en cours, global ou par équipe) doit
-- être identique pour TOUT LE MONDE — y compris un compte CONDUCTEUR, qui ne
-- voit normalement (RLS) que les mouvements de SA PROPRE équipe
-- (mouvements_tos_select / mouvements_manuels_select, migrations 008/011).
-- Un calcul client-side (fetchMouvementsTos) donnerait donc un classement
-- différent — et faux — selon qui regarde. Cette fonction SECURITY DEFINER
-- contourne RLS pour calculer l'agrégat sur TOUS les conducteurs de la
-- flotte, mais ne renvoie QUE le résultat agrégé (matricule/nom/prénom/
-- équipe/total) — jamais les mouvements bruts d'un autre conducteur.
--
-- p_team_id NULL = classement global (toutes équipes de la flotte
-- confondues) ; un id d'équipe = classement restreint à cette équipe
-- uniquement ("shift" au sens terrain = équipe, ex. "GR HADDAZI", pas S1/S2/S3).

-- Postgres refuse de renommer un paramètre via CREATE OR REPLACE (même
-- signature de types) — nécessaire seulement si une version antérieure de
-- cette fonction (avec "p_shift" au lieu de "p_team_id") a déjà été exécutée ;
-- sans effet sinon.
drop function if exists rendement_leaderboard(text, date, date, text);

create or replace function rendement_leaderboard(p_fleet text, p_date_from date, p_date_to date, p_team_id text default null)
returns table(driver_id text, matricule text, nom text, prenom text, team_nom text, total bigint)
language sql stable security definer set search_path = public as $$
  with mvmt as (
    select m.driver_id, m.total_mvmt as total
    from mouvements_tos m
    where m.driver_id is not null
      and m.date_travail >= p_date_from and m.date_travail <= p_date_to
    union all
    select m.driver_id,
           (coalesce(m.nombre_in,0) + coalesce(m.nombre_out,0) + coalesce(m.nombre_move,0)
            + coalesce(m.nombre_shifting,0) + coalesce(m.nombre_disch,0) + coalesce(m.nombre_load,0)
            + coalesce(m.nombre_autre,0)) as total
    from mouvements_manuels m
    where m.date_travail >= p_date_from and m.date_travail <= p_date_to
  )
  select d.id, d.matricule, d.nom, d.prenom, t.nom, sum(mvmt.total)::bigint as total
  from mvmt
  join drivers d on d.id = mvmt.driver_id
  join teams t on t.id = d.team_id
  where current_user_active()
    and coalesce(d.actif, true) = true
    and coalesce(t.type_engin, 'RTG') = p_fleet
    and (p_team_id is null or d.team_id = p_team_id)
  group by d.id, d.matricule, d.nom, d.prenom, t.nom
  order by total desc
  limit 10;
$$;

grant execute on function rendement_leaderboard(text, date, date, text) to authenticated;

-- Vérification (classement CC global, mois en cours).
select * from rendement_leaderboard('CC', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date, null);

-- ==========================================
-- FIN DE LA MIGRATION
-- ==========================================
