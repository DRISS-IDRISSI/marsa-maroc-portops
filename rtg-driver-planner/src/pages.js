const { useState, useMemo, useEffect } = React;
const { useNavigate } = ReactRouterDOM;

function useRtgState() {
  const [state, setState] = useState(RTGStore.get());
  useEffect(() => RTGStore.subscribe(setState), []);
  return state;
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
  OFF: { code: "OFF", label: "Off (Shift 3 dimanche)", className: "bg-slate-950 text-slate-500 border-slate-800" }
};

function Legend() {
  return (
    <div className="flex flex-wrap gap-2 text-[11px]">
      {Object.entries(RTG_STATUS_META).map(([key, meta]) => (
        <span key={key} className={`px-2 py-1 rounded border ${meta.className}`}>{meta.code} = {meta.label}</span>
      ))}
    </div>
  );
}

function MonthYearTeamPicker({ month, setMonth, year, setYear, teamId, setTeamId, teams, detailLevel, setDetailLevel }) {
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
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Équipe</label>
        <select value={teamId} onChange={e => setTeamId(e.target.value)} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white">
          <option value="all">Toutes les équipes</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Détail</label>
        <div className="flex gap-1">
          {[["code","C"],["vacation","C/V1"],["zone","C/V1/A"]].map(([k,l]) => (
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
    const parts = [meta.code];
    if (assignment.vacation) parts.push(assignment.vacation);
    if (detailLevel === "zone" && assignment.zone) parts.push(assignment.zone);
    text = parts.join("/");
  }
  return (
    <td className={`border border-border/60 text-center text-[11px] font-semibold px-1 py-1.5 ${meta.className}`} title={assignment.shift ? `${assignment.shift} ${assignment.startTime || ""}-${assignment.endTime || ""} · Zone ${assignment.zone || "-"}` : meta.label}>
      {text}
    </td>
  );
}

function PlanningGrid({ planning, drivers, detailLevel }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="border-collapse text-xs w-full">
        <thead>
          <tr className="bg-surface">
            <th className="sticky left-0 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10">Mat</th>
            <th className="sticky left-14 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10 min-w-[110px]">Nom</th>
            <th className="border border-border/60 px-2 py-2 text-left text-slate-300 min-w-[90px]">Prénom</th>
            <th className="border border-border/60 px-2 py-2 text-slate-300">Équipe</th>
            {planning.days.map(day => (
              <th key={day.iso} className="border border-border/60 px-1.5 py-2 text-slate-400 min-w-[34px]">{String(day.day).padStart(2,"0")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drivers.map(driver => (
            <tr key={driver.id} className="hover:bg-marine-600/10">
              <td className="sticky left-0 bg-card border border-border/60 px-2 py-1.5 text-slate-300 z-10">{driver.matricule}</td>
              <td className="sticky left-14 bg-card border border-border/60 px-2 py-1.5 text-white font-medium z-10">{driver.nom}</td>
              <td className="border border-border/60 px-2 py-1.5 text-slate-400">{driver.prenom}</td>
              <td className="border border-border/60 px-2 py-1.5 text-center text-slate-400">{driver.teamId}</td>
              {planning.days.map(day => {
                const a = day.assignments.find(x => x.driverId === driver.id);
                return <Cell key={day.iso} assignment={a} detailLevel={detailLevel} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
                <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="py-1.5 pr-3">Prénom</th>
                <th className="py-1.5 pr-3">Équipe</th><th className="py-1.5 pr-3">Vacation</th><th className="py-1.5 pr-3">Horaire</th>
                <th className="py-1.5 pr-3">Zone</th><th className="py-1.5 pr-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.driverId} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 text-slate-300">{a.matricule}</td>
                  <td className="py-1.5 pr-3 text-white font-medium">{a.nom}</td>
                  <td className="py-1.5 pr-3 text-slate-300">{a.prenom}</td>
                  <td className="py-1.5 pr-3 text-slate-400">{a.teamNom}</td>
                  <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-marine-600/20 text-marine-300">{a.vacation}</span></td>
                  <td className="py-1.5 pr-3 text-slate-400">{a.startTime}–{a.endTime}</td>
                  <td className="py-1.5 pr-3"><span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">{a.zone}</span></td>
                  <td className="py-1.5 pr-3 text-emerald-400">{a.status}</td>
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
  const nav = useNavigate();
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const todayIso = RTGDate.toISO(RTGDate.makeDate(year, month, Math.min(today.getUTCDate(), planning.days.length)));
  const todayAssignments = useMemo(() => PlanningEngine.generateDailyAssignments(todayIso, state), [state, todayIso]);

  const counts = { PRESENT: 0, REPOS: 0, CONGE: 0, MALADIE: 0, ABSENCE: 0, FORMATION: 0, OFF: 0 };
  todayAssignments.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });

  const byTeam = state.teams.map(t => ({
    team: t,
    shift: ShiftRotationEngine.getTeamShiftForDate(t, RTGDate.parseISO(todayIso), state.config)
  }));

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">RTG Driver Planner</h1>
        <p className="text-slate-400 text-sm mt-0.5">Gestion des conducteurs RTG — Terminal à conteneurs — {RTGDate.formatFr(RTGDate.parseISO(todayIso))}</p>
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

      <ValidationBanner validation={planning.validation} />

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
function PlanningMensuel() {
  const state = useRtgState();
  const now = new Date();
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [teamId, setTeamId] = useState("all");
  const [detailLevel, setDetailLevel] = useState("vacation");

  const planning = useMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const drivers = useMemo(() => state.drivers.filter(d => d.actif !== false && (teamId === "all" || d.teamId === teamId)), [state.drivers, teamId]);

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Planning mensuel RTG</h1>
        <p className="text-slate-400 text-sm mt-0.5">Généré automatiquement par le moteur de planification (shift / zone / vacation / repos)</p>
      </div>

      <MonthYearTeamPicker month={month} setMonth={setMonth} year={year} setYear={setYear} teamId={teamId} setTeamId={setTeamId} teams={state.teams} detailLevel={detailLevel} setDetailLevel={setDetailLevel} />

      <ValidationBanner validation={planning.validation} />

      <PlanningGrid planning={planning} drivers={drivers} detailLevel={detailLevel} />

      <div className="bg-card rounded-xl border border-border p-4">
        <Legend />
      </div>
    </div>
  );
}

// ==========================================
// 3. Affectation du jour
// ==========================================
function AffectationDuJour() {
  const state = useRtgState();
  const [dateStr, setDateStr] = useState(RTGDate.toISO(new Date()));

  const assignments = useMemo(() => {
    try { return PlanningEngine.generateDailyAssignments(dateStr, state); } catch (e) { return []; }
  }, [state, dateStr]);

  const grouped = {};
  state.config.shifts.forEach(s => {
    grouped[s.id] = (state.config.vacations[s.id] || []).map(v => ({
      vacation: v,
      rows: assignments.filter(a => a.shift === s.id && a.vacation === v.id && a.status === "PRESENT")
    }));
  });

  const offRows = assignments.filter(a => a.status === "OFF");

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Affectation du jour</h1>
        <p className="text-slate-400 text-sm mt-0.5">Sélectionnez une date pour voir l'affectation détaillée des 3 shifts</p>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex items-end gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date</label>
          <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(dateStr))}</div>
      </div>

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
  );
}
