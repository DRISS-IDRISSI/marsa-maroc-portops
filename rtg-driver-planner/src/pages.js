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

// Export Excel des rapports — CSV avec séparateur ";" (convention Excel FR,
// où "," est le séparateur décimal) et BOM UTF-8 pour que les accents
// s'affichent correctement à l'ouverture dans Excel.
function downloadCSV(filename, headers, rows) {
  const escape = v => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers, ...rows].map(r => r.map(escape).join(";"));
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ExportExcelButton({ onClick }) {
  return (
    <button onClick={onClick} className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
      <i className="fas fa-file-excel mr-1.5"></i>Excel
    </button>
  );
}

function PrintHeader({ subtitle, count, countLabel }) {
  const generatedAt = new Date();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b-2 border-slate-800">
      <div className="flex items-center gap-3">
        <img src="icons/marsa-maroc-logo.png" alt="Marsa Maroc" className="h-9 w-auto shrink-0" />
        <div>
          <div className="text-base sm:text-lg font-bold">Marsa Maroc — Terminal à Conteneurs</div>
          <div className="text-xs sm:text-sm text-slate-600">{subtitle}</div>
        </div>
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

function Cell({ assignment, detailLevel, onEdit }) {
  if (!assignment) return <td className="border border-border/60 bg-surface/40"></td>;
  const meta = RTG_STATUS_META[assignment.status] || { code: assignment.status, className: "text-slate-400" };
  let text = meta.code;
  if (assignment.status === "PRESENT" && detailLevel !== "code") {
    const parts = [];
    if (assignment.vacation) parts.push(assignment.vacation);
    if (detailLevel === "zone" && assignment.zone) parts.push(assignment.zone);
    text = parts.length ? parts.join("/") : meta.code;
  }
  const isManual = assignment.source === "MANUAL";
  const title = (assignment.shift ? `${assignment.shift} ${assignment.startTime || ""}-${assignment.endTime || ""} · Zone ${assignment.zone || "-"}` : meta.label) + (isManual ? " · Modifié manuellement" : "") + (onEdit ? " · Cliquer pour modifier" : "");
  return (
    <td
      className={`border border-border/60 text-center text-[11px] font-semibold px-1 py-1.5 ${meta.className} ${isManual ? "ring-1 ring-inset ring-sky-400" : ""} ${onEdit ? "cursor-pointer hover:brightness-125" : ""}`}
      title={title}
      onClick={onEdit}
    >
      {text}
    </td>
  );
}

// Case cliquable + modale de modification manuelle du planning (§32) — permet
// à l'ADMIN / RESPONSABLE / RESPONSABLE_SHIFT de forcer le statut/vacation/zone
// d'un conducteur pour un jour donné, notamment pour équilibrer à la main les
// vacations V1/V2 quand l'algorithme automatique ne suffit pas.
const EDITABLE_STATUSES = ["PRESENT", "REPOS", "CONGE", "MALADIE", "ABSENCE", "FORMATION", "OFF"];

function AssignmentEditModal({ driver, iso, assignment, config, teams, onClose }) {
  const [status, setStatus] = useState(assignment.status);
  const [vacation, setVacation] = useState(assignment.vacation || "V1");
  const [zone, setZone] = useState(assignment.zone || config.zones[0]);
  const [saving, setSaving] = useState(false);
  const isManual = assignment.source === "MANUAL";

  const team = teams.find(t => t.id === driver.teamId);
  const shift = assignment.shift || (team ? ShiftRotationEngine.getTeamShiftForDate(team, RTGDate.parseISO(iso), config) : null);
  const vacDefs = shift ? (config.vacations[shift] || []) : [];

  const save = async () => {
    setSaving(true);
    try {
      let override;
      if (status === "PRESENT") {
        const vacDef = vacDefs.find(v => v.id === vacation);
        override = { status: "PRESENT", shift: shift, vacation: vacation, zone: zone, startTime: vacDef ? vacDef.start : null, endTime: vacDef ? vacDef.end : null };
      } else {
        override = { status: status, shift: null, vacation: null, zone: null, startTime: null, endTime: null };
      }
      await RTGStore.setManualOverride(iso, driver.id, override, "Modification manuelle du planning", "équilibrage V1/V2 le " + iso);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const resetToAuto = async () => {
    setSaving(true);
    try {
      await RTGStore.deleteManualOverride(iso, driver.id, "le " + iso);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="mb-3">
          <div className="text-white font-semibold text-sm">{driver.matricule} — {driver.nom} {driver.prenom}</div>
          <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(iso))}{isManual ? " · déjà modifié manuellement" : ""}</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS}>Statut</label>
            <select className={FIELD_CLS} value={status} onChange={e => setStatus(e.target.value)}>
              {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{(RTG_STATUS_META[s] || {}).label || s}</option>)}
            </select>
          </div>
          {status === "PRESENT" && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={LABEL_CLS}>Vacation</label>
                <select className={FIELD_CLS} value={vacation} onChange={e => setVacation(e.target.value)}>
                  {vacDefs.map(v => <option key={v.id} value={v.id}>{v.id} ({v.start}-{v.end})</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className={LABEL_CLS}>Zone</label>
                <select className={FIELD_CLS} value={zone} onChange={e => setZone(e.target.value)}>
                  {config.zones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
        <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mt-3">
          <i className="fas fa-triangle-exclamation mr-1.5"></i>Cette modification remplace l'affectation automatique pour ce conducteur, ce jour-là uniquement.
        </p>
        <div className="flex gap-2 mt-4">
          <button disabled={saving} onClick={save} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">Enregistrer</button>
          {isManual && <button disabled={saving} onClick={resetToAuto} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-300 hover:text-white disabled:opacity-50">Revenir à l'auto</button>}
          <button disabled={saving} onClick={onClose} className="px-4 py-2 text-xs font-semibold rounded-lg bg-marine-800 text-slate-400 hover:text-white ml-auto disabled:opacity-50">Fermer</button>
        </div>
      </div>
    </div>
  );
}

// Table d'un seul groupe de vacation (V1 ou V2) au sein d'une équipe — mêmes
// colonnes que le modèle Excel réel fourni (bloc de conducteurs suivi d'une
// ligne "Nombre de présent" par jour), avec cellules cliquables si l'usager
// a le droit de modifier le planning à la main (§32).
function VacationGroupTable({ label, drivers, planning, detailLevel, config, onEditCell }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[11px] font-bold text-orange-400 uppercase tracking-wider mb-1.5 px-0.5">{label} <span className="text-slate-500 font-normal normal-case">({drivers.length} conducteur{drivers.length > 1 ? "s" : ""})</span></div>
      {drivers.length === 0 ? (
        <p className="text-xs text-slate-500 italic px-0.5 mb-2">Aucun conducteur dans ce groupe.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="border-collapse text-xs w-full">
            <thead>
              <tr className="bg-surface">
                <th className="sticky left-0 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10">Mat</th>
                <th className="sticky left-14 bg-surface border border-border/60 px-2 py-2 text-left text-slate-300 z-10 min-w-[90px] sm:min-w-[110px]">Nom</th>
                <th className="hidden sm:table-cell border border-border/60 px-2 py-2 text-left text-slate-300 min-w-[90px]">Prénom</th>
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
                  {planning.days.map(day => {
                    const a = day.assignments.find(x => x.driverId === driver.id);
                    return <Cell key={day.iso} assignment={a} detailLevel={detailLevel} onEdit={onEditCell ? () => onEditCell(driver, day.iso, a) : undefined} />;
                  })}
                </tr>
              ))}
              <tr className="bg-surface/70 font-bold">
                <td className="sticky left-0 bg-surface/70 border border-border/60 px-2 py-1.5 text-slate-300 z-10" colSpan="1">—</td>
                <td className="sticky left-14 bg-surface/70 border border-border/60 px-2 py-1.5 text-white z-10" colSpan="1">Nombre de présent</td>
                <td className="hidden sm:table-cell border border-border/60 px-2 py-1.5"></td>
                {planning.days.map(day => {
                  const count = drivers.reduce((n, driver) => {
                    const a = day.assignments.find(x => x.driverId === driver.id);
                    return n + (a && a.status === "PRESENT" ? 1 : 0);
                  }, 0);
                  return <td key={day.iso} className="border border-border/60 text-center text-[11px] text-white px-1 py-1.5">{count}</td>;
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanningGrid({ planning, drivers, detailLevel, config, teams, canEdit }) {
  const [editing, setEditing] = useState(null);
  const onEditCell = canEdit ? (driver, iso, assignment) => assignment && setEditing({ driver: driver, iso: iso, assignment: assignment }) : undefined;

  const teamIds = teams.filter(t => drivers.some(d => d.teamId === t.id)).map(t => t.id);

  return (
    <div>
      <p className="sm:hidden text-[11px] text-slate-500 mb-1.5"><i className="fas fa-arrows-left-right mr-1"></i>Faites glisser le tableau pour voir tous les jours</p>
      {canEdit && (
        <p className="text-[11px] text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg px-3 py-2 mb-3">
          <i className="fas fa-pen mr-1.5"></i>Cliquez sur une case pour modifier manuellement l'affectation d'un conducteur et équilibrer les vacations.
        </p>
      )}
      {teamIds.map(teamId => {
        const team = teams.find(t => t.id === teamId);
        const teamDrivers = drivers.filter(d => d.teamId === teamId);
        const v1 = teamDrivers.filter(d => d.initialVacation !== "V2");
        const v2 = teamDrivers.filter(d => d.initialVacation === "V2");
        return (
          <div key={teamId} className="mb-6 last:mb-0">
            {teamIds.length > 1 && <h3 className="text-white font-semibold text-sm mb-2">{team ? team.nom : teamId}</h3>}
            <VacationGroupTable label="Vacation 1" drivers={v1} planning={planning} detailLevel={detailLevel} config={config} onEditCell={onEditCell} />
            <VacationGroupTable label="Vacation 2" drivers={v2} planning={planning} detailLevel={detailLevel} config={config} onEditCell={onEditCell} />
          </div>
        );
      })}
      {editing && (
        <AssignmentEditModal driver={editing.driver} iso={editing.iso} assignment={editing.assignment} config={config} teams={teams} onClose={() => setEditing(null)} />
      )}
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
                <tr key={a.driverId} className={`border-b border-border/50 ${a.vacationBalanceAlert ? "bg-red-500/10" : ""}`}
                  title={a.vacationBalanceAlert ? "Cette vacation reste en excédent par rapport à l'autre — à faire passer exceptionnellement dans l'autre vacation si possible." : undefined}>
                  <td className="py-1.5 pr-3 text-slate-300">{a.matricule}</td>
                  <td className={`py-1.5 pr-3 font-medium ${a.vacationBalanceAlert ? "text-red-300" : "text-white"}`}>{a.nom}{a.vacationBalanceAlert && <i className="fas fa-triangle-exclamation ml-1.5 text-red-400" title="Vacation en surnombre"></i>}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-300">{a.prenom}</td>
                  <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.teamNom}</td>
                  <td className="py-1.5 pr-3"><span className={`px-1.5 py-0.5 rounded ${a.vacationBalanceAlert ? "bg-red-500/20 text-red-300 font-bold" : "bg-marine-600/20 text-marine-300"}`}>{a.vacation}</span></td>
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

// Recherche rapide d'un conducteur depuis le tableau de bord — évite d'avoir
// à défiler la liste complète des conducteurs pour en retrouver un.
function DriverSearchBox({ state, shiftRestricted, currentUser, todayAssignments }) {
  const nav = useNavigate();
  const [query, setQuery] = useState("");
  const pool = shiftRestricted ? state.drivers.filter(d => d.teamId === currentUser.teamId) : state.drivers;
  const q = query.trim().toLowerCase();
  const results = q
    ? pool.filter(d => d.matricule.toLowerCase().includes(q) || d.nom.toLowerCase().includes(q) || d.prenom.toLowerCase().includes(q)).slice(0, 8)
    : [];

  const goTo = driver => { nav("/conducteurs?q=" + encodeURIComponent(driver.matricule)); setQuery(""); };

  return (
    <div className="relative">
      <div className="relative">
        <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un conducteur (matricule, nom...)"
          className="w-full bg-card border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white" />
      </div>
      {q && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-card border border-border rounded-xl shadow-lg">
          {results.length === 0 && <div className="px-3 py-2 text-xs text-slate-500 italic">Aucun conducteur trouvé.</div>}
          {results.map(d => {
            const a = todayAssignments.find(x => x.driverId === d.id);
            const team = state.teams.find(t => t.id === d.teamId);
            const meta = a ? (RTG_STATUS_META[a.status] || { label: a.status }) : null;
            return (
              <button key={d.id} type="button" onClick={() => goTo(d)}
                className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-marine-600/30 border-b border-border/50 last:border-0 flex items-center justify-between gap-2">
                <span><span className="text-slate-400">{d.matricule}</span> — <span className="text-white font-medium">{d.nom} {d.prenom}</span></span>
                <span className="text-slate-500 shrink-0">{team ? team.nom : d.teamId}{meta ? " · " + meta.label : ""}</span>
              </button>
            );
          })}
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

      <DriverSearchBox state={state} shiftRestricted={shiftRestricted} currentUser={currentUser} todayAssignments={todayAssignments} />

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
  // ADMIN, RESPONSABLE (Exploitation) et RESPONSABLE_SHIFT peuvent forcer
  // manuellement une affectation depuis cette grille, notamment pour
  // équilibrer à la main les vacations V1/V2 quand l'algorithme ne suffit
  // pas (§32) — RESPONSABLE_SHIFT reste de toute façon cantonné à sa
  // propre équipe via effectiveTeamId/lockTeam ci-dessous.
  const canEditPlanning = !!currentUser && ["ADMIN", "RESPONSABLE", "RESPONSABLE_SHIFT"].indexOf(currentUser.role) !== -1;
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

  const exportExcel = () => {
    const headers = ["Mat", "Nom", "Prénom", "Équipe", ...planning.days.map(day => String(day.day).padStart(2, "0"))];
    const rows = drivers.map(driver => {
      const cells = planning.days.map(day => {
        const a = day.assignments.find(x => x.driverId === driver.id);
        if (!a) return "";
        const meta = RTG_STATUS_META[a.status] || { code: a.status };
        if (a.status === "PRESENT") return [a.vacation, a.zone].filter(Boolean).join("-") || meta.code;
        return meta.code;
      });
      return [driver.matricule, driver.nom, driver.prenom, driver.teamId, ...cells];
    });
    downloadCSV(`planning-mensuel-${RAPPORT_MOIS_LABELS_P[month - 1]}-${year}.csv`, headers, rows);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Planning mensuel RTG</h1>
          <p className="text-slate-400 text-sm mt-0.5">Généré automatiquement par le moteur de planification (shift / zone / vacation / repos)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
            <i className="fas fa-print mr-1.5"></i>Imprimer / PDF
          </button>
          <ExportExcelButton onClick={exportExcel} />
        </div>
      </div>

      <div className="print:hidden">
        <MonthYearTeamPicker month={month} setMonth={setMonth} year={year} setYear={setYear} teamId={effectiveTeamId} setTeamId={setTeamId} teams={state.teams} detailLevel={detailLevel} setDetailLevel={setDetailLevel} lockTeam={shiftRestricted} />
      </div>

      <div className="print:hidden">
        <ValidationBanner validation={validation} />
      </div>

      <div className="print:hidden">
        <PlanningGrid planning={planning} drivers={drivers} detailLevel={detailLevel} config={state.config} teams={state.teams} canEdit={canEditPlanning} />
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
        <p className="text-xs text-slate-500 italic">Aucun conducteur présent ce jour férié (aucun enregistrement "jour férié travaillé" — page Over Time).</p>
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
              <tr key={a.driverId} style={a.vacationBalanceAlert ? { color: "#b91c1c" } : undefined}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}{a.vacationBalanceAlert ? " (*)" : ""}</td>
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

// Repos et congés du jour, pour le shift concerné (un conducteur en repos ou
// en congé reste rattaché au shift de son équipe ce jour-là, même s'il n'est
// pas affecté) — demandé explicitement en plus des conducteurs présents.
function ReposCongesBlock({ rows }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <i className="fas fa-bed text-orange-400 text-sm"></i>
        <h3 className="text-white text-sm font-semibold">Repos &amp; congés</h3>
        <span className="ml-auto text-xs text-slate-500">{rows.length} conducteur{rows.length > 1 ? "s" : ""}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 italic">Aucun conducteur en repos ou en congé.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400">
              <tr className="text-left border-b border-border">
                <th className="py-1.5 pr-3">Mat</th><th className="py-1.5 pr-3">Nom</th><th className="hidden sm:table-cell py-1.5 pr-3">Prénom</th>
                <th className="hidden sm:table-cell py-1.5 pr-3">Équipe</th><th className="py-1.5 pr-3">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const meta = RTG_STATUS_META[a.status] || { label: a.status, className: "text-slate-400" };
                return (
                  <tr key={a.driverId} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 text-slate-300">{a.matricule}</td>
                    <td className="py-1.5 pr-3 text-white font-medium">{a.nom}</td>
                    <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-300">{a.prenom}</td>
                    <td className="hidden sm:table-cell py-1.5 pr-3 text-slate-400">{a.teamNom}</td>
                    <td className="py-1.5 pr-3"><span className={`px-1.5 py-0.5 rounded border ${meta.className}`}>{meta.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReposCongesPrintable({ rows }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-bold uppercase tracking-wide mb-1">Repos &amp; congés — {rows.length} conducteur{rows.length > 1 ? "s" : ""}</div>
      <table className="w-full text-[10px] border-collapse mb-2">
        <thead>
          <tr>
            <th className={PRINT_TH}>Mat</th><th className={PRINT_TH}>Nom</th><th className={PRINT_TH}>Prénom</th>
            <th className={PRINT_TH}>Équipe</th><th className={PRINT_TH}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(a => {
            const meta = RTG_STATUS_META[a.status] || { label: a.status };
            return (
              <tr key={a.driverId}>
                <td className={PRINT_TD}>{a.matricule}</td>
                <td className={PRINT_TD + " font-medium"}>{a.nom}</td>
                <td className={PRINT_TD}>{a.prenom}</td>
                <td className={PRINT_TD}>{a.teamNom}</td>
                <td className={PRINT_TD}>{meta.label}</td>
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
  const [shiftFilter, setShiftFilter] = useState("all");

  const assignments = useMemo(() => {
    try {
      const all = PlanningEngine.generateDailyAssignments(dateStr, state);
      return shiftRestricted ? all.filter(a => a.teamId === currentUser.teamId) : all;
    } catch (e) { return []; }
  }, [state, dateStr, shiftRestricted, currentUser]);

  // Un Responsable de Shift n'a qu'une seule équipe donc qu'un seul shift
  // pertinent ce jour-là (les 2 autres sections seraient vides) : on le
  // détermine automatiquement plutôt que de lui proposer le sélecteur.
  const dateObjForShift = RTGDate.parseISO(dateStr);
  const ownTeam = shiftRestricted ? state.teams.find(t => t.id === currentUser.teamId) : null;
  const ownShiftId = ownTeam ? ShiftRotationEngine.getTeamShiftForDate(ownTeam, dateObjForShift, state.config) : null;
  const effectiveShiftFilter = shiftRestricted ? ownShiftId : shiftFilter;
  const visibleShifts = effectiveShiftFilter === "all" ? state.config.shifts : state.config.shifts.filter(s => s.id === effectiveShiftFilter);

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

  // Un conducteur en repos ou en congé reste rattaché au shift de son équipe
  // ce jour-là (le shift/vacation ne sont calculés par le moteur que pour les
  // conducteurs présents) — on retrouve donc ce shift via son équipe pour
  // pouvoir afficher repos/congés séparément dans chaque section de shift.
  const teamShiftMap = {};
  const dateObj = RTGDate.parseISO(dateStr);
  state.teams.forEach(t => { teamShiftMap[t.id] = ShiftRotationEngine.getTeamShiftForDate(t, dateObj, state.config); });
  const reposCongesByShift = {};
  state.config.shifts.forEach(s => {
    reposCongesByShift[s.id] = assignments.filter(a => (a.status === "REPOS" || a.status === "CONGE") && teamShiftMap[a.teamId] === s.id);
  });

  const exportExcel = () => {
    const suffix = effectiveShiftFilter !== "all" ? "-" + effectiveShiftFilter : "";
    if (holiday) {
      const headers = ["Mat", "Nom", "Prénom", "Équipe", "Mouvements réalisés", "Commentaire"];
      const rows = presentDrivers.map(a => {
        const rec = RTGStore.getFerieMouvements(dateStr, a.driverId);
        return [a.matricule, a.nom, a.prenom, a.teamNom, rec ? rec.mouvements : "", rec ? rec.commentaire || "" : ""];
      });
      downloadCSV(`affectation-${dateStr}-jour-ferie.csv`, headers, rows);
      return;
    }
    const headers = ["Shift", "Vacation", "Mat", "Nom", "Prénom", "Équipe", "Horaire", "Zone", "Statut"];
    const rows = [];
    visibleShifts.forEach(s => {
      grouped[s.id].forEach(({ vacation, rows: vrows }) => {
        vrows.forEach(a => rows.push([s.label, vacation.id, a.matricule, a.nom, a.prenom, a.teamNom, `${a.startTime}-${a.endTime}`, a.zone, "Présent"]));
      });
      reposCongesByShift[s.id].forEach(a => rows.push([s.label, "", a.matricule, a.nom, a.prenom, a.teamNom, "", "", a.status === "REPOS" ? "Repos" : "Congé"]));
    });
    if (offRows.length > 0 && (effectiveShiftFilter === "all" || effectiveShiftFilter === "S3")) {
      offRows.forEach(a => rows.push(["Shift 3", "", a.matricule, a.nom, a.prenom, a.teamNom, "", "", "OFF"]));
    }
    downloadCSV(`affectation-${dateStr}${suffix}.csv`, headers, rows);
  };

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white">Affectation du jour</h1>
          <p className="text-slate-400 text-sm mt-0.5">Sélectionnez une date, et éventuellement un shift, pour voir l'affectation détaillée</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600">
            <i className="fas fa-print mr-1.5"></i>Imprimer / PDF
          </button>
          <ExportExcelButton onClick={exportExcel} />
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Date</label>
          <input type="date" value={dateStr} onChange={e => setDateStr(e.target.value)} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white" />
        </div>
        <div className="text-xs text-slate-500">{RTGDate.formatFr(RTGDate.parseISO(dateStr))}</div>
        {!shiftRestricted && (
          <div className="ml-auto">
            <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Shift à afficher</label>
            <div className="flex gap-1">
              <button onClick={() => setShiftFilter("all")}
                className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${shiftFilter === "all" ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>Tous</button>
              {state.config.shifts.map(s => (
                <button key={s.id} onClick={() => setShiftFilter(s.id)}
                  className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-all ${shiftFilter === s.id ? "bg-orange-500 text-white" : "bg-marine-800 text-slate-400 hover:text-white"}`}>{s.label}</button>
              ))}
            </div>
          </div>
        )}
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
        {visibleShifts.map(s => (
          <div key={s.id} className="space-y-3 pb-4 border-b border-border/60 last:border-0">
            <h2 className="text-sm font-bold text-orange-400 uppercase tracking-wider">{s.label} <span className="text-slate-500 font-normal">({s.start} → {s.end})</span></h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {grouped[s.id].map(({ vacation, rows }) => (
                <ShiftBlock key={vacation.id} title={`Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`} icon="fa-clock" rows={rows} />
              ))}
            </div>
            <ReposCongesBlock rows={reposCongesByShift[s.id]} />
          </div>
        ))}

        {offRows.length > 0 && (effectiveShiftFilter === "all" || effectiveShiftFilter === "S3") && (
          <ShiftBlock title="OFF — Shift 3 dimanche" icon="fa-power-off" rows={offRows} />
        )}
      </div>

      {/* Rapport imprimable — noir sur blanc, indépendant du thème sombre de l'appli. */}
      <div className="print-report bg-white text-slate-900 rounded-xl p-0">
        <PrintHeader
          subtitle={"Rapport d'affectation journalière — RTG — " + RTGDate.formatFr(RTGDate.parseISO(dateStr)) + (shiftRestricted ? " — " + (state.teams.find(t => t.id === currentUser.teamId) || {}).nom : "") + (effectiveShiftFilter !== "all" ? " — " + (state.config.shifts.find(s => s.id === effectiveShiftFilter) || {}).label : "")}
          count={holiday ? presentDrivers.length : assignments.length} countLabel={holiday ? "conducteur présent" : "conducteur affecté"}
        />
        {holiday ? (
          <div>
            <p className="text-xs mb-3">Jour férié — {holiday.label} — journée chômée, aucune affectation générée.</p>
            <FerieMouvementsPrintable dateStr={dateStr} presentDrivers={presentDrivers} />
            <ReposCongesPrintable rows={assignments.filter(a => a.status === "REPOS" || a.status === "CONGE")} />
          </div>
        ) : (
          <div>
            {visibleShifts.map(s => (
              <div key={s.id} className="mb-3">
                <div className="text-xs font-bold uppercase tracking-wide mb-1 border-b border-slate-300 pb-1">{s.label} ({s.start} → {s.end})</div>
                {grouped[s.id].map(({ vacation, rows }) => (
                  <ShiftBlockPrintable key={vacation.id} title={`Vacation ${vacation.id} · ${vacation.start} → ${vacation.end}`} rows={rows} />
                ))}
                <ReposCongesPrintable rows={reposCongesByShift[s.id]} />
              </div>
            ))}
            {offRows.length > 0 && (effectiveShiftFilter === "all" || effectiveShiftFilter === "S3") && <ShiftBlockPrintable title="OFF — Shift 3 dimanche" rows={offRows} />}
          </div>
        )}
        <div className="mt-4 pt-3 border-t border-slate-300 text-[10px] text-slate-500">
          Document généré automatiquement par RTG Driver Planner.
        </div>
      </div>
    </div>
  );
}
