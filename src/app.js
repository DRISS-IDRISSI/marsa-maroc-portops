const { useState } = React;
const { HashRouter, Routes, Route } = ReactRouterDOM;

function App() {
  const [term, setTerm] = useState('all');
  return (
    <HashRouter>
      <Layout term={term} setTerm={setTerm}>
        <Routes>
          <Route path="/" element={<Dashboard term={term} />} />
          <Route path="/navires" element={<Navires term={term} />} />
          <Route path="/trafic" element={<Trafic term={term} />} />
          <Route path="/livraison" element={<Livraison term={term} />} />
          <Route path="/ia" element={<IA term={term} />} />
          <Route path="/alertes" element={<Alertes term={term} />} />
          <Route path="/rtg" element={<RtgHome />} />
          <Route path="/rtg/planning" element={<PlanningMensuelRTG />} />
          <Route path="/rtg/affectation" element={<AffectationDuJourRTG />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
