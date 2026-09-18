const { HashRouter, Routes, Route } = ReactRouterDOM;

function App() {
  return (
    <HashRouter>
      <AuthGate>
        <Layout>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/planning" element={<PlanningMensuel />} />
            <Route path="/affectation" element={<AffectationDuJour />} />
            <Route path="/conducteurs" element={<DriversPage />} />
            <Route path="/conges" element={<CongesPage />} />
            <Route path="/maladies" element={<MaladiesPage />} />
            <Route path="/absences" element={<AbsencesPage />} />
            <Route path="/heures-exceptionnelles" element={<HeuresExceptionnellesPage />} />
            <Route path="/remplacement" element={<RemplacementPage />} />
            <Route path="/rapport-rh" element={<RapportRHPage />} />
            <Route path="/assistant" element={<AssistantIntelligentPage />} />
            <Route path="/mon-planning" element={<MonPlanningPage />} />
            <Route path="/mes-conges" element={<MesCongesPage />} />
            <Route path="/utilisateurs" element={<UsersPage />} />
          </Routes>
        </Layout>
      </AuthGate>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
