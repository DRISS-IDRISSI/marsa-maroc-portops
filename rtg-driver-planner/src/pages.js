const { useState, useMemo, useEffect } = React;
const { useNavigate } = ReactRouterDOM;

function useRtgState() {
  const [state, setState] = useState(RTGStore.get());
  useEffect(() => RTGStore.subscribe(setState), []);
  return state;
}

// Utilisateur connecté (§30) — null si personne n'est connecté (AuthGate
// affiche alors l'écran de connexion à la place de l'appli).
function useCurrentUser() {
  const state = useRtgState();
  return state.users.find(u => u.id === state.currentUserId) || null;
}

const ROLE_LABELS = { ADMIN: "Administrateur", RESPONSABLE: "Responsable Exploitation", RESPONSABLE_SHIFT: "Responsable de Shift" };

// Un Responsable de Shift ne voit/agit que sur SON équipe (teamId) ; les autres
// rôles (Admin, Responsable) ont accès à toutes les équipes — §30.
function isShiftRestricted(user) {
  return !!user && user.role === "RESPONSABLE_SHIFT";
}

// ==========================================
// Codes / légende
// ==========================================
const RTG_STATUS_META = {
  PRESENT: { code: "C", label: "Travail", className: "bg-amber-500/25 text-amber-300 border-amber-500/40" },
  REPOS: { code: "R", label: "Repos", className: "bg-rose-500/20 text-rose-300 border-rose-500/30" },
  CONGE: { code: "CG", label: "Congé", className: "bg-orange-600/30 text-orange-300 border-orange-600/40" },
  MALADIE: { code: "M", label: "Maladie", className: "bg-purple-600/30 text-purple-300 border-purple-600/40" },
  ABSENCE: { code: "A", label: "Absence", className: "bg-red-600/30 text-red-300 border-red-600/40" },
  FORMATION: { code: "F", label: "Formation", className: "bg-blue-600/30 text-blue-300 border-blue-600/40" },
  OFF: { code: "OFF", label: "Off (Shift 3 dimanche)", className: "bg-slate-950 text-slate-500 border-slate-800" },
  FERIE: { code: "FÉR", label: "Jour férié (chômé)", className: "bg-indigo-500/25 text-indigo-300 border-indigo-500/40" }
};

// Styles pour les rapports imprimables ("papier" clair, indépendant du thème
// sombre de l'appli) — même convention que le Rapport RH (pages2.js).
const PRINT_TH = "px-2 py-1.5 text-left font-semibold border-b-2 border-slate-300 whitespace-nowrap";
const PRINT_TD = "px-2 py-1 border-b border-slate-200 whitespace-nowrap";
const PRINT_TD_CENTER = PRINT_TD + " text-center";
const RAPPORT_MOIS_LABELS_P = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

function PrintHeader({ subtitle, count, countLabel }) {
  const generatedAt = new Date();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
      <div>
        <div className="text-base sm:text-lg font-bold">Marsa Maroc — Terminal à Conteneurs</div>
        <div className="text-xs sm:text-sm text-slate-600">{subtitle}</div>
      </div>
      <div className="sm:text-right text-xs text-slate-500">
        <div>Généré le {generatedAt.toLocaleDateString("fr-FR")} à {generatedAt.toLocaleTimeString("fr-FR")}</div>
        {count != null && <div>{count} {countLabel}{count > 1 ? "s" : ""}</div>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {Object.entries(RTG_STATUS_META).map(([key, meta]) => (
        <span key={key} className={`px-2 py-1 rounded border ${meta.className}`}>{meta.code} = {meta.label}</span>
      ))}
    </div>
  );
}

