const { useState, useEffect } = React;
const { useLocation, useNavigate } = ReactRouterDOM;

// ==========================================
// Connexion (§30) — écran plein écran tant qu'aucun utilisateur n'est
// connecté ; AuthGate l'affiche à la place de l'appli (pas de sidebar/topbar).
// ==========================================
// Formulaire "Mot de passe oublié ?" (§41) — envoie l'identifiant à l'Edge
// Function request-password-reset, qui répond toujours un message générique
// (jamais de confirmation/infirmation sur l'existence d'un compte, pour ne
// pas permettre l'énumération des identifiants). Un mot de passe temporaire
// est envoyé par email si un compte actif avec une adresse connue existe.
function ForgotPasswordForm({ onBack }) {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (!username.trim()) return;
    setSubmitting(true);
    setError(""); setMessage("");
    try {
      const { data, error: fnError } = await sb.functions.invoke("request-password-reset", { body: { username: username.trim() } });
      if (fnError) throw fnError;
      setMessage((data && data.message) || "Si un compte correspond à cet identifiant, un email a été envoyé à l'adresse enregistrée.");
    } catch (err) {
      setError("Erreur : " + (err && err.message ? err.message : "réessayez plus tard."));
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-xl p-6 space-y-4 fade-in">
      <div className="text-center mb-2">
        <h1 className="text-lg font-bold text-white">Mot de passe oublié</h1>
        <p className="text-xs text-slate-500 mt-1">Un mot de passe temporaire sera envoyé à l'email enregistré sur votre compte.</p>
      </div>
      {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
      {message && <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">{message}</div>}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Identifiant</label>
        <input autoFocus disabled={submitting} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white w-full" value={username} onChange={e => setUsername(e.target.value)} />
      </div>
      <button type="submit" disabled={submitting} className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
        {submitting ? "Envoi..." : "Envoyer"}
      </button>
      <button type="button" onClick={onBack} className="w-full text-xs text-slate-400 hover:text-white">
        <i className="fas fa-arrow-left mr-1.5"></i>Retour à la connexion
      </button>
    </form>
  );
}

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await RTGStore.login(username, password);
    } catch (err) {
      setError(err && err.message ? err.message : "Connexion impossible — vérifiez votre connexion internet et réessayez.");
    }
    setSubmitting(false);
  };

  if (forgotMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-port px-4">
        <ForgotPasswordForm onBack={() => setForgotMode(false)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-port px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-card border border-border rounded-xl p-6 space-y-4 fade-in">
        <div className="text-center mb-2">
          <div className="w-20 h-20 mx-auto rounded-lg bg-white flex items-center justify-center p-2 mb-3">
            <img src="icons/marsa-maroc-logo.png" alt="Marsa Maroc" className="max-w-full max-h-full object-contain" />
          </div>
          <h1 className="text-lg font-bold text-white">CES Driver Planner</h1>
          <p className="text-xs text-slate-500 mt-1">Marsa Maroc — Terminal à conteneurs</p>
        </div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Identifiant</label>
          <input autoFocus disabled={submitting} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white w-full" value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Mot de passe</label>
          <input type="password" disabled={submitting} className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white w-full" value={password} onChange={e => setPassword(e.target.value)} />
        </div>
        <button type="submit" disabled={submitting} className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
          {submitting ? "Connexion..." : "Se connecter"}
        </button>
        <button type="button" onClick={() => setForgotMode(true)} className="w-full text-xs text-slate-400 hover:text-white">
          Mot de passe oublié ?
        </button>
      </form>
    </div>
  );
}

function AuthLoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-port px-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-lg bg-white flex items-center justify-center p-2 mb-4 animate-pulse">
          <img src="icons/marsa-maroc-logo.png" alt="Marsa Maroc" className="max-w-full max-h-full object-contain" />
        </div>
        <p className="text-sm text-slate-400">Chargement...</p>
      </div>
    </div>
  );
}

