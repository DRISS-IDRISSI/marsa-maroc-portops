const { HashRouter, Routes, Route } = ReactRouterDOM;

function App() {
  return (
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/planning" element={<PlanningMensuel />} />
          <Route path="/affectation" element={<AffectationDuJour />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
