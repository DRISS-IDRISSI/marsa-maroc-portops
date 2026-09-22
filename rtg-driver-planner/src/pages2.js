// ==========================================
// RTG DRIVER PLANNER — Phase 2 : Conducteurs / Congés / Maladies / Absences / Remplacement
// Continue sur les mêmes conventions que pages.js (useRtgState, RTG_STATUS_META...).
// ==========================================

function ConfirmButton({ label, confirmLabel, onConfirm, className }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="text-xs text-slate-400">{confirmLabel || "Confirmer ?"}</span>
        <button onClick={() => { setConfirming(false); onConfirm(); }} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30">Oui</button>
        <button onClick={() => setConfirming(false)} className="text-xs px-2 py-1 rounded bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </span>
    );
  }
  return <button onClick={() => setConfirming(true)} className={className || "text-xs px-2 py-1 rounded bg-marine-800 text-slate-400 hover:text-white"}>{label}</button>;
}

// Départ d'un conducteur (§ demande RH) — retraite, changement de poste, ou
// arrêt de travail pour agent suspendu ; dans tous les cas le conducteur est
// désactivé (RTGStore.setDriverActive(id, false, motif)) et le motif est
// conservé sur la fiche + l'historique.
const DEPART_MOTIF_LABELS = {
  RETRAITE: "Retraite",
  CHANGEMENT_POSTE: "Changement de poste",
  AGENT_SUSPENDU: "Arrêt de travail — agent suspendu"
};

function DepartButton({ onConfirm }) {
  const [open, setOpen] = useState(false);
  const [motif, setMotif] = useState("RETRAITE");
  if (open) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <select value={motif} onChange={e => setMotif(e.target.value)} className="bg-surface border border-border rounded px-1.5 py-1 text-[11px] text-white">
          {Object.entries(DEPART_MOTIF_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button onClick={() => { setOpen(false); onConfirm(motif); }} className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30">Confirmer</button>
        <button onClick={() => setOpen(false)} className="text-xs px-2 py-1 rounded bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </span>
    );
  }
  return <button onClick={() => setOpen(true)} className="text-xs px-2 py-1 rounded bg-marine-800 text-red-400 hover:text-red-300">Départ</button>;
}

function Panel({ title, icon, children, actions }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon && <i className={`fas ${icon} text-orange-400 text-sm`}></i>}
        <h3 className="text-white text-sm font-semibold">{title}</h3>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const FIELD_CLS = "bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white w-full";
const LABEL_CLS = "block text-[10px] uppercase tracking-wider text-slate-500 mb-1";

// ==========================================
// 1. Conducteurs (CRUD complet — §28)
// ==========================================
function emptyDriverForm(lockedTeamId) {
  return { matricule: "", nom: "", prenom: "", email: "", teamId: lockedTeamId || "A", initialZone: "A", initialVacation: "V1", dateEntree: RTGDate.toISO(new Date()), observation: "", soldeReport: "", soldeReportAnnee: "", loginTos: "" };
}

