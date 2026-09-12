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
function emptyDriverForm(lockedTeamId) {
  return { matricule: "", nom: "", prenom: "", teamId: lockedTeamId || "A", initialZone: "A", initialVacation: "V1", dateEntree: RTGDate.toISO(new Date()), observation: "" };
}

function DriverForm({ state, initial, editingId, onCancel, onSaved, lockedTeamId }) {
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
    const teamId = lockedTeamId || form.teamId;
    const payload = Object.assign({}, form, { teamId: teamId, matricule: form.matricule.trim(), nom: form.nom.trim().toUpperCase(), prenom: form.prenom.trim().toUpperCase() });
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
            {state.config.zones.map(z => <option key={z} value={z}>{z}</option>)}
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
      <div className="flex gap-2">
        <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">{editingId ? "Enregistrer" : "Créer le conducteur"}</button>
        <button onClick={onCancel} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
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

function DriversPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [teamFilter, setTeamFilter] = useState(shiftRestricted ? currentUser.teamId : "all");
  const [statusFilter, setStatusFilter] = useState("actifs");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const visibleTeams = shiftRestricted ? state.teams.filter(t => t.id === currentUser.teamId) : state.teams;

  const drivers = useMemo(() => state.drivers.filter(d =>
    (shiftRestricted ? d.teamId === currentUser.teamId : (teamFilter === "all" || d.teamId === teamFilter)) &&
    (statusFilter === "tous" || (statusFilter === "actifs" ? d.actif !== false : d.actif === false))
  ), [state.drivers, teamFilter, statusFilter, shiftRestricted, currentUser]);

  const today = RTGDate.toISO(new Date());
  const todayDate = RTGDate.parseISO(today);

  const editingDriver = editingId ? state.drivers.find(d => d.id === editingId) : null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Conducteurs</h1>
          <p className="text-slate-400 text-sm mt-0.5">{drivers.filter(d => d.actif !== false).length} conducteurs actifs{shiftRestricted ? " — " + visibleTeams[0].nom : " sur " + state.drivers.length}</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau conducteur
        </button>
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
      </div>
      {!shiftRestricted && <p className="text-xs text-slate-500 -mt-2">Modifiez l'équipe d'un conducteur (bouton « Modifier ») pour rééquilibrer les effectifs entre shifts.</p>}

      {showForm && (
        <Panel title={editingId ? "Modifier le conducteur" : "Nouveau conducteur"} icon="fa-user-plus">
          <DriverForm state={state} lockedTeamId={shiftRestricted ? currentUser.teamId : null}
            initial={editingDriver ? { matricule: editingDriver.matricule, nom: editingDriver.nom, prenom: editingDriver.prenom, teamId: editingDriver.teamId, initialZone: editingDriver.initialZone, initialVacation: editingDriver.initialVacation, dateEntree: editingDriver.dateEntree, observation: editingDriver.observation || "" } : emptyDriverForm(shiftRestricted ? currentUser.teamId : null)}
            editingId={editingId} onCancel={() => { setShowForm(false); setEditingId(null); }} onSaved={() => { setShowForm(false); setEditingId(null); }} />
        </Panel>
      )}

      <div className="flex flex-wrap gap-3 bg-card rounded-xl border border-border p-4">
        {!shiftRestricted && (
        <div>
          <label className={LABEL_CLS}>Équipe</label>
          <select className={FIELD_CLS} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="all">Toutes</option>
            {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
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
              <th className="hidden sm:table-cell px-3 py-2">Bloc vacation</th><th className="hidden sm:table-cell px-3 py-2">Statut</th><th className="px-3 py-2">Actions</th>
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
function DriverSelect({ state, value, onChange, onlyActive, teamId }) {
  let drivers = onlyActive ? state.drivers.filter(d => d.actif !== false) : state.drivers;
  if (teamId) drivers = drivers.filter(d => d.teamId === teamId);
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
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ driverId: "", dateDebut: RTGDate.toISO(new Date()), dateFin: RTGDate.toISO(new Date()), type: showTypeSelect ? "ABSENCE" : "", commentaire: "" });
  const [error, setError] = useState("");

  const records = state[listKey]
    .filter(r => {
      if (!shiftRestricted) return true;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      return d && d.teamId === currentUser.teamId;
    })
    .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));

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

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date début</th><th className="px-3 py-2">Date fin</th>
              {showTypeSelect && <th className="px-3 py-2">Type</th>}
              <th className="px-3 py-2">Commentaire</th><th className="hidden sm:table-cell px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
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
                <td className="hidden sm:table-cell px-3 py-2 text-slate-500">{r.utilisateur}</td>
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
// 5. Heures exceptionnelles — doublage / férié travaillé / dimanche S3 (§29)
// ==========================================
const HEURE_EXCEPTIONNELLE_TYPES = {
  DOUBLAGE: { label: "Doublage", icon: "fa-layer-group", className: "bg-amber-600/30 text-amber-300" },
  FERIE_TRAVAILLE: { label: "Jour férié travaillé", icon: "fa-star-and-crescent", className: "bg-indigo-600/30 text-indigo-300" },
  DIMANCHE_S3: { label: "3ème shift dimanche (nécessité de service)", icon: "fa-triangle-exclamation", className: "bg-rose-600/30 text-rose-300" }
};

function emptyHeureExceptionnelleForm() {
  return { driverId: "", date: RTGDate.toISO(new Date()), type: "DOUBLAGE", heures: 8, commentaire: "" };
}

function HeuresExceptionnellesPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyHeureExceptionnelleForm());
  const [error, setError] = useState("");

  const records = state.heuresExceptionnelles
    .filter(r => {
      if (!shiftRestricted) return true;
      const d = state.drivers.find(dr => dr.id === r.driverId);
      return d && d.teamId === currentUser.teamId;
    })
    .slice().sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));

  const submit = () => {
    if (!form.driverId) { setError("Sélectionnez un conducteur."); return; }
    const heures = Number(form.heures);
    if (!heures || heures <= 0) { setError("Le nombre d'heures doit être supérieur à 0."); return; }
    RTGStore.addHeureExceptionnelle({ driverId: form.driverId, dateDebut: form.date, dateFin: form.date, type: form.type, heures: heures, commentaire: form.commentaire });
    setForm(emptyHeureExceptionnelleForm());
    setError("");
    setShowForm(false);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Heures exceptionnelles</h1>
          <p className="text-slate-400 text-sm mt-0.5">Doublage, jour férié travaillé, 3ème shift dimanche (nécessité de service) — {records.length} enregistrement{records.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => setShowForm(s => !s)} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouveau
        </button>
      </div>

      {showForm && (
        <Panel title="Nouvel enregistrement — heures exceptionnelles" icon="fa-clock-rotate-left">
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
              <div className="sm:col-span-3"><label className={LABEL_CLS}>Commentaire</label><input className={FIELD_CLS} value={form.commentaire} onChange={e => setForm(f => Object.assign({}, f, { commentaire: e.target.value }))} /></div>
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

      <p className="sm:hidden text-[11px] text-slate-500"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir plus de colonnes</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Conducteur</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Heures</th><th className="hidden sm:table-cell px-3 py-2">Commentaire</th><th className="hidden sm:table-cell px-3 py-2">Utilisateur</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr><td colSpan="7" className="px-3 py-6 text-center text-slate-500 italic">Aucun enregistrement.</td></tr>
            )}
            {records.map(r => {
              const meta = HEURE_EXCEPTIONNELLE_TYPES[r.type] || { label: r.type, className: "bg-slate-700 text-slate-300" };
              return (
                <tr key={r.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white">{driverLabel(state, r.driverId)}</td>
                  <td className="px-3 py-2 text-slate-300">{r.dateDebut}</td>
                  <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded ${meta.className}`}>{meta.label}</span></td>
                  <td className="px-3 py-2 text-slate-300 text-center">{r.heures}h</td>
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
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
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

function RapportRHPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState(shiftRestricted ? currentUser.teamId : "all");
  const effectiveTeamId = shiftRestricted ? currentUser.teamId : teamId;

  const report = useMemo(() => buildRapportRH(state, month, year, effectiveTeamId), [state, month, year, effectiveTeamId]);
  const generatedAt = new Date();

  const th = "px-2 py-2 text-left font-semibold border-b-2 border-slate-300 whitespace-nowrap";
  const td = "px-2 py-1.5 border-b border-slate-200 whitespace-nowrap";
  const tdCenter = td + " text-center";

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Rapport RH</h1>
          <p className="text-slate-400 text-sm mt-0.5">Récapitulatif mensuel à imprimer / envoyer au service RH</p>
        </div>
        <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-print mr-1.5"></i>Imprimer / PDF
        </button>
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
      <div className="bg-white text-slate-900 rounded-xl border border-slate-300 p-4 sm:p-6 print:rounded-none print:border-0 print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
          <div>
            <div className="text-base sm:text-lg font-bold">Marsa Maroc — Terminal à Conteneurs</div>
            <div className="text-xs sm:text-sm text-slate-600">Rapport RH — Conducteurs RTG — {RAPPORT_MOIS_LABELS[month - 1]} {year}{effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : ""}</div>
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
                <th className={th}>Total h except.</th>
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
          Document généré automatiquement par RTG Driver Planner — à valider par le Responsable Exploitation avant transmission au Service RH.
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 8. Utilisateurs (§30) — réservé au rôle ADMIN
// ==========================================
const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Administrateur — accès complet + gestion des utilisateurs" },
  { value: "RESPONSABLE", label: "Responsable — accès opérationnel complet, toutes équipes" },
  { value: "RESPONSABLE_SHIFT", label: "Responsable de Shift — accès limité à SON équipe" }
];

function emptyUserForm() {
  return { nom: "", username: "", password: "", role: "RESPONSABLE_SHIFT", teamId: "A" };
}

function UserForm({ state, initial, editingId, onCancel, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");

  const submit = () => {
    if (!form.nom.trim() || !form.username.trim()) { setError("Nom et identifiant sont obligatoires."); return; }
    if (!editingId && !form.password) { setError("Mot de passe obligatoire à la création."); return; }
    if (RTGStore.isUsernameTaken(form.username.trim(), editingId)) { setError("Cet identifiant est déjà utilisé."); return; }
    if (form.role === "RESPONSABLE_SHIFT" && !form.teamId) { setError("Sélectionnez l'équipe pour un Responsable de Shift."); return; }

    const payload = { nom: form.nom.trim(), username: form.username.trim(), role: form.role, teamId: form.role === "RESPONSABLE_SHIFT" ? form.teamId : null };
    if (form.password) payload.password = form.password;

    if (editingId) {
      RTGStore.updateUser(editingId, payload);
    } else {
      RTGStore.addUser(payload);
    }
    onSaved();
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
              {state.teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={submit} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">{editingId ? "Enregistrer" : "Créer l'utilisateur"}</button>
        <button onClick={onCancel} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white">Annuler</button>
      </div>
    </div>
  );
}

function UsersPage() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

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
          <p className="text-slate-400 text-sm mt-0.5">{state.users.length} compte{state.users.length > 1 ? "s" : ""} — Admin, Responsable, Responsable de Shift</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingId(null); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-plus mr-1.5"></i>Nouvel utilisateur
        </button>
      </div>

      <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
        <i className="fas fa-circle-info mr-1.5"></i>Cette application n'a pas de serveur : ces comptes filtrent l'accès dans l'interface, ce n'est pas une sécurité contre quelqu'un qui inspecterait le stockage local du navigateur.
      </p>

      {showForm && (
        <Panel title={editingId ? "Modifier l'utilisateur" : "Nouvel utilisateur"} icon="fa-user-shield">
          <UserForm state={state} editingId={editingId}
            initial={editingUser ? { nom: editingUser.nom, username: editingUser.username, password: "", role: editingUser.role, teamId: editingUser.teamId || "A" } : emptyUserForm()}
            onCancel={() => { setShowForm(false); setEditingId(null); }} onSaved={() => { setShowForm(false); setEditingId(null); }} />
        </Panel>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface text-slate-400">
            <tr className="text-left">
              <th className="px-3 py-2">Nom</th><th className="px-3 py-2">Identifiant</th><th className="px-3 py-2">Rôle</th>
              <th className="px-3 py-2">Équipe</th><th className="px-3 py-2">Statut</th><th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.users.map(u => {
              const team = u.teamId ? state.teams.find(t => t.id === u.teamId) : null;
              const isSelf = currentUser.id === u.id;
              return (
                <tr key={u.id} className="border-t border-border hover:bg-marine-600/10">
                  <td className="px-3 py-2 text-white font-medium">{u.nom}{isSelf ? <span className="text-slate-500"> (vous)</span> : ""}</td>
                  <td className="px-3 py-2 text-slate-300">{u.username}</td>
                  <td className="px-3 py-2 text-slate-400">{ROLE_LABELS[u.role] || u.role}</td>
                  <td className="px-3 py-2 text-slate-400">{team ? team.nom : "—"}</td>
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
