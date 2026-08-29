const { useState, useEffect, useMemo } = React;
const { useLocation, useNavigate } = ReactRouterDOM;

// ==========================================
// KPICard
// ==========================================
function KPICard({ icon, label, value, sub, color = "blue", highlight }) {
  const c = { blue: "from-blue-600 to-blue-800", orange: "from-orange-500 to-orange-700", green: "from-emerald-500 to-emerald-700", red: "from-red-500 to-red-700", purple: "from-purple-500 to-purple-700" }[color] || "from-blue-600 to-blue-800";
  return (
    <div className={`bg-card rounded-xl border border-border p-5 transition-all hover:border-marine-400 hover:-translate-y-0.5 ${highlight ? 'ring-1 ring-orange-500/30' : ''} fade-in`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${c} flex items-center justify-center text-white text-lg`}><i className={`fas ${icon}`}></i></div>
        {highlight && <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">Alerte</span>}
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ==========================================
// Sidebar
// ==========================================
function Sidebar({ term, setTerm }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { to: "/", icon: "fa-chart-line", label: "Dashboard" },
    { to: "/navires", icon: "fa-ship", label: "Navires" },
    { to: "/trafic", icon: "fa-exchange-alt", label: "Flux Camions" },
    { to: "/livraison", icon: "fa-clock", label: "Délais" },
    { to: "/ia", icon: "fa-robot", label: "Assistant IA" },
    { to: "/alertes", icon: "fa-bell", label: "Alertes" },
    { to: "/rtg", icon: "fa-users-gear", label: "RTG Planner" },
    { to: "/rtg/planning", icon: "fa-calendar-alt", label: "RTG · Planning" },
    { to: "/rtg/affectation", icon: "fa-clipboard-list", label: "RTG · Affectation" }
  ];

  const isActive = (p) => loc.pathname === p;

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center text-white">
          <i className="fas fa-anchor"></i>
        </div>
        {!collapsed && <div><div className="font-bold text-white text-sm leading-tight">Marsa Maroc</div><div className="text-[10px] text-slate-500 uppercase tracking-wider">Port Casablanca</div></div>}
      </div>

      <div className="p-3 space-y-1">
        <div className={`text-[10px] uppercase tracking-wider text-slate-600 mb-2 px-3 ${collapsed ? 'hidden' : ''}`}>Menu</div>
        {links.map(l => (
          <button key={l.to} onClick={() => { nav(l.to); setMobileOpen(false); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive(l.to) ? 'bg-marine-600/20 text-orange-400 border-l-2 border-orange-500' : 'text-slate-400 hover:bg-marine-600/10 hover:text-slate-200'}`}>
            <i className={`fas ${l.icon} w-5 text-center`}></i>
            {!collapsed && <span>{l.label}</span>}
          </button>
        ))}
      </div>

      {!collapsed && (
        <div className="mt-auto p-4 border-t border-border">
          <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-2">Terminal</div>
          <div className="flex gap-1">
            {[["all","Tous"],["tce","TCE"],["tc3","TC3"]].map(([k,l]) => (
              <button key={k} onClick={() => setTerm(k)}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${term === k ? 'bg-orange-500 text-white' : 'bg-marine-800 text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-marine-500 to-marine-700 flex items-center justify-center text-white text-xs"><i className="fas fa-user"></i></div>
          {!collapsed && <div><div className="text-xs font-medium text-white">Admin</div><div className="text-[10px] text-slate-500">Directeur</div></div>}
        </div>
      </div>
    </>
  );

  return (<>
    {/* Mobile toggle */}
    <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden fixed top-4 left-4 z-50 w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center text-white">
      <i className={`fas ${mobileOpen ? 'fa-times' : 'fa-bars'}`}></i>
    </button>

    {/* Mobile overlay */}
    {mobileOpen && <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)}></div>}

    {/* Desktop */}
    <aside className={`hidden lg:flex flex-col bg-card border-r border-border h-screen sticky top-0 transition-all duration-300 ${collapsed ? 'w-16' : 'w-56'}`}>
      <button onClick={() => setCollapsed(!collapsed)} className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center text-slate-400 hover:text-white z-10">
        <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'} text-xs`}></i>
      </button>
      {sidebarContent}
    </aside>

    {/* Mobile sidebar */}
    <aside className={`lg:hidden fixed inset-y-0 left-0 z-50 w-56 bg-card border-r border-border flex flex-col transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      {sidebarContent}
    </aside>
  </>);
}

// ==========================================
// Topbar
// ==========================================
function Topbar() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <header className="h-14 bg-card/80 backdrop-blur border-b border-border flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold text-white ml-12 lg:ml-0">Marsa Maroc <span className="text-orange-400">PortOps</span></h1>
        <span className="hidden sm:inline text-xs text-slate-600">|</span>
        <span className="hidden sm:inline text-xs text-slate-400">TCE & TC3 — Port de Casablanca</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-slate-400">
        <span className="hidden md:inline"><i className="far fa-calendar mr-1.5"></i>{time.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</span>
        <span><i className="far fa-clock mr-1.5"></i>{time.toLocaleTimeString('fr-FR')}</span>
        <span className="flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot"></span>En ligne</span>
      </div>
    </header>
  );
}

// ==========================================
// Layout
// ==========================================
function Layout({ children, term, setTerm }) {
  return (
    <div className="flex min-h-screen bg-port">
      <Sidebar term={term} setTerm={setTerm} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
        <footer className="bg-card border-t border-border px-6 py-3 text-center text-xs text-slate-600">
          © 2026 Marsa Maroc — Port de Casablanca | TCE & TC3 | Données réelles 29-30/06/2026
        </footer>
      </div>
    </div>
  );
}

// ==========================================
// ChartCanvas wrapper
// ==========================================
function ChartCanvas({ type, data, options, height = 280 }) {
  const canvasRef = React.useRef(null);
  const chartRef = React.useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    Chart.defaults.color = '#94A3B8';
    Chart.defaults.borderColor = '#243555';
    chartRef.current = new Chart(canvasRef.current, { type, data, options });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [type, data, options]);
  return <canvas ref={canvasRef} style={{ maxHeight: height }}></canvas>;
}
