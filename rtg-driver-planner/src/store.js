// ==========================================
// RTG DRIVER PLANNER — Store (Supabase : PostgreSQL + Auth + RLS)
// Remplace l'ancienne persistance localStorage : les données et
// l'authentification vivent maintenant dans Supabase (voir supabase/schema.sql
// pour les tables et les politiques RLS). L'API exposée par RTGStore
// (get/set/subscribe/addDriver/addConge/login...) reste identique à avant
// pour ne rien changer aux moteurs métier ni aux pages qui la consomment —
// seule l'intérieur de ce fichier change.
//
// Principe : au chargement (ou après connexion), on récupère toutes les
// tables Supabase UNE FOIS dans un objet `state` en mémoire, identique dans
// sa forme à l'ancien objet localStorage. Les pages continuent de lire cet
// objet de façon synchrone (RTGStore.get()) comme avant. Chaque action
// (ajouter un congé, modifier un conducteur...) écrit dans Supabase PUIS met
// à jour cette copie en mémoire et notifie les abonnés — d'où un léger délai
// réseau (normal, contrairement à l'ancien localStorage instantané) avant de
// voir le résultat, RLS oblige la vraie source de vérité à être la base.
// ==========================================

const RTG_AUTH_EMAIL_DOMAIN = "@rtg-planner.local";

// Marqueurs communs à l'import Excel du planning réel (pages.js) et à sa
// réinitialisation (RTGStore.resetImportedRestData ci-dessous), pour que les
// deux restent forcément synchronisés sur le même texte exact.
const RTG_IMPORT_OVERRIDE_MOTIF = "Import planning réel (Excel)";
const RTG_IMPORT_CONGE_COMMENT = "Import Excel — planning réel";
const RTG_IMPORT_MALADIE_COMMENT = "Import Excel — planning réel";

// Flotte actuellement affichée (RTG ou CC — chariots cavalier), un module
// distinct dans la même appli : mêmes tables/pages, seules les règles et
// zones d'affectation diffèrent. Préférence purement locale à l'appareil
// (pas de colonne Supabase), donc gardée en localStorage.
const RTG_FLEET_STORAGE_KEY = "rtg_current_fleet";
function readStoredFleet() {
  try {
    const v = window.localStorage.getItem(RTG_FLEET_STORAGE_KEY);
    return v === "CC" ? "CC" : "RTG";
  } catch (e) { return "RTG"; }
}

function rtgEmptyState() {
  return {
    dataVersion: 11,
    drivers: [], teams: [], config: RTG_CONFIG,
    conges: [], maladies: [], absences: [],
    heuresExceptionnelles: [], feriesMouvements: [],
    users: [], currentUserId: null,
    manualOverrides: {}, auditLog: [],
    currentFleet: readStoredFleet(),
    // `loading` : chargement des données en cours (au démarrage ou après
    // connexion) ; `authChecked` : la vérification de session initiale est
    // terminée (permet à AuthGate de ne pas afficher l'écran de connexion
    // avant même d'avoir su si une session existait déjà).
    loading: true, authChecked: false
  };
}

