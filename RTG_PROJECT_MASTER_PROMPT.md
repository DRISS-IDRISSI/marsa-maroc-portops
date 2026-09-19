# RTG Driver Planner — Master Prompt / Contexte projet

Ce document résume l'état du projet **RTG Driver Planner** (TC3PC — Terminal à
Conteneurs 3 du Port de Casablanca, filiale de Marsa Maroc) pour permettre à
un autre agent IA de reprendre le travail sans repartir de zéro. Colle ce
fichier en début de conversation avec le nouvel agent.

## 1. Le projet

RTG Driver Planner est une application web de planification pour les
conducteurs de portiques RTG (Rubber-Tyred Gantry) du terminal à conteneurs.
Elle gère : plannings mensuels (shifts/vacations/zones), repos automatiques,
congés/maladies/absences/formations, remplacements, heures exceptionnelles,
utilisateurs/rôles, et génère des rapports imprimables (RH, jours fériés).

- Dépôt GitHub : `DRISS-IDRISSI/marsa-maroc-portops`
- Application dans le sous-dossier `rtg-driver-planner/`
- Branche de développement : `claude/new-session-0yhk5k`
- Site déployé : https://driss-idrissi.github.io/marsa-maroc-portops/

## 2. Stack technique

- **React 18 (UMD/CDN) + React Router 6 (HashRouter) + Babel-standalone** :
  PAS de build step. Le JSX est transpilé dans le navigateur. Tous les
  fichiers `src/*.js` sont chargés via des `<script>` classiques dans
  `index.html`, dans un ordre précis (dépendances globales, pas de modules
  ES). Le partage entre fichiers se fait via des objets globaux
  (`window.RestDayEngine`, `window.RTG_CONFIG`, etc.).
- **Supabase** : backend de données (conducteurs, équipes, congés,
  utilisateurs, overrides manuels...). Voir `src/store.js` (accès) et
  `supabase/schema.sql`. Les règles métier STATIQUES (shifts, poids, jours
  fériés) restent en dur dans `src/data.js` (`RTG_CONFIG`) pour rester
  disponibles sans requête réseau.
- **PWA** : `sw.js` (service worker, stratégie network-first avec repli
  cache), `manifest.json`.
- **Cache-busting** : chaque fichier `<script src="...?v=XXXX">` dans
  `index.html` porte un suffixe de version, à incrémenter à CHAQUE déploiement
  (ex. `20260917-41`), en lockstep avec `version.json`. Sans ça, les
  navigateurs déjà ouverts ne voient pas les changements.
