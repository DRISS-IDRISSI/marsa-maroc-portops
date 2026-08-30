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
function emptyDriverForm() {
  return { matricule: "", nom: "", prenom: "", teamId: "A", initialZone: "A", initialVacation: "V1", dateEntree: RTGDate.toISO(new Date()), observation: "" };
}

function DriverForm({ state, initial, editingId, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");

  const submit = () => {
    if (!form.matricule.trim() || !form.nom.trim() || !form.prenom.trim()) {
      setError("Matricule, nom et prénom sont obligatoires.");
      return;
    }
    if (RTGStore.isMatriculeTaken(form.matricule.trim(), editingId)) {
      setError("Ce matricule est déjà utilisé par un autre conducteur.");
      return;
    }
    const payload = Object.assign({}, form, { matricule: form.matricule.trim(), nom: form.nom.trim().toUpperCase(), prenom: form.prenom.trim().toUpperCase() });
    if (editingId) {
      RTGStore.updateDriver(editingId, payload);
    } else {
      RTGStore.addDriver(payload);
    }
    onSaved();
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={LABEL_CLS}>Matricule</label><input className={FIELD_CLS} value={form.matricule} onChange={e => setForm(f => Object.assign({}, f, { matricule: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Nom</label><input className={FIELD_CLS} value={form.nom} onChange={e => setForm(f => Object.assign({}, f, { nom: e.target.value }))} /></div>
        <div><label className={LABEL_CLS}>Prénom</label><input className={FIELD_CLS} value={form.prenom} onChange={e => setForm(f => Object.assign({}, f, { prenom: e.target.value }))} /></div>
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select className={FIELD_CLS} value={form.teamId} onChange={e => setForm(f => Object.assign({}, f, { teamId: e.target.value }))}>
            {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Zone initiale</label>
          <select className={FIELD_CLS} value={form.initialZone} onChange={e => setForm(f => Object.assign({}, f, { initialZone: e.target.value }))}>
            {state.config.zones.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Vacation initiale</label>
          <select className={FIELD_CLS} value={form.initialVacation} onChange={e => setForm(f => Object.assign({}, f, { initialVacation: e.target.value }))}>
            {state.config.vacationCycle.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div><label className={LABEL_CLS}>Date d'entrée</label><input type="date" className={FIELD_CLS} value={form.dateEntree} onChange={e => setForm(f => Object.assign({}, f, { dateEntree: e.target.value }))} /></div>
        <div className="sm:col-span-2"><label className={LABEL_CLS}>Observation</label><input className={FIELD_CLS} value={form.observation} onChange={e => setForm(f => Object.assign({}, f, { observation: e.target.value }))} /></div>
      </div>
      <div className="flex gap-2">
        <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">{editingId ? "Enregistrer" : "Créer le conducteur"}</button>
        <button onClick={onCancel} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </div>
    </div>
  );
}

function DriversPage() {
  const state = useRtgState();
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("actifs");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const drivers = useMemo(() => state.drivers.filter(d =>
    (teamFilter === "all" || d.teamId === teamFilter) &&
    (statusFilter === "tous" || (statusFilter === "actifs" ? d.actif !== false : d.actif === false))
  ), [state.drivers, teamFilter, statusFilter]);

  const today = RTGDate.toISO(new Date());
  const todayDate = RTGDate.parseISO(today);

  const editingDriver = editingId ? state.drivers.find(d => d.id === editingId) : null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Conducteurs</h1>
          <p className="text-slate-400 text-sm mt-0.5">{state.drivers.filter(d => d.actif !== false).length} conducteurs actifs sur {state.drivers.length}</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau conducteur
        </button>
      </div>

      {showForm && (
        <Panel title={editingId ? "Modifier le conducteur" : "Nouveau conducteur"} icon="fa-user-plus">
          <DriverForm state={state} initial={editingDriver ? { matricule: editingDriver.matricule, nom: editingDriver.nom, prenom: editingDriver.prenom, teamId: editingDriver.teamId, initialZone: editingDriver.initialZone, initialVacation: editingDriver.initialVacation, dateEntree: editingDriver.dateEntree, observation: editingDriver.observation || "" } : emptyDriverForm()}
            editingId={editingId} onCancel={() => { setShowForm(false); setEditingId(null); }} onSaved={() => { setShowForm(false); setEditingId(null); }} />
        </Panel>
      )}

      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border p-4">
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select className={FIELD_CLS} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="all">Toutes</option>
            {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL_CLS}>Statut</label>
          <select className={FIELD_CLS} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="actifs">Actifs</option>
            <option value="inactifs">Inactifs</option>
            <option value="tous">Tous</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Mat</th><th className="px-3 py-2">Nom</th><th className="px-3 py-2">Prénom</th>
              <th className="px-3 py-2">Équipe</th><th className="px-3 py-2">Shift auj.</th><th className="px-3 py-2">Zone init.</th>
              <th className="px-3 py-2">Vacation init.</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Actions</th>
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
                    <td className="px-3 py-2 text-slate-300">{d.prenom}</td>
                    <td className="px-3 py-2 text-slate-400">{team ? team.nom : d.teamId}</td>
                    <td className="px-3 py-2 text-slate-400">{shift}</td>
                    <td className="px-3 py-2 text-center"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{d.initialZone}</span></td>
                    <td className="px-3 py-2 text-center">{d.initialVacation}</td>
                    <td className="px-3 py-2">
                      {d.actif !== false
                        ? <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Actif</span>
                        : <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">Inactif</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => { setEditingId(d.id); setShowForm(true); }} className="text-orange-400 hover:text-orange-300">Modifier</button>
                        <button onClick={() => setHistoryFor(historyFor === d.id ? null : d.id)} className="text-marine-300 hover:text-white">Historique</button>
                        {d.actif !== false
                          ? <ConfirmButton label="Désactiver" confirmLabel="Désactiver ?" onConfirm={() => RTGStore.setDriverActive(d.id, false)} className="text-red-400 hover:text-red-300 text-xs" />
                          : <ConfirmButton label="Réactiver" confirmLabel="Réactiver ?" onConfirm={() => RTGStore.setDriverActive(d.id, true)} className="text-emerald-400 hover:text-emerald-300 text-xs" />}
                      </div>
                    </td>
                  </tr>
                  {historyFor === d.id && (
                    <tr className="bg-surface/40">
                      <td colSpan="9" className="px-4 py-3">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Historique — {d.nom} {d.prenom}</div>
                        {state.auditLog.filter(a => a.driverId === d.id).length === 0
                          ? <p className="text-xs text-slate-500 italic">Aucune entrée.</p>
                          : (
                            <ul className="space-y-1 text-xs">
                              {state.auditLog.filter(a => a.driverId === d.id).map(a => (
                                <li key={a.id} className="text-slate-400">
                                  <span className="text-slate-600">{new Date(a.date).toLocaleString("fr-FR")}</span> — <span className="text-white">{a.action}</span>{a.details ? " — " + a.details : ""}
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
function DriverSelect({ state, value, onChange, onlyActive }) {
  const drivers = onlyActive ? state.drivers.filter(d => d.actif !== false) : state.drivers;
  return (
    <select className={FIELD_CLS} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— Sélectionner —</option>
      {drivers.map(d => <option key={d.id} value={d.id}>{d.matricule} — {d.nom} {d.prenom}</option>)}
    </select>
  );
}

function driverLabel(state, driverId) {
  const d = state.drivers.find(x => x.id === driverId);
  return d ? d.matricule + " — " + d.nom + " " + d.prenom : "(conducteur supprimé)";
}

// ==========================================
// 2/3/4. Congés / Maladies / Absences — page générique
// ==========================================
function RecordsPage({ title, icon, listKey, kindLabel, showTypeSelect, addFn, deleteFn }) {
  const state = useRtgState();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), type: showTypeSelect ? "ABSENCE" : "", commentaire: "" });
  const [error, setError] = useState("");

  const records = state[listKey].slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));

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
              <div className="sm:col-span-2"><label className={LABEL_CLS}>Conducteur</label><DriverSelect state={state} value={form.driverId} onChange={v => setForm(f => Object.assign({}, f, { driverId: v }))} /></div>
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

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date début</th><th className="px-3 py-2">Date fin</th>
              {showTypeSelect && <th className="px-3 py-2">Type</th>}
              <th className="px-3 py-2">Commentaire</th><th className="px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan={showTypeSelect ? 7 : 6} className="px-3 py-6 text-center text-slate-500 italic">Aucun enregistrement.</td></tr>
            )}
            {records.map(r => (
              <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                <td className="px-3 py-2 text-white">{driverLabel(state, r.driverId)}</td>
                <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                <td className="px-3 py-2 text-slate-300">{r.dateFin}</td>
                {showTypeSelect && <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded ${r.type === "FORMATION" ? "bg-blue-600/30 text-blue-300" : "bg-red-600/30 text-red-300"}`}>{r.type === "FORMATION" ? "Formation" : "Absence"}</span></td>}
                <td className="px-3 py-2 text-slate-400">{r.type && !showTypeSelect ? r.type : r.commentaire}</td>
                <td className="px-3 py-2 text-slate-500">{r.utilisateur}</td>
                <td className="px-3 py-2"><ConfirmButton label="Supprimer" confirmLabel="Supprimer ?" onConfirm={() => deleteFn(r.id)} className="text-red-400 hover:text-red-300 text-xs" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CongesPage() {
  return <RecordsPage title="Congés" icon="fa-umbrella-beach" listKey="conges" kindLabel="congé"
    addFn={f => RTGStore.addConge({ driverId: f.driverId, dateDebut: f.dateDebut, dateFin: f.dateFin, type: f.commentaire || "Congé annuel", commentaire: f.commentaire })}
    deleteFn={id => RTGStore.deleteConge(id)} />;
}

function MaladiesPage() {
  return <RecordsPage title="Maladies" icon="fa-briefcase-medical" listKey="maladies" kindLabel="maladie"
    addFn={f => RTGStore.addMaladie({ driverId: f.driverId, dateDebut: f.dateDebut, dateFin: f.dateFin, commentaire: f.commentaire })}
    deleteFn={id => RTGStore.deleteMaladie(id)} />;
}

function AbsencesPage() {
  return <RecordsPage title="Absences & Formations" icon="fa-user-slash" listKey="absences" kindLabel="absence/formation" showTypeSelect
    addFn={f => RTGStore.addAbsence({ driverId: f.driverId, dateDebut: f.dateDebut, dateFin: f.dateFin, type: f.type, commentaire: f.commentaire })}
    deleteFn={id => RTGStore.deleteAbsence(id)} />;
}

// ==========================================
// 5. Remplacement (§27)
// ==========================================
function RemplacementPage() {
  const state = useRtgState();
  const [dateStr, setDateStr] = useState(RTGDate.toISO(new Date()));
  const [absentId, setAbsentId] = useState("");
  const [chosenId, setChosenId] = useState("");
  const [applied, setApplied] = useState(null);

  const date = RTGDate.parseISO(dateStr);
  const assignments = useMemo(() => PlanningEngine.generateDailyAssignments(dateStr, state), [state, dateStr]);
  const absentDrivers = assignments.filter(a => ["CONGE", "MALADIE", "ABSENCE", "FORMATION"].indexOf(a.status) !== -1);

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
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-400">
                  <tr className="text-left border-b border-border">
                    <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="py-1.5 pr-3">Prénom</th>
                    <th className="py-1.5 pr-3">Zone propre</th><th className="py-1.5 pr-3">Jours travaillés</th>
                    <th className="py-1.5 pr-3">Jours repos</th><th className="py-1.5 pr-3">Dernière affect.</th><th className="py-1.5 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map(c => (
                    <tr key={c.driver.id} className={`border-b border-border/50 ${chosenId === c.driver.id ? "bg-orange-500/10" : ""}`}>
                      <td className="py-1.5 pr-3 text-slate-300">{c.driver.matricule}</td>
                      <td className="py-1.5 pr-3 text-white font-medium">{c.driver.nom}</td>
                      <td className="py-1.5 pr-3 text-slate-300">{c.driver.prenom}</td>
                      <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{assignments.find(a => a.driverId === c.driver.id) ? assignments.find(a => a.driverId === c.driver.id).zone : "—"}</span></td>
                      <td className="py-1.5 pr-3 text-slate-400">{c.joursTravailles}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{c.joursRepos}</td>
                      <td className="py-1.5 pr-3 text-slate-400">{c.derniereAffectation || "—"}</td>
                      <td className="py-1.5 pr-3">
                        <button onClick={() => setChosenId(c.driver.id)} className="text-xs px-2.5 py-1 rounded-lg bg-marine-800 text-slate-300 hover:bg-orange-500 hover:text-white transition-all">Choisir</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