const RTGStore = (function () {
  let state = rtgEmptyState();
  let listeners = [];

  function get() { return state; }

  function set(updater) {
    state = typeof updater === "function" ? updater(state) : updater;
    listeners.slice().forEach(fn => fn(state));
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function unsubscribe() {
      listeners = listeners.filter(f => f !== fn);
    };
  }

  function getCurrentUser() {
    return state.users.find(u => u.id === state.currentUserId) || null;
  }

  function setCurrentFleet(fleet) {
    const value = fleet === "CC" ? "CC" : "RTG";
    try { window.localStorage.setItem(RTG_FLEET_STORAGE_KEY, value); } catch (e) {}
    set(s => Object.assign({}, s, { currentFleet: value }));
  }

  function currentUserLabel() {
    const u = getCurrentUser();
    return u ? u.nom : "Système";
  }

  // ---------- Correspondance lignes Supabase (snake_case) <-> état (camelCase) ----------

  function mapDriverRow(r) {
    return {
      id: r.id, matricule: r.matricule, nom: r.nom, prenom: r.prenom, email: r.email || "", teamId: r.team_id,
      initialShift: r.initial_shift, initialZone: r.initial_zone, initialVacation: r.initial_vacation,
      statut: r.statut, dateEntree: r.date_entree, dateSortie: r.date_sortie,
      observation: r.observation || "", actif: r.actif, motifDepart: r.motif_depart,
      ordreAffichage: r.ordre_affichage,
      soldeReport: r.conge_solde_report, soldeReportAnnee: r.conge_solde_report_annee,
      loginTos: r.login_tos || ""
    };
  }
  function mapTeamRow(r) { return { id: r.id, nom: r.nom, shiftCycle: r.shift_cycle, typeEngin: r.type_engin || "RTG" }; }
  function mapProfileRow(r) { return { id: r.id, username: r.username, nom: r.nom, role: r.role, teamId: r.team_id, driverId: r.driver_id, actif: r.actif, email: r.email || "", credentialsSentAt: r.credentials_sent_at || null }; }
  function mapRecordRow(r) { return { id: r.id, driverId: r.driver_id, dateDebut: r.date_debut, dateFin: r.date_fin, type: r.type, commentaire: r.commentaire || "", utilisateur: r.utilisateur, createdAt: r.created_at }; }
  // Congés uniquement (§38) : mêmes champs de base + le workflow de demande
  // en libre-service (statut / justificatif / refus / validation). Un congé
  // saisi directement par un responsable n'a pas ces champs renseignés (statut
  // vaut 'VALIDE' par défaut côté base — voir migration_003).
  function mapCongeRow(r) {
    return Object.assign(mapRecordRow(r), {
      statut: r.statut || "VALIDE",
      justificatifPath: r.justificatif_path || null,
      motifRefus: r.motif_refus || "",
      validatedBy: r.validated_by || null,
      validatedAt: r.validated_at || null
    });
  }
  function mapHeureRow(r) { return { id: r.id, driverId: r.driver_id, dateDebut: r.date_debut, dateFin: r.date_fin, type: r.type, heures: r.heures, mouvements: r.mouvements, commentaire: r.commentaire || "", utilisateur: r.utilisateur, createdAt: r.created_at }; }
  function mapFerieMvtRow(r) { return { id: r.id, date: r.date, driverId: r.driver_id, mouvements: r.mouvements, commentaire: r.commentaire || "", utilisateur: r.utilisateur, createdAt: r.created_at, updatedAt: r.updated_at }; }
  function mapOverrideRow(r) { return { shift: r.shift, vacation: r.vacation, zone: r.zone, status: r.status, startTime: r.start_time, endTime: r.end_time, motif: r.motif, details: r.details, createdAt: r.created_at, updatedAt: r.updated_at }; }
  function mapAuditRow(r) { return { id: r.id, date: r.date, utilisateur: r.utilisateur, driverId: r.driver_id, matricule: r.matricule, action: r.action, details: r.details }; }
  function mapMouvementTosRow(r) {
    return {
      id: r.id, driverId: r.driver_id, loginTos: r.login_tos, dateTravail: r.date_travail, shift: r.shift,
      engin: r.engin, facility: r.facility,
      nombreIn: r.nombre_in, nombreOut: r.nombre_out, nombreMove: r.nombre_move, nombreShifting: r.nombre_shifting,
      nombreDisch: r.nombre_disch, nombreLoad: r.nombre_load, nombreAutre: r.nombre_autre, totalMvmt: r.total_mvmt,
      matchNote: r.match_note, createdAt: r.created_at, source: "TOS"
    };
  }
  function mapMouvementManuelRow(r) {
    const total = (r.nombre_in || 0) + (r.nombre_out || 0) + (r.nombre_move || 0) + (r.nombre_shifting || 0) + (r.nombre_disch || 0) + (r.nombre_load || 0) + (r.nombre_autre || 0);
    return {
      id: r.id, driverId: r.driver_id, loginTos: null, dateTravail: r.date_travail, shift: r.shift || "",
      engin: "Saisie manuelle", facility: null,
      nombreIn: r.nombre_in, nombreOut: r.nombre_out, nombreMove: r.nombre_move, nombreShifting: r.nombre_shifting,
      nombreDisch: r.nombre_disch, nombreLoad: r.nombre_load, nombreAutre: r.nombre_autre, totalMvmt: total,
      matchNote: null, commentaire: r.commentaire || "", utilisateur: r.utilisateur, createdAt: r.created_at, source: "MANUEL"
    };
  }

  // ---------- Chargement complet depuis Supabase ----------

  async function loadAll() {
    const [
      teamsRes, driversRes, profilesRes, congesRes, maladiesRes, absencesRes,
      heuresRes, feriesRes, overridesRes, auditRes
    ] = await Promise.all([
      sb.from("teams").select("*"),
      sb.from("drivers").select("*").order("matricule"),
      sb.from("profiles").select("*"),
      sb.from("conges").select("*"),
      sb.from("maladies").select("*"),
      sb.from("absences").select("*"),
      sb.from("heures_exceptionnelles").select("*"),
      sb.from("feries_mouvements").select("*"),
      sb.from("manual_overrides").select("*"),
      sb.from("audit_log").select("*").order("date", { ascending: false }).limit(500)
    ]);

    const manualOverrides = {};
    (overridesRes.data || []).forEach(r => { manualOverrides[r.date + "_" + r.driver_id] = mapOverrideRow(r); });

    return {
      teams: (teamsRes.data || []).map(mapTeamRow),
      drivers: (driversRes.data || []).map(mapDriverRow),
      users: (profilesRes.data || []).map(mapProfileRow),
      conges: (congesRes.data || []).map(mapCongeRow),
      maladies: (maladiesRes.data || []).map(mapRecordRow),
      absences: (absencesRes.data || []).map(mapRecordRow),
      heuresExceptionnelles: (heuresRes.data || []).map(mapHeureRow),
      feriesMouvements: (feriesRes.data || []).map(mapFerieMvtRow),
      manualOverrides: manualOverrides,
      auditLog: (auditRes.data || []).map(mapAuditRow)
    };
  }

  // Recharge tout depuis Supabase (utile après une action externe, ou pour
  // un futur bouton "Actualiser"). Conserve la config statique (RTG_CONFIG).
  async function refreshAll() {
    const data = await loadAll();
    set(s => Object.assign({}, s, data, { loading: false }));
  }

  // ---------- Authentification (Supabase Auth) ----------
  //
  // Chaque "identifiant" applicatif correspond à un email technique
  // <identifiant>@rtg-planner.local dans Supabase Auth — l'écran de
  // connexion continue de ne demander qu'un identifiant + mot de passe.
  // Les rôles/permissions sont contrôlés côté base (RLS), pas seulement par
  // ce que l'interface choisit d'afficher.

  async function login(username, password) {
    const email = (username || "").trim().toLowerCase() + RTG_AUTH_EMAIL_DOMAIN;
    const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password });
    if (error) {
      // Messages distincts pour diagnostiquer sans deviner : identifiants
      // faux, compte non confirmé (voir Auth > Providers > Email > "Confirm
      // email") et toute autre erreur Supabase renvoyée telle quelle.
      if (/invalid login credentials/i.test(error.message)) throw new Error("Identifiant ou mot de passe incorrect.");
      if (/email not confirmed/i.test(error.message)) throw new Error("Ce compte n'est pas confirmé côté Supabase (Authentication > Providers > Email > désactiver « Confirm email »).");
      throw new Error("Connexion refusée par Supabase : " + error.message);
    }
    if (!data.user) throw new Error("Connexion refusée par Supabase (raison inconnue).");

    const loaded = await loadAll();
    const me = loaded.users.find(u => u.id === data.user.id);
    if (!me) {
      await sb.auth.signOut();
      throw new Error("Compte authentifié mais aucun profil trouvé dans la table profiles (id " + data.user.id + ").");
    }
    if (me.actif === false) {
      await sb.auth.signOut();
      throw new Error("Ce compte a été désactivé.");
    }
    set(s => Object.assign({}, s, loaded, { currentUserId: me.id, loading: false, authChecked: true }));
    return me;
  }

  async function logout() {
    await sb.auth.signOut();
    set(() => Object.assign(rtgEmptyState(), { loading: false, authChecked: true }));
  }

  // Restaure une session existante au chargement de la page (l'utilisateur
  // reste connecté après un rafraîchissement, contrairement à l'ancien
  // système où "être connecté" n'était qu'un id posé dans localStorage).
  async function initAuth() {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session && data.session.user) {
        const loaded = await loadAll();
        const me = loaded.users.find(u => u.id === data.session.user.id);
        if (me && me.actif !== false) {
          set(s => Object.assign({}, s, loaded, { currentUserId: me.id, loading: false, authChecked: true }));
          return;
        }
        await sb.auth.signOut();
      }
    } catch (e) {
      console.warn("RTGStore: vérification de session impossible.", e);
    }
    set(s => Object.assign({}, s, { loading: false, authChecked: true }));
  }
  initAuth();

  // Repart d'un état vide et relance la vérification de session — conservé
  // pour compatibilité (n'est pas branché à un bouton dans l'interface).
  function resetToSeed() {
    set(() => rtgEmptyState());
    initAuth();
  }

  // ---------- Audit ----------

  async function addAuditEntry(entry) {
    const row = {
      date: new Date().toISOString(),
      utilisateur: currentUserLabel(),
      driver_id: entry.driverId || null,
      matricule: entry.matricule || null,
      action: entry.action,
      details: entry.details || null
    };
    const { data, error } = await sb.from("audit_log").insert(row).select().single();
    if (!error && data) {
      set(s => Object.assign({}, s, { auditLog: [mapAuditRow(data), ...s.auditLog] }));
    }
  }

  // ---------- Conducteurs (§28) ----------

  function isMatriculeTaken(matricule, excludeDriverId) {
    return state.drivers.some(d => d.matricule.toLowerCase() === matricule.toLowerCase() && d.id !== excludeDriverId);
  }

  async function addDriver(input) {
    const team = state.teams.find(t => t.id === input.teamId);
    const row = {
      id: input.teamId + "_" + input.matricule,
      matricule: input.matricule, nom: input.nom, prenom: input.prenom, email: input.email || null, team_id: input.teamId,
      initial_shift: team ? team.shiftCycle[0] : null,
      initial_zone: input.initialZone || state.config.zones[0],
      initial_vacation: input.initialVacation || "V1",
      statut: "PRESENT", date_entree: input.dateEntree || RTGDate.toISO(new Date()),
      date_sortie: null, observation: input.observation || "", actif: true
    };
    const { data, error } = await sb.from("drivers").insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const driver = mapDriverRow(data);
    set(s => Object.assign({}, s, { drivers: [...s.drivers, driver] }));
    addAuditEntry({ driverId: driver.id, matricule: driver.matricule, action: "Création conducteur", details: driver.nom + " " + driver.prenom + " — " + (team ? team.nom : driver.teamId) });
    return driver;
  }

  async function updateDriver(driverId, patch) {
    const before = state.drivers.find(d => d.id === driverId);
    const dbPatch = {};
    if ("matricule" in patch) dbPatch.matricule = patch.matricule;
    if ("nom" in patch) dbPatch.nom = patch.nom;
    if ("prenom" in patch) dbPatch.prenom = patch.prenom;
    if ("email" in patch) dbPatch.email = patch.email || null;
    if ("teamId" in patch) dbPatch.team_id = patch.teamId;
    if ("initialZone" in patch) dbPatch.initial_zone = patch.initialZone;
    if ("initialVacation" in patch) dbPatch.initial_vacation = patch.initialVacation;
    if ("dateEntree" in patch) dbPatch.date_entree = patch.dateEntree;
    if ("dateSortie" in patch) dbPatch.date_sortie = patch.dateSortie;
    if ("observation" in patch) dbPatch.observation = patch.observation;
    if ("actif" in patch) dbPatch.actif = patch.actif;
    if ("motifDepart" in patch) dbPatch.motif_depart = patch.motifDepart;
    if ("ordreAffichage" in patch) dbPatch.ordre_affichage = patch.ordreAffichage;
    if ("soldeReport" in patch) dbPatch.conge_solde_report = patch.soldeReport === "" || patch.soldeReport === null ? null : Number(patch.soldeReport);
    if ("soldeReportAnnee" in patch) dbPatch.conge_solde_report_annee = patch.soldeReportAnnee === "" || patch.soldeReportAnnee === null ? null : Number(patch.soldeReportAnnee);
    if ("loginTos" in patch) dbPatch.login_tos = patch.loginTos ? patch.loginTos.trim().toLowerCase() : null;

    const { data, error } = await sb.from("drivers").update(dbPatch).eq("id", driverId).select().single();
    if (error) { console.error(error); throw error; }
    const updated = mapDriverRow(data);
    set(s => Object.assign({}, s, { drivers: s.drivers.map(d => d.id === driverId ? updated : d) }));
    if (before) {
      addAuditEntry({ driverId: driverId, matricule: before.matricule, action: "Modification conducteur", details: Object.keys(patch).map(k => k + ": " + before[k] + " → " + patch[k]).join(", ") });
    }
  }

  // motif (départ) : "RETRAITE", "CHANGEMENT_POSTE" ou "AGENT_SUSPENDU" (arrêt
  // de travail) — voir DEPART_MOTIF_LABELS (pages2.js) pour les libellés.
  async function setDriverActive(driverId, actif, motif) {
    await updateDriver(driverId, { actif: actif, dateSortie: actif ? null : RTGDate.toISO(new Date()), motifDepart: actif ? null : (motif || "") });
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: actif ? "Réactivation conducteur" : "Départ conducteur", details: actif ? "" : (motif || "") });
  }

  // ---------- Congés / Maladies / Absences / Heures exceptionnelles — API générique ----------

  function recordRowMapper(table) { return table === "heures_exceptionnelles" ? mapHeureRow : mapRecordRow; }

  async function addRecord(table, listKey, input, auditAction) {
    const row = {
      driver_id: input.driverId, date_debut: input.dateDebut, date_fin: input.dateFin,
      commentaire: input.commentaire || "", utilisateur: currentUserLabel()
    };
    if ("type" in input) row.type = input.type;
    if ("heures" in input) row.heures = input.heures;
    if ("mouvements" in input) row.mouvements = input.mouvements;
    const { data, error } = await sb.from(table).insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const record = recordRowMapper(table)(data);
    set(s => Object.assign({}, s, { [listKey]: [...s[listKey], record] }));
    const d = state.drivers.find(dr => dr.id === input.driverId);
    addAuditEntry({ driverId: input.driverId, matricule: d ? d.matricule : "", action: auditAction, details: input.dateDebut + " → " + input.dateFin + (input.commentaire ? " (" + input.commentaire + ")" : "") });
    return record;
  }

  async function updateRecord(table, listKey, id, patch, auditAction) {
    const dbPatch = {};
    if ("dateDebut" in patch) dbPatch.date_debut = patch.dateDebut;
    if ("dateFin" in patch) dbPatch.date_fin = patch.dateFin;
    if ("type" in patch) dbPatch.type = patch.type;
    if ("heures" in patch) dbPatch.heures = patch.heures;
    if ("mouvements" in patch) dbPatch.mouvements = patch.mouvements;
    if ("commentaire" in patch) dbPatch.commentaire = patch.commentaire;
    const { data, error } = await sb.from(table).update(dbPatch).eq("id", id).select().single();
    if (error) { console.error(error); throw error; }
    const updated = recordRowMapper(table)(data);
    set(s => Object.assign({}, s, { [listKey]: s[listKey].map(r => r.id === id ? updated : r) }));
    const d = state.drivers.find(dr => dr.id === updated.driverId);
    addAuditEntry({ driverId: updated.driverId, matricule: d ? d.matricule : "", action: auditAction, details: "" });
  }

  async function deleteRecord(table, listKey, id, auditAction) {
    const r = state[listKey].find(rec => rec.id === id);
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) { console.error(error); throw error; }
    set(s => Object.assign({}, s, { [listKey]: s[listKey].filter(rec => rec.id !== id) }));
    if (r) {
      const d = state.drivers.find(dr => dr.id === r.driverId);
      addAuditEntry({ driverId: r.driverId, matricule: d ? d.matricule : "", action: auditAction, details: r.dateDebut + " → " + r.dateFin });
    }
  }

  function addConge(input) { return addRecord("conges", "conges", input, "Ajout congé"); }
  function updateConge(id, patch) { return updateRecord("conges", "conges", id, patch, "Modification congé"); }
  function deleteConge(id) { return deleteRecord("conges", "conges", id, "Suppression congé"); }

  // ---------- Demande de congé en libre-service (§38) ----------
  // Un conducteur (role CONDUCTEUR) envoie sa propre demande, justificatif à
  // l'appui (photo/scan) : elle entre en base avec statut EN_ATTENTE, sans
  // effet sur le planning tant qu'un Responsable ne l'a pas validée
  // (AbsenceEngine ne prend en compte que les congés VALIDE — voir son
  // en-tête). Le fichier est stocké dans le bucket privé
  // "justificatifs-conges", sous <driverId>/<horodatage>-<nom fichier> — les
  // policies RLS de ce bucket (migration_003) limitent l'upload à ce même
  // dossier pour un compte CONDUCTEUR.
  const RTG_JUSTIFICATIFS_BUCKET = "justificatifs-conges";

  async function submitCongeRequest(input) {
    const path = input.driverId + "/" + Date.now() + "-" + input.file.name.replace(/[^\w.\-]/g, "_");
    const { error: uploadError } = await sb.storage.from(RTG_JUSTIFICATIFS_BUCKET).upload(path, input.file, { upsert: false });
    if (uploadError) { console.error(uploadError); throw uploadError; }

    const row = {
      driver_id: input.driverId, date_debut: input.dateDebut, date_fin: input.dateFin,
      type: "Congé annuel", commentaire: input.commentaire || "", utilisateur: currentUserLabel(),
      statut: "EN_ATTENTE", justificatif_path: path
    };
    const { data, error } = await sb.from("conges").insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const record = mapCongeRow(data);
    set(s => Object.assign({}, s, { conges: [...s.conges, record] }));
    addAuditEntry({ driverId: input.driverId, matricule: (state.drivers.find(d => d.id === input.driverId) || {}).matricule || "", action: "Demande de congé (en attente)", details: input.dateDebut + " → " + input.dateFin });
    return record;
  }

  // decision: "VALIDE" ou "REFUSE". Réservé à Admin/Responsable/Responsable
  // de Shift (RLS conges_write) — un CONDUCTEUR ne peut pas s'auto-valider.
  async function validateCongeRequest(id, decision, motifRefus) {
    const dbPatch = {
      statut: decision,
      motif_refus: decision === "REFUSE" ? (motifRefus || "") : null,
      validated_by: state.currentUserId,
      validated_at: new Date().toISOString()
    };
    const { data, error } = await sb.from("conges").update(dbPatch).eq("id", id).select().single();
    if (error) { console.error(error); throw error; }
    const updated = mapCongeRow(data);
    set(s => Object.assign({}, s, { conges: s.conges.map(r => r.id === id ? updated : r) }));
    const d = state.drivers.find(dr => dr.id === updated.driverId);
    addAuditEntry({ driverId: updated.driverId, matricule: d ? d.matricule : "", action: decision === "VALIDE" ? "Validation demande de congé" : "Refus demande de congé", details: motifRefus || "" });
    // Email de confirmation (Edge Function "send-conge-email", voir son
    // en-tête pour le déploiement) — best-effort : un échec d'envoi (email
    // absent, secrets Gmail pas encore configurés, fonction pas encore
    // déployée) ne doit JAMAIS remettre en cause la validation/refus
    // elle-même, déjà actée en base ci-dessus.
    if (d && d.email) {
      try {
        await sb.functions.invoke("send-conge-email", {
          body: { to: d.email, driverName: d.nom + " " + d.prenom, dateDebut: updated.dateDebut, dateFin: updated.dateFin, decision: decision, motifRefus: motifRefus || "" }
        });
      } catch (e) {
        console.warn("RTGStore: envoi de l'email de confirmation de congé impossible.", e);
      }
    }
    return updated;
  }

  // URL signée temporaire (bucket privé) pour consulter/télécharger un
  // justificatif — ne pas en garder une copie, elle expire (60s).
  async function getCongeJustificatifUrl(path) {
    const { data, error } = await sb.storage.from(RTG_JUSTIFICATIFS_BUCKET).createSignedUrl(path, 60);
    if (error) { console.error(error); throw error; }
    return data.signedUrl;
  }

  function addMaladie(input) { return addRecord("maladies", "maladies", input, "Ajout maladie"); }
  function updateMaladie(id, patch) { return updateRecord("maladies", "maladies", id, patch, "Modification maladie"); }
  function deleteMaladie(id) { return deleteRecord("maladies", "maladies", id, "Suppression maladie"); }

  function addAbsence(input) { return addRecord("absences", "absences", input, input.type === "FORMATION" ? "Ajout formation" : "Ajout absence"); }
  function updateAbsence(id, patch) { return updateRecord("absences", "absences", id, patch, "Modification absence/formation"); }
  function deleteAbsence(id) { return deleteRecord("absences", "absences", id, "Suppression absence/formation"); }

  // ---------- Heures exceptionnelles : doublage / férié travaillé / dimanche S3 (§29) ----------

  const HEURE_EXCEPTIONNELLE_LABELS = { DOUBLAGE: "Ajout doublage", FERIE_TRAVAILLE: "Ajout jour férié travaillé", DIMANCHE_S3: "Ajout 3ème shift dimanche" };

  function addHeureExceptionnelle(input) { return addRecord("heures_exceptionnelles", "heuresExceptionnelles", input, HEURE_EXCEPTIONNELLE_LABELS[input.type] || "Ajout Over Time"); }
  function updateHeureExceptionnelle(id, patch) { return updateRecord("heures_exceptionnelles", "heuresExceptionnelles", id, patch, "Modification Over Time"); }
  function deleteHeureExceptionnelle(id) { return deleteRecord("heures_exceptionnelles", "heuresExceptionnelles", id, "Suppression Over Time"); }

  // ---------- Affectations manuelles / remplacement (§26-27) ----------

  async function setManualOverride(isoDate, driverId, override, auditAction, auditDetails) {
    const row = {
      date: isoDate, driver_id: driverId,
      shift: override.shift, vacation: override.vacation, zone: override.zone, status: override.status,
      start_time: override.startTime, end_time: override.endTime, motif: auditAction || null, details: auditDetails || null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await sb.from("manual_overrides").upsert(row, { onConflict: "date,driver_id" }).select().single();
    if (error) { console.error(error); throw error; }
    // Garde-fou : si la ligne renvoyée par Supabase après l'upsert ne
    // correspond pas exactement à ce qui a été demandé (date/conducteur),
    // le signaler bruyamment plutôt que de mettre en cache silencieusement
    // une valeur qui ne serait pas celle attendue (déjà vu : un import qui
    // se dit réussi sans erreur, mais dont un jour précis n'apparaît jamais
    // dans l'appli ni dans l'historique — ce garde-fou permet de vérifier si
    // Supabase renvoie autre chose que ce qui a été envoyé).
    if (data.date !== isoDate || data.driver_id !== driverId) {
      const mismatch = new Error("Réponse Supabase inattendue pour l'affectation manuelle : demandé " + isoDate + "/" + driverId + ", reçu " + data.date + "/" + data.driver_id);
      console.error(mismatch, { requested: { isoDate, driverId }, received: data });
      throw mismatch;
    }
    const key = isoDate + "_" + driverId;
    set(s => Object.assign({}, s, { manualOverrides: Object.assign({}, s.manualOverrides, { [key]: mapOverrideRow(data) }) }));
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: auditAction || "Modification affectation", details: isoDate + (auditDetails ? " — " + auditDetails : "") });
  }

  // Annule une affectation manuelle : le conducteur revient à l'affectation
  // automatique calculée par le moteur pour ce jour-là.
  async function deleteManualOverride(isoDate, driverId, auditDetails) {
    const key = isoDate + "_" + driverId;
    if (!state.manualOverrides[key]) return;
    const { error } = await sb.from("manual_overrides").delete().eq("date", isoDate).eq("driver_id", driverId);
    if (error) { console.error(error); throw error; }
    set(s => {
      const manualOverrides = Object.assign({}, s.manualOverrides);
      delete manualOverrides[key];
      return Object.assign({}, s, { manualOverrides: manualOverrides });
    });
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: "Annulation affectation manuelle", details: isoDate + (auditDetails ? " — " + auditDetails : "") });
  }

  // Supprime UNIQUEMENT les repos/présences forcés manuellement et les
  // congés créés par l'import Excel du planning réel (RTG_IMPORT_OVERRIDE_MOTIF
  // / RTG_IMPORT_CONGE_COMMENT), pour une équipe et un mois donnés — jamais
  // les autres modifications manuelles (Remplacement, édition case par case
  // sans motif d'import, congés saisis normalement). Sert à repartir d'une
  // base propre avant de refaire un import (ex. après plusieurs tentatives
  // avec des versions buguées du fichier ou de l'outil).
  async function resetImportedRestData(teamId, month, year) {
    const driverIds = state.drivers.filter(d => d.teamId === teamId).map(d => d.id);
    if (driverIds.length === 0) return { overridesDeleted: 0, congesDeleted: 0, maladiesDeleted: 0 };
    const mm = String(month).padStart(2, "0");
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const first = year + "-" + mm + "-01";
    const last = year + "-" + mm + "-" + String(dim).padStart(2, "0");

    const { data: overridesData, error: overridesErr } = await sb.from("manual_overrides")
      .delete().in("driver_id", driverIds).eq("motif", RTG_IMPORT_OVERRIDE_MOTIF)
      .gte("date", first).lte("date", last).select("id");
    if (overridesErr) { console.error(overridesErr); throw overridesErr; }

    const { data: congesData, error: congesErr } = await sb.from("conges")
      .delete().in("driver_id", driverIds).eq("commentaire", RTG_IMPORT_CONGE_COMMENT)
      .gte("date_debut", first).lte("date_fin", last).select("id");
    if (congesErr) { console.error(congesErr); throw congesErr; }

    const { data: maladiesData, error: maladiesErr } = await sb.from("maladies")
      .delete().in("driver_id", driverIds).eq("commentaire", RTG_IMPORT_MALADIE_COMMENT)
      .gte("date_debut", first).lte("date_fin", last).select("id");
    if (maladiesErr) { console.error(maladiesErr); throw maladiesErr; }

    await refreshAll();
    const team = state.teams.find(t => t.id === teamId);
    const overridesCount = (overridesData || []).length, congesCount = (congesData || []).length, maladiesCount = (maladiesData || []).length;
    addAuditEntry({ action: "Réinitialisation import Excel", details: (team ? team.nom : teamId) + " — " + mm + "/" + year + " — " + overridesCount + " affectation(s), " + congesCount + " congé(s) et " + maladiesCount + " maladie(s) supprimé(s)" });
    return { overridesDeleted: overridesCount, congesDeleted: congesCount, maladiesDeleted: maladiesCount };
  }

  // Remise à zéro complète du planning d'une équipe pour un mois donné :
  // supprime TOUTES les affectations manuelles (quel qu'en soit le motif —
  // import Excel, équilibrage V1/V2 case par case, remplacement...), TOUS
  // les congés et TOUTES les maladies qui touchent ce mois, pour repartir
  // d'un planning entièrement recalculé par l'algorithme (aucune donnée
  // manuelle résiduelle) avant un réimport. Plus radical que
  // resetImportedRestData ci-dessus (qui ne touche que les données déjà
  // taguées "import") : utile quand une modification manuelle antérieure —
  // même hors import — fausse encore le planning après un import propre.
  async function resetMonthPlanningToBlank(teamId, month, year) {
    const driverIds = state.drivers.filter(d => d.teamId === teamId).map(d => d.id);
    if (driverIds.length === 0) return { overridesDeleted: 0, congesDeleted: 0, maladiesDeleted: 0 };
    const mm = String(month).padStart(2, "0");
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const first = year + "-" + mm + "-01";
    const last = year + "-" + mm + "-" + String(dim).padStart(2, "0");

    const { data: overridesData, error: overridesErr } = await sb.from("manual_overrides")
      .delete().in("driver_id", driverIds).gte("date", first).lte("date", last).select("id");
    if (overridesErr) { console.error(overridesErr); throw overridesErr; }

    // Congé/maladie : toute période qui CHEVAUCHE le mois (pas seulement
    // celles entièrement à l'intérieur), pour qu'aucune trace « CG »/« M »
    // ne reste visible sur la grille de ce mois après la remise à zéro.
    const { data: congesData, error: congesErr } = await sb.from("conges")
      .delete().in("driver_id", driverIds).lte("date_debut", last).gte("date_fin", first).select("id");
    if (congesErr) { console.error(congesErr); throw congesErr; }

    const { data: maladiesData, error: maladiesErr } = await sb.from("maladies")
      .delete().in("driver_id", driverIds).lte("date_debut", last).gte("date_fin", first).select("id");
    if (maladiesErr) { console.error(maladiesErr); throw maladiesErr; }

    await refreshAll();
    const team = state.teams.find(t => t.id === teamId);
    const overridesCount = (overridesData || []).length, congesCount = (congesData || []).length, maladiesCount = (maladiesData || []).length;
    addAuditEntry({ action: "Remise à zéro complète du planning", details: (team ? team.nom : teamId) + " — " + mm + "/" + year + " — " + overridesCount + " affectation(s), " + congesCount + " congé(s) et " + maladiesCount + " maladie(s) supprimé(s)" });
    return { overridesDeleted: overridesCount, congesDeleted: congesCount, maladiesDeleted: maladiesCount };
  }

  // Corrige/supprime en masse les affectations manuelles (import Excel ou
  // autre) dont la VACATION (V1/V2) ne correspond plus au calcul automatique
  // à jour — typiquement après une correction du moteur de rotation
  // (ex. règle samedi/dimanche/lundi du 3ème shift) : les jours importés
  // avant ce correctif restent figés sur l'ancienne valeur tant qu'on ne les
  // supprime pas un par un. Ne touche QUE les affectations où le statut est
  // "PRESENT" avec une vacation renseignée ET différente de la valeur
  // recalculée — jamais les repos/congés/remplacements forcés manuellement,
  // qui restent des décisions volontaires à conserver telles quelles.
  async function bulkClearStaleVacationOverrides(teamId, month, year) {
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return { checked: 0, cleared: 0 };
    const driverIds = new Set(state.drivers.filter(d => d.teamId === teamId).map(d => d.id));
    const mm = String(month).padStart(2, "0");
    const prefix = year + "-" + mm + "-";
    const toClear = [];
    Object.keys(state.manualOverrides).forEach(key => {
      const iso = key.slice(0, 10);
      const driverId = key.slice(11);
      if (!iso.startsWith(prefix) || !driverIds.has(driverId)) return;
      const override = state.manualOverrides[key];
      if (override.status !== "PRESENT" || !override.vacation) return;
      const driver = state.drivers.find(d => d.id === driverId);
      if (!driver) return;
      const correct = VacationRotationEngine.getVacationForDate(driver, RTGDate.parseISO(iso), state, team);
      if (correct && correct !== override.vacation) toClear.push({ iso, driverId });
    });
    for (const { iso, driverId } of toClear) {
      await deleteManualOverride(iso, driverId, "Nettoyage vacation obsolète (correctif rotation samedi/dimanche/lundi)");
    }
    addAuditEntry({ action: "Nettoyage vacations obsolètes", details: team.nom + " — " + mm + "/" + year + " — " + toClear.length + " affectation(s) corrigée(s)" });
    return { checked: Object.keys(state.manualOverrides).length, cleared: toClear.length };
  }

  // ---------- Mouvements réalisés un jour férié, PAR CONDUCTEUR PRÉSENT (§31) ----------

  function getFerieMouvements(isoDate, driverId) {
    return state.feriesMouvements.find(f => f.date === isoDate && f.driverId === driverId) || null;
  }

  async function setFerieMouvements(isoDate, driverId, mouvements, commentaire) {
    const row = { date: isoDate, driver_id: driverId, mouvements: mouvements, commentaire: commentaire, utilisateur: currentUserLabel(), updated_at: new Date().toISOString() };
    const { data, error } = await sb.from("feries_mouvements").upsert(row, { onConflict: "date,driver_id" }).select().single();
    if (error) { console.error(error); throw error; }
    const record = mapFerieMvtRow(data);
    set(s => {
      const existingIdx = s.feriesMouvements.findIndex(f => f.date === isoDate && f.driverId === driverId);
      const list = existingIdx === -1 ? [...s.feriesMouvements, record] : s.feriesMouvements.map(f => f.id === record.id ? record : f);
      return Object.assign({}, s, { feriesMouvements: list });
    });
    const d = state.drivers.find(dr => dr.id === driverId);
    addAuditEntry({ driverId: driverId, matricule: d ? d.matricule : "", action: "Mouvements jour férié", details: isoDate + " — " + mouvements + " mouvement(s)" });
  }

  // ---------- Mouvements RTG importés depuis le TOS ----------
  // Table potentiellement volumineuse (plusieurs centaines de lignes/jour à
  // terme) : volontairement JAMAIS chargée dans `state` au démarrage comme
  // le reste (congés, heures exceptionnelles...) — chaque page qui en a
  // besoin interroge Supabase directement avec sa propre plage de dates,
  // RLS s'occupant déjà de restreindre ce qui est visible par rôle/équipe.
  async function fetchMouvementsTos({ driverId, dateFrom, dateTo } = {}) {
    let query = sb.from("mouvements_tos").select("*").order("date_travail", { ascending: false }).order("shift");
    if (driverId) query = query.eq("driver_id", driverId);
    if (dateFrom) query = query.gte("date_travail", dateFrom);
    if (dateTo) query = query.lte("date_travail", dateTo);
    let manuelQuery = sb.from("mouvements_manuels").select("*").order("date_travail", { ascending: false });
    if (driverId) manuelQuery = manuelQuery.eq("driver_id", driverId);
    if (dateFrom) manuelQuery = manuelQuery.gte("date_travail", dateFrom);
    if (dateTo) manuelQuery = manuelQuery.lte("date_travail", dateTo);
    const [tosRes, manuelRes] = await Promise.all([query, manuelQuery]);
    if (tosRes.error) { console.error(tosRes.error); throw tosRes.error; }
    if (manuelRes.error) { console.error(manuelRes.error); throw manuelRes.error; }
    return (tosRes.data || []).map(mapMouvementTosRow).concat((manuelRes.data || []).map(mapMouvementManuelRow));
  }

  // Ignorer durablement un login TOS non rattaché à un conducteur (ex.
  // conducteur tracteur ayant ponctuellement opéré un RTG) : le prochain
  // import ne le remontera plus jamais, et supprime au passage les lignes
  // déjà importées pour ce login (voir import-tos-moves/index.ts).
  async function ignoreTosLogin(loginTos, note) {
    // upsert (pas insert) : redemander à ignorer un login déjà ignoré (ex.
    // ré-affiché suite à un import non à jour côté Edge Function) ne doit
    // jamais échouer sur une violation de clé déjà existante — la ligne
    // mouvements_tos doit être re-supprimée dans tous les cas ci-dessous.
    const { error } = await sb.from("mouvements_tos_logins_ignores").upsert({ login_tos: loginTos, note: note || null, created_by: state.currentUserId }, { onConflict: "login_tos" });
    if (error) { console.error(error); throw error; }
    const { error: deleteError } = await sb.from("mouvements_tos").delete().eq("login_tos", loginTos);
    if (deleteError) console.error(deleteError);
    addAuditEntry({ action: "Login TOS ignoré", details: loginTos + (note ? " — " + note : "") });
  }

  async function addMouvementManuel(input) {
    const row = {
      driver_id: input.driverId, date_travail: input.dateTravail, shift: input.shift || null,
      nombre_in: Number(input.nombreIn) || 0, nombre_out: Number(input.nombreOut) || 0, nombre_move: Number(input.nombreMove) || 0,
      nombre_shifting: Number(input.nombreShifting) || 0, nombre_disch: Number(input.nombreDisch) || 0,
      nombre_load: Number(input.nombreLoad) || 0, nombre_autre: Number(input.nombreAutre) || 0,
      commentaire: input.commentaire || "", utilisateur: currentUserLabel()
    };
    const { data, error } = await sb.from("mouvements_manuels").insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const record = mapMouvementManuelRow(data);
    const d = state.drivers.find(dr => dr.id === input.driverId);
    addAuditEntry({ driverId: input.driverId, matricule: d ? d.matricule : "", action: "Ajout mouvements manuels", details: input.dateTravail + " — " + record.totalMvmt + " mouvement(s)" });
    return record;
  }

  async function deleteMouvementManuel(id) {
    const { error } = await sb.from("mouvements_manuels").delete().eq("id", id);
    if (error) { console.error(error); throw error; }
    addAuditEntry({ action: "Suppression mouvements manuels", details: id });
  }

  // ---------- Utilisateurs / authentification (§30) ----------
  //
  // Les comptes et rôles vivent maintenant dans Supabase Auth + la table
  // `profiles`, protégés par RLS — plus de mots de passe en clair dans le
  // navigateur. Limite technique à connaître : créer un NOUVEL utilisateur
  // (signup) est possible depuis le navigateur avec la clé publique, mais
  // changer le mot de passe d'un AUTRE utilisateur déjà existant ne l'est
  // pas (il faut la clé secrète, que cette appli n'expose jamais) — un admin
  // doit alors le faire directement dans le tableau de bord Supabase
  // (Authentication > Users > sélectionner le compte > réinitialiser).

  function isUsernameTaken(username, excludeUserId) {
    return state.users.some(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== excludeUserId);
  }

  async function addUser(input) {
    const email = input.username.trim().toLowerCase() + RTG_AUTH_EMAIL_DOMAIN;
    const { data: authData, error: authError } = await sbAdmin.auth.signUp({ email: email, password: input.password });
    if (authError || !authData.user) { console.error(authError); throw authError || new Error("Création du compte impossible."); }

    const row = {
      id: authData.user.id, username: input.username.trim(), nom: input.nom.trim(), role: input.role,
      team_id: input.role === "RESPONSABLE_SHIFT" ? input.teamId : null,
      driver_id: input.role === "CONDUCTEUR" ? input.driverId : null,
      email: input.role === "CONDUCTEUR" ? null : (input.email || null),
      actif: true
    };
    const { data, error } = await sb.from("profiles").insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const user = mapProfileRow(data);
    set(s => Object.assign({}, s, { users: [...s.users, user] }));
    addAuditEntry({ action: "Création utilisateur", details: user.nom + " (" + user.username + ") — " + user.role });
    return user;
  }

  async function updateUser(userId, patch) {
    const dbPatch = {};
    if ("username" in patch) dbPatch.username = patch.username;
    if ("nom" in patch) dbPatch.nom = patch.nom;
    if ("role" in patch) dbPatch.role = patch.role;
    if ("teamId" in patch) dbPatch.team_id = patch.teamId;
    if ("driverId" in patch) dbPatch.driver_id = patch.driverId;
    if ("actif" in patch) dbPatch.actif = patch.actif;
    if ("email" in patch) dbPatch.email = patch.email || null;

    if (patch.password) {
      if (userId === state.currentUserId) {
        const { error } = await sb.auth.updateUser({ password: patch.password });
        if (error) { console.error(error); throw error; }
      } else {
        throw new Error("Impossible de changer le mot de passe d'un autre utilisateur depuis l'application — à faire dans Supabase (Authentication > Users > réinitialiser).");
      }
    }

    // Rien à modifier dans `profiles` (ex. uniquement le mot de passe, déjà
    // traité ci-dessus via sb.auth.updateUser, qui ne touche pas cette
    // table) : ne PAS lancer un update+select vide. Cette table n'est
    // modifiable que par un ADMIN (RLS profiles_write_admin) — un
    // update({}) par un non-ADMIN (ex. self-service "Mon compte") est donc
    // rejeté par RLS (0 ligne visible) et .single() échoue avec "Cannot
    // coerce the result to a single JSON object", alors que le mot de passe,
    // lui, a bien été changé.
    if (Object.keys(dbPatch).length === 0) {
      addAuditEntry({ action: "Modification utilisateur", details: userId });
      return;
    }

    const { data, error } = await sb.from("profiles").update(dbPatch).eq("id", userId).select().single();
    if (error) { console.error(error); throw error; }
    const updated = mapProfileRow(data);
    set(s => Object.assign({}, s, { users: s.users.map(u => u.id === userId ? updated : u) }));
    addAuditEntry({ action: "Modification utilisateur", details: userId });
  }

  async function setUserActive(userId, actif) {
    await updateUser(userId, { actif: actif });
    if (!actif && state.currentUserId === userId) logout();
  }

  async function deleteUser(userId) {
    const u = state.users.find(x => x.id === userId);
    const { error } = await sb.from("profiles").delete().eq("id", userId);
    if (error) { console.error(error); throw error; }
    set(s => Object.assign({}, s, { users: s.users.filter(x => x.id !== userId) }));
    if (state.currentUserId === userId) logout();
    addAuditEntry({ action: "Suppression utilisateur", details: u ? u.nom + " (" + u.username + ")" : userId });
  }

  // supabase-js renvoie sur functions.invoke() une erreur générique ("Edge
  // Function returned a non-2xx status code") — le vrai message (ex. "Aucun
  // email renseigné...") est dans le corps JSON de la réponse, accessible via
  // error.context (l'objet Response brut). Sans ça, l'utilisateur ne voit
  // jamais la cause réelle d'un échec d'envoi.
  async function extractFunctionErrorMessage(error) {
    try {
      if (error && error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        if (body && body.error) return body.error;
      }
    } catch (_) { /* corps non-JSON ou déjà consommé : on retombe sur error.message */ }
    return (error && error.message) || "Erreur inconnue.";
  }

  // Enregistre en base la date du dernier envoi d'identifiants — sans ça, le
  // statut "Envoyé" affiché sur la page Utilisateurs ne survivrait pas à un
  // changement de page ou un rafraîchissement (perdu en mémoire locale
  // uniquement).
  async function markCredentialsSent(userId) {
    const { data, error } = await sb.from("profiles").update({ credentials_sent_at: new Date().toISOString() }).eq("id", userId).select().single();
    if (error) { console.error(error); return; }
    const updated = mapProfileRow(data);
    set(s => Object.assign({}, s, { users: s.users.map(u => u.id === userId ? updated : u) }));
  }

  // Envoi des identifiants (édge function "send-credentials-email") — appelé
  // juste après la création d'un compte CONDUCTEUR, seul moment où le mot de
  // passe en clair est encore connu. best-effort : ne bloque jamais la
  // création du compte elle-même en cas d'échec d'envoi.
  async function sendCredentialsEmail({ to, driverName, username, password, userId }) {
    const appUrl = window.location.origin + window.location.pathname;
    const { error } = await sb.functions.invoke("send-credentials-email", {
      body: { to, driverName, username, password, appUrl }
    });
    if (error) { console.error(error); throw new Error(await extractFunctionErrorMessage(error)); }
    if (userId) await markCredentialsSent(userId);
  }

  // Réinitialisation + renvoi des identifiants pour un compte EXISTANT
  // (édge function "reset-and-send-credentials", réservée aux ADMIN côté
  // fonction) — nécessaire car un mot de passe déjà défini n'est plus
  // récupérable en clair (Supabase Auth ne le stocke jamais).
  async function resetAndSendCredentials(targetUserId) {
    const appUrl = window.location.origin + window.location.pathname;
    const { error } = await sb.functions.invoke("reset-and-send-credentials", {
      body: { targetUserId, appUrl }
    });
    if (error) { console.error(error); throw new Error(await extractFunctionErrorMessage(error)); }
    await markCredentialsSent(targetUserId);
    const u = state.users.find(x => x.id === targetUserId);
    addAuditEntry({ action: "Réinitialisation + renvoi des identifiants", details: u ? u.nom + " (" + u.username + ")" : targetUserId });
  }

  // ---------- Équipes : créer / renommer le shift-équipe (§30) ----------

  async function addTeam({ id, nom, shiftCycle, typeEngin }) {
    const row = { id, nom, shift_cycle: shiftCycle, type_engin: typeEngin || "RTG" };
    const { data, error } = await sb.from("teams").insert(row).select().single();
    if (error) { console.error(error); throw error; }
    const created = mapTeamRow(data);
    set(s => Object.assign({}, s, { teams: s.teams.concat([created]) }));
    addAuditEntry({ action: "Création équipe", details: created.nom + " (" + created.typeEngin + ")" });
    return created;
  }

  async function updateTeam(teamId, patch) {
    const before = state.teams.find(t => t.id === teamId);
    const dbPatch = {};
    if ("nom" in patch) dbPatch.nom = patch.nom;
    if ("shiftCycle" in patch) dbPatch.shift_cycle = patch.shiftCycle;
    if ("typeEngin" in patch) dbPatch.type_engin = patch.typeEngin;
    const { data, error } = await sb.from("teams").update(dbPatch).eq("id", teamId).select().single();
    if (error) { console.error(error); throw error; }
    const updated = mapTeamRow(data);
    set(s => Object.assign({}, s, { teams: s.teams.map(t => t.id === teamId ? updated : t) }));
    if (before) {
      addAuditEntry({ action: "Renommage équipe/shift", details: before.nom + " → " + (patch.nom || before.nom) });
    }
  }

  return {
    get, set, subscribe, addAuditEntry, resetToSeed, refreshAll,
    isMatriculeTaken, addDriver, updateDriver, setDriverActive,
    addConge, updateConge, deleteConge,
    submitCongeRequest, validateCongeRequest, getCongeJustificatifUrl,
    addMaladie, updateMaladie, deleteMaladie,
    addAbsence, updateAbsence, deleteAbsence,
    addHeureExceptionnelle, updateHeureExceptionnelle, deleteHeureExceptionnelle,
    setManualOverride, deleteManualOverride, resetImportedRestData, resetMonthPlanningToBlank, bulkClearStaleVacationOverrides,
    getCurrentUser, login, logout,
    isUsernameTaken, addUser, updateUser, setUserActive, deleteUser, sendCredentialsEmail, resetAndSendCredentials,
    addTeam, updateTeam, setCurrentFleet,
    getFerieMouvements, setFerieMouvements,
    fetchMouvementsTos, addMouvementManuel, deleteMouvementManuel, ignoreTosLogin
  };
})();