- **Déploiement** : GitHub Actions, workflow `.github/workflows/deploy-rtg-pages.yml`,
  publie `rtg-driver-planner/` sur GitHub Pages.
  - **IMPORTANT / piège connu** : l'environnement GitHub Pages
    (`github-pages`) n'autorise les déploiements QUE depuis `main` par
    réglage d'environnement. Un push sur la branche de dev déclenche bien le
    workflow, mais il échoue TOUJOURS instantanément (protection
    d'environnement, pas un vrai bug). Pour déployer réellement : déclencher
    manuellement le workflow (`workflow_dispatch`) sur `main` — le workflow,
    même lancé depuis `main`, checkout ensuite le CONTENU de la branche de
    dev (`claude/new-session-0yhk5k`) grâce à son `ref` codé en dur dans le
    fichier YAML. C'est ce run `workflow_dispatch` sur `main` qui compte.
  - Séquence de déploiement habituelle : commit + push sur la branche de dev
    → déclencher `workflow_dispatch` sur `main` pour `deploy-rtg-pages.yml`
    → attendre ~20s → vérifier `conclusion: success` sur ce run précis.

## 3. Structure du dépôt (dossier `rtg-driver-planner/`)

- `index.html` — shell HTML, liste tous les `<script>` avec leur `?v=`.
- `version.json` — `{"version": "<ISO timestamp>"}`, à bumper à chaque déploiement.
- `sw.js` — service worker (network-first).
- `manifest.json` — manifeste PWA.
- `icons/` — logos (`marsa-maroc-logo.png`, `tc3pc-logo.jpg` — le vrai logo
  officiel TC3PC, remplace une ancienne approximation SVG).
- `src/data.js` — `RTG_CONFIG` : TOUTES les constantes métier (shifts,
  vacations, poids de repos, jours fériés, dates de référence...). Très
  commenté, chaque constante explique le POURQUOI métier.
- `src/store.js` — accès Supabase (lecture/écriture), état global de l'app.
- `src/pages.js`, `src/pages2.js` — pages React (Planning Mensuel,
  Affectation du Jour, rapports imprimables RH/Jours fériés...).
- `src/components.js` — composants partagés (topbar, sidebar, login...).
- `src/engines/*.js` — moteurs métier, PUREMENT fonctionnels (prennent
  `state` en paramètre, ne mutent rien globalement sauf leurs propres
  caches internes) :
  - `dateUtils.js` (RTGDate) — utilitaires date (pas de dépendance à `Date`
    native pour éviter les pièges de timezone).
  - `shiftRotationEngine.js` — quel shift (S1/S2/S3) une équipe a un jour
    donné (rotation hebdomadaire, cycle par défaut `["S1","S3","S2"]`).
  - `vacationRotationEngine.js` — quel label (V1/V2) un BLOC de vacation
    affiche un jour donné (bascule quotidienne, gelée dimanche→lundi).
  - `zoneRotationEngine.js` / `zoneBalancingEngine.js` — rotation/équilibrage
    des zones (A-H).
  - `absenceEngine.js` — congés/maladies/absences/formations (statut figé
    d'un conducteur un jour donné).
  - `holidayEngine.js` — jours fériés marocains + règle "veille de férié
    pour Shift 3" (S3 chômé la veille d'un férié, car son service démarre le
    soir).
  - `restDayEngine.js` — **LE MOTEUR LE PLUS COMPLEXE ET LE PLUS RETRAVAILLÉ**,
    génère les repos mensuels automatiques. Détaillé en section 4.
  - `exceptionEngine.js` — heures exceptionnelles (doublage, férié travaillé,
    dimanche 3ème shift...).
  - `planningEngine.js` — orchestrateur, combine tous les moteurs pour donner
    le statut journalier d'un conducteur (PRESENT/REPOS/CONGE/absence/...).
  - `replacementEngine.js` — suggestions de remplacement.
  - `validationEngine.js` — détection d'anomalies sur le planning (bandeau
    "Planning valide — aucune anomalie détectée" vu dans l'UI).

## 4. `restDayEngine.js` — algorithme des repos mensuels (le cœur du projet)

### Règle générale
Génère `config.reposMensuel` (6) jours de REPOS par conducteur et par mois,
parmi les jours qui ne sont ni congé/maladie/absence, ni un dimanche de
Shift 3 (OFF automatique), ni un jour férié. Calculé ÉQUIPE PAR ÉQUIPE (pas
conducteur isolé) pour imposer des plafonds partagés.

### Concept clé : deux blocs de vacation INDÉPENDANTS
Chaque équipe a deux blocs fixes, `driver.initialVacation` = "V1" ou "V2"
(fixe, ne change JAMAIS — confirmé par un modèle Excel de référence fourni
par l'exploitant où les deux blocs sont des copies exactes l'un de l'autre,
jour pour jour). Les repos de V1 et V2 sont calculés de façon **totalement
indépendante** (compteurs d'occupation, plafonds, pointeurs de rotation —
rien n'est jamais partagé entre les deux blocs). Confirmé explicitement par
l'exploitant : "CHAQUE VAC EST INDEPENDENTE".

### Escalier continu (Phase B) — exigence n°1 de l'exploitant
Instruction ferme, répétée plusieurs fois : les repos d'un jour J sont
donnés à des conducteurs CONSÉCUTIFS dans l'ordre d'affichage de l'équipe
(`ordreAffichage`, PAS l'ordre matricule Supabase — bug corrigé cette
session). Une fois le quota du jour J épuisé, le jour J+1 reprend juste
APRÈS le dernier conducteur servi le jour J. Un seul pointeur PAR BLOC, qui
ne se réinitialise JAMAIS entre jours ni entre occurrences de shift (sauf
changement de mois, voir plus bas).

### Architecture interne (dans `getTeamRestDays`)
1. **Phase A** : pour chaque conducteur, calcule `remainingQuota` (quota
   mensuel moins congés/jours fixes), puis répartit ce quota entre les
   OCCURRENCES de shift du mois (`shiftRuns` — jours consécutifs sous le même
   shift ; `distributeByWeight`, pondéré par `restDayWeightByShift`).
2. **Phase B** : pour chaque bloc (V1/V2), pour chaque occurrence, calcule
   `totalDemand` (somme des besoins des conducteurs pour cette occurrence),
   répartit ce total sur les jours de l'occurrence (`splitDemandAcrossDays`,
   pondéré par jour de semaine + biais V1/V2 du label affiché ce jour-là),
   puis remplit chaque jour via la rotation continue (pointeur unique par
   bloc). **Éligibilité basée sur `remainingQuota` global du conducteur**,
   PAS sur son besoin propre à cette occurrence précise (bug corrigé : sinon
   un arrondi individuel pouvait "sauter" un conducteur dans l'ordre alors
   qu'il suit directement le précédent). Rattrapage local si une journée ne
   trouve pas assez de candidats éligibles (adjacence).
3. **Phase C** (repli rare) : besoin résiduel replacé sur tout le mois,
   trois niveaux de relaxation (adjacence+plafond → plafond seul → aucun).

### Règles de non-adjacence
Jamais 2 repos consécutifs pour un même conducteur. **La non-adjacence saute
par-dessus un jour OFF automatique** (dimanche Shift 3) pour comparer avec
le vrai jour d'avant/après — sinon repos-OFF-repos (3 jours d'affilée sans
travail) passait inaperçu (bug corrigé, cas HAITOU/GR BAKKALI).

### Poids et pondérations (tous dans `RTG_CONFIG`)
- `restDayWeightByShift` : {S1:1, S2:0.75, S3:1} — Shift 2 plus sollicité
  (40% de charge) reçoit moins de repos.
- `restDayLabelBiasByShift` : {S1:{V1:13,V2:17}, S2:{V1:20,V2:20},
  S3:{V1:18,V2:12}} — biais V1/V2 à l'intérieur d'un shift, selon le label
  qu'affiche le bloc ce jour-là (charge plus faible → plus de repos ce jour).
- `restDayWeightByDow` : [1,1,1,1,1,2,4] (Lundi=index0...Dimanche=index6) —
  samedi/dimanche à charge plus faible, poids plus élevé.
- `restDayWeightSaturdayShift2` : 4 — samedi encore plus faible si l'équipe
  est sur Shift 2 cette semaine-là.

**Méthode de répartition = plus grand reste PUR** (pas de plancher uniforme
préalable) : chaque jour/occurrence reçoit directement
`floor(total × son poids / poids total)`, le reliquat départagé par plus
grand reste. Historique : un plancher uniforme (`floor(total/nb jours)`
attribué à tous avant tout poids) écrasait la différence de poids — corrigé
pour `splitDemandAcrossDays` (jours au sein d'une occurrence) ET testé pour
`distributeByWeight` (occurrences elles-mêmes), mais **cette dernière
correction a été explicitement ANNULÉE** ("résultat insatisfaisant") — donc
`distributeByWeight` garde SON plancher uniforme, contrairement à
`splitDemandAcrossDays`. Ne pas re-fusionner les deux sans revalider avec
l'exploitant.

### Planchers/plafonds "au mieux" (jamais imposés)
Trois mécanismes de plancher minimum garanti + plafond assoupli, tous
**best-effort** (jamais forcés au-delà du quota réel disponible) :
1. **Samedi** : `restDayMinSaturday` (4), tout shift confondu.
2. **Dimanche** (S1/S2 uniquement, S3 déjà OFF) : `restDayMinSunday` (5).
   Historique : il existait un ANCIEN mécanisme `getMandatorySundayOff`
   (repos dominical FORCÉ à un nombre exact via `sundayVacationCap`) —
   **retiré entièrement** sur demande explicite de l'exploitant ("le
   dimanche ne doit plus avoir un nombre FIXE"). `sundayVacationCap` (6)
   sert encore, mais seulement pour calculer un plafond journalier assoupli.
3. **Shift 3** (tout jour de la semaine) : `restDayShift3Present` —
   `{V1:{min:8,max:9}, V2:{min:5,max:7}}` (présents, pas repos — converti en
   interne). Le plus récent ajout, résultat mitigé constaté sur test
   synthétique (contrainte mathématique : quota mensuel total insuffisant
   pour tenir ce plancher SUR CHAQUE jour d'une occurrence de 6-7 jours) —
   **à valider par l'exploitant sur données réelles**.

Implémentation : `capForGroup(group, day)` calcule le plafond du jour
(base ~30% du bloc, ou relâché pour samedi/dimanche/Shift3 selon les
plancher/plafonds ci-dessus, combinables). `minRestForDay(group, day)`
calcule le plancher à réserver PROACTIVEMENT dans `splitDemandAcrossDays`
AVANT la répartition pondérée du reliquat. **Si la somme des planchers d'une
occurrence dépasse le total disponible**, ils sont eux-mêmes répartis par
plus grand reste proportionnel (jamais un jour totalement à zéro pendant
qu'un autre est pleinement servi — bug corrigé en ajoutant le plancher
Shift 3, qui s'applique à TOUS les jours d'une occurrence contrairement à
samedi/dimanche qui ne touchent qu'un seul jour).

### Chaînage inter-mois (`_pointerCache`, `historyEnabled`)
Deux pointeurs de rotation persistent d'un mois sur l'autre (sinon chaque
mois "figeait" les mêmes conducteurs en tête) :
- Pointeur de l'escalier continu Phase B (par bloc).
- Pointeur de la fenêtre glissante samedi/dimanche (si applicable — voir
  historique ci-dessous, actuellement pas de mécanisme dominical forcé).

`config.reposReferenceDate` ("2026-10-01") — **distinct** de
`config.rotationReferenceDate` ("2026-08-01", dédié zone/vacation, ne JAMAIS
toucher) — définit le mois de DÉPART des repos : aucun mois avant cette
date n'est jamais regardé en arrière (adjacence avec le dernier jour du
mois précédent, chaînage des pointeurs). Demande explicite de
l'exploitant : "considérer le mois 10 le mois de départ, oublie le mois 9".
Novembre 2026+ continue normalement de dépendre du mois précédent une fois
celui-ci réellement calculé (pas de dépendance circulaire).

## 5. Historique des bugs corrigés cette session (chronologique, condensé)

1. V1/V2 partageaient un plafond quotidien commun → séparés (`dayUsage =
   {V1:{},V2:{}}`).
2. `teamDrivers` triés par ordre matricule Supabase au lieu de
   `ordreAffichage` (celui affiché à l'écran) → tri harmonisé avec
   `pages.js`.
3. Deux anciennes passes de "rééquilibrage automatique V1/V2" (échange +
   bonus quotidien) cassaient l'ordre sur Shift 1/3 sans toucher Shift 2 →
   **supprimées entièrement** sur demande explicite ("Oui, désactiver
   l'automatique").
4. Repos "séparés" au lieu de groupés par occurrence de shift → réintroduit
   le découpage par occurrence (`shiftRuns`) + pointeur JAMAIS réinitialisé
   entre occurrences.
5. Lumpy (1,4,1) au lieu d'escalier régulier (1,2,3) → rattrapage local
   choisit le jour éligible le MOINS chargé, pas le premier trouvé.
6. Contrainte héritée de septembre bloquait par adjacence le 1er octobre →
   `reposReferenceDate` (voir section 4).
7. Rotation dominicale/samedi "figée" sur les mêmes conducteurs mois après
   mois ET semaine après semaine → cause racine = pointeur unique partagé
   entre les deux blocs dans `getMandatorySundayOff`, avançant du nombre
   CHOISI (résonance exacte avec la taille du bloc) → pointeur par bloc,
   n'avançant que d'UN cran par passage (fenêtre glissante). **Puis ce
   mécanisme entier a été retiré** (voir point 9).
8. Trou visuel dans l'escalier (RBIAA sauté au profit de MIRE) → éligibilité
   basée sur `remainingQuota` global au lieu du besoin par occurrence
   (arrondi individuel).
9. Règle des "6 repos figés le dimanche" jugée trop rigide → mécanisme
   `getMandatorySundayOff` retiré ENTIÈREMENT ; le dimanche redevient un
   jour candidat normal avec juste un plafond assoupli.
10. Dimanche ne se démarquait plus assez des jours ouvrés (plancher uniforme
    écrasait le poids) → `splitDemandAcrossDays` réécrit en plus-grand-reste
    pur.
11. Adjacence ne sautait pas par-dessus un dimanche OFF automatique (Shift
    3) → repos-OFF-repos possible → corrigé (`blockedByAdjacency`).
12. Ajout planchers minimum garantis samedi (4) / dimanche (5).
13. Shift 2 gardait presque autant de repos que Shift 3 malgré poids
    différents (même cause que #10, mais sur `distributeByWeight` cette
    fois) → corrigé en plus-grand-reste pur... **puis ANNULÉ** ("résultat
    insatisfaisant") → `distributeByWeight` a RETROUVÉ son plancher uniforme
    d'origine. `splitDemandAcrossDays`, lui, reste en plus-grand-reste pur.
14. Logo TC3PC — l'ancien SVG était une approximation à la main → remplacé
    par le vrai logo officiel fourni par l'exploitant (JPG).
15. Fourchette de présents ciblée Shift 3 (V1 8-9, V2 5-7) ajoutée — résultat
    partiellement atteint seulement (contrainte de quota mensuel), à valider
    sur données réelles.

## 6. Conventions et contraintes à respecter absolument

- **Aucun accès direct à Supabase.** Toute correction de données (pas de
  code) doit être faite par l'exploitant lui-même via l'UI de l'app (ex.
  "Importer Excel" → "Remise à zéro complète du planning"). Ne JAMAIS
  écrire de données hors de l'UI de l'app.
- **Quota mensuel reste fixe à 6**, avec 7 possible seulement via des
  mécanismes légitimes déjà en place (jamais de règle automatique de bonus
  6-vs-7 — explicitement refusée par l'exploitant : "RIEN A CHANGER DANS LE
  CODE" sur ce sujet précis). Ajustement manuel toujours possible dans l'UI.
- **Toujours bumper `?v=` dans `index.html` ET `version.json`** à chaque
  déploiement (cache-busting).
- **Toujours tester avant de déployer.** Un harnais de test Node.js existe
  dans `/tmp/resttest/` (jetable, hors dépôt) : copies de tous les fichiers
  `src/engines/*.js` + `data.js`, chargés via `new Function(...)`, avec une
  équipe synthétique de 24 conducteurs (12 V1 + 12 V2, noms repris des
  captures d'écran réelles GR AZZAM/GR BAKKALI pour rester traçable).
  Scripts clés à recréer si besoin : vérif adjacence/férié/quota sur
  plusieurs mois, vérif plafond réel par bloc (pas le plafond global naïf
  du vieux `verify.js`, qui donne des faux positifs depuis qu'on a des
  plafonds assouplis samedi/dimanche/Shift3), vérif motif repos-OFF-repos.
- **Séquence de déploiement** : voir section 2 (push sur la branche de dev
  → `workflow_dispatch` sur `main` → attendre → vérifier `success`). Un
  échec du run déclenché par le PUSH lui-même (pas le dispatch) sur la
  branche de dev est NORMAL et déjà documenté sur la PR #1 — ne pas
  ré-investiguer, ne pas re-commenter.
- **PR #1** (`DRISS-IDRISSI/marsa-maroc-portops#1`) est suivie
  (`subscribe_pr_activity`) — les échecs `deploy` sur les commits de la
  branche de dev y sont déjà expliqués dans un commentaire existant.
- **Commentaires très détaillés dans le code** : le style du projet est
  d'expliquer le POURQUOI métier de chaque règle/constante dans un
  commentaire au-dessus, souvent en citant la demande de l'exploitant
  verbatim. Continuer ce style.
- **Toujours valider les changements de règle avec l'exploitant** avant de
  les considérer "faits" — ce projet avance par itérations très fines,
  souvent avec des allers-retours (une correction peut être explicitement
  annulée si le résultat ne convient pas à l'usage réel, cf. point 13
  ci-dessus).

## 7. Personnes / équipes de test connues (utile pour reproduire un cas)

- **GR AZZAM**, **GR BAKKALI** — noms d'équipes réels vus dans les captures
  d'écran de l'exploitant. GR BAKKALI V1 (12 conducteurs, ordre d'affichage) :
  AFIR, EL HOUR, SAOUI, TAGHIA, KHACHI, KARABILA, CHARRAKI, BOULHEND,
  ABOUSSOUGHRA, BENHICHAM, AIMARAH, HAITOU.
- GR AZZAM V1 (12 conducteurs) : AZIB, OUDRAOUA, MAAQUOUL, CHARIH, AYAR,
  BIDDA, MOUSSADAK, AKIK, RBIAA, HAKIM, MIRE, AZGAR — utilisés aussi dans le
  harnais de test synthétique.
- Mois de référence des tests/discussions : **octobre 2026** (mois de
  départ des repos, `reposReferenceDate`).
