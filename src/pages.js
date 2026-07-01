const { useState, useEffect, useMemo } = React;
const { useLocation, useNavigate } = ReactRouterDOM;

// ==========================================
// 1. Dashboard
// ==========================================
function Dashboard({ term }) {
  const fluxChartData = useMemo(() => ({
    labels: ["S1", "S2", "S3"],
    datasets: [
      { label: "TCE", data: [M.flux.tce.s1.tot, M.flux.tce.s2.tot, M.flux.tce.s3.tot], backgroundColor: "#1A5276", borderRadius: 4 },
      { label: "TC3", data: [M.flux.tc3.s1.tot, M.flux.tc3.s2.tot, M.flux.tc3.s3.tot], backgroundColor: "#E67E22", borderRadius: 4 }
    ]
  }), []);

  const importExportData = useMemo(() => ({
    labels: ["Import", "Export"],
    datasets: [{
      data: [M.flux.global.pi + M.flux.global.vi, M.flux.global.pe + M.flux.global.ve],
      backgroundColor: ["#27AE60", "#E67E22"],
      borderWidth: 0
    }]
  }), []);

  const shiftDetailData = useMemo(() => ({
    labels: ["S1", "S2", "S3"],
    datasets: [
      { label: "Plein Imp", data: [M.flux.tce.s1.pi, M.flux.tce.s2.pi, M.flux.tce.s3.pi], backgroundColor: "#1A5276", borderRadius: 4 },
      { label: "Vide Imp", data: [M.flux.tce.s1.vi, M.flux.tce.s2.vi, M.flux.tce.s3.vi], backgroundColor: "#94A3B8", borderRadius: 4 },
      { label: "Plein Exp", data: [M.flux.tce.s1.pe, M.flux.tce.s2.pe, M.flux.tce.s3.pe], backgroundColor: "#27AE60", borderRadius: 4 },
      { label: "Vide Exp", data: [M.flux.tce.s1.ve, M.flux.tce.s2.ve, M.flux.tce.s3.ve], backgroundColor: "#E67E22", borderRadius: 4 }
    ]
  }), []);

  const delayChartData = useMemo(() => ({
    labels: ["Moyenne", "Médiane", "P95"],
    datasets: [
      { label: "TCE", data: [M.livraison.tce.moy, M.livraison.tce.med, M.livraison.tce.p95], backgroundColor: "#1A5276", borderRadius: 4 },
      { label: "TC3", data: [M.livraison.tc3.moy, M.livraison.tc3.med, M.livraison.tc3.p95], backgroundColor: "#E67E22", borderRadius: 4 }
    ]
  }), []);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#94A3B8" } }
    },
    scales: {
      x: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" } },
      y: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" } }
    }
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: "#94A3B8", padding: 16 } }
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Vue d&apos;ensemble</h1>
        <p className="text-slate-400 text-sm mt-0.5">Tableau de bord Marsa Maroc — Port de Casablanca — {M.date}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KPICard icon="fa-ship" label="Navires" value={M.navires.total} sub={M.navires.accoste + " accostés · " + M.navires.attente + " attente"} color="blue" />
        <KPICard icon="fa-truck" label="Flux Conteneurs" value={M.flux.global.tot.toLocaleString()} sub={M.date} color="orange" />
        <KPICard icon="fa-clock" label="Délai TCE" value={M.livraison.tce.moy + " min"} sub={"P95: " + M.livraison.tce.p95 + " min"} color="green" />
        <KPICard icon="fa-clock" label="Délai TC3" value={M.livraison.tc3.moy + " min"} sub={"P95: " + M.livraison.tc3.p95 + " min"} color="red" highlight={M.livraison.tc3.moy > 90} />
        <KPICard icon="fa-arrow-down" label="Import" value={(M.flux.global.pi + M.flux.global.vi).toLocaleString()} sub={"TC plein: " + M.flux.global.pi} color="green" />
        <KPICard icon="fa-arrow-up" label="Export" value={(M.flux.global.pe + M.flux.global.ve).toLocaleString()} sub={"TC vide: " + M.flux.global.ve} color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-exchange-alt text-marine-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Flux TCE vs TC3 par Shift</h3>
          </div>
          <ChartCanvas type="bar" data={fluxChartData} options={chartOptions} height={280} />
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-chart-pie text-orange-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Import vs Export</h3>
          </div>
          <div style={{ maxWidth: 240, margin: "0 auto" }}>
            <ChartCanvas type="doughnut" data={importExportData} options={doughnutOptions} height={240} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-box text-emerald-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Détails par Type — TCE</h3>
          </div>
          <ChartCanvas type="bar" data={shiftDetailData} options={chartOptions} height={280} />
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-hourglass-half text-red-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Distribution des Délais (min)</h3>
          </div>
          <ChartCanvas type="bar" data={delayChartData} options={chartOptions} height={280} />
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. Navires
// ==========================================
function Navires({ term }) {
  const [statusFilter, setStatusFilter] = useState("Tous");
  const [terminalFilter, setTerminalFilter] = useState("Tous");
  const [search, setSearch] = useState("");

  const statusColors = {
    "Accosté": "text-emerald-400 bg-emerald-400/15",
    "Attente": "text-amber-400 bg-amber-400/15",
    "Prévision": "text-blue-400 bg-blue-400/15",
    "Appareillé": "text-slate-400 bg-slate-400/15"
  };

  const statusIcons = {
    "Accosté": "fa-anchor",
    "Attente": "fa-clock",
    "Prévision": "fa-map-marker-alt",
    "Appareillé": "fa-ship"
  };

  const filtered = useMemo(() => {
    return M.navires.liste.filter((s) => {
      if (statusFilter !== "Tous" && s.s !== statusFilter) return false;
      if (terminalFilter !== "Tous" && s.t !== terminalFilter) return false;
      if (term !== "all" && s.t && s.t.toLowerCase() !== term) return false;
      if (search && !s.n.toLowerCase().includes(search.toLowerCase()) && !s.a.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [statusFilter, terminalFilter, search, term]);

  const stats = [
    { label: "Total", value: M.navires.total, color: "text-white" },
    { label: "Accostés", value: M.navires.accoste, color: "text-emerald-400" },
    { label: "Attente", value: M.navires.attente, color: "text-amber-400" },
    { label: "Prévision", value: M.navires.prevision, color: "text-blue-400" },
    { label: "Appareillés", value: M.navires.appareille, color: "text-slate-400" }
  ];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Situation Navires</h1>
        <p className="text-slate-400 text-sm mt-0.5">Suivi des {M.navires.total} navires — TCE &amp; TC3</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-card border border-border rounded-lg p-3 text-center">
            <p className={"text-xl font-bold " + s.color}>{s.value}</p>
            <p className="text-slate-400 text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm"></i>
            <input
              type="text"
              placeholder="Rechercher un navire ou armateur..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-port border border-border rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-marine-400"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <i className="fas fa-filter text-slate-500 text-sm"></i>
            {["Tous", "Accosté", "Attente", "Prévision", "Appareillé"].map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={"text-xs h-8 px-3 rounded-md transition-all " + (statusFilter === s ? "bg-marine-600 text-white" : "bg-port text-slate-400 hover:text-white border border-border")}>
                {s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {["Tous", "TCE", "TC3"].map((t) => (
              <button key={t} onClick={() => setTerminalFilter(t)}
                className={"text-xs h-8 px-3 rounded-md transition-all " + (terminalFilter === t ? "bg-orange-500 text-white" : "bg-port text-slate-400 hover:text-white border border-border")}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-white text-sm font-semibold">Liste des navires ({filtered.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Navire</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Statut</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Terminal</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Armateur</th>
                <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">Longueur</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">ETA</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Accostage</th>
                <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Appareillage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ship, i) => {
                const sc = statusColors[ship.s] || "text-slate-400";
                const si = statusIcons[ship.s] || "fa-ship";
                return (
                  <tr key={i} className="border-b border-border hover:bg-surface/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{ship.n}</td>
                    <td className="px-4 py-3">
                      <span className={"inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full " + sc}>
                        <i className={"fas " + si + " text-[10px]"}></i>
                        {ship.s}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {ship.t ? (
                        <span className={"font-medium " + (ship.t === "TCE" ? "text-blue-400" : "text-orange-400")}>{ship.t}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{ship.a || "—"}</td>
                    <td className="px-4 py-3 text-slate-400 text-right">
                      {ship.l ? (
                        <span className="flex items-center justify-end gap-1">
                          <i className="fas fa-ruler-horizontal text-xs text-slate-500"></i>
                          {ship.l}m
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{ship.eta || "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{ship.acc || "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{ship.app || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-slate-400">Aucun navire ne correspond aux filtres sélectionnés.</div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// 3. Trafic
// ==========================================
function Trafic({ term }) {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#94A3B8" } } },
    scales: {
      x: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" } },
      y: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" } }
    }
  };

  const shiftChartData = useMemo(() => ({
    labels: ["S1", "S2", "S3"],
    datasets: [
      { label: "TCE", data: [M.flux.tce.s1.tot, M.flux.tce.s2.tot, M.flux.tce.s3.tot], backgroundColor: "#1A5276", borderRadius: 4 },
      { label: "TC3", data: [M.flux.tc3.s1.tot, M.flux.tc3.s2.tot, M.flux.tc3.s3.tot], backgroundColor: "#E67E22", borderRadius: 4 }
    ]
  }), []);

  const typeChartData = useMemo(() => {
    const types = ["pi", "vi", "pe", "ve"];
    const labels = ["Plein Imp", "Vide Imp", "Plein Exp", "Vide Exp"];
    const colors = ["#1A5276", "#94A3B8", "#27AE60", "#E67E22"];
    return {
      labels,
      datasets: ["tce", "tc3"].map((t, i) => ({
        label: t.toUpperCase(),
        data: types.map((ty) => M.flux[t].tot[ty]),
        backgroundColor: ["#1A5276", "#E67E22"][i],
        borderRadius: 4
      }))
    };
  }), []);

  const terminals = term === "all" ? ["tce", "tc3"] : [term];
  const typeLabels = { pi: "Plein Imp", vi: "Vide Imp", pe: "Plein Exp", ve: "Vide Exp" };
  const typeKeys = ["pi", "vi", "pe", "ve"];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Flux Camions</h1>
        <p className="text-slate-400 text-sm mt-0.5">Trafic conteneurs par shift et terminal — {M.date}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon="fa-truck" label="TCE" value={M.flux.tce.tot.tot.toLocaleString()} sub="54.6% du flux total" color="blue" />
        <KPICard icon="fa-truck" label="TC3" value={M.flux.tc3.tot.tot.toLocaleString()} sub="45.4% du flux total" color="orange" />
        <KPICard icon="fa-boxes" label="Total" value={M.flux.global.tot.toLocaleString()} sub="3 shifts (S1/S2/S3)" color="green" />
        <KPICard icon="fa-arrow-up" label="Shift le plus actif" value="S2" sub="1,581 conteneurs (52.1%)" color="purple" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-chart-bar text-emerald-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Comparaison par Type — TCE vs TC3</h3>
          </div>
          <ChartCanvas type="bar" data={typeChartData} options={chartOptions} height={280} />
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="fas fa-exchange-alt text-orange-400 text-sm"></i>
            <h3 className="text-white text-sm font-semibold">Flux par Shift — TCE + TC3</h3>
          </div>
          <ChartCanvas type="bar" data={shiftChartData} options={chartOptions} height={280} />
        </div>
      </div>

      {terminals.map((t) => {
        const T = t.toLowerCase();
        const data = M.flux[T];
        return (
          <div key={T} className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                <i className={"fas fa-truck " + (T === "tce" ? "text-blue-400" : "text-orange-400")}></i>
                {T.toUpperCase()} — {data.tot.tot} conteneurs
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Type</th>
                    <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">S1</th>
                    <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">S2</th>
                    <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">S3</th>
                    <th className="text-right text-slate-400 text-xs uppercase px-4 py-3 font-bold">Total</th>
                    <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">%</th>
                  </tr>
                </thead>
                <tbody>
                  {typeKeys.map((ty) => {
                    const total = data.tot[ty];
                    const pct = ((total / data.tot.tot) * 100).toFixed(1);
                    return (
                      <tr key={ty} className="border-b border-border hover:bg-surface/40 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{typeLabels[ty]}</td>
                        <td className="px-4 py-3 text-slate-400 text-right">{data.s1[ty]}</td>
                        <td className="px-4 py-3 text-slate-400 text-right">{data.s2[ty]}</td>
                        <td className="px-4 py-3 text-slate-400 text-right">{data.s3[ty]}</td>
                        <td className="px-4 py-3 text-white text-right font-bold">{total}</td>
                        <td className="px-4 py-3 text-slate-400 text-right">{pct}%</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-border bg-port/50 font-bold">
                    <td className="px-4 py-3 text-white font-bold">TOTAL</td>
                    <td className="px-4 py-3 text-white text-right font-bold">{data.s1.tot}</td>
                    <td className="px-4 py-3 text-white text-right font-bold">{data.s2.tot}</td>
                    <td className="px-4 py-3 text-white text-right font-bold">{data.s3.tot}</td>
                    <td className="px-4 py-3 text-emerald-400 text-right font-bold">{data.tot.tot}</td>
                    <td className="px-4 py-3 text-slate-400 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// 4. Livraison
// ==========================================
function Livraison({ term }) {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: "#94A3B8" } } },
    scales: {
      x: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" } },
      y: { ticks: { color: "#94A3B8" }, grid: { color: "#243555" }, title: { display: true, text: "Minutes", color: "#94A3B8" } }
    }
  };

  const delayLineChartData = useMemo(() => {
    const allLines = Array.from(new Set([
      ...M.livraison.tce.lignes.map((l) => l.l),
      ...M.livraison.tc3.lignes.map((l) => l.l)
    ])).filter((l) => l !== "BABMARS");
    return {
      labels: allLines,
      datasets: [
        { label: "TCE", data: allLines.map((l) => M.livraison.tce.lignes.find((x) => x.l === l)?.m ?? 0), backgroundColor: "#1A5276", borderRadius: 4 },
        { label: "TC3", data: allLines.map((l) => M.livraison.tc3.lignes.find((x) => x.l === l)?.m ?? 0), backgroundColor: "#E67E22", borderRadius: 4 }
      ]
    };
  }, []);

  function DelayBadge({ value }) {
    if (value > 100) return <span className="inline-flex items-center text-xs font-bold text-red-400 bg-red-400/15 px-2 py-0.5 rounded-full"><i className="fas fa-exclamation-triangle mr-1 text-[10px]"></i>{value}m</span>;
    if (value > 60) return <span className="inline-flex items-center text-xs font-bold text-amber-400 bg-amber-400/15 px-2 py-0.5 rounded-full">{value}m</span>;
    return <span className="inline-flex items-center text-xs font-bold text-emerald-400 bg-emerald-400/15 px-2 py-0.5 rounded-full">{value}m</span>;
  }

  const terminals = term === "all" ? ["tce", "tc3"] : [term];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white">Délais Livraison Import</h1>
        <p className="text-slate-400 text-sm mt-0.5">Temps moyen de livraison import par terminal et ligne maritime</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard icon="fa-clock" label="Moyenne TCE" value={M.livraison.tce.moy + " min"} sub={"Médiane: " + M.livraison.tce.med + " min"} color="green" />
        <KPICard icon="fa-clock" label="Moyenne TC3" value={M.livraison.tc3.moy + " min"} sub={"Médiane: " + M.livraison.tc3.med + " min"} color="red" highlight={true} />
        <KPICard icon="fa-arrow-up" label="Écart TCE/TC3" value={"+" + (M.livraison.tc3.moy - M.livraison.tce.moy).toFixed(1) + " min"} sub={"+" + (((M.livraison.tc3.moy - M.livraison.tce.moy) / M.livraison.tce.moy) * 100).toFixed(1) + "%"} color="orange" />
        <KPICard icon="fa-exclamation-triangle" label="P95 TC3" value={M.livraison.tc3.p95 + " min"} sub="Seuil critique dépassé" color="red" highlight={true} />
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <i className="fas fa-chart-bar text-blue-400 text-sm"></i>
          <h3 className="text-white text-sm font-semibold">Délai Moyen par Ligne Maritime — TCE vs TC3 (min)</h3>
        </div>
        <ChartCanvas type="bar" data={delayLineChartData} options={chartOptions} height={300} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {terminals.map((t) => {
          const T = t.toLowerCase();
          const data = M.livraison[T];
          const maxCount = Math.max(...data.lignes.map((l) => l.c));
          return (
            <div key={T} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-white text-sm font-semibold flex items-center gap-2">
                  <i className={"fas fa-clock " + (T === "tce" ? "text-blue-400" : "text-orange-400")}></i>
                  {T.toUpperCase()} — {data.tot} conteneurs
                </h3>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                  <span>Moy: {data.moy}min</span>
                  <span>Méd: {data.med}min</span>
                  <span className={data.p95 > 180 ? "text-red-400 font-bold" : ""}>P95: {data.p95}min</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-slate-400 text-xs uppercase px-4 py-3">Ligne</th>
                      <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">Conteneurs</th>
                      <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">Délai moy</th>
                      <th className="text-right text-slate-400 text-xs uppercase px-4 py-3">% Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lignes.sort((a, b) => b.c - a.c).map((line) => (
                      <tr key={line.l} className="border-b border-border hover:bg-surface/40 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{line.l}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-port rounded-full h-1.5 overflow-hidden">
                              <div className="h-full bg-marine-400 rounded-full" style={{ width: (line.c / maxCount * 100) + "%" }}></div>
                            </div>
                            <span className="text-slate-400 text-right">{line.c}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right"><DelayBadge value={line.m} /></td>
                        <td className="px-4 py-3 text-slate-400 text-right">{((line.c / data.tot) * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// 5. IA
// ==========================================
function IA({ term }) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content: "👋 **Bienvenue sur l'assistant Marsa Maroc !**\n\nJe peux vous aider à analyser les données du port de Casablanca (TCE & TC3). Voici ce que je peux faire :\n\n• 📊 Résumé des opérations globales\n• ⚖️ Comparaison des délais entre terminaux\n• 🚛 Analyse des flux camions\n• ⚓ Situation des navires\n\nPosez-moi une question ou sélectionnez une suggestion ci-dessous.",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = React.useRef(null);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const suggestions = [
    "Quel est le résumé des opérations ?",
    "Compare les délais TCE et TC3",
    "Analyse les flux camions du 29/06",
    "Quels sont les navires accostés ?"
  ];

  function getAIResponse(query) {
    const lower = query.toLowerCase();
    if (lower.includes("résumé") || lower.includes("opérations")) return M.iaResponses.resume;
    if (lower.includes("délai") || lower.includes("compare")) return M.iaResponses.delai;
    if (lower.includes("flux") || lower.includes("camion")) return M.iaResponses.flux;
    if (lower.includes("navire") || lower.includes("accost")) return M.iaResponses.navire;
    return "🤖 **Assistant Marsa Maroc**<br><br>Je ne dispose pas encore de réponse spécifique pour cette question. Voici ce que je peux analyser :<br><br>• 📊 Résumé des opérations globales<br>• ⚖️ Comparaison TCE vs TC3<br>• 🚛 Flux camions par shift et terminal<br>• ⚓ Situation des navires accostés<br><br>Essayez de reformuler votre question avec ces mots-clés, ou sélectionnez une suggestion ci-dessus.";
  }

  function handleSend(text) {
    if (!text.trim()) return;
    const userMsg = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);
    setTimeout(() => {
      const response = getAIResponse(text);
      const assistantMsg = { id: (Date.now() + 1).toString(), role: "assistant", content: response, timestamp: new Date() };
      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 600 + Math.random() * 800);
  }

  function renderContent(content) {
    if (content.includes("<")) {
      return React.createElement("div", { dangerouslySetInnerHTML: { __html: content } });
    }
    return React.createElement("div", { className: "whitespace-pre-wrap leading-relaxed" }, content);
  }

  return (
    <div className="flex flex-col fade-in" style={{ height: "calc(100vh - 10rem)" }}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <i className="fas fa-robot text-orange-400"></i>
          Assistant IA
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Questions et analyses intelligentes sur les données du port</p>
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={"flex gap-3 " + (msg.role === "user" ? "justify-end" : "justify-start")}>
              {msg.role === "assistant" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <i className="fas fa-robot text-orange-400 text-sm"></i>
                </div>
              )}
              <div className={"max-w-[80%] rounded-xl px-4 py-3 text-sm " + (msg.role === "user" ? "bg-marine-600 text-white rounded-br-sm" : "bg-port text-white border border-border rounded-bl-sm")}>
                {renderContent(msg.content)}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 w-8 h-8 rounded-full bg-marine-600/20 flex items-center justify-center">
                  <i className="fas fa-user text-marine-400 text-sm"></i>
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex gap-3">
              <div className="shrink-0 w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                <i className="fas fa-robot text-orange-400 text-sm"></i>
              </div>
              <div className="bg-port border border-border rounded-xl rounded-bl-sm px-4 py-3">
                <i className="fas fa-spinner fa-spin text-slate-400 text-sm"></i>
              </div>
            </div>
          )}
          <div ref={bottomRef}></div>
        </div>

        {messages.length <= 1 && (
          <div className="px-4 pb-2">
            <p className="text-slate-500 text-xs mb-2 uppercase tracking-wider font-medium">Suggestions</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => handleSend(s)} className="text-xs bg-port border border-border text-slate-400 hover:text-white hover:border-marine-400 px-3 py-1.5 rounded-md transition-all">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t border-border">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(input); }} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question sur les données du port..."
              className="flex-1 bg-port border border-border rounded-lg text-white text-sm placeholder-slate-500 px-3 py-2 focus:outline-none focus:border-marine-400"
            />
            <button type="submit" disabled={!input.trim() || isTyping} className="bg-marine-600 hover:bg-marine-500 text-white px-4 py-2 rounded-lg transition-all disabled:opacity-50">
              <i className="fas fa-paper-plane text-sm"></i>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 6. Alertes
// ==========================================
function Alertes({ term }) {
  const [levelFilter, setLevelFilter] = useState("Tous");

  const levelConfig = {
    critique: { color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30", icon: "fa-exclamation-circle", label: "Critique" },
    avertissement: { color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30", icon: "fa-exclamation-triangle", label: "Avertissement" },
    info: { color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/30", icon: "fa-info-circle", label: "Info" }
  };

  const filtered = useMemo(() => {
    if (levelFilter === "Tous") return M.alertes;
    return M.alertes.filter((a) => a.n === levelFilter);
  }, [levelFilter]);

  const stats = useMemo(() => ({
    total: M.alertes.length,
    critique: M.alertes.filter((a) => a.n === "critique").length,
    avertissement: M.alertes.filter((a) => a.n === "avertissement").length,
    info: M.alertes.filter((a) => a.n === "info").length
  }), []);

  const statItems = [
    { level: "Tous", count: stats.total, color: "text-white", bg: "bg-card" },
    { level: "critique", count: stats.critique, color: "text-red-400", bg: "bg-red-400/10" },
    { level: "avertissement", count: stats.avertissement, color: "text-amber-400", bg: "bg-amber-400/10" },
    { level: "info", count: stats.info, color: "text-blue-400", bg: "bg-blue-400/10" }
  ];

  return (
    <div className="space-y-6 fade-in">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <i className="fas fa-bell text-red-400"></i>
          Alertes
        </h1>
        <p className="text-slate-400 text-sm mt-0.5">Alertes basées sur les données réelles du {M.date}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {statItems.map((s) => (
          <button key={s.level} onClick={() => setLevelFilter(s.level)}
            className={"rounded-lg p-3 text-center border transition-all hover:scale-[1.02] " + (levelFilter === s.level ? "border-marine-400 ring-1 ring-marine-400/30 " : "border-border hover:border-marine-400/50 ") + s.bg}>
            <p className={"text-xl font-bold " + s.color}>{s.count}</p>
            <p className="text-slate-400 text-xs mt-0.5">{s.level === "Tous" ? "Toutes" : s.level + "s"}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <i className="fas fa-filter text-slate-500 text-sm"></i>
        {["Tous", "critique", "avertissement", "info"].map((l) => (
          <button key={l} onClick={() => setLevelFilter(l)}
            className={"text-xs h-8 px-3 rounded-md transition-all capitalize " + (levelFilter === l
              ? l === "critique" ? "bg-red-500 text-white" : l === "avertissement" ? "bg-amber-500 text-white" : l === "info" ? "bg-blue-500 text-white" : "bg-marine-600 text-white"
              : "bg-port text-slate-400 hover:text-white border border-border")}>
            {l === "Tous" ? "Toutes" : l + "s"}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((alert) => {
          const cfg = levelConfig[alert.n];
          return (
            <div key={alert.id} className={"bg-card border rounded-xl transition-all hover:scale-[1.005] " + cfg.border}>
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className={"shrink-0 w-9 h-9 rounded-lg flex items-center justify-center " + cfg.bg}>
                    <i className={"fas " + cfg.icon + " " + cfg.color}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-white font-semibold text-sm">{alert.t}</h3>
                      <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full " + cfg.bg + " " + cfg.color}>{cfg.label}</span>
                      <span className="text-[10px] border border-border text-slate-400 px-2 py-0.5 rounded-full">
                        <i className="fas fa-tag mr-1 text-[8px]"></i>
                        {alert.term}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1.5 leading-relaxed">{alert.d}</p>
                    <div className="flex items-center gap-1 mt-2 text-slate-500 text-xs">
                      <i className="fas fa-clock text-[10px]"></i>
                      {alert.dt} {alert.h}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <i className="fas fa-bell text-6xl text-slate-700 mb-3"></i>
          <p className="text-slate-400">Aucune alerte dans cette catégorie.</p>
        </div>
      )}
    </div>
  );
}
