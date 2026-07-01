const { useState } = React;
const { BrowserRouter, Routes, Route } = ReactRouterDOM;

function App() {
  const [term, setTerm] = useState('all');
  return (
    <BrowserRouter>
      <Layout term={term} setTerm={setTerm}>
        <Routes>
          <Route path="/" element={<Dashboard term={term} />} />
          <Route path="/navires" element={<Navires term={term} />} />
          <Route path="/trafic" element={<Trafic term={term} />} />
          <Route path="/livraison" element={<Livraison term={term} />} />
          <Route path="/ia" element={<IA term={term} />} />
          <Route path="/alertes" element={<Alertes term={term} />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