function MonthYearTeamPicker({ month, setMonth, year, setYear, teamId, setTeamId, teams, detailLevel, setDetailLevel, lockTeam }) {
  const months = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  return (
    <div className="flex flex-wrap items-end gap-3 bg-card rounded-xl border border-border p-4">
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mois</label>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
          {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Année</label>
        <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-24 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
      </div>
      {!lockTeam && (
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Équipe</label>
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
          <option value="all">Toutes les équipes</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
        </select>
      </div>
      )}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Détail</label>
        <div className="flex gap-1">
          {[["code","C"],["vacation","V1"],["zone","V1/A"]].map(([k,l]) => (
            <button key={k} onClick={() => setDetailLevel(k)}
              className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${detailLevel === k ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>{l}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValidationBanner({ validation }) {
  if (!validation) return null;
  if (validation.valid) {
    return (
      <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl px-4 py-3 text-sm font-medium">
        <i className="fas fa-circle-check"></i> Planning valide — aucune anomalie détectée
      </div>
    );
  }
  return (
    <details className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium flex items-center gap-2">
        <i className="fas fa-triangle-exclamation"></i> {validation.count} anomalie{validation.count > 1 ? "s" : ""} détectée{validation.count > 1 ? "s" : ""}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr className="text-left border-b border-red-500/20">
              <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Matricule</th><th className="py-1 pr-3">Conducteur</th>
              <th className="py-1 pr-3">Anomalie</th><th className="py-1 pr-3">Attendu</th><th className="py-1 pr-3">Trouvé</th>
            </tr>
          </thead>
          <tbody>
            {validation.anomalies.slice(0, 200).map((a, i) => (
              <tr key={i} className="border-b border-red-500/10">
                <td className="py-1 pr-3 whitespace-nowrap">{a.date === "—" ? "—" : a.date.slice(8,10) + "/" + a.date.slice(5,7)}</td>
                <td className="py-1 pr-3">{a.matricule}</td>
                <td className="py-1 pr-3 whitespace-nowrap">{a.nom} {a.prenom}</td>
                <td className="py-1 pr-3">{a.type}</td>
                <td className="py-1 pr-3">{a.attendu}</td>
                <td className="py-1 pr-3">{a.trouve}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Cell({ assignment, detailLevel }) {
  if (!assignment) return <td className="border border-border/60 bg-surface/40"></td>;
  const meta = RTG_STATUS_META[assignment.status] || { code: assignment.status, className: "text-slate-400" };
  let text = meta.code;
  if (assignment.status === "PRESENT" && detailLevel !== "code") {
    const parts = [];
    if (assignment.vacation) parts.push(assignment.vacation);
    if (detailLevel === "zone" && assignment.zone) parts.push(assignment.zone);
    text = parts.length ? parts.join("/") : meta.code;
  }
  return (
    <td className={`border border-border/60 text-center text-[11px] font-semibold px-1 py-1.5 ${meta.className}`} title={assignment.shift ? `${assignment.shift} ${assignment.startTime || ""}-${assignment.endTime || ""} · Zone ${assignment.zone || "-"}` : meta.label}>
      {text}
    </td>
  );
}

function PlanningGrid({ planning, drivers, detailLevel, config }) {
  return (
    <div>
      <p className="sm:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir tous les jours</p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="border-collapse text-xs w-full">
          <thead>
            <tr className="bg-surface">
              <th className="sticky left-0 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10">Mat</th>
              <th className="sticky left-14 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10 min-w-[90px] sm:min-w-[110px]">Nom</th>
              <th className="hidden sm:table-cell border border-border/60 px-2 py-2 text-left text-slate-300 min-w-[90px]">Prénom</th>
              <th className="hidden sm:table-cell border border-border/60 px-2 py-2 text-slate-300">Équipe</th>
              {planning.days.map(day => {
                const holiday = HolidayEngine.getHoliday(day.iso, config);
                return (
                  <th key={day.iso} className={`border border-border/60 px-1 sm:px-1.5 py-2 min-w-[26px] sm:min-w-[34px] ${holiday ? "bg-indigo-500/20 text-indigo-300" : "text-slate-400"}`} title={holiday ? holiday.label : undefined}>
                    {String(day.day).padStart(2, "0")}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {drivers.map(driver => (
              <tr key={driver.id} className="hover:bg-marine-600/10">
                <td className="sticky left-0 bg-card border border-border/60 px-2 py-1.5 text-slate-300 z-10">{driver.matricule}</td>
                <td className="sticky left-14 bg-card border border-border/60 px-2 py-1.5 text-white font-medium z-10">{driver.nom}</td>
                <td className="hidden sm:table-cell border border-border/60 px-2 py-1.5 text-slate-400">{driver.prenom}</td>
                <td className="hidden sm:table-cell border border-border/60 px-2 py-1.5 text-center text-slate-400">{driver.teamId}</td>
                {planning.days.map(day => {
                  const a = day.assignments.find(x => x.driverId === driver.id);
                  return <Cell key={day.iso} assignment={a} detailLevel={detailLevel} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftBlock({ title, icon, rows }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <i className={`fas ${icon} text-orange-400 text-sm`}></i>
        <h3 className="text-white text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-slate-500">{rows.length} conducteur{rows.length > 1 ? "s" : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Aucun conducteur affecté.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr className="text-left border-b border-border">
                <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="hidden sm:table-cell py-1.5 pr-3">Prénom</th>
                <th className="hidden sm:table-cell py-1.5 pr-3">Équipe</th><th className="py-1.5 pr-3">Vacation</th><th className="hidden sm:table-cell py-1.5 pr-3">Horaire</th>
                <th className="py-1.5 pr-3">Zone</th><th className="hidden sm:table-cell py-1.5 pr-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.driverId} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 text-slate-300">{a.matricule}</td>
                  <td className="py-1.5 pr-3 text-white font-medium">{a.nom}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-300">{a.prenom}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.teamNom}</td>
                  <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-marine-600/20 text-marine-300">{a.vacation}</span></td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.startTime}–{a.endTime}</td>
                  <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{a.zone}</span></td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-emerald-400">{a.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 1. Accueil
// ==========================================
function Home() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const nav = useNavigate();
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const todayIso = RTGDate.toISO(RTGDate.makeDate(year, month, Math.min(today.getUTCDate(), planning.days.length)));
  const todayAssignments = useMemo(() => {
    const all = PlanningEngine.generateDailyAssignments(todayIso, state);
    return shiftRestricted ? all.filter(a => a.teamId === currentUser.teamId) : all;
  }, [state, todayIso, shiftRestricted, currentUser]);

  const counts = { PRESENT: 0, REPOS: 0, CONGE: 0, MALADIE: 0, ABSENCE: 0, FORMATION: 0, OFF: 0 };
  todayAssignments.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

  const byTeam = (shiftRestricted ? state.teams.filter(t => t.id === currentUser.teamId) : state.teams).map(t => ({
    team: t,
    shift: ShiftRotationEngine.getTeamShiftForDate(t, RTGDate.parseISO(todayIso), state.config)
  }));

  const validation = shiftRestricted
    ? (() => {
        const anomalies = planning.validation.anomalies.filter(a => {
          const d = state.drivers.find(dr => dr.id === a.driverId);
          return d && d.teamId === currentUser.teamId;
        });
        return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
      })()
    : planning.validation;

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">RTG Driver Planner</h1>
        <p className="text-slate-400 text-sm mt-0.5">Gestion des conducteurs RTG — Terminal à conteneurs — {RTGDate.formatFr(RTGDate.parseISO(todayIso))}{shiftRestricted ? " — " + byTeam[0].team.nom : ""}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KPICard icon="fa-user-check" label="Présents" value={counts.PRESENT} color="green" />
        <KPICard icon="fa-bed" label="Repos" value={counts.REPOS} color="blue" />
        <KPICard icon="fa-umbrella-beach" label="Congés" value={counts.CONGE} color="orange" />
        <KPICard icon="fa-briefcase-medical" label="Maladies" value={counts.MALADIE} color="purple" />
        <KPICard icon="fa-user-slash" label="Absences" value={counts.ABSENCE} color="red" />
        <KPICard icon="fa-graduation-cap" label="Formations" value={counts.FORMATION} color="blue" />
        <KPICard icon="fa-power-off" label="Off (S3 dim.)" value={counts.OFF} color="red" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {byTeam.map(({ team, shift }) => (
          <div key={team.id} className="bg-card rounded-xl border border-border p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{team.nom}</div>
            <div className="text-2xl font-bold text-white">{shift}</div>
            <div className="text-xs text-slate-500 mt-1">{(state.config.shifts.find(s => s.id === shift) || {}).start} – {(state.config.shifts.find(s => s.id === shift) || {}).end}</div>
          </div>
        ))}
      </div>

      <ValidationBanner validation={validation} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => nav("/planning")} className="text-left bg-card rounded-xl border border-border p-5 hover:border-orange-400 transition-all flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-marine-500 to-marine-700 flex items-center justify-center text-white text-lg"><i className="fas fa-calendar-alt"></i></div>
          <div>
            <div className="text-white font-semibold text-sm">Planning mensuel</div>
            <div className="text-xs text-slate-500">Vue complète du mois par équipe, rotation shift/zone/vacation</div>
          </div>
        </button>
        <button onClick={() => nav("/affectation")} className="text-left bg-card rounded-xl border border-border p-5 hover:border-orange-400 transition-all flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white text-lg"><i className="fas fa-clipboard-list"></i></div>
          <div>
            <div className="text-white font-semibold text-sm">Affectation du jour</div>
            <div className="text-xs text-slate-500">3 shifts × 2 vacations, zones et horaires pour une date donnée</div>
          </div>
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 2. Planning mensuel
// ==========================================
// Version imprimable (noir sur blanc, sans couleurs pour économiser l'encre) du
// planning mensuel — visible uniquement à l'impression / export PDF.
function PlanningGridPrintable({ planning, drivers, config }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-[10px] w-full">
        <thead>
          <tr>
            <th className={PRINT_TH}>Mat</th>
            <th className={PRINT_TH}>Nom</th>
            <th className={PRINT_TH}>Prénom</th>
            <th className={PRINT_TH}>Équipe</th>
            {planning.days.map(day => {
              const holiday = HolidayEngine.getHoliday(day.iso, config);
              return <th key={day.iso} className={PRINT_TH + " text-center px-1"} title={holiday ? holiday.label : undefined}>{String(day.day).padStart(2, "0")}{holiday ? "*" : ""}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {drivers.map(driver => (
            <tr key={driver.id}>
              <td className={PRINT_TD}>{driver.matricule}</td>
              <td className={PRINT_TD + " font-medium"}>{driver.nom}</td>
              <td className={PRINT_TD}>{driver.prenom}</td>
              <td className={PRINT_TD}>{driver.teamId}</td>
              {planning.days.map(day => {
                const a = day.assignments.find(x => x.driverId === driver.id);
                if (!a) return <td key={day.iso} className={PRINT_TD_CENTER}>—</td>;
                const meta = RTG_STATUS_META[a.status] || { code: a.status };
                let text = meta.code;
                if (a.status === "PRESENT") text = [a.vacation, a.zone].filter(Boolean).join("-") || meta.code;
                return <td key={day.iso} className={PRINT_TD_CENTER}>{text}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600">
        {Object.entries(RTG_STATUS_META).map(([key, meta]) => <span key={key}>{meta.code} = {meta.label}</span>)}
        <span>* = jour férié</span>
      </div>
    </div>
  );
}

function PlanningMensuel() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState(shiftRestricted ? currentUser.teamId : "all");
  const [detailLevel, setDetailLevel] = useState("vacation");

  const effectiveTeamId = shiftRestricted ? currentUser.teamId : teamId;
  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const drivers = useMemo(() => state.drivers.filter(d => d.actif !== false && (effectiveTeamId === "all" || d.teamId === effectiveTeamId)), [state.drivers, effectiveTeamId]);

  const validation = shiftRestricted
    ? (() => {
        const anomalies = planning.validation.anomalies.filter(a => {
          const d = state.drivers.find(dr => dr.id === a.driverId);
          return d && d.teamId === currentUser.teamId;
        });
        return { valid: anomalies.length === 0, anomalies: anomalies, count: anomalies.length };
      })()
    : planning.validation;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Planning mensuel RTG</h1>
          <p className="text-slate-400 text-sm mt-0.5">Généré automatiquement par le moteur de planification (shift / zone / vacation / repos)</p>
        </div>
        <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-print mr-1.5"></i>Imprimer / PDF
        </button>
      </div>

      <div className="print:hidden">
        <MonthYearTeamPicker month={month} setMonth={setMonth} year={year} setYear={setYear} teamId={effectiveTeamId} setTeamId={setTeamId} teams={state.teams} detailLevel={detailLevel} setDetailLevel={setDetailLevel} lockTeam={shiftRestricted} />
      </div>

      <div className="print:hidden">
        <ValidationBanner validation={validation} />
      </div>

      <div className="print:hidden">
        <PlanningGrid planning={planning} drivers={drivers} detailLevel={detailLevel} config={state.config} />
      </div>

      <div className="bg-card rounded-xl border border-border p-4 print:hidden">
        <Legend />
      </div>

      {/* Rapport imprimable — noir sur blanc, indépendant du thème sombre de l'appli. */}
      <div className="print-report bg-white text-slate-900 rounded-xl p-0">
        <PrintHeader
          subtitle={"Rapport de planning mensuel — RTG — " + RAPPORT_MOIS_LABELS_P[month - 1] + " " + year + (effectiveTeamId !== "all" ? " — " + (state.teams.find(t => t.id === effectiveTeamId) || {}).nom : "")}
          count={drivers.length} countLabel="conducteur"
        />
        <PlanningGridPrintable planning={planning} drivers={drivers} config={state.config} />
      </div>
    </div>
  );
}

// ==========================================
// Mouvements réalisés un jour férié, PAR CONDUCTEUR PRÉSENT (§31) — un jour
// férié est chômé (statut FERIE pour tous), sauf pour un conducteur avec un
// enregistrement "jour férié travaillé" (§29), qui apparaît alors PRÉSENT :
// c'est pour lui qu'on saisit le nombre de mouvements réalisés ce jour-là.
// ==========================================
function FerieMouvementsRow({ dateStr, driverId, label }) {
  const existing = RTGStore.getFerieMouvements(dateStr, driverId);
  const [value, setValue] = useState(existing ? String(existing.mouvements) : "");
  const [comment, setComment] = useState(existing ? existing.commentaire || "" : "");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const rec = RTGStore.getFerieMouvements(dateStr, driverId);
    setValue(rec ? String(rec.mouvements) : "");
    setComment(rec ? rec.commentaire || "" : "");
    setSaved(false);
  }, [dateStr, driverId]);

  const save = () => {
    const n = Number(value);
    if (!value || isNaN(n) || n < 0) return;
    RTGStore.setFerieMouvements(dateStr, driverId, n, comment);
    setSaved(true);
  };

  return (
    <div className="flex flex-wrap items-end gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="text-xs text-slate-300 font-medium w-40 shrink-0">{label}</div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mouvements réalisés</label>
        <input type="number" min="0" value={value} onChange={e => { setValue(e.target.value); setSaved(false); }}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white w-28" />
      </div>
      <div className="flex-1 min-w-[140px]">
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Commentaire</label>
        <input value={comment} onChange={e => { setComment(e.target.value); setSaved(false); }}
          className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm text-white w-full" />
      </div>
      <button onClick={save} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">Enregistrer</button>
      {saved && <span className="text-xs text-emerald-400"><i className="fas fa-circle-check mr-1"></i>Enregistré</span>}
    </div>
  );
}

function FerieMouvementsPanel({ dateStr, presentDrivers }) {
  if (presentDrivers.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-1">
          <i className="fas fa-truck-ramp-box text-orange-400 text-sm"></i>
          <h3 className="text-white text-sm font-semibold">Mouvements réalisés — jour férié</h3>
        </div>
        <p className="text-xs text-slate-500 italic">Aucun conducteur présent ce jour férié (aucun enregistrement "jour férié travaillé" — page Heures exceptionnelles).</p>
      </div>
    );
  }
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <i className="fas fa-truck-ramp-box text-orange-400 text-sm"></i>
        <h3 className="text-white text-sm font-semibold">Mouvements réalisés — jour férié</h3>
      </div>
      {presentDrivers.map(a => <FerieMouvementsRow key={a.driverId} dateStr={dateStr} driverId={a.driverId} label={a.matricule + " — " + a.nom + " " + a.prenom} />)}
    </div>
  );
}

// Version imprimable (noir sur blanc) d'un bloc vacation.
function ShiftBlockPrintable({ title, rows }) {
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">{title} — {rows.length} conducteur{rows.length > 1 ? "s" : ""}</div>
      {rows.length === 0 ? (
        <p className="text-[10px] text-slate-500 italic mb-2">Aucun conducteur affecté.</p>
      ) : (
        <table className="w-full text-[10px] border-collapse mb-2">
          <thead>
            <tr>
              <th className={PRINT_TH}>Mat</th><th className={PRINT_TH}>Nom</th><th className={PRINT_TH}>Prénom</th>
              <th className={PRINT_TH}>Équipe</th><th className={PRINT_TH}>Vacation</th><th className={PRINT_TH}>Horaire</th><th className={PRINT_TH}>Zone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => (
              <tr key={a.driverId}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}</td>
                <td className={PRINT_TD}>{a.prenom}</td>
                <td className={PRINT_TD}>{a.teamNom}</td>
                <td className={PRINT_TD_CENTER}>{a.vacation}</td>
                <td className={PRINT_TD}>{a.startTime}–{a.endTime}</td>
                <td className={PRINT_TD_CENTER}>{a.zone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FerieMouvementsPrintable({ dateStr, presentDrivers }) {
  if (presentDrivers.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">Mouvements réalisés — jour férié</div>
      <table className="w-full text-[10px] border-collapse mb-2">
        <thead>
          <tr>
            <th className={PRINT_TH}>Mat</th><th className={PRINT_TH}>Nom</th><th className={PRINT_TH}>Prénom</th>
            <th className={PRINT_TH}>Mouvements</th><th className={PRINT_TH}>Commentaire</th>
          </tr>
        </thead>
        <tbody>
          {presentDrivers.map(a => {
            const rec = RTGStore.getFerieMouvements(dateStr, a.driverId);
            return (
              <tr key={a.driverId}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}</td>
                <td className={PRINT_TD}>{a.prenom}</td>
                <td className={PRINT_TD_CENTER}>{rec ? rec.mouvements : "—"}</td>
                <td className={PRINT_TD}>{rec ? rec.commentaire || "" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================
// 3. Affectation du jour
// ==========================================
function AffectationDuJour() {
  const state = useRtgState();
  const currentUser = useCurrentUser();
  const shiftRestricted = isShiftRestricted(currentUser);
  const [dateStr, setDateStr] = useState(RTGDate.toISO(new Date()));

  const assignments = useMemo(() => {
    try {
      const all = PlanningEngine.generateDailyAssignments(dateStr, state);
      return shiftRestricted ? all.filter(a => a.teamId === currentUser.teamId) : all;
    } catch (e) { return []; }
  }, [state, dateStr, shiftRestricted, currentUser]);

  const grouped = {};
  state.config.shifts.forEach(s => {
    grouped[s.id] = (state.config.vacations[s.id] || []).map(v => ({
      vacation: v,
      rows: assignments.filter(a => a.shift === s.id && a.vacation === v.id && a.status === "PRESENT")
    }));
  });

  const offRows = assignments.filter(a => a.status === "OFF");
  const holiday = HolidayEngine.getHoliday(dateStr, state.config);

  const presentDrivers = assignments.filter(a => a.status === "PRESENT");

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Affectation du jour</h1>
          <p className="text-slate-400 text-sm mt-0.5">Sélectionnez une date pour voir l'affectation détaillée des 3 shifts</p>
        </div>
        <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
          <i className="fas fa-print mr-1.5"></i>Imprimer / PDF
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex items-end gap-3 print:hidden">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date</label>
          <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(dateStr))}</div>
      </div>

      {holiday && (
        <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded-xl px-4 py-3 text-sm print:hidden">
          <i className="fas fa-star-and-crescent"></i> Jour férié — {holiday.label} — journée chômée, aucune affectation générée
        </div>
      )}

      {holiday && (
        <div className="print:hidden">
          <FerieMouvementsPanel dateStr={dateStr} presentDrivers={presentDrivers} />
        </div>
      )}

      <div className="print:hidden space-y-4">
        {state.config.shifts.map(s => (
          <div key={s.id} className="space-y-3">
            <h2 className="text-sm font-bold text-orange-400 uppercase tracking-wider">{s.label} <span className="text-slate-500 font-normal">({s.start} → {s.end})</span></h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {grouped[s.id].map(({ vacation, rows }) => (
                <ShiftBlock key={vacation.id} title={`Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`} icon="fa-clock" rows={rows} />
              ))}
            </div>
          </div>
        ))}

        {offRows.length > 0 && (
          <ShiftBlock title="OFF — Shift 3 dimanche" icon="fa-power-off" rows={offRows} />
        )}
      </div>

      {/* Rapport imprimable — noir sur blanc, indépendant du thème sombre de l'appli. */}
      <div className="print-report bg-white text-slate-900 rounded-xl p-0">
        <PrintHeader
          subtitle={"Rapport d'affectation journalière — RTG — " + RTGDate.formatFr(RTGDate.parseISO(dateStr)) + (shiftRestricted ? " — " + (state.teams.find(t => t.id === currentUser.teamId) || {}).nom : "")}
          count={holiday ? presentDrivers.length : assignments.length} countLabel={holiday ? "conducteur présent" : "conducteur affecté"}
        />
        {holiday ? (
          <div>
            <p className="text-xs mb-3">Jour férié — {holiday.label} — journée chômée, aucune affectation générée.</p>
            <FerieMouvementsPrintable dateStr={dateStr} presentDrivers={presentDrivers} />
          </div>
        ) : (
          <div>
            {state.config.shifts.map(s => (
              <div key={s.id} className="mb-3">
                <div className="text-xs font-bold uppercase tracking-wide mb-1 border-b border-slate-300 pb-1">{s.label} ({s.start} → {s.end})</div>
                {grouped[s.id].map(({ vacation, rows }) => (
                  <ShiftBlockPrintable key={vacation.id} title={`Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`} rows={rows} />
                ))}
              </div>
            ))}
            {offRows.length > 0 && <ShiftBlockPrintable title="OFF — Shift 3 dimanche" rows={offRows} />}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
          Document généré automatiquement par RTG Driver Planner.
        </div>
      </div>
    </div>
  );
}
