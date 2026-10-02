// ==========================================
// RTG DRIVER PLANNER — Assistant intelligent (§36)
// Détection automatique d'anomalies + aide à la correction du planning,
// 100% local (règles/calculs sur les données déjà en mémoire, sans appel
// à une IA externe — choix explicite de l'exploitant).
// ==========================================

// Seuils simples, non configurables pour l'instant (v1) : au-delà, une
// alerte est levée. Ajustables ici si l'exploitant les trouve trop stricts
// ou trop laxistes une fois en usage réel.
const ASSISTANT_SEUIL_HEURES_EXCEPTIONNELLES = 20; // heures/mois par conducteur
const ASSISTANT_SEUIL_JOURS_CONSECUTIFS = 12; // jours de travail d'affilée sans repos/absence

const AssistantEngine = {
  // `teamId` = "all" ou l'id d'une équipe précise (Responsable de Shift : sa
  // propre équipe uniquement, comme les autres pages de l'appli — §30).
  analyzeMonth(month, year, state, teamId) {
    const planning = PlanningEngine.generateMonthlyPlanning(month, year, state);
    const insights = [];
    let seq = 0;
    const push = (i) => { insights.push(Object.assign({ id: "ai-" + (seq++) }, i)); };

    const drivers = state.drivers.filter(d => d.actif !== false && (teamId === "all" || d.teamId === teamId));
    const driverIds = {};
    drivers.forEach(d => { driverIds[d.id] = true; });
    const driverTeamId = {};
    state.drivers.forEach(d => { driverTeamId[d.id] = d.teamId; });

    // 1. Anomalies structurelles (déjà calculées par ValidationEngine —
    // shift/vacation/zone manquants, affectation pendant une absence, quota
    // de repos non respecté...).
    planning.validation.anomalies
      .filter(a => !a.driverId || driverIds[a.driverId])
      .forEach(a => {
        push({
          severity: "critical", category: "structure",
          title: a.type,
          detail: (a.matricule ? a.matricule + " — " + a.nom + " " + a.prenom + " : " : "") + "attendu " + a.attendu + ", trouvé " + a.trouve,
          date: a.date !== "—" ? a.date : null,
          driverId: a.driverId || null,
          suggestion: "Corriger l'affectation sur Affectation du jour ou Planning mensuel."
        });
      });

    // 2. Déséquilibre V1/V2 (Shift 1 et Shift 3 — les deux vacations
    // doivent être égales, ou à défaut ne différer que d'UN seul
    // conducteur, cf. RestDayEngine). Un écart supérieur à 1 signale un
    // déséquilibre que l'algorithme n'a pas pu absorber automatiquement
    // (souvent après des affectations manuelles ou des absences imprévues).
    planning.days.forEach(day => {
      ["S1", "S3"].forEach(shiftId => {
        const vacs = (state.config.vacations[shiftId] || []).map(v => v.id);
        if (vacs.length !== 2) return;
        const counts = {};
        vacs.forEach(v => { counts[v] = 0; });
        day.assignments.forEach(a => {
          if (a.status === "PRESENT" && a.shift === shiftId && driverIds[a.driverId] && counts[a.vacation] != null) counts[a.vacation]++;
        });
        const diff = Math.abs(counts[vacs[0]] - counts[vacs[1]]);
        if (diff > 1) {
          const surnombre = counts[vacs[0]] > counts[vacs[1]] ? vacs[0] : vacs[1];
          push({
            severity: "warning", category: "equilibre",
            title: "Déséquilibre V1/V2 — " + shiftId,
            detail: RTGDate.formatFr(RTGDate.parseISO(day.iso)) + " : " + vacs[0] + " = " + counts[vacs[0]] + ", " + vacs[1] + " = " + counts[vacs[1]] + " (écart " + diff + ")",
            date: day.iso,
            teamId: null,
            suggestion: "Donner priorité de repos à un conducteur de " + surnombre + " dans les prochains jours pour rééquilibrer."
          });
        }
      });
    });

    // 3. Sous-effectif : jour où une équipe se retrouve avec moins de la
    // moitié de son effectif actif présent (hors dimanche OFF / jour férié,
    // où 0 présent est normal — present > 0 exclut ces cas).
    state.teams.forEach(team => {
      if (teamId !== "all" && team.id !== teamId) return;
      const headcount = state.drivers.filter(d => d.actif !== false && d.teamId === team.id).length;
      if (headcount < 4) return; // équipe trop petite pour qu'un seuil ait un sens
      planning.days.forEach(day => {
        const present = day.assignments.filter(a => a.status === "PRESENT" && driverTeamId[a.driverId] === team.id).length;
        if (present > 0 && present < headcount * 0.5) {
          push({
            severity: "critical", category: "effectif",
            title: "Sous-effectif — " + team.nom,
            detail: RTGDate.formatFr(RTGDate.parseISO(day.iso)) + " : seulement " + present + " présent(s) sur " + headcount + " conducteurs.",
            date: day.iso,
            teamId: team.id,
            suggestion: "Vérifier les remplacements disponibles pour ce jour (page Remplacement)."
          });
        }
      });
    });

    // 4. Heures exceptionnelles élevées sur le mois.
    const firstIso = planning.days[0].iso, lastIso = planning.days[planning.days.length - 1].iso;
    drivers.forEach(driver => {
      const total = (state.heuresExceptionnelles || [])
        .filter(r => r.driverId === driver.id && r.dateDebut >= firstIso && r.dateDebut <= lastIso)
        .reduce((sum, r) => sum + (Number(r.heures) || 0), 0);
      if (total > ASSISTANT_SEUIL_HEURES_EXCEPTIONNELLES) {
        push({
          severity: total > ASSISTANT_SEUIL_HEURES_EXCEPTIONNELLES * 1.5 ? "critical" : "warning",
          category: "heures",
          title: "Heures exceptionnelles élevées",
          detail: driver.matricule + " — " + driver.nom + " " + driver.prenom + " : " + total + "h ce mois-ci (seuil " + ASSISTANT_SEUIL_HEURES_EXCEPTIONNELLES + "h).",
          date: null, driverId: driver.id, teamId: driver.teamId,
          suggestion: "Vérifier la charge de travail de ce conducteur, envisager de réduire les doublages/heures exceptionnelles."
        });
      }
    });

    // 5. Conducteurs enchaînant trop de jours de travail sans repos/absence
    // dans le mois — signal de fatigue à traiter avant que ça ne devienne
    // un problème (aide à la CORRECTION, pas juste un constat a posteriori).
    drivers.forEach(driver => {
      let streak = 0, maxStreak = 0, maxStreakEndIso = null;
      planning.days.forEach(day => {
        const a = day.assignments.find(x => x.driverId === driver.id);
        if (a && a.status === "PRESENT") {
          streak++;
          if (streak > maxStreak) { maxStreak = streak; maxStreakEndIso = day.iso; }
        } else {
          streak = 0;
        }
      });
      if (maxStreak > ASSISTANT_SEUIL_JOURS_CONSECUTIFS) {
        push({
          severity: "warning", category: "repos",
          title: "Trop de jours consécutifs sans repos",
          detail: driver.matricule + " — " + driver.nom + " " + driver.prenom + " : " + maxStreak + " jours de travail d'affilée (jusqu'au " + RTGDate.formatFr(RTGDate.parseISO(maxStreakEndIso)) + ").",
          date: maxStreakEndIso, driverId: driver.id, teamId: driver.teamId,
          suggestion: "Prévoir un repos pour ce conducteur dans les tout prochains jours."
        });
      }
    });

    const order = { critical: 0, warning: 1, info: 2 };
    insights.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.date || "").localeCompare(b.date || ""));
    return insights;
  }
};
