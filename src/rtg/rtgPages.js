const { useState: rtgUseState, useMemo: rtgUseMemo, useEffect: rtgUseEffect } = React;
const { useNavigate: rtgUseNavigate } = ReactRouterDOM;

function useRtgState() {
  const [state, setState] = rtgUseState(RTGStore.get());
  rtgUseEffect(() => RTGStore.subscribe(setState), []);
  return state;
}

// ==========================================
// RTG — Accueil du module
// ==========================================
function RtgHome() {
  const state = useRtgState();
  const nav = rtgUseNavigate();
  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const year = today.getUTCFullYear();

  const planning = rtgUseMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const todayIso = RTGDate.toISO(RTGDate.makeDate(year, month, Math.min(today.getUTCDate(), planning.days.length)));
  const todayAssignments = rtgUseMemo(() => PlanningEngine.generateDailyAssignments(todayIso, state), [state, todayIso]);

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

      <RtgValidationBanner validation={planning.validation} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => nav("/rtg/planning")} className="text-left bg-card rounded-xl border border-border p-5 hover:border-orange-400 transition-all flex items-center gap-4">
          <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-marine-500 to-marine-700 flex items-center justify-center text-white text-lg"><i className="fas fa-calendar-alt"></i></div>
          <div>
            <div className="text-white font-semibold text-sm">Planning mensuel</div>
            <div className="text-xs text-slate-500">Vue complète du mois par équipe, rotation shift/zone/vacation</div>
          </div>
        </button>
        <button onClick={() => nav("/rtg/affectation")} className="text-left bg-card rounded-xl border border-border p-5 hover:border-orange-400 transition-all flex items-center gap-4">
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
// RTG — Planning mensuel
// ==========================================
function PlanningMensuelRTG() {
  const state = useRtgState();
  const now = new Date();
  const [month, setMonth] = rtgUseState(now.getUTCMonth() + 1);
  const [year, setYear] = rtgUseState(now.getUTCFullYear());
  const [teamId, setTeamId] = rtgUseState("all");
  const [detailLevel, setDetailLevel] = rtgUseState("vacation");

  const planning = rtgUseMemo(() => PlanningEngine.generateMonthlyPlanning(month, year, state), [state, month, year]);
  const drivers = rtgUseMemo(() => state.drivers.filter(d => d.actif !== false && (teamId === "all" || d.teamId === teamId)), [state.drivers, teamId]);

  return (
    <div className="space-y-4 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Planning mensuel RTG</h1>
        <p className="text-slate-400 text-sm mt-0.5">Généré automatiquement par le moteur de planification (shift / zone / vacation / repos)</p>
      </div>

      <RtgMonthYearTeamPicker month={month} setMonth={setMonth} year={year} setYear={setYear} teamId={teamId} setTeamId={setTeamId} teams={state.teams} detailLevel={detailLevel} setDetailLevel={setDetailLevel} />

      <RtgValidationBanner validation={planning.validation} />

      <RtgPlanningGrid planning={planning} drivers={drivers} teams={state.teams} detailLevel={detailLevel} />

      <div className="bg-card rounded-xl border border-border p-4">
        <RtgLegend />
      </div>
    </div>
  );
}

// ==========================================
// RTG — Affectation du jour
// ==========================================
function AffectationDuJourRTG() {
  const state = useRtgState();
  const [dateStr, setDateStr] = rtgUseState(RTGDate.toISO(new Date()));

  const assignments = rtgUseMemo(() => {
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
              <RtgShiftBlock key={vacation.id} title={`Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`} icon="fa-clock" rows={rows} />
            ))}
          </div>
        </div>
      ))}

      {offRows.length > 0 && (
        <RtgShiftBlock title="OFF — Shift 3 dimanche" icon="fa-power-off" rows={offRows} />
      )}
    </div>
  );
}
