// ==========================================
// RTG DRIVER PLANNER — Correctif de répartition des zones (§7-8 + mode d'affectation)
// La zone A n'est pas prioritaire : sur un même créneau (shift + vacation) un jour
// donné, si plus de 8 conducteurs sont présents, un seul reste en zone A et le
// surplus double les autres zones (B-H), réparti vers celles qui en ont le moins.
//
// Correctif ponctuel appliqué UNIQUEMENT en cas de dépassement (>8 présents sur le
// créneau) — la rotation individuelle A→H de chaque conducteur (ZoneRotationEngine,
// basée sur ses propres jours travaillés) reste la règle de base et n'est pas
// touchée quand un créneau compte 8 présents ou moins.
// ==========================================

const ZoneBalancingEngine = {
  // `entries` : tableau d'objets portant une propriété `zone` mutable, pour tous les
  // conducteurs présents d'un même (shift, vacation) un jour donné.
  rebalance(entries, zoneList) {
    if (!zoneList || zoneList.length === 0 || entries.length <= 8) return;

    const zoneA = zoneList[0];
    const others = zoneList.slice(1);
    if (others.length === 0) return;

    const inA = entries.filter(e => e.zone === zoneA);
    if (inA.length <= 1) return;

    const counts = {};
    others.forEach(z => { counts[z] = entries.filter(e => e.zone === z).length; });

    // Garde le premier conducteur en zone A, redistribue le reste vers la zone B-H
    // la moins chargée à chaque étape (répartition équilibrée du doublage).
    inA.slice(1).forEach(e => {
      let target = others[0];
      others.forEach(z => { if (counts[z] < counts[target]) target = z; });
      e.zone = target;
      counts[target]++;
    });
  }
};
