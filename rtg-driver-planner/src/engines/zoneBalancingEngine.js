// ==========================================
// RTG DRIVER PLANNER — Répartition équitable des zones par créneau (§7-8 + charge)
// La zone A n'est pas prioritaire :
//   - Si moins de 8 conducteurs sont présents sur un créneau (shift + vacation) un
//     jour donné, la zone A reste VIDE et les présents sont répartis équitablement
//     (un seul par zone, sans doublon) sur les 7 autres zones (B-H).
//   - Si 8 conducteurs présents ou plus, les 8 zones (A comprise) sont toutes
//     occupées : chacune reçoit d'abord floor(n/8) conducteurs, puis le reste
//     (toujours < 8, donc absorbé par les 7 zones B-H) est distribué en +1 sur les
//     zones B-H uniquement — la zone A ne reçoit jamais cette part supplémentaire
//     avant les autres.
//
// S'applique systématiquement à chaque créneau (pas seulement en cas de
// dépassement), en remplacement de la simple rotation individuelle A→H pour la
// zone FINALEMENT affichée. La rotation individuelle (ZoneRotationEngine, basée
// sur les jours effectivement travaillés par chaque conducteur) sert uniquement de
// clé de tri pour décider qui, dans le groupe, reçoit quelle zone — afin de garder
// une variation raisonnable d'un jour à l'autre plutôt qu'un ordre figé.
// ==========================================

const ZoneBalancingEngine = {
  // `entries` : tableau d'objets portant une propriété `zone` mutable (déjà remplie
  // avec la zone "naturelle" issue de la rotation individuelle), pour tous les
  // conducteurs présents d'un même (shift, vacation) un jour donné.
  assignZonesForSlot(entries, zoneList) {
    if (!zoneList || zoneList.length === 0 || entries.length === 0) return;

    const n = entries.length;
    const zoneA = zoneList[0];
    const others = zoneList.slice(1); // B..H

    // Ordre d'affectation au sein du groupe : par zone naturelle (rotation
    // individuelle) puis par identifiant pour un résultat déterministe, afin que la
    // répartition varie raisonnablement d'un jour à l'autre sans figer un ordre fixe.
    const ordered = entries.slice().sort((a, b) => {
      const za = zoneList.indexOf(a.zone);
      const zb = zoneList.indexOf(b.zone);
      if (za !== zb) return za - zb;
      return String(a.driverId).localeCompare(String(b.driverId));
    });

    if (n < 8) {
      if (others.length === 0) return;
      ordered.forEach((e, i) => { e.zone = others[i % others.length]; });
      return;
    }

    const base = Math.floor(n / zoneList.length);
    const remainder = n % zoneList.length; // toujours < 8, donc < others.length+1

    let idx = 0;
    for (let r = 0; r < base && idx < n; r++) {
      for (let z = 0; z < zoneList.length && idx < n; z++) {
        ordered[idx].zone = zoneList[z];
        idx++;
      }
    }
    for (let r = 0; r < remainder && idx < n; r++) {
      ordered[idx].zone = others[r % others.length];
      idx++;
    }
  }
};