function DriverForm({ state, initial, editingId, onCancel, onSaved, lockedTeamId }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.matricule.trim() || !form.nom.trim() || !form.prenom.trim()) {
      setError("Matricule, nom et prénom sont obligatoires.");
      return;
    }
    if (RTGStore.isMatriculeTaken(form.matricule.trim(), editingId)) {
      setError("Ce matricule est déjà utilisé par un autre conducteur.");
      return;
    }
    const teamId = lockedTeamId || form.teamId;
    const payload = Object.assign({}, form, { teamId: teamId, matricule: form.matricule.trim(), nom: form.nom.trim().toUpperCase(), prenom: form.prenom.trim().toUpperCase() });
    setSaving(true);
    try {
      if (editingId) {
        await RTGStore.updateDriver(editingId, payload);
      } else {
        await RTGStore.addDriver(payload);
      }
      onSaved();
    } catch (err) {
      setError("Erreur d'enregistrement : " + (err && err.message ? err.message : "réessayez."));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={LABEL_CLS}>Matricule</label><input className={FIELD_CLS} value={form.matricule} onChange={e => setForm(f => Object.assign({}, f, { matricule: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Nom</label><input className={FIELD_CLS} value={form.nom} onChange={e => setForm(f => Object.assign({}, f, { nom: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Prénom</label><input className={FIELD_CLS} value={form.prenom} onChange={e => setForm(f => Object.assign({}, f, { prenom: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Email personnel</label><input type="email" placeholder="pour les notifications de congé" className={FIELD_CLS} value={form.email || ""} onChange={e => setForm(f => Object.assign({}, f, { email: e.target.value }))} /></div>
        {!lockedTeamId && (
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select className={FIELD_CLS} value={form.teamId} onChange={e => setForm(f => Object.assign({}, f, { teamId: e.target.value }))}>
            {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </div>
        )}
        <div>
          <label className={LABEL_CLS}>Zone initiale</label>
          <select className={FIELD_CLS} value={form.initialZone} onChange={e => setForm(f => Object.assign({}, f, { initialZone: e.target.value }))}>
            {zonesForFleet(state.config, ((state.teams.find(t => t.id === (lockedTeamId || form.teamId)) || {}).typeEngin) || "RTG").map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Bloc de vacation (au 01/08/2026)</label>
          <select className={FIELD_CLS} value={form.initialVacation} onChange={e => setForm(f => Object.assign({}, f, { initialVacation: e.target.value }))}>
            {state.config.vacationCycle.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div><label className={LABEL_CLS}>Date d'entrée</label><input type="date" className={FIELD_CLS} value={form.dateEntree} onChange={e => setForm(f => Object.assign({}, f, { dateEntree: e.target.value }))} /></div>
        <div className="sm:col-span-2"><label className={LABEL_CLS}>Observation</label><input className={FIELD_CLS} value={form.observation} onChange={e => setForm(f => Object.assign({}, f, { observation: e.target.value }))} /></div>
      </div>
      <div className="border-t border-border pt-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Solde de congé — reliquat antérieur à l'appli (saisie unique, à partir des archives RH)</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={LABEL_CLS}>Solde reporté (jours ouvrables)</label>
            <input type="number" min="0" step="1" placeholder="ex. 12" className={FIELD_CLS} value={form.soldeReport}
              onChange={e => setForm(f => Object.assign({}, f, { soldeReport: e.target.value }))} />
          </div>
          <div>
            <label className={LABEL_CLS}>Applicable à partir de l'année</label>
            <input type="number" min="2000" step="1" placeholder="ex. 2026" className={FIELD_CLS} value={form.soldeReportAnnee}
              onChange={e => setForm(f => Object.assign({}, f, { soldeReportAnnee: e.target.value }))} />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">Une fois renseigné, le solde disponible se recalcule automatiquement chaque année suivante (droit de 26j/an + report non expiré − jours de congé déjà pris dans l'appli).</p>
      </div>
      <div className="border-t border-border pt-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Mouvements RTG — import automatique depuis le TOS</p>
        <div><label className={LABEL_CLS}>Login TOS (uniquement si différent de celui déduit automatiquement)</label>
          <input placeholder="ex. melghannamtc3" className={FIELD_CLS} value={form.loginTos || ""} onChange={e => setForm(f => Object.assign({}, f, { loginTos: e.target.value }))} />
        </div>
        <p className="text-[11px] text-slate-500 mt-1.5">Laissez vide : le login est déduit automatiquement (1ère lettre du prénom + nom + suffixe terminal). Ne renseignez ce champ que si l'import de mouvements RTG ne rattache pas ce conducteur (login TOS orthographié différemment de son nom officiel).</p>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">{saving ? "Enregistrement..." : (editingId ? "Enregistrer" : "Créer le conducteur")}</button>
        <button onClick={onCancel} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </div>
    </div>
  );
}

// Renommer une équipe/shift (§30) — édition en ligne, réservée à Admin/Responsable
// (un Responsable de Shift ne gère pas le nom de son équipe, seulement ses conducteurs).
function TeamNameEditor({ team, editable }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(team.nom);

  if (!editable) return <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{team.nom}</div>;

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mb-1">
        <input autoFocus value={value} onChange={e => setValue(e.target.value)}
          className="bg-surface border border-border rounded px-2 py-1 text-xs text-white w-32" />
        <button onClick={() => { if (value.trim()) RTGStore.updateTeam(team.id, { nom: value.trim() }); setEditing(false); }} className="text-emerald-400 hover:text-emerald-300"><i className="fas fa-check"></i></button>
        <button onClick={() => { setValue(team.nom); setEditing(false); }} className="text-slate-500 hover:text-white"><i className="fas fa-times"></i></button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 mb-1">
      <div className="text-xs uppercase tracking-wider text-slate-500">{team.nom}</div>
      <button onClick={() => setEditing(true)} title="Renommer ce shift/équipe"
        className="flex items-center gap-1 text-[10px] font-medium text-orange-400/80 hover:text-orange-400 border border-orange-500/30 hover:border-orange-500/60 rounded px-1.5 py-0.5">
        <i className="fas fa-pen text-[9px]"></i>Renommer
      </button>
    </div>
  );
}

// Création d'une équipe (§ module Chariots Cavalier) — jusqu'ici l'appli ne
// permettait que de renommer une équipe existante (TeamNameEditor) : il n'y
// avait jamais eu besoin d'en créer une nouvelle avant l'arrivée du module CC.
// Ordre fixe de rotation hebdomadaire des shifts (ShiftRotationEngine) :
// S1 → S3 → S2 → S1 ... Construit un shiftCycle de 3 éléments tel que
// l'équipe soit sur `currentShift` la semaine en cours (weekIndexMod3 =
// diffWeeks % 3 par rapport à config.referenceWeekStart), en respectant
// cet ordre pour les semaines suivantes.
const SHIFT_ROTATION_ORDER = ["S1", "S3", "S2"];
function buildShiftCycleForCurrentShift(currentShift, weekIndexMod3) {
  const p = SHIFT_ROTATION_ORDER.indexOf(currentShift);
  const cycle = [];
  for (let i = 0; i < 3; i++) {
    cycle[i] = SHIFT_ROTATION_ORDER[(((p - weekIndexMod3 + i) % 3) + 3) % 3];
  }
  return cycle;
}

function TeamForm({ state, typeEngin, onCancel, onSaved }) {
  const [nom, setNom] = useState("");
  const [currentShift, setCurrentShift] = useState("S1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!nom.trim()) { setError("Le nom de l'équipe est obligatoire."); return; }
    const id = typeEngin + "_" + nom.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (!id || id === typeEngin + "_") { setError("Nom invalide."); return; }
    setSaving(true);
    try {
      const refWeek = RTGDate.startOfWeekMonday(RTGDate.parseISO(state.config.referenceWeekStart));
      const targetWeek = RTGDate.startOfWeekMonday(new Date());
      const diffWeeks = Math.floor(RTGDate.diffDays(refWeek, targetWeek) / 7);
      const weekIndexMod3 = ((diffWeeks % 3) + 3) % 3;
      const shiftCycle = buildShiftCycleForCurrentShift(currentShift, weekIndexMod3);
      await RTGStore.addTeam({ id, nom: nom.trim(), shiftCycle, typeEngin });
      onSaved();
    } catch (err) {
      setError("Erreur d'enregistrement : " + (err && err.message ? err.message : "réessayez."));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      <div>
        <label className={LABEL_CLS}>Nom de l'équipe</label>
        <input autoFocus className={FIELD_CLS} placeholder={"ex. GR " + typeEngin + " 1"} value={nom} onChange={e => setNom(e.target.value)} />
      </div>
      <div>
        <label className={LABEL_CLS}>Shift de cette équipe cette semaine</label>
        <select className={FIELD_CLS} value={currentShift} onChange={e => setCurrentShift(e.target.value)}>
          <option value="S1">Shift 1</option>
          <option value="S2">Shift 2</option>
          <option value="S3">Shift 3</option>
        </select>
        <p className="text-[11px] text-slate-500 mt-1">Détermine le point de départ de la rotation hebdomadaire (S1 → S3 → S2 → S1...) pour cette équipe.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">{saving ? "Enregistrement..." : "Créer l'équipe"}</button>
        <button onClick={onCancel} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </div>
    </div>
  );
}

function DriversPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const loc = useLocation();
  const [teamFilter, setTeamFilter] = useState(shiftRestricted ? currentUser.teamId : "all");
  const [statusFilter, setStatusFilter] = useState("actifs");
  // Pré-rempli depuis ?q=... quand on arrive via la recherche du tableau de bord.
  const [searchQuery, setSearchQuery] = useState(() => new URLSearchParams(loc.search).get("q") || "");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  // Ouvre directement l'historique du conducteur visé par ?open=<matricule>
  // (lien "Nom" depuis le Planning mensuel ou l'Affectation du jour) — une
  // seule fois, dès que le conducteur correspondant est chargé.
  const openMatricule = useMemo(() => new URLSearchParams(loc.search).get("open"), [loc.search]);
  useEffect(() => {
    if (!openMatricule) return;
    const d = state.drivers.find(dr => dr.matricule === openMatricule);
    if (d) setHistoryFor(d.id);
  }, [openMatricule, state.drivers]);

  // Un Responsable de Shift/Conducteur reste toujours sur sa propre équipe ;
  // pour ADMIN/RESPONSABLE, la bascule RTG/CC (barre latérale) détermine
  // quelle flotte est affichée ici (§ module Chariots Cavalier).
  const fleetTeamIds = useMemo(() => new Set(
    state.teams.filter(t => (t.typeEngin || "RTG") === state.currentFleet).map(t => t.id)
  ), [state.teams, state.currentFleet]);
  const visibleTeams = shiftRestricted ? state.teams.filter(t => t.id === currentUser.teamId) : state.teams.filter(t => fleetTeamIds.has(t.id));
  const [showTeamForm, setShowTeamForm] = useState(false);

  const drivers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return state.drivers.filter(d =>
      (shiftRestricted ? d.teamId === currentUser.teamId : fleetTeamIds.has(d.teamId)) &&
      (shiftRestricted || teamFilter === "all" || d.teamId === teamFilter) &&
      (statusFilter === "tous" || (statusFilter === "actifs" ? d.actif !== false : d.actif === false)) &&
      (!q || d.matricule.toLowerCase().includes(q) || d.nom.toLowerCase().includes(q) || d.prenom.toLowerCase().includes(q))
    );
  }, [state.drivers, teamFilter, statusFilter, searchQuery, shiftRestricted, currentUser, fleetTeamIds]);

  const today = RTGDate.toISO(new Date());
  const todayDate = RTGDate.parseISO(today);

  const editingDriver = editingId ? state.drivers.find(d => d.id === editingId) : null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Conducteurs{!shiftRestricted ? " — " + state.currentFleet : ""}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{drivers.filter(d => d.actif !== false).length} conducteurs actifs{shiftRestricted ? " — " + visibleTeams[0].nom : " sur " + state.drivers.filter(d => fleetTeamIds.has(d.teamId)).length}</p>
        </div>
        <div className="flex gap-2">
          {!shiftRestricted && (
            <button onClick={() => { setShowTeamForm(true); setShowForm(false); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-white hover:bg-marine-700 border border-border">
              <i className="fas fa-users-rectangle mr-1.5"></i>Nouvelle équipe
            </button>
          )}
          <button onClick={() => { setShowForm(true); setShowTeamForm(false); setEditingId(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
            <i className="fas fa-plus mr-1.5"></i>Nouveau conducteur
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {visibleTeams.map(t => {
          const effectif = state.drivers.filter(d => d.actif !== false && d.teamId === t.id).length;
          const shift = ShiftRotationEngine.getTeamShiftForDate(t, todayDate, state.config);
          return (
            <div key={t.id} className="bg-card rounded-xl border border-border p-4">
              <TeamNameEditor team={t} editable={!shiftRestricted} />
              <div className="text-xs text-slate-500 -mt-0.5 mb-1">{shift} aujourd'hui</div>
              <div className="text-2xl font-bold text-white">{effectif} <span className="text-sm font-normal text-slate-500">conducteurs</span></div>
            </div>
          );
        })}
        {visibleTeams.length === 0 && (
          <p className="text-xs text-slate-500 italic sm:col-span-3">Aucune équipe {state.currentFleet} pour l'instant — créez-en une avec « Nouvelle équipe ».</p>
        )}
      </div>
      {!shiftRestricted && <p className="text-xs text-slate-500 -mt-2">Modifiez l'équipe d'un conducteur (bouton « Modifier ») pour rééquilibrer les effectifs entre shifts.</p>}

      {showTeamForm && (
        <Panel title={"Nouvelle équipe " + state.currentFleet} icon="fa-users-rectangle">
          <TeamForm state={state} typeEngin={state.currentFleet} onCancel={() => setShowTeamForm(false)} onSaved={() => setShowTeamForm(false)} />
        </Panel>
      )}

      {showForm && (
        <Panel title={editingId ? "Modifier le conducteur" : "Nouveau conducteur"} icon="fa-user-plus">
          <DriverForm state={Object.assign({}, state, { teams: visibleTeams })} lockedTeamId={shiftRestricted ? currentUser.teamId : null}
            initial={editingDriver ? { matricule: editingDriver.matricule, nom: editingDriver.nom, prenom: editingDriver.prenom, email: editingDriver.email || "", teamId: editingDriver.teamId, initialZone: editingDriver.initialZone, initialVacation: editingDriver.initialVacation, dateEntree: editingDriver.dateEntree, observation: editingDriver.observation || "", soldeReport: editingDriver.soldeReport != null ? editingDriver.soldeReport : "", soldeReportAnnee: editingDriver.soldeReportAnnee != null ? editingDriver.soldeReportAnnee : "", loginTos: editingDriver.loginTos || "" } : emptyDriverForm(shiftRestricted ? currentUser.teamId : (visibleTeams[0] ? visibleTeams[0].id : ""))}
            editingId={editingId} onCancel={() => { setShowForm(false); setEditingId(null); }} onSaved={() => { setShowForm(false); setEditingId(null); }} />
        </Panel>
      )}

      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border p-4">
        <div className="flex-1 min-w-[200px]">
          <label className={LABEL_CLS}>Rechercher</label>
          <input className={FIELD_CLS} placeholder="Matricule, nom, prénom..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        </div>
        {!shiftRestricted && (
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select className={FIELD_CLS} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="all">Toutes</option>
            {visibleTeams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </div>
        )}
        <div>
          <label className={LABEL_CLS}>Statut</label>
          <select className={FIELD_CLS} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="actifs">Actifs</option>
            <option value="inactifs">Inactifs</option>
            <option value="tous">Tous</option>
          </select>
        </div>
      </div>

      <p className="sm:hidden text-[11px] text-slate-500 -mt-2"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Mat</th><th className="px-3 py-2">Nom</th><th className="hidden sm:table-cell px-3 py-2">Prénom</th>
              <th className="px-3 py-2">Équipe</th><th className="hidden sm:table-cell px-3 py-2">Shift auj.</th><th className="hidden sm:table-cell px-3 py-2">Zone init.</th>
              <th className="hidden sm:table-cell px-3 py-2">Bloc vacation</th><th className="hidden sm:table-cell px-3 py-2">Statut</th>
              <th className="hidden sm:table-cell px-3 py-2">Solde congé</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(d => {
              const team = state.teams.find(t => t.id === d.teamId);
              const shift = team ? ShiftRotationEngine.getTeamShiftForDate(team, todayDate, state.config) : "—";
              return (
                <React.Fragment key={d.id}>
                  <tr className="border-t border-border hover:bg-marine-600/10">
                    <td className="px-3 py-2 text-slate-300">{d.matricule}</td>
                    <td className="px-3 py-2 text-white font-medium">{d.nom}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-slate-300">{d.prenom}</td>
                    <td className="px-3 py-2 text-slate-400">{team ? team.nom : d.teamId}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-slate-400">{shift}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-center"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{d.initialZone}</span></td>
                    <td className="hidden sm:table-cell px-3 py-2 text-center">{d.initialVacation}</td>
                    <td className="hidden sm:table-cell px-3 py-2">
                      {d.actif !== false
                        ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Actif</span>
                        : <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400" title={d.motifDepart ? DEPART_MOTIF_LABELS[d.motifDepart] || d.motifDepart : ""}>Inactif{d.motifDepart ? " — " + (DEPART_MOTIF_LABELS[d.motifDepart] || d.motifDepart) : ""}</span>}
                    </td>
                    <td className="hidden sm:table-cell px-3 py-2"><CongeSoldeBadge driver={d} state={state} /></td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => { setEditingId(d.id); setShowForm(true); }} className="text-orange-400 hover:text-orange-300">Modifier</button>
                        <button onClick={() => setHistoryFor(historyFor === d.id ? null : d.id)} className="text-marine-300 hover:text-white">Historique</button>
                        {d.actif !== false
                          ? <DepartButton onConfirm={motif => RTGStore.setDriverActive(d.id, false, motif)} />
                          : <ConfirmButton label="Réactiver" confirmLabel="Réactiver ?" onConfirm={() => RTGStore.setDriverActive(d.id, true)} className="text-emerald-400 hover:text-emerald-300 text-xs" />}
                      </div>
                    </td>
                  </tr>
                  {historyFor === d.id && (
                    <tr className="bg-surface/40">
                      <td colSpan="10" className="px-4 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Historique — {d.nom} {d.prenom}</div>
                        {state.auditLog.filter(a => a.driverId === d.id).length === 0
                          ? <p className="text-xs text-slate-500 italic">Aucune entrée.</p>
                          : (
                            <ul className="space-y-1 text-xs">
                              {state.auditLog.filter(a => a.driverId === d.id).map(a => (
                                <li key={a.id} className="text-slate-400">
                                  <span className="text-slate-600">{new Date(a.date).toLocaleString("fr-FR")}</span> — <span className="text-white">{a.action}</span>{a.details ? " — " + (a.action === "Départ conducteur" ? (DEPART_MOTIF_LABELS[a.details] || a.details) : a.details) : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// Sélecteur de conducteur générique (congés/maladies/absences/remplacement)
// ==========================================
// Combobox avec recherche (matricule/nom/prénom) plutôt qu'un <select> natif
// — avec 75 conducteurs, faire défiler une liste déroulante pour en trouver
// un était pénible (demande explicite : une case "recherche").
function DriverSelect({ state, value, onChange, onlyActive, teamId }) {
  let drivers = onlyActive ? state.drivers.filter(d => d.actif !== false) : state.drivers;
  if (teamId) drivers = drivers.filter(d => d.teamId === teamId);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = drivers.find(d => d.id === value);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? drivers.filter(d => d.matricule.toLowerCase().includes(q) || d.nom.toLowerCase().includes(q) || d.prenom.toLowerCase().includes(q))
    : drivers;

  return (
    <div className="relative">
      <input
        className={FIELD_CLS}
        placeholder="Rechercher (matricule, nom...)"
        value={open ? query : (selected ? `${selected.matricule} — ${selected.nom} ${selected.prenom}` : "")}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-surface border border-border rounded-lg shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-xs text-slate-500 italic">Aucun résultat.</div>}
          {filtered.map(d => (
            <button key={d.id} type="button"
              onMouseDown={() => { onChange(d.id); setQuery(""); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-marine-600/30 ${d.id === value ? "bg-marine-600/20 text-white" : "text-slate-300"}`}>
              {d.matricule} — {d.nom} {d.prenom}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function driverLabel(state, driverId) {
  const d = state.drivers.find(x => x.id === driverId);
  return d ? d.matricule + " — " + d.nom + " " + d.prenom : "(conducteur supprimé)";
}

// Barre "Filtrer par conducteur" réutilisée sur les pages de liste
// (Congés, Maladies, Absences, Over Time, Mouvements RTG) — recherche
// matricule/nom/prénom, avec un lien pour réinitialiser une fois un
// conducteur sélectionné.
function DriverFilterBar({ state, value, onChange, teamId }) {
  return (
    <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
      <div className="w-full sm:w-72">
        <label className={LABEL_CLS}>Filtrer par conducteur</label>
        <DriverSelect state={state} value={value} onChange={onChange} teamId={teamId} />
      </div>
      {value && (
        <button onClick={() => onChange("")} className="text-xs text-slate-400 hover:text-white underline">
          Réinitialiser le filtre
        </button>
      )}
    </div>
  );
}

// Badge "solde de congé" (§40) réutilisé sur la fiche Conducteur, la page
// Congés (responsable) et Mes Congés (conducteur) — voir CongeBalanceEngine.
function CongeSoldeBadge({ driver, state }) {
  if (!driver) return <span className="text-slate-600">—</span>;
  const solde = CongeBalanceEngine.soldeDisponible(driver, state);
  if (!solde) return <span className="text-slate-600" title="Solde de départ non renseigné (fiche conducteur)">—</span>;
  const cls = solde.disponible <= 0 ? "bg-red-500/20 text-red-300" : solde.disponible <= 5 ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-400";
  return (
    <span className={`px-1.5 py-0.5 rounded font-semibold whitespace-nowrap ${cls}`}
      title={`Droit ${solde.droit}j + report ${solde.report}j − pris ${solde.pris}j en ${solde.annee}`}>
      {solde.disponible}j disponibles
    </span>
  );
}

// ==========================================
// 2/3/4. Congés / Maladies / Absences — page générique
// ==========================================
function RecordsPage({ title, icon, listKey, kindLabel, showTypeSelect, showStatusCol, addFn, deleteFn }) {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), type: showTypeSelect ? "ABSENCE" : "", commentaire: "" });
  const [error, setError] = useState("");
  const [filterDriverId, setFilterDriverId] = useState("");

  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);

  const records = state[listKey]
    .filter(r => {
      if (filterDriverId && r.driverId !== filterDriverId) return false;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      if (!d) return false;
      if (!shiftRestricted) return true;
      return d.teamId === currentUser.teamId;
    })
    .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
  const todayIso = RTGDate.toISO(new Date());

  const submit = () => {
    if (!form.driverId) { setError("Sélectionnez un conducteur."); return; }
    if (form.dateFin < form.dateDebut) { setError("La date de fin doit être après la date de début."); return; }
    addFn(form);
    setForm({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), type: showTypeSelect ? "ABSENCE" : "", commentaire: "" });
    setError("");
    setShowForm(false);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          <p className="text-slate-400 text-sm mt-0.5">{records.length} enregistrement{records.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau
        </button>
      </div>

      {showForm && (
        <Panel title={"Nouvel enregistrement — " + kindLabel} icon={icon}>
          <div className="space-y-3">
            {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Conducteur</label><DriverSelect state={state} value={form.driverId} onChange={v => setForm(f => Object.assign({}, f, { driverId: v }))} teamId={shiftRestricted ? currentUser.teamId : null} /></div>
              <div><label className={LABEL_CLS}>Date début</label><input type="date" className={FIELD_CLS} value={form.dateDebut} onChange={e => setForm(f => Object.assign({}, f, { dateDebut: e.target.value }))} /></div>
              <div><label className={LABEL_CLS}>Date fin</label><input type="date" className={FIELD_CLS} value={form.dateFin} onChange={e => setForm(f => Object.assign({}, f, { dateFin: e.target.value }))} /></div>
              {showTypeSelect && (
                <div>
                  <label className={LABEL_CLS}>Type</label>
                  <select className={FIELD_CLS} value={form.type} onChange={e => setForm(f => Object.assign({}, f, { type: e.target.value }))}>
                    <option value="ABSENCE">Absence</option>
                    <option value="FORMATION">Formation</option>
                  </select>
                </div>
              )}
              <div className={showTypeSelect ? "sm:col-span-3" : "sm:col-span-4"}><label className={LABEL_CLS}>Commentaire</label><input className={FIELD_CLS} value={form.commentaire} onChange={e => setForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Enregistrer</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        </Panel>
      )}

      <DriverFilterBar state={state} value={filterDriverId} onChange={setFilterDriverId} teamId={shiftRestricted ? currentUser.teamId : null} />

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date début</th><th className="px-3 py-2">Date fin</th>
              {showStatusCol && <th className="px-3 py-2">Statut</th>}
              {showTypeSelect && <th className="px-3 py-2">Type</th>}
              <th className="px-3 py-2">Commentaire</th><th className="hidden sm:table-cell px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan={(showTypeSelect ? 7 : 6) + (showStatusCol ? 1 : 0)} className="px-3 py-6 text-center text-slate-500 italic">Aucun enregistrement.</td></tr>
            )}
            {records.map(r => {
              const temporalMeta = todayIso < r.dateDebut ? CONGE_TEMPORAL_META.FUTUR : todayIso > r.dateFin ? CONGE_TEMPORAL_META.ACHEVE : CONGE_TEMPORAL_META.EN_COURS;
              return (
              <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                <td className="px-3 py-2 text-white">{driverLabel(state, r.driverId)}</td>
                <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                <td className="px-3 py-2 text-slate-300">{r.dateFin}</td>
                {showStatusCol && <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded border ${temporalMeta.className}`}>{temporalMeta.label}</span></td>}
                {showTypeSelect && <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded ${r.type === "FORMATION" ? "bg-blue-600/30 text-blue-300" : "bg-red-600/30 text-red-300"}`}>{r.type === "FORMATION" ? "Formation" : "Absence"}</span></td>}
                <td className="px-3 py-2 text-slate-400">{r.type && !showTypeSelect ? r.type : r.commentaire}</td>
                <td className="hidden sm:table-cell px-3 py-2 text-slate-500">{r.utilisateur}</td>
                <td className="px-3 py-2"><ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => deleteFn(r.id)} className="text-red-400 hover:text-red-300 text-xs" /></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Statuts d'une demande de congé (§38) — un congé saisi directement par un
// responsable est VALIDE dès sa création ; seule une demande en
// libre-service envoyée par un conducteur passe par EN_ATTENTE.
const CONGE_STATUT_META = {
  EN_ATTENTE: { label: "En attente", className: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
  VALIDE: { label: "Validé", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  REFUSE: { label: "Refusé", className: "bg-red-500/20 text-red-300 border-red-500/30" }
};

// Distinction visuelle demandée par l'exploitant, UNIQUEMENT pour les
// congés VALIDÉS : selon la position de la période par rapport à
// aujourd'hui, pour repérer en un coup d'œil qui est ACTUELLEMENT en congé
// (plutôt qu'un badge "Validé" identique pour un congé déjà terminé, en
// cours, ou pas encore commencé). "En attente"/"Refusé" gardent leur
// couleur habituelle (CONGE_STATUT_META), sans rapport avec la date.
const CONGE_TEMPORAL_META = {
  EN_COURS: { label: "En cours", className: "bg-sky-500/20 text-sky-300 border-sky-500/30" },
  ACHEVE: { label: "Terminé", className: "bg-slate-700/40 text-slate-400 border-slate-600/40" },
  FUTUR: { label: "À venir", className: "bg-violet-500/20 text-violet-300 border-violet-500/30" }
};
function congeDisplayMeta(r, todayIso) {
  if (r.statut === "EN_ATTENTE" || r.statut === "REFUSE") return CONGE_STATUT_META[r.statut];
  if (todayIso < r.dateDebut) return CONGE_TEMPORAL_META.FUTUR;
  if (todayIso > r.dateFin) return CONGE_TEMPORAL_META.ACHEVE;
  return CONGE_TEMPORAL_META.EN_COURS;
}

function CongeJustificatifLink({ path }) {
  const [busy, setBusy] = useState(false);
  if (!path) return <span className="text-slate-600">—</span>;
  const open = async () => {
    setBusy(true);
    try {
      const url = await RTGStore.getCongeJustificatifUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      alert("Impossible d'ouvrir le justificatif : " + (e && e.message ? e.message : "réessayez."));
    }
    setBusy(false);
  };
  return (
    <button onClick={open} disabled={busy} className="text-orange-400 hover:text-orange-300 disabled:opacity-50">
      <i className="fas fa-paperclip mr-1"></i>{busy ? "Ouverture..." : "Voir"}
    </button>
  );
}

// Page Congés (Admin/Responsable/Responsable de Shift) — saisie directe
// (auto-validée) toujours possible, PLUS les demandes envoyées en
// libre-service par les conducteurs (statut EN_ATTENTE), à Valider/Refuser
// ici. Distincte de RecordsPage (utilisée par Maladies/Absences) car ce
// workflow d'approbation + justificatif n'existe que pour les congés.
function CongesPage() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), commentaire: "" });
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [refusingId, setRefusingId] = useState(null);
  const [refusMotif, setRefusMotif] = useState("");
  const [filterDriverId, setFilterDriverId] = useState("");

  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);

  const records = state.conges
    .filter(r => {
      if (filterDriverId && r.driverId !== filterDriverId) return false;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      if (!d) return false;
      if (!shiftRestricted) return true;
      return d.teamId === currentUser.teamId;
    })
    .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
  const pendingCount = records.filter(r => r.statut === "EN_ATTENTE").length;
  const todayIso = RTGDate.toISO(new Date());

  const submit = () => {
    if (!form.driverId) { setError("Sélectionnez un conducteur."); return; }
    if (form.dateFin < form.dateDebut) { setError("La date de fin doit être après la date de début."); return; }
    RTGStore.addConge({ driverId: form.driverId, dateDebut: form.dateDebut, dateFin: form.dateFin, type: form.commentaire || "Congé annuel", commentaire: form.commentaire });
    setForm({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), commentaire: "" });
    setError("");
    setShowForm(false);
  };

  const validate = async id => {
    setBusyId(id);
    try { await RTGStore.validateCongeRequest(id, "VALIDE"); }
    catch (e) { alert("Erreur : " + (e && e.message ? e.message : "réessayez.")); }
    setBusyId(null);
  };

  const refuse = async id => {
    setBusyId(id);
    try { await RTGStore.validateCongeRequest(id, "REFUSE", refusMotif); setRefusingId(null); setRefusMotif(""); }
    catch (e) { alert("Erreur : " + (e && e.message ? e.message : "réessayez.")); }
    setBusyId(null);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Congés</h1>
          <p className="text-slate-400 text-sm mt-0.5">{records.length} enregistrement{records.length > 1 ? "s" : ""}{pendingCount > 0 ? " — " + pendingCount + " en attente de validation" : ""}</p>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau
        </button>
      </div>

      {showForm && (
        <Panel title="Nouvel enregistrement — congé" icon="fa-umbrella-beach">
          <div className="space-y-3">
            {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Conducteur</label><DriverSelect state={state} value={form.driverId} onChange={v => setForm(f => Object.assign({}, f, { driverId: v }))} teamId={shiftRestricted ? currentUser.teamId : null} /></div>
              <div><label className={LABEL_CLS}>Date début</label><input type="date" className={FIELD_CLS} value={form.dateDebut} onChange={e => setForm(f => Object.assign({}, f, { dateDebut: e.target.value }))} /></div>
              <div><label className={LABEL_CLS}>Date fin</label><input type="date" className={FIELD_CLS} value={form.dateFin} onChange={e => setForm(f => Object.assign({}, f, { dateFin: e.target.value }))} /></div>
              <div className="sm:col-span-4"><label className={LABEL_CLS}>Commentaire</label><input className={FIELD_CLS} value={form.commentaire} onChange={e => setForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
            </div>
            <p className="text-[11px] text-slate-500">Un congé saisi ici est directement validé. Les demandes envoyées par un conducteur depuis son compte apparaissent ci-dessous avec le statut "En attente".</p>
            <div className="flex gap-2">
              <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Enregistrer</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        </Panel>
      )}

      <DriverFilterBar state={state} value={filterDriverId} onChange={setFilterDriverId} teamId={shiftRestricted ? currentUser.teamId : null} />

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date début</th><th className="px-3 py-2">Date fin</th>
              <th className="px-3 py-2">Statut</th><th className="hidden sm:table-cell px-3 py-2">Solde</th><th className="px-3 py-2">Justificatif</th>
              <th className="px-3 py-2">Commentaire</th><th className="hidden sm:table-cell px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan="9" className="px-3 py-6 text-center text-slate-500 italic">Aucun enregistrement.</td></tr>
            )}
            {records.map(r => {
              const meta = congeDisplayMeta(r, todayIso);
              const isPending = r.statut === "EN_ATTENTE";
              const rDriver = state.drivers.find(dr => dr.id === r.driverId);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white">{driverLabel(state, r.driverId)}</td>
                  <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                  <td className="px-3 py-2 text-slate-300">{r.dateFin}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded border ${meta.className}`}>{meta.label}</span>
                    {r.statut === "REFUSE" && r.motifRefus ? <div className="text-[10px] text-slate-500 mt-0.5">{r.motifRefus}</div> : null}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2"><CongeSoldeBadge driver={rDriver} state={state} /></td>
                  <td className="px-3 py-2"><CongeJustificatifLink path={r.justificatifPath} /></td>
                  <td className="px-3 py-2 text-slate-400">{r.commentaire}</td>
                  <td className="hidden sm:table-cell px-3 py-2 text-slate-500">{r.utilisateur}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isPending && (
                        refusingId === r.id ? (
                          <span className="flex items-center gap-1">
                            <input autoFocus placeholder="Motif (optionnel)" value={refusMotif} onChange={e => setRefusMotif(e.target.value)} className="bg-surface border border-border rounded px-1.5 py-1 text-[11px] text-white w-28" />
                            <button disabled={busyId === r.id} onClick={() => refuse(r.id)} className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50">OK</button>
                            <button onClick={() => { setRefusingId(null); setRefusMotif(""); }} className="text-slate-500 hover:text-white text-xs">Annuler</button>
                          </span>
                        ) : (
                          <React.Fragment>
                            <button disabled={busyId === r.id} onClick={() => validate(r.id)} className="text-emerald-400 hover:text-emerald-300 text-xs disabled:opacity-50">Valider</button>
                            <button disabled={busyId === r.id} onClick={() => setRefusingId(r.id)} className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50">Refuser</button>
                          </React.Fragment>
                        )
                      )}
                      <ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => RTGStore.deleteConge(r.id)} className="text-red-400 hover:text-red-300 text-xs" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MaladiesPage() {
  return <RecordsPage title="Maladies" icon="fa-briefcase-medical" listKey="maladies" kindLabel="maladie" showStatusCol
    addFn={f => RTGStore.addMaladie({ driverId: f.driverId, dateDebut: f.dateDebut, dateFin: f.dateFin, commentaire: f.commentaire })}
    deleteFn={id => RTGStore.deleteMaladie(id)} />;
}

function AbsencesPage() {
  return <RecordsPage title="Absences & Formations" icon="fa-user-slash" listKey="absences" kindLabel="absence/formation" showTypeSelect
    addFn={f => RTGStore.addAbsence({ driverId: f.driverId, dateDebut: f.dateDebut, dateFin: f.dateFin, type: f.type, commentaire: f.commentaire })}
    deleteFn={id => RTGStore.deleteAbsence(id)} />;
}

// ==========================================
// 5. Heures exceptionnelles — doublage / férié travaillé / dimanche S3 (§29)
// ==========================================
const HEURE_EXCEPTIONNELLE_TYPES = {
  DOUBLAGE: { label: "Doublage", icon: "fa-layer-group", className: "bg-amber-600/30 text-amber-300" },
  FERIE_TRAVAILLE: { label: "Jour férié travaillé", icon: "fa-star-and-crescent", className: "bg-indigo-600/30 text-indigo-300" },
  DIMANCHE_S3: { label: "3ème shift dimanche (nécessité de service)", icon: "fa-triangle-exclamation", className: "bg-rose-600/30 text-rose-300" }
};

function emptyHeureExceptionnelleForm() {
  return { driverId: "", date: RTGDate.toISO(new Date()), type: "DOUBLAGE", heures: 4, mouvements: "", commentaire: "" };
}

function HeuresExceptionnellesPage() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyHeureExceptionnelleForm());
  const [error, setError] = useState("");
  const [filterDriverId, setFilterDriverId] = useState("");

  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);

  const records = state.heuresExceptionnelles
    .filter(r => {
      if (filterDriverId && r.driverId !== filterDriverId) return false;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      if (!d) return false;
      if (!shiftRestricted) return true;
      return d.teamId === currentUser.teamId;
    })
    .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));

  const submit = () => {
    if (!form.driverId) { setError("Sélectionnez un conducteur."); return; }
    const heures = Number(form.heures);
    if (!heures || heures <= 0) { setError("Le nombre d'heures doit être supérieur à 0."); return; }
    RTGStore.addHeureExceptionnelle({ driverId: form.driverId, dateDebut: form.date, dateFin: form.date, type: form.type, heures: heures, mouvements: form.mouvements === "" ? null : Number(form.mouvements), commentaire: form.commentaire });
    setForm(emptyHeureExceptionnelleForm());
    setError("");
    setShowForm(false);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Over Time</h1>
          <p className="text-slate-400 text-sm mt-0.5">Doublage, jour férié travaillé, 3ème shift dimanche (nécessité de service) — {records.length} enregistrement{records.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau
        </button>
      </div>

      {showForm && (
        <Panel title="Nouvel enregistrement — Over Time" icon="fa-clock-rotate-left">
          <div className="space-y-3">
            {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Conducteur</label><DriverSelect state={state} value={form.driverId} onChange={v => setForm(f => Object.assign({}, f, { driverId: v }))} teamId={shiftRestricted ? currentUser.teamId : null} /></div>
              <div><label className={LABEL_CLS}>Date</label><input type="date" className={FIELD_CLS} value={form.date} onChange={e => setForm(f => Object.assign({}, f, { date: e.target.value }))} /></div>
              <div>
                <label className={LABEL_CLS}>Type</label>
                <select className={FIELD_CLS} value={form.type} onChange={e => setForm(f => Object.assign({}, f, { type: e.target.value }))}>
                  {Object.entries(HEURE_EXCEPTIONNELLE_TYPES).map(([k, meta]) => <option key={k} value={k}>{meta.label}</option>)}
                </select>
              </div>
              <div><label className={LABEL_CLS}>Heures</label><input type="number" min="0" step="0.5" className={FIELD_CLS} value={form.heures} onChange={e => setForm(f => Object.assign({}, f, { heures: e.target.value }))} /></div>
              <div><label className={LABEL_CLS}>Mouvements</label><input type="number" min="0" step="1" placeholder="Optionnel" className={FIELD_CLS} value={form.mouvements} onChange={e => setForm(f => Object.assign({}, f, { mouvements: e.target.value }))} /></div>
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Commentaire</label><input className={FIELD_CLS} value={form.commentaire} onChange={e => setForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
            </div>
            {(form.type === "FERIE_TRAVAILLE" || form.type === "DIMANCHE_S3") && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <i className="fas fa-circle-info mr-1.5"></i>Ce conducteur sera affiché PRÉSENT ce jour-là (au lieu de {form.type === "FERIE_TRAVAILLE" ? "férié" : "OFF"}) sur le planning et l'affectation du jour.
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Enregistrer</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div className="w-full sm:w-72">
          <label className={LABEL_CLS}>Filtrer par conducteur</label>
          <DriverSelect state={state} value={filterDriverId} onChange={setFilterDriverId} teamId={shiftRestricted ? currentUser.teamId : null} />
        </div>
        {filterDriverId && (
          <button onClick={() => setFilterDriverId("")} className="text-xs text-slate-400 hover:text-white underline">
            Réinitialiser le filtre
          </button>
        )}
      </div>

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Heures</th><th className="px-3 py-2">Mouvements</th><th className="hidden sm:table-cell px-3 py-2">Commentaire</th><th className="hidden sm:table-cell px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-500 italic">Aucun enregistrement.</td></tr>
            )}
            {records.map(r => {
              const meta = HEURE_EXCEPTIONNELLE_TYPES[r.type] || { label: r.type, className: "bg-slate-700 text-slate-300" };
              return (
                <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white">{driverLabel(state, r.driverId)}</td>
                  <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded ${meta.className}`}>{meta.label}</span></td>
                  <td className="px-3 py-2 text-slate-300 text-center">{r.heures}h</td>
                  <td className="px-3 py-2 text-slate-300 text-center">{r.mouvements != null ? r.mouvements : "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{r.commentaire}</td>
                  <td className="px-3 py-2 text-slate-500">{r.utilisateur}</td>
                  <td className="px-3 py-2"><ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => RTGStore.deleteHeureExceptionnelle(r.id)} className="text-red-400 hover:text-red-300 text-xs" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 6. Remplacement (§27)
// ==========================================
function RemplacementPage() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  const [dateStr, setDateStr] = useState(RTGDate.toISO(new Date()));
  const [absentId, setAbsentId] = useState("");
  const [chosenId, setChosenId] = useState("");
  const [applied, setApplied] = useState(null);

  const date = RTGDate.parseISO(dateStr);
  const assignments = useMemo(() => PlanningEngine.generateDailyAssignments(dateStr, state), [state, dateStr]);
  const absentDrivers = assignments.filter(a =>
    ["CONGE", "MALADIE", "ABSENCE", "FORMATION"].indexOf(a.status) !== -1 &&
    (!shiftRestricted || a.teamId === currentUser.teamId)
  );

  const candidates = useMemo(() => absentId ? ReplacementEngine.getCandidates(dateStr, absentId, state) : [], [state, dateStr, absentId]);
  const absentDriver = state.drivers.find(d => d.id === absentId);
  const chosen = candidates.find(c => c.driver.id === chosenId);
  const preview = (absentId && chosenId) ? ReplacementEngine.buildOverride(dateStr, absentId, chosenId, state) : null;

  const confirmReplacement = () => {
    if (!preview || !absentDriver || !chosen) return;
    RTGStore.setManualOverride(dateStr, chosenId, preview, "Remplacement",
      chosen.driver.nom + " " + chosen.driver.prenom + " remplace " + absentDriver.nom + " " + absentDriver.prenom + " — zone " + preview.zone);
    setApplied({ zone: preview.zone, remplacant: chosen.driver, absent: absentDriver });
    setChosenId("");
  };

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Remplacement</h1>
        <p className="text-slate-400 text-sm mt-0.5">Trouver un conducteur disponible pour couvrir un conducteur absent</p>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className={LABEL_CLS}>Date</label>
          <input type="date" className={FIELD_CLS} value={dateStr} onChange={e => { setDateStr(e.target.value); setAbsentId(""); setChosenId(""); setApplied(null); }} />
        </div>
        <div className="min-w-[260px]">
          <label className={LABEL_CLS}>Conducteur absent</label>
          <select className={FIELD_CLS} value={absentId} onChange={e => { setAbsentId(e.target.value); setChosenId(""); setApplied(null); }}>
            <option value="">— Sélectionner —</option>
            {absentDrivers.map(a => <option key={a.driverId} value={a.driverId}>{a.matricule} — {a.nom} {a.prenom} ({a.status})</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-500">{absentDrivers.length} conducteur{absentDrivers.length > 1 ? "s" : ""} absent{absentDrivers.length > 1 ? "s" : ""} ce jour-là</div>
      </div>

      {applied && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 text-sm">
          <i className="fas fa-circle-check"></i> {applied.remplacant.nom} {applied.remplacant.prenom} remplace {applied.absent.nom} {applied.absent.prenom} — zone {applied.zone} le {dateStr}
        </div>
      )}

      {absentId && (
        <Panel title={"Candidats disponibles — " + (absentDriver ? absentDriver.nom + " " + absentDriver.prenom : "")} icon="fa-people-arrows">
          {candidates.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Aucun conducteur disponible dans la même équipe ce jour-là.</p>
          ) : (
            <div>
              <p className="sm:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
              <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr className="text-left border-b border-border">
                    <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="hidden sm:table-cell py-1.5 pr-3">Prénom</th>
                    <th className="py-1.5 pr-3">Zone propre</th><th className="hidden sm:table-cell py-1.5 pr-3">Jours travaillés</th>
                    <th className="hidden sm:table-cell py-1.5 pr-3">Jours repos</th><th className="hidden sm:table-cell py-1.5 pr-3">Dernière affect.</th><th className="py-1.5 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => (
                    <tr key={c.driver.id} className={`border-b border-border/50 ${chosenId === c.driver.id ? "bg-orange-500/10" : ""}`}>
                      <td className="py-1.5 pr-3 text-slate-300">{c.driver.matricule}</td>
                      <td className="py-1.5 pr-3 text-white font-medium">{c.driver.nom}</td>
                      <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-300">{c.driver.prenom}</td>
                      <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{assignments.find(a => a.driverId === c.driver.id) ? assignments.find(a => a.driverId === c.driver.id).zone : "—"}</span></td>
                      <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{c.joursTravailles}</td>
                      <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{c.joursRepos}</td>
                      <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{c.derniereAffectation || "—"}</td>
                      <td className="py-1.5 pr-3">
                        <button onClick={() => setChosenId(c.driver.id)} className="text-xs px-2.5 py-1 rounded-lg bg-marine-800 text-slate-300 hover:bg-orange-500 hover:text-white transition-all">Choisir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </Panel>
      )}

      {chosen && preview && (
        <Panel title="Confirmation du remplacement" icon="fa-triangle-exclamation">
          <p className="text-sm text-slate-300 mb-3">
            <span className="text-white font-medium">{chosen.driver.nom} {chosen.driver.prenom}</span> reprendra la zone{" "}
            <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{preview.zone}</span> le {dateStr} à la place de{" "}
            <span className="text-white font-medium">{absentDriver.nom} {absentDriver.prenom}</span> ({absentDriver && (assignments.find(a=>a.driverId===absentId)||{}).status}).
          </p>
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">
            <i className="fas fa-triangle-exclamation mr-1.5"></i>Cette affectation est manuelle et ne suit plus la rotation automatique de zone pour {chosen.driver.nom}.
          </p>
          <div className="flex gap-2">
            <button onClick={confirmReplacement} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Confirmer le remplacement</button>
            <button onClick={() => setChosenId("")} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ==========================================
// 7. Rapport RH — imprimable, fin de mois (§29)
// ==========================================
const RAPPORT_MOIS_LABELS = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function buildRapportRH(state, month, year, teamId) {
  const planning = PlanningEngine.generateMonthlyPlanning(month, year, state);
  const firstIso = planning.days[0].iso;
  const lastIso = planning.days[planning.days.length - 1].iso;

  const drivers = state.drivers.filter(d => d.actif !== false && (teamId === "all" || d.teamId === teamId));

  const rows = drivers.map(driver => {
    const counts = { PRESENT: 0, REPOS: 0, CONGE: 0, MALADIE: 0, ABSENCE: 0, FORMATION: 0, OFF: 0, FERIE: 0 };
    planning.days.forEach(day => {
      const a = day.assignments.find(x => x.driverId === driver.id);
      if (a) counts[a.status] = (counts[a.status] || 0) + 1;
    });

    const exceptions = state.heuresExceptionnelles.filter(r => r.driverId === driver.id && r.dateDebut >= firstIso && r.dateDebut <= lastIso);
    const byType = { DOUBLAGE: { jours: 0, heures: 0 }, FERIE_TRAVAILLE: { jours: 0, heures: 0 }, DIMANCHE_S3: { jours: 0, heures: 0 } };
    let totalHeures = 0;
    exceptions.forEach(r => {
      if (!byType[r.type]) return;
      byType[r.type].jours++;
      byType[r.type].heures += Number(r.heures) || 0;
      totalHeures += Number(r.heures) || 0;
    });

    const team = state.teams.find(t => t.id === driver.teamId);
    return { driver: driver, teamNom: team ? team.nom : driver.teamId, counts: counts, byType: byType, totalHeures: totalHeures };
  });

  return { planning: planning, rows: rows };
}

// Rapport jours fériés travaillés & 3ème shift dimanche (§29/§31) — recense les
// dérogations "nécessité de service" du mois, avec les mouvements réalisés
// pour chaque jour férié travaillé (cf. FerieMouvementsPanel, pages.js).
function buildRapportFeriesS3(state, month, year, teamId) {
  const prefix = year + "-" + String(month).padStart(2, "0");
  const records = state.heuresExceptionnelles
    .filter(r => (r.type === "FERIE_TRAVAILLE" || r.type === "DIMANCHE_S3") && r.dateDebut.slice(0, 7) === prefix)
    .filter(r => {
      if (teamId === "all") return true;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      return d && d.teamId === teamId;
    })
    .slice().sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));

  const rows = records.map(r => {
    const driver = state.drivers.find(d => d.id === r.driverId);
    const team = driver ? state.teams.find(t => t.id === driver.teamId) : null;
    const mouvement = r.type === "FERIE_TRAVAILLE" ? RTGStore.getFerieMouvements(r.dateDebut, r.driverId) : null;
    return {
      record: r, driver: driver, teamNom: team ? team.nom : (driver ? driver.teamId : ""),
      mouvements: mouvement ? mouvement.mouvements : null,
      mouvementCommentaire: mouvement ? mouvement.commentaire || "" : ""
    };
  });

  return {
    rows: rows,
    totalFerie: rows.filter(r => r.record.type === "FERIE_TRAVAILLE").length,
    totalS3: rows.filter(r => r.record.type === "DIMANCHE_S3").length,
    totalMouvements: rows.reduce((sum, r) => sum + (r.mouvements || 0), 0)
  };
}

function RapportRHPage() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  const now = new Date();
  const [tab, setTab] = useState("rh");
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState(shiftRestricted ? currentUser.teamId : "all");
  const effectiveTeamId = shiftRestricted ? currentUser.teamId : teamId;
  // Filtre "Jour" — uniquement pertinent pour l'onglet Mouvements RTG (les
  // autres rapports sont des cumuls mensuels par nature) : "all" garde tout
  // le mois, sinon restreint à une seule journée.
  const [day, setDay] = useState("all");
  const dayIso = day === "all" ? null : RTGDate.toISO(RTGDate.makeDate(year, month, Number(day)));

  const report = useMemo(() => buildRapportRH(state, month, year, effectiveTeamId), [state, month, year, effectiveTeamId]);
  const feriesReport = useMemo(() => buildRapportFeriesS3(state, month, year, effectiveTeamId), [state, month, year, effectiveTeamId]);
  const generatedAt = new Date();

  // Onglet "Mouvements RTG" : total par conducteur (import automatique TOS),
  // sur le même mois/équipe que les autres onglets de cette page.
  const [mvtRows, setMvtRows] = useState([]);
  const [mvtLoading, setMvtLoading] = useState(false);
  const [mvtError, setMvtError] = useState("");
  useEffect(() => {
    if (tab !== "mouvements") return;
    setMvtLoading(true);
    setMvtError("");
    const dim = RTGDate.daysInMonth(month, year);
    const dateFrom = RTGDate.toISO(RTGDate.makeDate(year, month, 1));
    const dateTo = RTGDate.toISO(RTGDate.makeDate(year, month, dim));
    RTGStore.fetchMouvementsTos({ dateFrom, dateTo })
      .then(setMvtRows)
      .catch(e => setMvtError(e && e.message ? e.message : "Chargement impossible."))
      .finally(() => setMvtLoading(false));
  }, [tab, month, year]);

  useEffect(() => { setDay("all"); }, [month, year]);

  const mvtReport = useMemo(() => {
    const map = {};
    mvtRows.forEach(r => {
      if (dayIso && r.dateTravail !== dayIso) return;
      const d = r.driverId ? state.drivers.find(dr => dr.id === r.driverId) : null;
      if (effectiveTeamId !== "all" && (!d || d.teamId !== effectiveTeamId)) return;
      const key = r.driverId || ("_" + r.loginTos);
      if (!map[key]) {
        map[key] = { driverId: r.driverId, loginTos: r.loginTos, nombreIn: 0, nombreOut: 0, nombreMove: 0, nombreShifting: 0, nombreDisch: 0, nombreLoad: 0, nombreAutre: 0, totalMvmt: 0 };
      }
      MOUVEMENTS_TOS_COLUMNS.forEach(c => { map[key][c.key] += r[c.key] || 0; });
      map[key].totalMvmt += r.totalMvmt || 0;
    });
    const rows = Object.values(map).sort((a, b) => {
      const da = a.driverId ? state.drivers.find(d => d.id === a.driverId) : null;
      const db = b.driverId ? state.drivers.find(d => d.id === b.driverId) : null;
      return (da ? da.matricule : "zzz").localeCompare(db ? db.matricule : "zzz");
    });
    return { rows, total: rows.reduce((s, r) => s + r.totalMvmt, 0) };
  }, [mvtRows, state.drivers, effectiveTeamId, dayIso]);

  const th = "px-2 py-2 text-left font-semibold border-b-2 border-slate-300 whitespace-nowrap";
  const td = "px-2 py-1.5 border-b border-slate-200 whitespace-nowrap";
  const tdCenter = td + " text-center";

  const exportExcel = () => {
    if (tab === "mouvements") {
      const headers = ["Mat", "Nom", "Prénom", "Équipe"].concat(MOUVEMENTS_TOS_COLUMNS.map(c => c.label)).concat(["Total"]);
      const rows = mvtReport.rows.map(g => {
        const d = g.driverId ? state.drivers.find(dr => dr.id === g.driverId) : null;
        const teamNom = d ? ((state.teams.find(t => t.id === d.teamId) || {}).nom || "") : "";
        return [d ? d.matricule : "", d ? d.nom : "", d ? d.prenom : (g.loginTos + " (non rattaché)"), teamNom]
          .concat(MOUVEMENTS_TOS_COLUMNS.map(c => g[c.key]))
          .concat([g.totalMvmt]);
      });
      downloadCSV(`mouvements-rtg-${dayIso || (RAPPORT_MOIS_LABELS[month - 1] + "-" + year)}.csv`, headers, rows);
      return;
    }
    if (tab === "feries") {
      const headers = ["Date", "Mat", "Nom", "Prénom", "Équipe", "Type", "Heures", "Mouvements réalisés", "Commentaire"];
      const rows = feriesReport.rows.map(r => [
        r.record.dateDebut, r.driver ? r.driver.matricule : "", r.driver ? r.driver.nom : "", r.driver ? r.driver.prenom : "", r.teamNom,
        r.record.type === "FERIE_TRAVAILLE" ? "Férié travaillé" : "3ème shift dimanche", r.record.heures,
        r.record.type === "FERIE_TRAVAILLE" ? (r.mouvements != null ? r.mouvements : "") : "",
        r.record.type === "FERIE_TRAVAILLE" ? (r.mouvementCommentaire || r.record.commentaire || "") : (r.record.commentaire || "")
      ]);
      downloadCSV(`jours-feries-3eme-shift-${RAPPORT_MOIS_LABELS[month - 1]}-${year}.csv`, headers, rows);
      return;
    }
    const headers = ["Mat", "Nom", "Prénom", "Équipe", "Présents", "Repos", "Congés", "Maladies", "Absences", "Formations", "Doublage (h)", "Férié travaillé (j)", "Férié travaillé (h)", "Dim. 3ème shift (j)", "Dim. 3ème shift (h)", "Total Over Time (h)"];
    const rows = report.rows.map(r => [
      r.driver.matricule, r.driver.nom, r.driver.prenom, r.teamNom, r.counts.PRESENT, r.counts.REPOS, r.counts.CONGE, r.counts.MALADIE, r.counts.ABSENCE, r.counts.FORMATION,
      r.byType.DOUBLAGE.heures, r.byType.FERIE_TRAVAILLE.jours, r.byType.FERIE_TRAVAILLE.heures, r.byType.DIMANCHE_S3.jours, r.byType.DIMANCHE_S3.heures, r.totalHeures
    ]);
    downloadCSV(`rapport-rh-${RAPPORT_MOIS_LABELS[month - 1]}-${year}.csv`, headers, rows);
  };

  const printRef = useRef(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const exportPdf = async () => {
    if (!printRef.current) return;
    setPdfBusy(true);
    try {
      const filename = tab === "feries"
        ? `jours-feries-3eme-shift-${RAPPORT_MOIS_LABELS[month - 1]}-${year}.pdf`
        : tab === "mouvements"
        ? `mouvements-rtg-${dayIso || (RAPPORT_MOIS_LABELS[month - 1] + "-" + year)}.pdf`
        : `rapport-rh-${RAPPORT_MOIS_LABELS[month - 1]}-${year}.pdf`;
      await exportNodeAsPdf(printRef.current, filename);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Rapports</h1>
          <p className="text-slate-400 text-sm mt-0.5">Rapports mensuels à imprimer / envoyer au service RH</p>
        </div>
        <div className="flex gap-2">
          <ExportPdfButton onClick={exportPdf} busy={pdfBusy} />
          <ExportExcelButton onClick={exportExcel} />
        </div>
      </div>

      <div className="flex gap-2 print:hidden">
        <button onClick={() => setTab("rh")} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "rh" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Rapport RH</button>
        <button onClick={() => setTab("feries")} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "feries" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Jours fériés &amp; 3ème shift dimanche</button>
        <button onClick={() => setTab("mouvements")} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "mouvements" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Mouvements RTG</button>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4 print:hidden">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
        {tab === "mouvements" && (
        <div>
          <label className={LABEL_CLS}>Jour</label>
          <select value={day} onChange={e => setDay(e.target.value)} className={FIELD_CLS}>
            <option value="all">Tout le mois</option>
            {Array.from({ length: RTGDate.daysInMonth(month, year) }, (_, i) => i + 1).map(d => (
              <option key={d} value={d}>{String(d).padStart(2, "0")}</option>
            ))}
          </select>
        </div>
        )}
        {!shiftRestricted && (
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select value={teamId} onChange={e => setTeamId(e.target.value)} className={FIELD_CLS}>
            <option value="all">Toutes les équipes</option>
            {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </div>
        )}
      </div>

      {/* Contenu imprimable : style "papier" clair, indépendant du thème sombre de l'appli. */}
      {tab === "rh" && (
      <div ref={printRef} className="bg-white text-slate-900 rounded-xl border border-slate-300 p-4 sm:p-6 print:rounded-none print:border-0 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
          <div className="flex items-center gap-3">
            <img src="icons/tc3pc-logo.jpg" alt="TC3PC" className="h-9 w-auto shrink-0" />
            <div>
              <div className="text-base sm:text-lg font-bold">TC3PC — Terminal à Conteneurs 3 du Port de Casablanca <span className="font-normal text-slate-500">(filiale de Marsa Maroc)</span></div>
              <div className="text-xs sm:text-sm text-slate-600">Rapport RH — Conducteurs RTG — {RAPPORT_MOIS_LABELS[month - 1]} {year}{effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : ""}</div>
            </div>
          </div>
          <div className="sm:text-right text-xs text-slate-500">
            <div>Généré le {generatedAt.toLocaleDateString("fr-FR")} à {generatedAt.toLocaleTimeString("fr-FR")}</div>
            <div>{report.rows.length} conducteur{report.rows.length > 1 ? "s" : ""}</div>
          </div>
        </div>

        <p className="sm:hidden print:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir toutes les colonnes</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={th}>Mat</th>
                <th className={th}>Nom</th>
                <th className={th}>Prénom</th>
                <th className={th}>Équipe</th>
                <th className={th}>Présents</th>
                <th className={th}>Repos</th>
                <th className={th}>Congés</th>
                <th className={th}>Maladies</th>
                <th className={th}>Absences</th>
                <th className={th}>Formations</th>
                <th className={th}>Doublage (h)</th>
                <th className={th}>Férié travaillé (j/h)</th>
                <th className={th}>Dim. 3ème shift (j/h)</th>
                <th className={th}>Total Over Time (h)</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map(r => (
                <tr key={r.driver.id}>
                  <td className={td}>{r.driver.matricule}</td>
                  <td className={td + " font-medium"}>{r.driver.nom}</td>
                  <td className={td}>{r.driver.prenom}</td>
                  <td className={td}>{r.teamNom}</td>
                  <td className={tdCenter}>{r.counts.PRESENT}</td>
                  <td className={tdCenter}>{r.counts.REPOS}</td>
                  <td className={tdCenter}>{r.counts.CONGE}</td>
                  <td className={tdCenter}>{r.counts.MALADIE}</td>
                  <td className={tdCenter}>{r.counts.ABSENCE}</td>
                  <td className={tdCenter}>{r.counts.FORMATION}</td>
                  <td className={tdCenter}>{r.byType.DOUBLAGE.heures || "—"}</td>
                  <td className={tdCenter}>{r.byType.FERIE_TRAVAILLE.jours ? `${r.byType.FERIE_TRAVAILLE.jours} / ${r.byType.FERIE_TRAVAILLE.heures}h` : "—"}</td>
                  <td className={tdCenter}>{r.byType.DIMANCHE_S3.jours ? `${r.byType.DIMANCHE_S3.jours} / ${r.byType.DIMANCHE_S3.heures}h` : "—"}</td>
                  <td className={tdCenter + " font-semibold"}>{r.totalHeures || "—"}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr><td colSpan="14" className="px-2 py-6 text-center text-slate-500 italic">Aucun conducteur pour cette sélection.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
          Document généré automatiquement par CES Driver Planner — à valider par le Responsable Exploitation avant transmission au Service RH.
        </div>
      </div>
      )}

      {tab === "feries" && (
      <div ref={printRef} className="bg-white text-slate-900 rounded-xl border border-slate-300 p-4 sm:p-6 print:rounded-none print:border-0 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
          <div className="flex items-center gap-3">
            <img src="icons/tc3pc-logo.jpg" alt="TC3PC" className="h-9 w-auto shrink-0" />
            <div>
              <div className="text-base sm:text-lg font-bold">TC3PC — Terminal à Conteneurs 3 du Port de Casablanca <span className="font-normal text-slate-500">(filiale de Marsa Maroc)</span></div>
              <div className="text-xs sm:text-sm text-slate-600">Jours fériés travaillés &amp; 3ème shift dimanche — RTG — {RAPPORT_MOIS_LABELS[month - 1]} {year}{effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : ""}</div>
            </div>
          </div>
          <div className="sm:text-right text-xs text-slate-500">
            <div>Généré le {generatedAt.toLocaleDateString("fr-FR")} à {generatedAt.toLocaleTimeString("fr-FR")}</div>
            <div>{feriesReport.totalFerie} jour(s) férié(s) travaillé(s) · {feriesReport.totalS3} 3ème shift dimanche</div>
          </div>
        </div>

        <p className="sm:hidden print:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir toutes les colonnes</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Mat</th>
                <th className={th}>Nom</th>
                <th className={th}>Prénom</th>
                <th className={th}>Équipe</th>
                <th className={th}>Type</th>
                <th className={th}>Heures</th>
                <th className={th}>Mouvements réalisés</th>
                <th className={th}>Commentaire</th>
              </tr>
            </thead>
            <tbody>
              {feriesReport.rows.map(r => (
                <tr key={r.record.id}>
                  <td className={td}>{r.record.dateDebut}</td>
                  <td className={td}>{r.driver ? r.driver.matricule : "—"}</td>
                  <td className={td + " font-medium"}>{r.driver ? r.driver.nom : "—"}</td>
                  <td className={td}>{r.driver ? r.driver.prenom : ""}</td>
                  <td className={td}>{r.teamNom}</td>
                  <td className={td}>{r.record.type === "FERIE_TRAVAILLE" ? "Férié travaillé" : "3ème shift dimanche"}</td>
                  <td className={tdCenter}>{r.record.heures}h</td>
                  <td className={tdCenter}>{r.record.type === "FERIE_TRAVAILLE" ? (r.mouvements != null ? r.mouvements : "—") : "—"}</td>
                  <td className={td}>{r.record.type === "FERIE_TRAVAILLE" ? (r.mouvementCommentaire || r.record.commentaire || "") : (r.record.commentaire || "")}</td>
                </tr>
              ))}
              {feriesReport.rows.length === 0 && (
                <tr><td colSpan="9" className="px-2 py-6 text-center text-slate-500 italic">Aucun jour férié travaillé ni 3ème shift dimanche pour cette sélection.</td></tr>
              )}
            </tbody>
            {feriesReport.rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan="6" className={td + " text-right font-semibold"}>Total mouvements réalisés (jours fériés) :</td>
                  <td colSpan="3" className={td + " font-semibold"}>{feriesReport.totalMouvements}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="mt-6 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
          Document généré automatiquement par CES Driver Planner — à valider par le Responsable Exploitation avant transmission au Service RH.
        </div>
      </div>
      )}

      {tab === "mouvements" && (
      <div ref={printRef} className="bg-white text-slate-900 rounded-xl border border-slate-300 p-4 sm:p-6 print:rounded-none print:border-0 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
          <div className="flex items-center gap-3">
            <img src="icons/tc3pc-logo.jpg" alt="TC3PC" className="h-9 w-auto shrink-0" />
            <div>
              <div className="text-base sm:text-lg font-bold">TC3PC — Terminal à Conteneurs 3 du Port de Casablanca <span className="font-normal text-slate-500">(filiale de Marsa Maroc)</span></div>
              <div className="text-xs sm:text-sm text-slate-600">Mouvements RTG (import TOS) — {dayIso ? RTGDate.formatFr(RTGDate.parseISO(dayIso)) : RAPPORT_MOIS_LABELS[month - 1] + " " + year}{effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : ""}</div>
            </div>
          </div>
          <div className="sm:text-right text-xs text-slate-500">
            <div>Généré le {generatedAt.toLocaleDateString("fr-FR")} à {generatedAt.toLocaleTimeString("fr-FR")}</div>
            <div>{mvtReport.rows.length} conducteur{mvtReport.rows.length > 1 ? "s" : ""} · {mvtReport.total} mouvement{mvtReport.total > 1 ? "s" : ""}</div>
          </div>
        </div>

        {mvtError && <div className="text-xs text-red-600 mb-2">{mvtError}</div>}
        <p className="sm:hidden print:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir toutes les colonnes</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className={th}>Mat</th>
                <th className={th}>Nom</th>
                <th className={th}>Prénom</th>
                <th className={th}>Équipe</th>
                {MOUVEMENTS_TOS_COLUMNS.map(c => <th key={c.key} className={th}>{c.label}</th>)}
                <th className={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {mvtLoading && (
                <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 5} className="px-2 py-6 text-center text-slate-500 italic">Chargement...</td></tr>
              )}
              {!mvtLoading && mvtReport.rows.map(g => {
                const d = g.driverId ? state.drivers.find(dr => dr.id === g.driverId) : null;
                const teamNom = d ? ((state.teams.find(t => t.id === d.teamId) || {}).nom || "") : "";
                return (
                  <tr key={g.driverId || g.loginTos}>
                    <td className={td}>{d ? d.matricule : g.loginTos}</td>
                    <td className={td + " font-medium"}>{d ? d.nom : "(non rattaché)"}</td>
                    <td className={td}>{d ? d.prenom : ""}</td>
                    <td className={td}>{teamNom}</td>
                    {MOUVEMENTS_TOS_COLUMNS.map(c => <td key={c.key} className={tdCenter}>{g[c.key]}</td>)}
                    <td className={tdCenter + " font-semibold"}>{g.totalMvmt}</td>
                  </tr>
                );
              })}
              {!mvtLoading && mvtReport.rows.length === 0 && (
                <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 5} className="px-2 py-6 text-center text-slate-500 italic">Aucun mouvement importé pour cette sélection.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
          Document généré automatiquement par CES Driver Planner (import TOS) — à valider par le Responsable Exploitation avant transmission au Service RH.
        </div>
      </div>
      )}
    </div>
  );
}

// ==========================================
// 8. Utilisateurs (§30) — réservé au rôle ADMIN
// ==========================================
const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Administrateur — accès complet + gestion des utilisateurs" },
  { value: "RESPONSABLE", label: "Responsable — accès opérationnel complet, toutes équipes" },
  { value: "RESPONSABLE_SHIFT", label: "Responsable de Shift — accès limité à SON équipe" },
  { value: "CONDUCTEUR", label: "Conducteur — accès à SON planning uniquement" }
];

function emptyUserForm(defaultTeamId) {
  return { nom: "", username: "", password: "", role: "RESPONSABLE_SHIFT", teamId: defaultTeamId || "", driverId: "", email: "" };
}

function UserForm({ state, initial, editingId, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.nom.trim() || !form.username.trim()) { setError("Nom et identifiant sont obligatoires."); return; }
    if (!editingId && !form.password) { setError("Mot de passe obligatoire à la création."); return; }
    if (RTGStore.isUsernameTaken(form.username.trim(), editingId)) { setError("Cet identifiant est déjà utilisé."); return; }
    if (form.role === "RESPONSABLE_SHIFT" && !form.teamId) { setError("Sélectionnez l'équipe pour un Responsable de Shift."); return; }
    if (form.role === "CONDUCTEUR") {
      if (!form.driverId) { setError("Sélectionnez le conducteur rattaché à ce compte."); return; }
      const already = state.users.find(u => u.driverId === form.driverId && u.id !== editingId);
      if (already) { setError("Ce conducteur a déjà un compte (" + already.username + ")."); return; }
    }

    const payload = {
      nom: form.nom.trim(), username: form.username.trim(), role: form.role,
      teamId: form.role === "RESPONSABLE_SHIFT" ? form.teamId : null,
      driverId: form.role === "CONDUCTEUR" ? form.driverId : null,
      email: form.role === "CONDUCTEUR" ? null : (form.email || "").trim()
    };
    if (form.password) payload.password = form.password;

    setSaving(true);
    try {
      if (editingId) {
        await RTGStore.updateUser(editingId, payload);
      } else {
        await RTGStore.addUser(payload);
      }
      onSaved();
    } catch (err) {
      setError("Erreur d'enregistrement : " + (err && err.message ? err.message : "réessayez."));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={LABEL_CLS}>Nom complet</label><input className={FIELD_CLS} value={form.nom} onChange={e => setForm(f => Object.assign({}, f, { nom: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Identifiant</label><input className={FIELD_CLS} value={form.username} onChange={e => setForm(f => Object.assign({}, f, { username: e.target.value }))} /></div>
        <div>
          <label className={LABEL_CLS}>Mot de passe{editingId ? " (laisser vide pour ne pas changer)" : ""}</label>
          <input type="password" className={FIELD_CLS} value={form.password} onChange={e => setForm(f => Object.assign({}, f, { password: e.target.value }))} />
        </div>
        <div>
          <label className={LABEL_CLS}>Rôle</label>
          <select className={FIELD_CLS} value={form.role} onChange={e => setForm(f => Object.assign({}, f, { role: e.target.value }))}>
            {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {form.role === "RESPONSABLE_SHIFT" && (
          <div>
            <label className={LABEL_CLS}>Équipe / Shift</label>
            <select className={FIELD_CLS} value={form.teamId} onChange={e => setForm(f => Object.assign({}, f, { teamId: e.target.value }))}>
              <option value="">— Sélectionner —</option>
              {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
          </div>
        )}
        {form.role !== "CONDUCTEUR" && (
          <div>
            <label className={LABEL_CLS}>Email (pour "mot de passe oublié")</label>
            <input type="email" className={FIELD_CLS} value={form.email} onChange={e => setForm(f => Object.assign({}, f, { email: e.target.value }))} />
          </div>
        )}
        {form.role === "CONDUCTEUR" && (
          <div>
            <label className={LABEL_CLS}>Conducteur</label>
            <DriverSelect state={state} value={form.driverId} onlyActive
              onChange={id => setForm(f => {
                const driver = state.drivers.find(d => d.id === id);
                const next = Object.assign({}, f, { driverId: id });
                // Identifiant suggéré à partir du matricule — seulement si le
                // champ n'a pas déjà été modifié manuellement, pour ne jamais
                // écraser une saisie volontaire.
                if (driver && !f.username.trim()) next.username = driver.matricule.toLowerCase();
                return next;
              })} />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">{saving ? "Enregistrement..." : (editingId ? "Enregistrer" : "Créer l'utilisateur")}</button>
        <button onClick={onCancel} disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </div>
    </div>
  );
}

// Mot de passe temporaire lisible (évite les caractères ambigus 0/O, 1/l/I)
// à communiquer au conducteur — il pourra le changer une fois connecté.
function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Création en masse d'un compte CONDUCTEUR pour chaque conducteur actif qui
// n'en a pas encore — identifiant = matricule (minuscules), mot de passe
// temporaire généré. Les mots de passe ne sont récupérables qu'une seule
// fois (Supabase Auth ne les stocke pas en clair) : affichés + exportables
// en CSV juste après la création, pour être distribués aux conducteurs.
const RTG_SLEEP = ms => new Promise(r => setTimeout(r, ms));
function isRateLimitError(e) {
  const msg = ((e && e.message) || "").toLowerCase();
  return msg.indexOf("rate limit") !== -1 || msg.indexOf("too many requests") !== -1 || msg.indexOf("429") !== -1;
}

function ConducteurAccountsPanel({ state }) {
  const driverIdsWithAccount = {};
  state.users.forEach(u => { if (u.driverId) driverIdsWithAccount[u.driverId] = true; });
  const missing = state.drivers.filter(d => d.actif !== false && !driverIdsWithAccount[d.id]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [emailStatus, setEmailStatus] = useState({}); // matricule -> "sending" | "sent" | "error"
  const [emailBusy, setEmailBusy] = useState(false);

  // Supabase Auth limite le nombre d'inscriptions par fenêtre de temps —
  // avec ~40 conducteurs créés d'affilée sans pause, la limite est atteinte
  // en cours de route (observé en usage réel). Un délai entre chaque compte
  // + des nouvelles tentatives avec attente croissante en cas de "rate
  // limit" évitent d'interrompre la création à mi-chemin ; en dernier
  // recours, ré-cliquer sur le bouton reprend uniquement les conducteurs
  // encore sans compte (liste "missing" recalculée à chaque rendu).
  const createAll = async () => {
    setBusy(true); setError(""); setResults([]); setProgress({ done: 0, total: missing.length });
    const created = [];
    for (const d of missing) {
      const username = d.matricule.toLowerCase();
      if (RTGStore.isUsernameTaken(username)) { setProgress(p => Object.assign({}, p, { done: p.done + 1 })); continue; }
      const password = generateTempPassword();
      let attempt = 0;
      let ok = false;
      while (!ok) {
        try {
          const newUser = await RTGStore.addUser({ nom: d.nom + " " + d.prenom, username: username, password: password, role: "CONDUCTEUR", driverId: d.id });
          created.push({ matricule: d.matricule, nom: d.nom, prenom: d.prenom, username: username, password: password, email: d.email || "", userId: newUser.id });
          ok = true;
        } catch (e) {
          if (isRateLimitError(e) && attempt < 4) {
            attempt++;
            const wait = 5000 * attempt;
            setError("Limite de débit Supabase atteinte — nouvelle tentative dans " + (wait / 1000) + "s pour " + d.matricule + "...");
            await RTG_SLEEP(wait);
            continue;
          }
          setError("Échec pour " + d.matricule + " — " + d.nom + " " + d.prenom + " : " + (e && e.message ? e.message : "erreur inconnue") + ". Arrêt (les comptes déjà créés ci-dessous sont bien enregistrés — recliquez sur le bouton pour reprendre là où ça s'est arrêté).");
          setResults(created);
          setProgress(null);
          setBusy(false);
          return;
        }
      }
      setProgress(p => Object.assign({}, p, { done: p.done + 1 }));
      await RTG_SLEEP(1500);
    }
    setError("");
    setResults(created);
    setProgress(null);
    setBusy(false);
  };

  const downloadCsv = () => {
    downloadCSV("comptes-conducteurs.csv", ["Matricule", "Nom", "Prénom", "Identifiant", "Mot de passe"],
      results.map(r => [r.matricule, r.nom, r.prenom, r.username, r.password]));
  };

  const sendOne = async r => {
    if (!r.email) return;
    setEmailStatus(s => Object.assign({}, s, { [r.matricule]: "sending" }));
    try {
      await RTGStore.sendCredentialsEmail({ to: r.email, driverName: r.nom + " " + r.prenom, username: r.username, password: r.password, userId: r.userId });
      setEmailStatus(s => Object.assign({}, s, { [r.matricule]: "sent" }));
    } catch (e) {
      console.error(e);
      setEmailStatus(s => Object.assign({}, s, { [r.matricule]: "error" }));
    }
  };

  const sendAll = async () => {
    setEmailBusy(true);
    for (const r of results) {
      if (r.email && emailStatus[r.matricule] !== "sent") await sendOne(r);
    }
    setEmailBusy(false);
  };

  const withEmail = results.filter(r => r.email);

  return (
    <Panel title="Comptes conducteurs" icon="fa-id-card">
      <p className="text-xs text-slate-400 mb-3">
        {missing.length === 0
          ? "Tous les conducteurs actifs ont déjà un compte."
          : missing.length + " conducteur(s) actif(s) sans compte. L'identifiant sera son matricule (en minuscules) et un mot de passe temporaire sera généré pour chacun, à communiquer au conducteur — il pourra le changer une fois connecté."}
      </p>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {missing.length > 0 && (
        <button onClick={createAll} disabled={busy} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60 mb-3">
          {busy ? `Création en cours... (${progress ? progress.done : 0}/${progress ? progress.total : missing.length})` : `Créer les ${missing.length} compte(s) manquant(s)`}
        </button>
      )}
      {results.length > 0 && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <p className="text-xs text-emerald-400"><i className="fas fa-circle-check mr-1"></i>{results.length} compte(s) créé(s) — notez ces mots de passe, ils ne seront plus jamais affichés ensuite.</p>
            <div className="flex gap-2">
              {withEmail.length > 0 && (
                <button onClick={sendAll} disabled={emailBusy} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
                  <i className="fas fa-paper-plane mr-1.5"></i>{emailBusy ? "Envoi en cours..." : `Envoyer les identifiants par email (${withEmail.length})`}
                </button>
              )}
              <button onClick={downloadCsv} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-marine-700 text-white hover:bg-marine-600">
                <i className="fas fa-download mr-1.5"></i>Télécharger (CSV)
              </button>
            </div>
          </div>
          {results.some(r => !r.email) && (
            <p className="text-xs text-amber-400 mb-2"><i className="fas fa-triangle-exclamation mr-1"></i>{results.filter(r => !r.email).length} conducteur(s) sans email personnel renseigné — identifiants à leur communiquer autrement.</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-surface text-slate-400">
                <tr className="text-left"><th className="px-3 py-2">Matricule</th><th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Identifiant</th><th className="px-3 py-2">Mot de passe</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Envoi</th></tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.matricule} className="border-t border-border">
                    <td className="px-3 py-2 text-slate-300">{r.matricule}</td>
                    <td className="px-3 py-2 text-white">{r.nom} {r.prenom}</td>
                    <td className="px-3 py-2 text-slate-300">{r.username}</td>
                    <td className="px-3 py-2 text-slate-300 font-mono">{r.password}</td>
                    <td className="px-3 py-2 text-slate-400">{r.email || "—"}</td>
                    <td className="px-3 py-2">
                      {!r.email ? (
                        <span className="text-slate-600">—</span>
                      ) : emailStatus[r.matricule] === "sent" ? (
                        <span className="text-emerald-400"><i className="fas fa-circle-check mr-1"></i>Envoyé</span>
                      ) : emailStatus[r.matricule] === "sending" ? (
                        <span className="text-slate-400">Envoi...</span>
                      ) : (
                        <button onClick={() => sendOne(r)} className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-marine-700 text-white hover:bg-marine-600">
                          {emailStatus[r.matricule] === "error" ? "Réessayer" : "Envoyer"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}

function UsersPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  // La liste des comptes reste volontairement non filtrée par flotte (un
  // ADMIN gère tous les comptes RTG et CC au même endroit) — seuls les
  // sélecteurs équipe/conducteur du formulaire de création respectent la
  // bascule RTG/CC, pour proposer par défaut les équipes/conducteurs de la
  // flotte actuellement affichée.
  const fTeams = fleetTeams(state, null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const formState = useMemo(() => Object.assign({}, state, {
    teams: fTeams,
    drivers: state.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [state, fTeams]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [resendStatus, setResendStatus] = useState({}); // userId -> "sending" | "sent" | "error"
  const [resendError, setResendError] = useState({}); // userId -> message d'erreur

  const resendCredentials = async u => {
    setResendStatus(s => Object.assign({}, s, { [u.id]: "sending" }));
    setResendError(s => Object.assign({}, s, { [u.id]: "" }));
    try {
      await RTGStore.resetAndSendCredentials(u.id);
      setResendStatus(s => Object.assign({}, s, { [u.id]: "sent" }));
    } catch (e) {
      console.error(e);
      setResendStatus(s => Object.assign({}, s, { [u.id]: "error" }));
      setResendError(s => Object.assign({}, s, { [u.id]: (e && e.message) || "Erreur inconnue." }));
    }
  };

  if (!currentUser || currentUser.role !== "ADMIN") {
    return (
      <div className="space-y-4 fade-in">
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
          <i className="fas fa-lock"></i> Cette page est réservée aux administrateurs.
        </div>
      </div>
    );
  }

  const editingUser = editingId ? state.users.find(u => u.id === editingId) : null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Utilisateurs</h1>
          <p className="text-slate-400 text-sm mt-0.5">{state.users.length} compte{state.users.length > 1 ? "s" : ""} — Admin, Responsable, Responsable de Shift, Conducteur</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouvel utilisateur
        </button>
      </div>

      <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
        <i className="fas fa-shield-halved mr-1.5"></i>Comptes et données hébergés sur Supabase (PostgreSQL + Auth) : les permissions de chaque rôle sont vérifiées côté base (Row Level Security), pas seulement par cette interface.
      </p>

      <Panel title="Sauvegarde des données" icon="fa-download">
        <p className="text-xs text-slate-400 mb-3">Télécharge une copie complète des données actuelles de cet appareil (conducteurs, congés, maladies, absences, Over Time, utilisateurs, historique...) dans un fichier JSON. À faire avant toute migration ou changement important.</p>
        <button onClick={() => {
          const json = JSON.stringify(state, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `rtg-sauvegarde-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-700 text-white hover:bg-marine-600">
          <i className="fas fa-download mr-1.5"></i>Télécharger la sauvegarde (JSON)
        </button>
      </Panel>

      <ConducteurAccountsPanel state={formState} />

      {showForm && (
        <Panel title={editingId ? "Modifier l'utilisateur" : "Nouvel utilisateur"} icon="fa-user-shield">
          <UserForm state={formState} editingId={editingId}
            initial={editingUser ? { nom: editingUser.nom, username: editingUser.username, password: "", role: editingUser.role, teamId: editingUser.teamId || (formState.teams[0] ? formState.teams[0].id : ""), driverId: editingUser.driverId || "", email: editingUser.email || "" } : emptyUserForm(formState.teams[0] ? formState.teams[0].id : "")}
            onCancel={() => { setShowForm(false); setEditingId(null); }} onSaved={() => { setShowForm(false); setEditingId(null); }} />
        </Panel>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Nom</th><th className="px-3 py-2">Identifiant</th><th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Équipe / Conducteur</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.users.map(u => {
              const team = u.teamId ? state.teams.find(t => t.id === u.teamId) : null;
              const driver = u.driverId ? state.drivers.find(d => d.id === u.driverId) : null;
              const isSelf = currentUser.id === u.id;
              const targetEmail = driver ? driver.email : u.email;
              const resendState = resendStatus[u.id];
              return (
                <tr key={u.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white font-medium">{u.nom}{isSelf ? <span className="text-slate-500"> (vous)</span> : ""}</td>
                  <td className="px-3 py-2 text-slate-300">{u.username}</td>
                  <td className="px-3 py-2 text-slate-400">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="px-3 py-2 text-slate-400">{team ? team.nom : (driver ? driver.matricule + " — " + driver.nom + " " + driver.prenom : "—")}</td>
                  <td className="px-3 py-2">
                    {u.actif !== false
                      ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Actif</span>
                      : <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">Inactif</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => { setEditingId(u.id); setShowForm(true); }} className="text-orange-400 hover:text-orange-300">Modifier</button>
                      {u.actif !== false
                        ? <ConfirmButton label="Désactiver" confirmLabel={isSelf ? "Vous déconnecter ?" : "Désactiver ?"} onConfirm={() => RTGStore.setUserActive(u.id, false)} className="text-red-400 hover:text-red-300 text-xs" />
                        : <ConfirmButton label="Réactiver" confirmLabel="Réactiver ?" onConfirm={() => RTGStore.setUserActive(u.id, true)} className="text-emerald-400 hover:text-emerald-300 text-xs" />}
                      {!isSelf && <ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => RTGStore.deleteUser(u.id)} className="text-red-400 hover:text-red-300 text-xs" />}
                      {u.actif !== false && targetEmail && (
                        resendState === "sending" ? (
                          <span className="text-slate-400">Envoi...</span>
                        ) : u.credentialsSentAt && resendState !== "error" ? (
                          <span className="text-emerald-400" title={"Identifiants envoyés le " + new Date(u.credentialsSentAt).toLocaleString("fr-FR")}>
                            <i className="fas fa-circle-check mr-1"></i>Envoyé le {new Date(u.credentialsSentAt).toLocaleDateString("fr-FR")}
                          </span>
                        ) : (
                          <ConfirmButton
                            label={resendState === "error" ? "Réessayer" : "Renvoyer identifiants"}
                            confirmLabel={"Générer un nouveau mot de passe et l'envoyer à " + targetEmail + " ?"}
                            onConfirm={() => resendCredentials(u)}
                            className="text-sky-400 hover:text-sky-300 text-xs" />
                        )
                      )}
                      {u.actif !== false && targetEmail && u.credentialsSentAt && resendState !== "error" && resendState !== "sending" && (
                        <ConfirmButton
                          label="Renvoyer"
                          confirmLabel={"Générer un nouveau mot de passe et le renvoyer à " + targetEmail + " ?"}
                          onConfirm={() => resendCredentials(u)}
                          className="text-sky-400 hover:text-sky-300 text-xs" />
                      )}
                    </div>
                    {resendState === "error" && resendError[u.id] && (
                      <div className="text-red-400 mt-1">{resendError[u.id]}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// Assistant intelligent (§36) — détection automatique d'anomalies + aide à
// la correction du planning, calcul 100% local (AssistantEngine, sans IA
// externe — choix explicite de l'exploitant après comparaison des deux
// approches).
// ==========================================
const ASSISTANT_SEVERITY_META = {
  critical: { label: "Critique", icon: "fa-circle-exclamation", cls: "bg-red-500/10 border-red-500/30 text-red-300" },
  warning: { label: "Avertissement", icon: "fa-triangle-exclamation", cls: "bg-amber-500/10 border-amber-500/30 text-amber-300" },
  info: { label: "Info", icon: "fa-circle-info", cls: "bg-sky-500/10 border-sky-500/30 text-sky-300" }
};

function AssistantIntelligentPage() {
  const rawState = useRtgState();
  const nav = useNavigate();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs.
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState(shiftRestricted ? currentUser.teamId : "all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const effectiveTeamId = shiftRestricted ? currentUser.teamId : teamId;

  const insights = useMemo(() => AssistantEngine.analyzeMonth(month, year, state, effectiveTeamId), [state, month, year, effectiveTeamId]);
  const visibleInsights = severityFilter === "all" ? insights : insights.filter(i => i.severity === severityFilter);
  const counts = { critical: 0, warning: 0, info: 0 };
  insights.forEach(i => { counts[i.severity] = (counts[i.severity] || 0) + 1; });

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Assistant intelligent</h1>
        <p className="text-slate-400 text-sm mt-0.5">Détection automatique d'anomalies et aide à la correction du planning — calcul 100% local, sans IA externe</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
        {!shiftRestricted && (
          <div>
            <label className={LABEL_CLS}>Équipe</label>
            <select value={teamId} onChange={e => setTeamId(e.target.value)} className={FIELD_CLS}>
              <option value="all">Toutes les équipes</option>
              {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
          </div>
        )}
        <div className="ml-auto flex gap-1">
          {[["all", "Tous"], ["critical", "Critiques"], ["warning", "Avertissements"], ["info", "Infos"]].map(([k, l]) => (
            <button key={k} onClick={() => setSeverityFilter(k)}
              className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${severityFilter === k ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-red-300">{counts.critical || 0}</div>
          <div className="text-xs text-red-300/80 uppercase tracking-wider">Critiques</div>
        </div>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-amber-300">{counts.warning || 0}</div>
          <div className="text-xs text-amber-300/80 uppercase tracking-wider">Avertissements</div>
        </div>
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-sky-300">{counts.info || 0}</div>
          <div className="text-xs text-sky-300/80 uppercase tracking-wider">Infos</div>
        </div>
      </div>

      {visibleInsights.length === 0 ? (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-4 text-sm font-medium">
          <i className="fas fa-circle-check"></i> Aucune anomalie détectée pour cette sélection — planning sain.
        </div>
      ) : (
        <div className="space-y-2">
          {visibleInsights.map(insight => {
            const meta = ASSISTANT_SEVERITY_META[insight.severity] || ASSISTANT_SEVERITY_META.info;
            return (
              <div key={insight.id} className={`rounded-xl border p-4 text-sm ${meta.cls}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3">
                    <i className={`fas ${meta.icon} mt-0.5`}></i>
                    <div>
                      <div className="font-semibold text-white">{insight.title}</div>
                      <div className="text-slate-300 mt-0.5">{insight.detail}</div>
                      {insight.suggestion && (
                        <div className="mt-1.5 text-xs text-slate-400 flex items-start gap-1.5">
                          <i className="fas fa-lightbulb mt-0.5"></i><span>{insight.suggestion}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {insight.date && (
                    <button onClick={() => nav("/affectation?date=" + insight.date)}
                      className="shrink-0 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-marine-800 text-slate-200 hover:text-white hover:bg-marine-700 transition-all whitespace-nowrap">
                      <i className="fas fa-arrow-right mr-1"></i> Voir l'affectation
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==========================================
// Mon planning (§37) — SEULE page accessible à un compte CONDUCTEUR
// (isDriverRestricted, pages.js) : lecture seule de SON propre planning,
// rien d'autre. La demande de congé en libre-service (avec upload du
// justificatif + validation par le Responsable de Shift + email de
// confirmation) viendra dans une étape suivante.
// ==========================================
function MonPlanningPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const driver = currentUser && currentUser.driverId ? state.drivers.find(d => d.id === currentUser.driverId) : null;
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());

  const rows = useMemo(() => {
    if (!driver) return [];
    const planning = PlanningEngine.generateMonthlyPlanning(month, year, state);
    return planning.days.map(day => ({ iso: day.iso, assignment: day.assignments.find(a => a.driverId === driver.id) || null }));
  }, [state, month, year, driver]);

  if (!driver) {
    return (
      <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
        <i className="fas fa-triangle-exclamation"></i> Votre compte n'est rattaché à aucune fiche conducteur. Contactez un administrateur.
      </div>
    );
  }

  const team = state.teams.find(t => t.id === driver.teamId);

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Mon planning</h1>
        <p className="text-slate-400 text-sm mt-0.5">{driver.matricule} — {driver.nom} {driver.prenom}{team ? " — " + team.nom : ""}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">Shift</th><th className="px-3 py-2">Vacation</th><th className="px-3 py-2">Zone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const a = r.assignment;
              const meta = a ? (RTG_STATUS_META[a.status] || {}) : {};
              const present = a && a.status === "PRESENT";
              return (
                <tr key={r.iso} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{RTGDate.formatFr(RTGDate.parseISO(r.iso))}</td>
                  <td className="px-3 py-2">{a ? <span className={`px-1.5 py-0.5 rounded border ${meta.className || ""}`}>{meta.label || a.status}</span> : "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{present ? ((state.config.shifts.find(s => s.id === a.shift) || {}).label || a.shift) : "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{present ? (a.vacation || "—") : "—"}</td>
                  <td className="px-3 py-2 text-slate-300">{present ? (a.zone || "—") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Convertit une dataURL (canvas.toDataURL / captureNodeAsPng) en File
// uploadable via Supabase Storage — évite d'avoir à changer submitCongeRequest
// (pages2.js) : le formulaire signé généré ci-dessous devient simplement LE
// justificatif, uploadé exactement comme une photo l'aurait été.
function dataUrlToFile(dataUrl, filename) {
  const parts = dataUrl.split(",");
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const bin = atob(parts[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

// Signature manuscrite — un simple <canvas> sur lequel dessiner (souris,
// doigt ou stylet via l'API Pointer Events, unifiée). Elle est capturée avec
// le reste du formulaire par html2canvas au moment de l'envoi (voir
// MesCongesPage.submit) : pas besoin d'exporter son contenu séparément, le
// canvas fait partie du DOM capturé comme n'importe quel autre élément.
function SignaturePad({ canvasRef, onChange }) {
  const drawingRef = useRef(false);
  const lastRef = useRef(null);

  // Le canvas est étiré en CSS (w-full) mais garde sa résolution de dessin
  // fixe (width/height ci-dessous) — sans ce facteur d'échelle, le trait
  // dessiné se désynchronise du curseur dès que la largeur affichée diffère
  // de la résolution interne.
  const getPos = e => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const start = e => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = getPos(e);
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastRef.current = pos;
    onChange(true);
  };
  const end = () => { drawingRef.current = false; };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    onChange(false);
  };

  return (
    <div>
      <canvas ref={canvasRef} width={460} height={150}
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
        style={{ touchAction: "none" }} className="bg-white border border-slate-400 rounded w-full cursor-crosshair" />
      <button type="button" onClick={clear} className="mt-1 text-[10px] text-slate-500 hover:text-slate-800 underline">Effacer</button>
    </div>
  );
}

// Reproduction du formulaire papier officiel "Demande de congé
// administratif" (TC3PC, document ENCAAPCGRHS10) — demande explicite de
// l'exploitant : même structure/affichage, rempli automatiquement à partir
// de la fiche du conducteur, signé numériquement. Ce composant EST
// l'aperçu : affiché en direct dans la page (jamais masqué comme les blocs
// "print-report" des autres rapports), il est capturé tel quel en image au
// moment de l'envoi (MesCongesPage.submit) — ce que le conducteur voit à
// l'écran est exactement ce qui part au responsable.
const CONGE_DOC_CODE = "ENCAAPCGRHS10";
// Réduit à l'échelle (transform: scale, pas de redimensionnement du DOM) un
// document de dimensions FIXES (par défaut 210×297mm, format A4) pour qu'il
// tienne dans la largeur disponible — sans ça, sur un écran étroit
// (mobile), le document déborde et se retrouve coupé (l'exploitant l'a
// signalé par capture d'écran) plutôt que simplement rétréci comme le
// ferait un aperçu avant impression classique. Le transform:scale ne
// s'applique qu'à ce WRAPPER — l'élément capturé par html2canvas
// (CongeFormPrintable.formRef, un cran plus bas, jamais transformé
// lui-même) garde ses vraies dimensions 210×297mm : html2canvas clone
// uniquement le sous-arbre du nœud ciblé, sans hériter des transforms de
// ses ancêtres, donc capture le document à sa taille réelle quel que soit
// le niveau de réduction visuelle appliqué ici pour l'affichage.
// `scaleBoxRef`/`wrapperRef` (optionnels) donnent au parent une prise directe
// sur le DOM du wrapper mis à l'échelle — nécessaire pour le neutraliser
// pendant une capture html2canvas (voir MesCongesPage.submit) : un ancêtre
// avec `transform: scale(...)` peut faire dupliquer/décaler le texte rendu
// par html2canvas (bug constaté sur mobile, où le facteur d'échelle est
// significativement < 1) — html2canvas doit voir le document à sa taille
// RÉELLE, jamais à travers ce transform.
function A4ScaledPreview({ widthMm, heightMm, children, wrapperRef: externalWrapperRef, scaleBoxRef: externalScaleBoxRef }) {
  const internalOuterRef = useRef(null);
  const internalScaleBoxRef = useRef(null);
  const outerRef = externalWrapperRef || internalOuterRef;
  const scaleBoxRef = externalScaleBoxRef || internalScaleBoxRef;
  const [scale, setScale] = useState(1);
  const mmToPx = 96 / 25.4;
  const naturalWidthPx = widthMm * mmToPx;
  const naturalHeightPx = heightMm * mmToPx;

  useEffect(() => {
    const compute = () => {
      if (!outerRef.current) return;
      const available = outerRef.current.clientWidth;
      setScale(available > 0 ? Math.min(1, available / naturalWidthPx) : 1);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [naturalWidthPx]);

  return (
    <div ref={outerRef} className="w-full overflow-hidden" style={{ height: naturalHeightPx * scale }}>
      <div ref={scaleBoxRef} style={{ width: naturalWidthPx, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

// Format A4 (210 × 297mm, comme la page papier réelle) — demande explicite
// de l'exploitant, réduit à l'écran si besoin par A4ScaledPreview
// ci-dessus (sans jamais changer ses dimensions RÉELLES, capturées telles
// quelles par html2canvas à l'envoi/export via formRef, posé directement
// sur CE nœud — jamais sur son wrapper transformé).
function CongeFormPrintable({ driver, dateDebut, dateFin, dernierCongePris, signatureCanvasRef, onSignatureChange, formRef }) {
  return (
      <div ref={formRef} className="bg-white text-slate-900 shadow-lg text-sm leading-snug"
        style={{ width: "210mm", minHeight: "297mm", padding: "16mm 18mm", boxSizing: "border-box" }}>
        <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-4 mb-5">
          <img src="icons/tc3pc-logo.jpg" alt="TC3PC" className="h-14 w-auto shrink-0" />
          <div className="text-right">
            <div className="text-base font-bold uppercase">Demande de congé administratif</div>
            <div className="text-sm">Personnel 5 à 18</div>
            <div className="flex items-center justify-end mt-2 text-[10px] leading-none">
              <span className="font-semibold mr-1 leading-none">Document :</span>
              <div className="flex">
                {CONGE_DOC_CODE.split("").map((c, i) => (
                  <span key={i} className={`relative inline-block w-4 h-4 border border-slate-800 ${i > 0 ? "-ml-px" : ""}`}>
                    <span className="absolute font-bold" style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}>{c}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-sm font-bold uppercase underline mb-4">À remplir par l'intéressé</div>
        <div className="space-y-2.5 mb-6">
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Nom et Prénom</span><span>: <span className="font-semibold">{driver.nom} {driver.prenom}</span> — Mle {driver.matricule}</span></div>
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Fonction</span><span>: Conducteur RTG</span></div>
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Entité</span><span>: TC3PC</span></div>
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Dernier congé pris</span><span>: {dernierCongePris || "—"}</span></div>
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Date début de congé</span><span>: {dateDebut ? RTGDate.formatFr(RTGDate.parseISO(dateDebut)) : "—"}</span></div>
          <div className="flex flex-wrap gap-x-2"><span className="w-52 shrink-0 text-slate-600">Date fin du congé</span><span>: {dateFin ? RTGDate.formatFr(RTGDate.parseISO(dateFin)) : "—"} <span className="italic text-slate-500">(incluse)</span></span></div>
        </div>

        <div className="flex items-end justify-between gap-6 mb-8">
          <div>Casablanca, le {RTGDate.formatFr(RTGDate.parseISO(RTGDate.toISO(new Date())))}</div>
          <div className="text-center">
            <div className="text-xs font-semibold uppercase mb-1.5">Signature de l'intéressé</div>
            <SignaturePad canvasRef={signatureCanvasRef} onChange={onSignatureChange} />
          </div>
        </div>

        <div className="border-t-2 border-slate-800 pt-4">
          <div className="text-center text-sm font-bold uppercase mb-3">À remplir par le responsable</div>
          <div className="mb-2">Avis du responsable direct : ..............................</div>
          <div className="mb-4">Intérimaire proposé : ..............................</div>
          <div className="text-right mb-4">Casablanca, le .....................</div>
          <div className="grid grid-cols-2 gap-4 text-xs font-semibold uppercase text-center">
            <div>Visa Chef de Service</div>
            <div>Chef de Division</div>
          </div>
          <div className="text-center text-xs font-semibold uppercase mt-4">Chef du Département</div>
        </div>
      </div>
  );
}

// ==========================================
// Mes congés (§38/§40) — DEUXIÈME page accessible à un compte CONDUCTEUR
// (avec "Mon planning") : demande de congé en libre-service. Le conducteur
// remplit les dates puis signe DIRECTEMENT sur une reproduction du
// formulaire papier officiel (CongeFormPrintable ci-dessus, affichée en
// direct comme aperçu) ; à l'envoi, ce formulaire rempli+signé est capturé
// en image et devient le justificatif — transmis EN_ATTENTE jusqu'à
// validation par le Responsable de Shift (page Congés). Aucun effet sur le
// planning tant qu'elle n'est pas VALIDE (voir AbsenceEngine.activeConges).
// ==========================================
function MesCongesPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const driver = currentUser && currentUser.driverId ? state.drivers.find(d => d.id === currentUser.driverId) : null;
  const [form, setForm] = useState({ dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), commentaire: "" });
  const [hasSignature, setHasSignature] = useState(false);
  const signatureCanvasRef = useRef(null);
  const formNodeRef = useRef(null);
  const previewWrapperRef = useRef(null);
  const previewScaleBoxRef = useRef(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const myRequests = driver ? state.conges.filter(c => c.driverId === driver.id).slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut)) : [];
  const todayIsoMesConges = RTGDate.toISO(new Date());

  // "Dernier congé pris" (comme sur le formulaire papier, format MM/AAAA) :
  // le congé VALIDE le plus récent déjà terminé — calculé automatiquement,
  // pas besoin que le conducteur s'en souvienne.
  const dernierCongePris = useMemo(() => {
    if (!driver) return "";
    const todayIso = RTGDate.toISO(new Date());
    const past = (state.conges || [])
      .filter(c => c.driverId === driver.id && c.statut !== "EN_ATTENTE" && c.statut !== "REFUSE" && c.dateFin < todayIso)
      .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
    if (past.length === 0) return "";
    const d = RTGDate.parseISO(past[0].dateDebut);
    return String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear();
  }, [state.conges, driver]);

  // Solde de congé (§40) : disponible à ce jour, et jours ouvrables que la
  // demande en cours de saisie consommerait (fériés exclus, dimanche compté
  // comme travaillé) — pour que le conducteur voie l'impact avant d'envoyer.
  const solde = useMemo(() => driver ? CongeBalanceEngine.soldeDisponible(driver, state) : null, [driver, state]);
  const joursDemandes = useMemo(() => {
    if (!driver || form.dateFin < form.dateDebut) return 0;
    return CongeBalanceEngine.countJoursOuvrables(form.dateDebut, form.dateFin, state.config);
  }, [driver, form.dateDebut, form.dateFin, state.config]);

  if (!driver) {
    return (
      <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
        <i className="fas fa-triangle-exclamation"></i> Votre compte n'est rattaché à aucune fiche conducteur. Contactez un administrateur.
      </div>
    );
  }

  const clearSignature = () => {
    if (!signatureCanvasRef.current) return;
    const c = signatureCanvasRef.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    setHasSignature(false);
  };

  // Le formulaire est affiché réduit (A4ScaledPreview, transform: scale(...))
  // pour tenir sur un écran étroit — mais un ancêtre transformé pendant la
  // capture html2canvas fait dupliquer/décaler tout le texte rendu (bug
  // constaté sur mobile, où le facteur d'échelle est significativement < 1 :
  // le PDF/justificatif généré affichait un texte fantôme superposé,
  // illisible). Neutralise le transform et les contraintes de taille du
  // wrapper le temps de la capture, puis les restaure — le document est
  // ainsi toujours capturé à sa taille réelle, jamais à travers ce zoom.
  const withUnscaledCapture = async fn => {
    const scaleBox = previewScaleBoxRef.current, wrapper = previewWrapperRef.current;
    const prevTransform = scaleBox ? scaleBox.style.transform : null;
    const prevWrapperHeight = wrapper ? wrapper.style.height : null;
    const prevWrapperOverflow = wrapper ? wrapper.style.overflow : null;
    if (scaleBox) scaleBox.style.transform = "none";
    if (wrapper) { wrapper.style.height = "auto"; wrapper.style.overflow = "visible"; }
    try {
      return await fn();
    } finally {
      if (scaleBox) scaleBox.style.transform = prevTransform;
      if (wrapper) { wrapper.style.height = prevWrapperHeight; wrapper.style.overflow = prevWrapperOverflow; }
    }
  };

  const downloadPdf = async () => {
    if (!formNodeRef.current) return;
    setPdfBusy(true);
    try {
      await loadPdfLibs();
      await withUnscaledCapture(() => exportNodeAsPdf(formNodeRef.current, `demande-conge-${driver.matricule}-${form.dateDebut}.pdf`, { fitOnePage: true, orientation: "portrait", forceWidth: 800 }));
    } catch (e) {
      alert("Erreur d'export PDF : " + (e && e.message ? e.message : "réessayez."));
    }
    setPdfBusy(false);
  };

  // Le formulaire rempli + signé (CongeFormPrintable, affiché en direct
  // comme aperçu) est capturé en image au moment de l'envoi et devient LE
  // justificatif — même mécanisme de stockage que l'ancien upload manuel
  // (RTGStore.submitCongeRequest), rien à changer côté backend.
  const submit = async () => {
    if (form.dateFin < form.dateDebut) { setError("La date de fin doit être après la date de début."); return; }
    if (!hasSignature) { setError("Signez le formulaire ci-dessous avant d'envoyer votre demande."); return; }
    if (!formNodeRef.current) return;
    setError(""); setSubmitting(true);
    try {
      await loadPdfLibs();
      const png = await withUnscaledCapture(() => captureNodeAsPng(formNodeRef.current, 800));
      const file = dataUrlToFile(png.dataUrl, `demande-conge-${driver.matricule}-${form.dateDebut}.png`);
      await RTGStore.submitCongeRequest({ driverId: driver.id, dateDebut: form.dateDebut, dateFin: form.dateFin, commentaire: form.commentaire, file: file });
      setForm({ dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), commentaire: "" });
      clearSignature();
    } catch (e) {
      setError("Erreur d'envoi : " + (e && e.message ? e.message : "réessayez."));
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Mes congés</h1>
        <p className="text-slate-400 text-sm mt-0.5">{driver.matricule} — {driver.nom} {driver.prenom}</p>
      </div>

      <Panel title="Solde de congé" icon="fa-calendar-check">
        {solde ? (
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <div><span className="text-2xl font-bold text-white">{solde.disponible}</span> <span className="text-slate-400">jour{solde.disponible > 1 ? "s" : ""} ouvrable{solde.disponible > 1 ? "s" : ""} disponible{solde.disponible > 1 ? "s" : ""}</span></div>
            <div className="text-[11px] text-slate-500">Droit {solde.annee} : {solde.droit}j + report : {solde.report}j − déjà pris {solde.annee} : {solde.pris}j</div>
            {joursDemandes > 0 && (
              <div className={`text-xs px-2 py-1 rounded ${joursDemandes > solde.disponible ? "bg-red-500/20 text-red-300" : "bg-marine-700 text-slate-300"}`}>
                Cette demande décompterait {joursDemandes} jour{joursDemandes > 1 ? "s" : ""} ouvrable{joursDemandes > 1 ? "s" : ""}
                {joursDemandes > solde.disponible ? " — dépasse le solde disponible" : ""}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">Solde non encore renseigné par votre responsable — contactez-le pour connaître vos droits restants.</p>
        )}
      </Panel>

      <Panel title="Nouvelle demande de congé" icon="fa-umbrella-beach">
        <div className="space-y-3">
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={LABEL_CLS}>Date début</label><input type="date" className={FIELD_CLS} value={form.dateDebut} onChange={e => setForm(f => Object.assign({}, f, { dateDebut: e.target.value }))} /></div>
            <div><label className={LABEL_CLS}>Date fin</label><input type="date" className={FIELD_CLS} value={form.dateFin} onChange={e => setForm(f => Object.assign({}, f, { dateFin: e.target.value }))} /></div>
            <div className="sm:col-span-2"><label className={LABEL_CLS}>Commentaire (optionnel)</label><input className={FIELD_CLS} value={form.commentaire} onChange={e => setForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
          </div>

          <div>
            <label className={LABEL_CLS}>Aperçu — signez directement sur le formulaire ci-dessous</label>
            <A4ScaledPreview widthMm={210} heightMm={297} wrapperRef={previewWrapperRef} scaleBoxRef={previewScaleBoxRef}>
              <CongeFormPrintable driver={driver} dateDebut={form.dateDebut} dateFin={form.dateFin} dernierCongePris={dernierCongePris}
                signatureCanvasRef={signatureCanvasRef} onSignatureChange={setHasSignature} formRef={formNodeRef} />
            </A4ScaledPreview>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
              {submitting ? "Envoi en cours..." : "Envoyer la demande à mon responsable"}
            </button>
            <button onClick={downloadPdf} disabled={pdfBusy} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-700 text-white hover:bg-marine-600 disabled:opacity-60">
              <i className="fas fa-file-pdf mr-1.5"></i>{pdfBusy ? "Génération..." : "Télécharger en PDF"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Votre demande (avec ce formulaire signé) sera transmise à votre Responsable de Shift pour validation. Suivez son statut ci-dessous.</p>
        </div>
      </Panel>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Date début</th><th className="px-3 py-2">Date fin</th><th className="px-3 py-2">Statut</th>
              <th className="px-3 py-2">Justificatif</th><th className="px-3 py-2">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {myRequests.length === 0 && (
              <tr><td colSpan="5" className="px-3 py-6 text-center text-slate-500 italic">Aucune demande pour l'instant.</td></tr>
            )}
            {myRequests.map(r => {
              const meta = congeDisplayMeta(r, todayIsoMesConges);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                  <td className="px-3 py-2 text-slate-300">{r.dateFin}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded border ${meta.className}`}>{meta.label}</span>
                    {r.statut === "REFUSE" && r.motifRefus ? <div className="text-[10px] text-slate-500 mt-0.5">{r.motifRefus}</div> : null}
                  </td>
                  <td className="px-3 py-2"><CongeJustificatifLink path={r.justificatifPath} /></td>
                  <td className="px-3 py-2 text-slate-400">{r.commentaire}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 8. Mouvements RTG — importés automatiquement depuis le rapport TOS
// (voir supabase/functions/import-tos-moves). Jamais chargés dans l'état
// global (table potentiellement volumineuse) : chaque page interroge
// directement Supabase pour sa période affichée.
// ==========================================
const MOUVEMENTS_TOS_COLUMNS = [
  { key: "nombreIn", label: "IN" },
  { key: "nombreOut", label: "OUT" },
  { key: "nombreMove", label: "Déplacements" },
  { key: "nombreShifting", label: "Shifting" },
  { key: "nombreDisch", label: "Déchargement" },
  { key: "nombreLoad", label: "Chargement" },
  { key: "nombreAutre", label: "Autre" }
];

function MesMouvementsPage() {
  const currentUser = useCurrentUser();
  const state = useRtgState();
  const driver = currentUser && currentUser.driverId ? state.drivers.find(d => d.id === currentUser.driverId) : null;
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!driver) return;
    setLoading(true);
    setError("");
    const dim = RTGDate.daysInMonth(month, year);
    const dateFrom = RTGDate.toISO(RTGDate.makeDate(year, month, 1));
    const dateTo = RTGDate.toISO(RTGDate.makeDate(year, month, dim));
    RTGStore.fetchMouvementsTos({ driverId: driver.id, dateFrom, dateTo })
      .then(setRows)
      .catch(e => setError(e && e.message ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  }, [driver, month, year]);

  if (!driver) {
    return (
      <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
        <i className="fas fa-triangle-exclamation"></i> Votre compte n'est rattaché à aucune fiche conducteur. Contactez un administrateur.
      </div>
    );
  }

  const totalMvmt = rows.reduce((s, r) => s + (r.totalMvmt || 0), 0);

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Mes mouvements</h1>
        <p className="text-slate-400 text-sm mt-0.5">Mouvements RTG réalisés, importés automatiquement depuis le TOS — {driver.matricule} — {driver.nom} {driver.prenom}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Shift</th><th className="px-3 py-2">Engin</th>
              {MOUVEMENTS_TOS_COLUMNS.map(c => <th key={c.key} className="px-3 py-2 text-center">{c.label}</th>)}
              <th className="px-3 py-2 text-center font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 4} className="px-3 py-6 text-center text-slate-500 italic">Chargement...</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 4} className="px-3 py-6 text-center text-slate-500 italic">Aucun mouvement enregistré pour cette période.</td></tr>
            )}
            {!loading && rows.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                <td className="px-3 py-2 text-white">{r.dateTravail}</td>
                <td className="px-3 py-2 text-slate-300">{r.shift}</td>
                <td className="px-3 py-2 text-slate-300">{r.engin}</td>
                {MOUVEMENTS_TOS_COLUMNS.map(c => <td key={c.key} className="px-3 py-2 text-center text-slate-300">{r[c.key]}</td>)}
                <td className="px-3 py-2 text-center text-white font-bold">{r.totalMvmt}</td>
              </tr>
            ))}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-bold">
                <td className="px-3 py-2 text-white" colSpan={MOUVEMENTS_TOS_COLUMNS.length + 3}>Total période</td>
                <td className="px-3 py-2 text-center text-white">{totalMvmt}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// Consultation seule pour le conducteur — heures_exceptionnelles est déjà
// chargée dans state au démarrage (RLS restreint déjà à ses propres lignes),
// pas besoin d'un fetch dédié comme pour les mouvements TOS.
function MesOverTimePage() {
  const currentUser = useCurrentUser();
  const state = useRtgState();
  const driver = currentUser && currentUser.driverId ? state.drivers.find(d => d.id === currentUser.driverId) : null;
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());

  if (!driver) {
    return (
      <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
        <i className="fas fa-triangle-exclamation"></i> Votre compte n'est rattaché à aucune fiche conducteur. Contactez un administrateur.
      </div>
    );
  }

  const dim = RTGDate.daysInMonth(month, year);
  const firstIso = RTGDate.toISO(RTGDate.makeDate(year, month, 1));
  const lastIso = RTGDate.toISO(RTGDate.makeDate(year, month, dim));
  const rows = state.heuresExceptionnelles
    .filter(r => r.driverId === driver.id && r.dateDebut >= firstIso && r.dateDebut <= lastIso)
    .sort((a, b) => a.dateDebut.localeCompare(b.dateDebut));
  const totalHeures = rows.reduce((s, r) => s + (Number(r.heures) || 0), 0);

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Mes Over Time</h1>
        <p className="text-slate-400 text-sm mt-0.5">Doublage, jour férié travaillé, 3ème shift dimanche — {driver.matricule} — {driver.nom} {driver.prenom}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-center">Heures</th><th className="px-3 py-2 text-center">Mouvements</th><th className="px-3 py-2">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">Aucun Over Time enregistré pour cette période.</td></tr>
            )}
            {rows.map(r => {
              const t = HEURE_EXCEPTIONNELLE_TYPES[r.type] || { label: r.type, className: "bg-slate-700 text-slate-300" };
              return (
                <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white">{r.dateDebut}{r.dateFin && r.dateFin !== r.dateDebut ? " → " + r.dateFin : ""}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[11px] ${t.className}`}>{t.label}</span></td>
                  <td className="px-3 py-2 text-center text-white font-bold">{r.heures}</td>
                  <td className="px-3 py-2 text-center text-slate-300">{r.mouvements != null ? r.mouvements : "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{r.commentaire || "—"}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-bold">
                <td className="px-3 py-2 text-white" colSpan={2}>Total période</td>
                <td className="px-3 py-2 text-center text-white">{totalHeures}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// Vue responsable/admin : mouvements agrégés par conducteur sur une période,
// avec le détail par jour/shift/engin. RLS restreint déjà ce qui revient pour
// un RESPONSABLE_SHIFT (sa propre équipe uniquement) — pas de filtre
// supplémentaire nécessaire côté client.
function emptyMouvementManuelForm(teamId) {
  return { driverId: "", dateTravail: RTGDate.toISO(new Date()), shift: "", nombreIn: 0, nombreOut: 0, nombreMove: 0, nombreShifting: 0, nombreDisch: 0, nombreLoad: 0, nombreAutre: 0, commentaire: "" };
}

function MouvementsRtgPage() {
  const rawState = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  // Bascule RTG/CC : un compte restreint (Responsable de Shift) reste sur sa
  // propre équipe quelle que soit la flotte affichée par ailleurs. Le rapport
  // TOS (rows/totalRows) revient du serveur pour TOUTES les flottes — les
  // lignes déjà rattachées à un conducteur de l'AUTRE flotte sont retirées
  // ci-dessous (visibleRows/visibleTotalRows) via rawState.drivers (liste
  // complète, nécessaire pour bien les reconnaître comme "rattachées" et ne
  // pas les confondre avec un login réellement non rattaché à personne).
  const fTeams = fleetTeams(rawState, shiftRestricted ? currentUser.teamId : null);
  const fTeamIds = new Set(fTeams.map(t => t.id));
  const state = useMemo(() => Object.assign({}, rawState, {
    teams: fTeams,
    drivers: rawState.drivers.filter(d => fTeamIds.has(d.teamId))
  }), [rawState, fTeams]);
  const now = new Date();
  const [tab, setTab] = useState("detail");
  const [filterDriverId, setFilterDriverId] = useState("");

  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshDetailRows = () => {
    setLoading(true);
    setError("");
    const dim = RTGDate.daysInMonth(month, year);
    const dateFrom = RTGDate.toISO(RTGDate.makeDate(year, month, 1));
    const dateTo = RTGDate.toISO(RTGDate.makeDate(year, month, dim));
    return RTGStore.fetchMouvementsTos({ dateFrom, dateTo })
      .then(setRows)
      .catch(e => setError(e && e.message ? e.message : "Chargement impossible."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab !== "detail") return;
    refreshDetailRows();
  }, [tab, month, year]);

  // ---- Saisie manuelle : certains mouvements réalisés par les conducteurs
  // ne remontent pas dans le rapport TOS — un responsable peut les ajouter
  // à la main, par conducteur et par jour. Fusionnés automatiquement avec
  // les mouvements importés dans tous les rapports (RTGStore.fetchMouvementsTos). ----
  const [showManuelForm, setShowManuelForm] = useState(false);
  const [manuelForm, setManuelForm] = useState(() => emptyMouvementManuelForm());
  const [manuelError, setManuelError] = useState("");
  const [manuelSaving, setManuelSaving] = useState(false);

  const submitManuel = async () => {
    if (!manuelForm.driverId) { setManuelError("Sélectionnez un conducteur."); return; }
    setManuelSaving(true);
    setManuelError("");
    try {
      await RTGStore.addMouvementManuel(manuelForm);
      setManuelForm(emptyMouvementManuelForm());
      setShowManuelForm(false);
      if (tab === "detail") await refreshDetailRows();
    } catch (e) {
      setManuelError("Erreur d'enregistrement : " + (e && e.message ? e.message : "réessayez."));
    } finally {
      setManuelSaving(false);
    }
  };

  const deleteManuel = async id => {
    try {
      await RTGStore.deleteMouvementManuel(id);
      if (tab === "detail") await refreshDetailRows();
    } catch (e) {
      alert("Erreur : " + (e && e.message ? e.message : "réessayez."));
    }
  };

  // ---- Onglet "Total par conducteur" : période libre (date à date), une
  // ligne par conducteur avec le total de chaque type de mouvement — sur le
  // modèle du rapport Excel fourni par l'exploitant. ----
  const monthStartIso = RTGDate.toISO(RTGDate.makeDate(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const todayIsoForTotal = RTGDate.toISO(now);
  const [dateDebut, setDateDebut] = useState(monthStartIso);
  const [dateFin, setDateFin] = useState(todayIsoForTotal);
  const [totalRows, setTotalRows] = useState([]);
  const [totalLoading, setTotalLoading] = useState(false);
  const [totalError, setTotalError] = useState("");

  const refreshTotalRows = () => {
    setTotalLoading(true);
    setTotalError("");
    return RTGStore.fetchMouvementsTos({ dateFrom: dateDebut, dateTo: dateFin })
      .then(setTotalRows)
      .catch(e => setTotalError(e && e.message ? e.message : "Chargement impossible."))
      .finally(() => setTotalLoading(false));
  };

  useEffect(() => {
    if (tab !== "total") return;
    refreshTotalRows();
  }, [tab, dateDebut, dateFin]);

  // Un login TOS non rattaché peut être un cas légitime hors périmètre (ex.
  // conducteur tracteur ayant ponctuellement opéré un RTG), pas forcément une
  // fiche conducteur manquante à corriger — "Ignorer" l'exclut durablement
  // des imports futurs et supprime l'historique déjà importé pour ce login.
  const ignoreLogin = login => {
    if (!window.confirm(`Ignorer définitivement le login "${login}" ? Ses mouvements déjà importés seront supprimés, et il ne sera plus jamais signalé comme non rattaché.`)) return;
    RTGStore.ignoreTosLogin(login)
      .then(() => { refreshDetailRows(); refreshTotalRows(); })
      .catch(e => alert("Erreur : " + (e && e.message ? e.message : "réessayez.") + "\n\nSi le login réapparaît malgré un \"ignorer\" réussi, la fonction d'import TOS déployée sur Supabase n'est peut-être pas à jour — voir avec l'administrateur pour la redéployer."));
  };

  // Ne garder que les lignes de la flotte actuellement affichée : soit non
  // rattachées à un conducteur (à examiner quelle que soit la flotte), soit
  // rattachées à un conducteur de la flotte en cours — puis, si un
  // conducteur précis est sélectionné, uniquement ses lignes.
  const fleetFilterRow = r => {
    if (filterDriverId) return r.driverId === filterDriverId;
    return !r.driverId || fTeamIds.has((rawState.drivers.find(d => d.id === r.driverId) || {}).teamId);
  };
  const visibleRows = useMemo(() => rows.filter(fleetFilterRow), [rows, fTeamIds, rawState.drivers, filterDriverId]);
  const visibleTotalRows = useMemo(() => totalRows.filter(fleetFilterRow), [totalRows, fTeamIds, rawState.drivers, filterDriverId]);

  const totalByDriver = useMemo(() => {
    const map = {};
    visibleTotalRows.forEach(r => {
      const key = r.driverId || ("_" + r.loginTos);
      if (!map[key]) {
        map[key] = { driverId: r.driverId, loginTos: r.loginTos, nombreIn: 0, nombreOut: 0, nombreMove: 0, nombreShifting: 0, nombreDisch: 0, nombreLoad: 0, nombreAutre: 0, totalMvmt: 0 };
      }
      MOUVEMENTS_TOS_COLUMNS.forEach(c => { map[key][c.key] += r[c.key] || 0; });
      map[key].totalMvmt += r.totalMvmt || 0;
    });
    return Object.values(map).sort((a, b) => {
      const da = a.driverId ? state.drivers.find(d => d.id === a.driverId) : null;
      const db = b.driverId ? state.drivers.find(d => d.id === b.driverId) : null;
      return (da ? da.matricule : "zzz").localeCompare(db ? db.matricule : "zzz");
    });
  }, [visibleTotalRows, state.drivers]);

  const totalUnmatchedLogins = [...new Set(visibleTotalRows.filter(r => !r.driverId).map(r => r.loginTos))];
  const totalGrandTotal = visibleTotalRows.reduce((s, r) => s + (r.totalMvmt || 0), 0);

  const exportTotalExcel = () => {
    const headers = ["Matricule", "Nom", "Prénom", "Équipe"].concat(MOUVEMENTS_TOS_COLUMNS.map(c => c.label)).concat(["Total"]);
    const dataRows = totalByDriver.map(g => {
      const d = g.driverId ? state.drivers.find(dr => dr.id === g.driverId) : null;
      const team = d ? state.teams.find(t => t.id === d.teamId) : null;
      return [d ? d.matricule : "", d ? d.nom : "", d ? d.prenom : (g.loginTos + " (non rattaché)"), team ? team.nom : ""]
        .concat(MOUVEMENTS_TOS_COLUMNS.map(c => g[c.key]))
        .concat([g.totalMvmt]);
    });
    downloadCSV(`mouvements-rtg-total-${dateDebut}-${dateFin}.csv`, headers, dataRows);
  };

  // Regroupe par journée (la plus récente en premier) puis par shift — même
  // logique de lecture que l'Affectation du jour, plus naturelle pour un
  // responsable que la liste plate par conducteur.
  const byDay = useMemo(() => {
    const days = {};
    visibleRows.forEach(r => {
      if (!days[r.dateTravail]) days[r.dateTravail] = {};
      const shiftKey = r.shift || "—";
      if (!days[r.dateTravail][shiftKey]) days[r.dateTravail][shiftKey] = [];
      days[r.dateTravail][shiftKey].push(r);
    });
    return Object.keys(days).sort((a, b) => b.localeCompare(a)).map(dateIso => ({
      dateIso,
      shifts: Object.keys(days[dateIso]).sort().map(shift => {
        const shiftRows = days[dateIso][shift].slice().sort((a, b) => {
          const da = a.driverId ? state.drivers.find(d => d.id === a.driverId) : null;
          const db = b.driverId ? state.drivers.find(d => d.id === b.driverId) : null;
          return (da ? da.matricule : "zzz").localeCompare(db ? db.matricule : "zzz") || a.engin.localeCompare(b.engin);
        });
        const total = shiftRows.reduce((s, r) => s + (r.totalMvmt || 0), 0);
        return { shift, rows: shiftRows, total };
      })
    }));
  }, [visibleRows, state.drivers]);

  const unmatched = visibleRows.filter(r => !r.driverId);
  const unmatchedLogins = [...new Set(unmatched.map(r => r.loginTos))];
  const grandTotal = visibleRows.reduce((s, r) => s + (r.totalMvmt || 0), 0);

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Mouvements RTG</h1>
          <p className="text-slate-400 text-sm mt-0.5">Mouvements réalisés, importés automatiquement depuis le rapport TOS</p>
        </div>
        <button onClick={() => setShowManuelForm(s => !s)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Ajouter des mouvements manuels
        </button>
      </div>

      {showManuelForm && (
        <Panel title="Nouvel enregistrement — mouvements manuels" icon="fa-truck-ramp-box">
          <div className="space-y-3">
            <p className="text-[11px] text-slate-500">Pour les mouvements réalisés par un conducteur mais non tracés par le TOS. Renseignez uniquement les types concernés — le total se calcule automatiquement.</p>
            {manuelError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{manuelError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Conducteur</label><DriverSelect state={state} value={manuelForm.driverId} onChange={v => setManuelForm(f => Object.assign({}, f, { driverId: v }))} teamId={shiftRestricted ? currentUser.teamId : null} /></div>
              <div><label className={LABEL_CLS}>Date</label><input type="date" className={FIELD_CLS} value={manuelForm.dateTravail} onChange={e => setManuelForm(f => Object.assign({}, f, { dateTravail: e.target.value }))} /></div>
              <div>
                <label className={LABEL_CLS}>Shift (optionnel)</label>
                <select className={FIELD_CLS} value={manuelForm.shift} onChange={e => setManuelForm(f => Object.assign({}, f, { shift: e.target.value }))}>
                  <option value="">—</option>
                  {state.config.shifts.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {MOUVEMENTS_TOS_COLUMNS.map(c => (
                <div key={c.key}>
                  <label className={LABEL_CLS}>{c.label}</label>
                  <input type="number" min="0" step="1" className={FIELD_CLS} value={manuelForm[c.key]} onChange={e => setManuelForm(f => Object.assign({}, f, { [c.key]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div><label className={LABEL_CLS}>Commentaire</label><input className={FIELD_CLS} value={manuelForm.commentaire} onChange={e => setManuelForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
            <div className="flex gap-2">
              <button onClick={submitManuel} disabled={manuelSaving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">{manuelSaving ? "Enregistrement..." : "Enregistrer"}</button>
              <button onClick={() => setShowManuelForm(false)} disabled={manuelSaving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
            </div>
          </div>
        </Panel>
      )}

      <div className="flex gap-2">
        <button onClick={() => setTab("detail")} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "detail" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Détail par jour/shift</button>
        <button onClick={() => setTab("total")} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${tab === "total" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Total par conducteur (période)</button>
      </div>

      <DriverFilterBar state={state} value={filterDriverId} onChange={setFilterDriverId} teamId={shiftRestricted ? currentUser.teamId : null} />

      {tab === "detail" && (
      <>
      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Mois</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className={FIELD_CLS}>
            {RAPPORT_MOIS_LABELS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Année</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className={`w-24 ${FIELD_CLS}`} />
        </div>
        {!loading && visibleRows.length > 0 && (
          <div className="ml-auto text-xs text-slate-400">{visibleRows.length} ligne{visibleRows.length > 1 ? "s" : ""} — <span className="text-white font-bold">{grandTotal}</span> mouvements au total</div>
        )}
      </div>

      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}

      {unmatchedLogins.length > 0 && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <i className="fas fa-triangle-exclamation mr-1.5"></i>
          {unmatchedLogins.length} login{unmatchedLogins.length > 1 ? "s" : ""} TOS non rattaché{unmatchedLogins.length > 1 ? "s" : ""} à un conducteur de l'application :{" "}
          {unmatchedLogins.map((l, i) => (
            <span key={l}>{i > 0 ? ", " : ""}{l} <button onClick={() => ignoreLogin(l)} className="underline hover:text-amber-300">(ignorer)</button></span>
          ))}
        </div>
      )}

      {loading && <div className="text-xs text-slate-500 italic px-1">Chargement...</div>}
      {!loading && byDay.length === 0 && (
        <div className="text-xs text-slate-500 italic px-1">Aucun mouvement importé pour cette période.</div>
      )}

      {!loading && byDay.map(day => (
        <div key={day.dateIso} className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 bg-surface border-b border-border font-semibold text-white text-sm">
            {RTGDate.formatFr(RTGDate.parseISO(day.dateIso))}
          </div>
          {day.shifts.map(s => (
            <div key={s.shift} className="border-b border-border last:border-b-0">
              <div className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-slate-500 flex items-center justify-between">
                <span>Shift {s.shift}</span>
                <span className="text-slate-400">{s.total} mouvement{s.total > 1 ? "s" : ""}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr className="text-left">
                      <th className="px-4 py-1">Conducteur</th><th className="px-3 py-1">Équipe</th><th className="px-3 py-1">Engin</th>
                      {MOUVEMENTS_TOS_COLUMNS.map(c => <th key={c.key} className="px-3 py-1 text-center">{c.label}</th>)}
                      <th className="px-3 py-1 text-center font-bold">Total</th>
                      <th className="px-3 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map(r => {
                      const d = r.driverId ? state.drivers.find(dr => dr.id === r.driverId) : null;
                      const team = d ? state.teams.find(t => t.id === d.teamId) : null;
                      return (
                        <tr key={r.id} className="border-t border-border/60 hover:bg-marine-600/10">
                          <td className="px-4 py-1.5 text-white">{d ? `${d.matricule} — ${d.nom} ${d.prenom}` : <span className="text-amber-400">{r.loginTos} (non rattaché)</span>}</td>
                          <td className="px-3 py-1.5 text-slate-300">{team ? team.nom : "—"}</td>
                          <td className="px-3 py-1.5 text-slate-300">{r.source === "MANUEL" ? <span className="text-sky-400">{r.engin}</span> : r.engin}</td>
                          {MOUVEMENTS_TOS_COLUMNS.map(c => <td key={c.key} className="px-3 py-1.5 text-center text-slate-300">{r[c.key]}</td>)}
                          <td className="px-3 py-1.5 text-center text-white font-bold">{r.totalMvmt}</td>
                          <td className="px-3 py-1.5">{r.source === "MANUEL" && <ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => deleteManuel(r.id)} className="text-red-400 hover:text-red-300 text-[11px]" />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ))}
      </>
      )}

      {tab === "total" && (
      <>
      <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Date début</label>
          <input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} className={FIELD_CLS} />
        </div>
        <div>
          <label className={LABEL_CLS}>Date fin</label>
          <input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} className={FIELD_CLS} />
        </div>
        <button onClick={exportTotalExcel} disabled={totalByDriver.length === 0} className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50">
          <i className="fas fa-file-excel mr-1.5"></i>Excel
        </button>
        {!totalLoading && totalRows.length > 0 && (
          <div className="ml-auto text-xs text-slate-400">{totalByDriver.length} conducteur{totalByDriver.length > 1 ? "s" : ""} — <span className="text-white font-bold">{totalGrandTotal}</span> mouvements au total</div>
        )}
      </div>

      {totalError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{totalError}</div>}

      {totalUnmatchedLogins.length > 0 && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <i className="fas fa-triangle-exclamation mr-1.5"></i>
          {totalUnmatchedLogins.length} login{totalUnmatchedLogins.length > 1 ? "s" : ""} TOS non rattaché{totalUnmatchedLogins.length > 1 ? "s" : ""} à un conducteur de l'application :{" "}
          {totalUnmatchedLogins.map((l, i) => (
            <span key={l}>{i > 0 ? ", " : ""}{l} <button onClick={() => ignoreLogin(l)} className="underline hover:text-amber-300">(ignorer)</button></span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Matricule</th><th className="px-3 py-2">Nom</th><th className="px-3 py-2">Prénom</th><th className="px-3 py-2">Équipe</th>
              {MOUVEMENTS_TOS_COLUMNS.map(c => <th key={c.key} className="px-3 py-2 text-center">{c.label}</th>)}
              <th className="px-3 py-2 text-center font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {totalLoading && <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 5} className="px-3 py-6 text-center text-slate-500 italic">Chargement...</td></tr>}
            {!totalLoading && totalByDriver.length === 0 && (
              <tr><td colSpan={MOUVEMENTS_TOS_COLUMNS.length + 5} className="px-3 py-6 text-center text-slate-500 italic">Aucun mouvement importé pour cette période.</td></tr>
            )}
            {!totalLoading && totalByDriver.map(g => {
              const d = g.driverId ? state.drivers.find(dr => dr.id === g.driverId) : null;
              const team = d ? state.teams.find(t => t.id === d.teamId) : null;
              return (
                <tr key={g.driverId || g.loginTos} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white">{d ? d.matricule : <span className="text-amber-400">{g.loginTos}</span>}</td>
                  <td className="px-3 py-2 text-white">{d ? d.nom : "(non rattaché)"}</td>
                  <td className="px-3 py-2 text-slate-300">{d ? d.prenom : ""}</td>
                  <td className="px-3 py-2 text-slate-300">{team ? team.nom : "—"}</td>
                  {MOUVEMENTS_TOS_COLUMNS.map(c => <td key={c.key} className="px-3 py-2 text-center text-slate-300">{g[c.key]}</td>)}
                  <td className="px-3 py-2 text-center text-white font-bold">{g.totalMvmt}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}