function AuthGate({ children }) {
  const state = useRtgState();
  const loc = useLocation();
  const nav = useNavigate();
  const currentUser = state.users.find(u => u.id === state.currentUserId) || null;
  // Un compte CONDUCTEUR (§37/§39) n'a accès qu'à un jeu de pages restreint :
  // "Mon planning", "Mes congés", et — en lecture seule, comme un
  // Responsable de Shift — Planning mensuel et Affectation du jour de son
  // équipe. Toute autre URL (y compris l'accueil) redirige vers "Mon
  // planning" — les policies RLS limitent déjà les DONNÉES visibles, ce
  // garde-fou évite en plus d'exposer l'interface des autres pages.
  const CONDUCTEUR_ALLOWED_PATHS = ["/mon-planning", "/mes-conges", "/mes-mouvements", "/mes-overtime", "/planning", "/affectation", "/mon-compte"];
  useEffect(() => {
    if (currentUser && isDriverRestricted(currentUser) && CONDUCTEUR_ALLOWED_PATHS.indexOf(loc.pathname) === -1) {
      nav("/mon-planning", { replace: true });
    }
  }, [currentUser, loc.pathname]);
  if (!state.authChecked || state.loading) return <AuthLoadingScreen />;
  if (!currentUser) return <LoginPage />;
  return children;
}

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
function Sidebar() {
  const loc = useLocation();
  const nav = useNavigate();
  const state = useRtgState();
  const currentUser = state.users.find(u => u.id === state.currentUserId) || null;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Un compte CONDUCTEUR (§37/§39) — voir AuthGate pour la liste des URL
  // autorisées, dont ces liens sont le reflet exact.
  const links = isDriverRestricted(currentUser) ? [
    { to: "/mon-planning", icon: "fa-calendar-check", label: "Mon planning" },
    { to: "/mes-conges", icon: "fa-umbrella-beach", label: "Mes congés" },
    { to: "/mes-mouvements", icon: "fa-truck-ramp-box", label: "Mes mouvements" },
    { to: "/mes-overtime", icon: "fa-clock-rotate-left", label: "Mes Over Time" },
    { to: "/planning", icon: "fa-calendar-alt", label: "Planning mensuel" },
    { to: "/affectation", icon: "fa-clipboard-list", label: "Affectation du jour" }
  ] : [
    { to: "/", icon: "fa-chart-line", label: "Accueil" },
    { to: "/planning", icon: "fa-calendar-alt", label: "Planning mensuel" },
    { to: "/affectation", icon: "fa-clipboard-list", label: "Affectation du jour" },
    { to: "/conducteurs", icon: "fa-users", label: "Conducteurs" },
    { to: "/conges", icon: "fa-umbrella-beach", label: "Congés" },
    { to: "/maladies", icon: "fa-briefcase-medical", label: "Maladies" },
    { to: "/absences", icon: "fa-user-slash", label: "Absences" },
    { to: "/heures-exceptionnelles", icon: "fa-clock-rotate-left", label: "Over Time" },
    { to: "/mouvements-rtg", icon: "fa-truck-ramp-box", label: "Mouvements " + state.currentFleet },
    { to: "/remplacement", icon: "fa-people-arrows", label: "Remplacement" },
    { to: "/rapport-rh", icon: "fa-file-invoice", label: "Rapports" },
    { to: "/assistant", icon: "fa-wand-magic-sparkles", label: "Assistant intelligent" }
  ];
  if (currentUser && currentUser.role === "ADMIN") {
    links.push({ to: "/utilisateurs", icon: "fa-user-shield", label: "Utilisateurs" });
  }

  const isActive = (p) => loc.pathname === p;

  // Bascule RTG / CC (chariots cavalier) — deux modules dans la même appli,
  // même page/menu, mais on ne montre que les équipes/conducteurs de la
  // flotte choisie. Réservé à ADMIN/RESPONSABLE (vue globale) : un
  // Responsable de Shift ou un Conducteur reste toujours cantonné à sa
  // propre équipe, quelle que soit cette bascule.
  const showFleetSwitch = currentUser && (currentUser.role === "ADMIN" || currentUser.role === "RESPONSABLE");

  const sidebarContent = (
    <>
      <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center p-1 shrink-0">
          <img src="icons/marsa-maroc-logo.png" alt="Marsa Maroc" className="max-w-full max-h-full object-contain" />
        </div>
        {!collapsed && <div><div className="font-bold text-white text-sm leading-tight">CES Driver Planner</div><div className="text-[10px] text-slate-500 uppercase tracking-wider">Marsa Maroc — Terminal Conteneurs</div></div>}
      </div>

      {showFleetSwitch && !collapsed && (
        <div className="px-3 pt-3">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
            {["RTG", "CC"].map(f => (
              <button key={f} onClick={() => RTGStore.setCurrentFleet(f)}
                className={`flex-1 px-3 py-1.5 transition-colors ${state.currentFleet === f ? "bg-orange-500 text-white" : "bg-surface text-slate-400 hover:text-white"}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

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

      <div className="mt-auto p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-marine-500 to-marine-700 flex items-center justify-center text-white text-xs"><i className="fas fa-user"></i></div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white truncate">{currentUser ? currentUser.nom : "—"}</div>
              <div className="text-[10px] text-slate-500 truncate">{currentUser ? (ROLE_LABELS[currentUser.role] || currentUser.role) + (currentUser.teamId ? " — " + (state.teams.find(t => t.id === currentUser.teamId) || {}).nom : "") : ""}</div>
            </div>
          )}
          {!collapsed && (
            <button onClick={() => nav("/mon-compte")} title="Mon compte — changer mon mot de passe" className="text-slate-500 hover:text-orange-400 shrink-0">
              <i className="fas fa-key"></i>
            </button>
          )}
          {!collapsed && (
            <button onClick={() => RTGStore.logout()} title="Déconnexion" className="text-slate-500 hover:text-red-400 shrink-0">
              <i className="fas fa-right-from-bracket"></i>
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (<>
    <button onClick={() => setMobileOpen(!mobileOpen)} className="print:hidden lg:hidden fixed top-4 left-4 z-50 w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center text-white">
      <i className={`fas ${mobileOpen ? 'fa-times' : 'fa-bars'}`}></i>
    </button>

    {mobileOpen && <div className="print:hidden lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setMobileOpen(false)}></div>}

    <aside className={`print:hidden hidden lg:flex flex-col bg-card border-r border-border h-screen sticky top-0 transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
      <button onClick={() => setCollapsed(!collapsed)} className="absolute -right-3 top-20 w-6 h-6 bg-card border border-border rounded-full flex items-center justify-center text-slate-400 hover:text-white z-10">
        <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'} text-xs`}></i>
      </button>
      {sidebarContent}
    </aside>

    <aside className={`print:hidden lg:hidden fixed inset-y-0 left-0 z-50 w-60 bg-card border-r border-border flex flex-col transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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
    <header className="print:hidden h-14 bg-card/80 backdrop-blur border-b border-border flex items-center justify-between px-3 sm:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="hidden sm:block text-lg font-bold text-white lg:ml-0 truncate">CES <span className="text-orange-400">Driver Planner</span></h1>
        <span className="hidden sm:inline text-xs text-slate-600">|</span>
        <span className="hidden lg:inline text-xs text-slate-400">Gestion des conducteurs</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-4 text-sm text-slate-400 ml-auto">
        <span className="hidden md:inline"><i className="far fa-calendar mr-1.5"></i>{time.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</span>
        <span><i className="far fa-clock mr-1.5"></i>{time.toLocaleTimeString('fr-FR')}</span>
        <span className="flex items-center gap-1.5 text-xs"><span className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot"></span><span className="hidden sm:inline">En ligne</span></span>
      </div>
    </header>
  );
}

// ==========================================
// Mon compte (§41) — changer son propre mot de passe, accessible à TOUS les
// rôles (y compris CONDUCTEUR, voir AuthGate/Sidebar). Réutilise le
// mécanisme déjà présent dans RTGStore.updateUser (branche "userId ===
// currentUserId" -> sb.auth.updateUser({password})), jusqu'ici uniquement
// atteignable via la page Utilisateurs réservée à l'ADMIN.
// ==========================================
function ChangePasswordPage() {
  const currentUser = useCurrentUser();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError(""); setSuccess(false);
    if (password.length < 6) { setError("Le mot de passe doit contenir au moins 6 caractères."); return; }
    if (password !== confirm) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setSaving(true);
    try {
      await RTGStore.updateUser(currentUser.id, { password: password });
      setSuccess(true);
      setPassword(""); setConfirm("");
    } catch (err) {
      setError("Erreur : " + (err && err.message ? err.message : "réessayez."));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4 fade-in max-w-md">
      <div>
        <h1 className="text-2xl font-bold text-white">Mon compte</h1>
        <p className="text-slate-400 text-sm mt-0.5">{currentUser ? currentUser.nom + " — " + currentUser.username : ""}</p>
      </div>
      <Panel title="Changer mon mot de passe" icon="fa-key">
        <form onSubmit={submit} className="space-y-3">
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
          {success && <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">Mot de passe modifié avec succès.</div>}
          <div>
            <label className={LABEL_CLS}>Nouveau mot de passe</label>
            <input type="password" disabled={saving} className={FIELD_CLS} value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <div>
            <label className={LABEL_CLS}>Confirmer le mot de passe</label>
            <input type="password" disabled={saving} className={FIELD_CLS} value={confirm} onChange={e => setConfirm(e.target.value)} />
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-semibold rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60">
            {saving ? "Enregistrement..." : "Changer le mot de passe"}
          </button>
        </form>
      </Panel>
    </div>
  );
}

// ==========================================
// Détection de nouvelle version (§34) — cette appli est une SPA à page
// unique : naviguer entre les pages ne recharge JAMAIS le JS, donc un onglet
// resté ouvert continue de tourner sur l'ancien code même après un nouveau
// déploiement. version.json est régénéré à CHAQUE déploiement (SHA du commit,
// voir le workflow GitHub Actions) et rechargé sans cache pour détecter ça.
// ==========================================
const RTG_LOADED_VERSION = { current: null };

function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch("version.json", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (!data || !data.version || cancelled) return;
          if (RTG_LOADED_VERSION.current === null) {
            RTG_LOADED_VERSION.current = data.version;
          } else if (data.version !== RTG_LOADED_VERSION.current) {
            setUpdateAvailable(true);
          }
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  if (!updateAvailable) return null;
  return (
    <div className="print:hidden bg-sky-600 text-white text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-3 flex-wrap">
      <i className="fas fa-circle-info"></i>
      <span>Une nouvelle version de l'application est disponible.</span>
      <button onClick={() => window.location.reload()} className="px-3 py-1 rounded bg-white text-sky-700 font-semibold hover:bg-sky-50">
        Recharger
      </button>
    </div>
  );
}

// ==========================================
// Layout
// ==========================================
function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-port print:bg-white">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <UpdateBanner />
        <Topbar />
        <main className="flex-1 p-4 lg:p-6 overflow-auto print:p-0">
          <div className="max-w-7xl mx-auto print:max-w-none">
            {children}
          </div>
        </main>
        <footer className="print:hidden bg-card border-t border-border px-6 py-3 text-center text-xs text-slate-600">
          © 2026 Marsa Maroc — CES Driver Planner — Terminal à conteneurs
        </footer>
      </div>
    </div>
  );
}
