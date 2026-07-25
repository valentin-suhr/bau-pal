"use client";

import { useMemo, useState } from "react";

type Plot = {
  id: number;
  district: string;
  address: string;
  area: number;
  units: number;
  floors: string;
  status: "Available" | "Review";
  type: string;
  cost: number;
  x: number;
  y: number;
  shape: string;
  score: number;
};

const plots: Plot[] = [
  { id: 1, district: "Lichtenberg", address: "Siegfriedstraße 18", area: 1280, units: 18, floors: "IV + attic", status: "Available", type: "Closing a gap", cost: 8.2, x: 77, y: 52, shape: "M0 5 L32 0 L40 28 L8 36 Z", score: 92 },
  { id: 2, district: "Pankow", address: "Prenzlauer Promenade 42", area: 940, units: 13, floors: "IV", status: "Available", type: "Corner plot", cost: 6.1, x: 57, y: 23, shape: "M0 0 L36 7 L30 38 L4 32 Z", score: 86 },
  { id: 3, district: "Neukölln", address: "Britzer Damm 106", area: 1650, units: 22, floors: "III + attic", status: "Review", type: "Rear lot", cost: 9.6, x: 54, y: 75, shape: "M4 0 L36 3 L40 32 L0 38 Z", score: 79 },
  { id: 4, district: "Spandau", address: "Pichelsdorfer Straße 71", area: 2130, units: 28, floors: "IV", status: "Available", type: "Former commercial", cost: 13.4, x: 15, y: 50, shape: "M0 5 L38 0 L35 35 L7 39 Z", score: 83 },
  { id: 5, district: "Treptow-Köpenick", address: "Köpenicker Landstraße 94", area: 1180, units: 16, floors: "III", status: "Review", type: "Infill", cost: 7.1, x: 76, y: 78, shape: "M5 0 L40 8 L32 38 L0 30 Z", score: 74 },
  { id: 6, district: "Reinickendorf", address: "Residenzstraße 126", area: 760, units: 10, floors: "IV", status: "Available", type: "Closing a gap", cost: 4.8, x: 34, y: 19, shape: "M0 0 L31 4 L38 35 L5 39 Z", score: 88 },
];

function money(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 1 }).format(value);
}

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [selectedId, setSelectedId] = useState(1);
  const [desiredUnits, setDesiredUnits] = useState(16);
  const [budget, setBudget] = useState(9);
  const [panelOpen, setPanelOpen] = useState(true);
  const [saved, setSaved] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [showAvailable, setShowAvailable] = useState(true);

  const selected = plots.find((plot) => plot.id === selectedId) ?? plots[0];
  const filtered = useMemo(() => plots.filter((plot) => {
    const textMatch = `${plot.district} ${plot.address}`.toLowerCase().includes(search.toLowerCase());
    return textMatch && (!showAvailable || plot.status === "Available");
  }), [search, showAvailable]);

  const fit = selected.units - desiredUnits;
  const totalCost = selected.cost + Math.max(0, desiredUnits - selected.units) * 0.23;
  const perHousehold = totalCost * 1_000_000 / desiredUnits;
  const budgetFit = totalCost <= budget;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="Grounded home">
          <span className="brandmark"><span /></span>
          <span>Grounded</span>
        </a>
        <nav aria-label="Primary navigation">
          <button className="navlink active">Explore</button>
          <button className="navlink">How it works</button>
          <button className="navlink">About the data</button>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Saved plots"><Icon>♡</Icon><span className="save-count">{saved.length}</span></button>
          <button className="avatar" aria-label="Open profile">VS</button>
        </div>
      </header>

      <section className="workspace">
        <aside className={`sidebar ${panelOpen ? "" : "collapsed"}`}>
          <div className="sidebar-head">
            <div>
              <p className="eyebrow">PLOT FINDER</p>
              <h1>Find ground for<br />your shared future.</h1>
            </div>
            <button className="close-mobile" onClick={() => setPanelOpen(false)} aria-label="Close filters">×</button>
          </div>
          <p className="intro">Explore potentially vacant or underused plots in Berlin and test what your group could build.</p>

          <label className="searchbox">
            <Icon>⌕</Icon>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="District, street or postcode" />
            <kbd>⌘ K</kbd>
          </label>

          <div className="result-line">
            <span><strong>{filtered.length}</strong> potential plots</span>
            <button>Sort: Best fit <span>⌄</span></button>
          </div>

          <div className="filters">
            <button className={showAvailable ? "filter active" : "filter"} onClick={() => setShowAvailable(!showAvailable)}>
              <span className="filter-icon">◎</span> Available now
            </button>
            <button className="filter"><span className="filter-icon">▱</span> 700–2,200 m² <span>⌄</span></button>
            <button className="filter"><span className="filter-icon">▥</span> 10+ units <span>⌄</span></button>
          </div>

          <div className="plot-list">
            {filtered.map((plot) => (
              <button key={plot.id} className={`plot-card ${plot.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(plot.id)}>
                <div className="plot-card-top">
                  <span className={`status ${plot.status === "Review" ? "review" : ""}`}><i />{plot.status}</span>
                  <span className="score">{plot.score}% match</span>
                </div>
                <h2>{plot.address}</h2>
                <p>{plot.district} · Berlin</p>
                <div className="card-metrics">
                  <span><b>{plot.area.toLocaleString("de-DE")}</b> m² plot</span>
                  <span><b>~{plot.units}</b> units</span>
                  <span><b>{money(plot.cost)}</b>m est.</span>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <div className="empty">No exact matches. Try another district or clear a filter.</div>}
          </div>
          <p className="data-note"><Icon>ⓘ</Icon> Screening data, not a legal building assessment. Always verify ownership and planning law.</p>
        </aside>

        <section className="map-area" aria-label="Interactive map of Berlin plots">
          <div className="map-paper">
            <div className="district d1">REINICKENDORF</div><div className="district d2">PANKOW</div>
            <div className="district d3">SPANDAU</div><div className="district d4">MITTE</div>
            <div className="district d5">LICHTENBERG</div><div className="district d6">CHARLOTTENBURG</div>
            <div className="district d7">TEMPELHOF</div><div className="district d8">NEUKÖLLN</div>
            <div className="district d9">TREPTOW–KÖPENICK</div>
            <div className="river river1" /><div className="river river2" />
            <div className="road r1" /><div className="road r2" /><div className="road r3" /><div className="road r4" /><div className="road r5" />
            <div className="park p1" /><div className="park p2" /><div className="park p3" />
            {filtered.map((plot, index) => (
              <button
                key={plot.id}
                className={`map-marker ${selectedId === plot.id ? "selected" : ""}`}
                style={{ left: `${plot.x}%`, top: `${plot.y}%` }}
                onClick={() => setSelectedId(plot.id)}
                aria-label={`Select ${plot.address}`}
              >
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
          <div className="map-tools">
            <button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button><button aria-label="Locate me">⌾</button>
          </div>
          <button className="filter-toggle" onClick={() => setPanelOpen(true)}><Icon>☷</Icon> Filters</button>
          <div className="map-legend"><span><i className="dot green" />Available</span><span><i className="dot ochre" />Needs review</span><button>Map layers <Icon>▱</Icon></button></div>

          <article className="detail-card">
            <div className="detail-main">
              <div className="detail-title">
                <span className={`status ${selected.status === "Review" ? "review" : ""}`}><i />{selected.status}</span>
                <button
                  className={saved.includes(selected.id) ? "save saved" : "save"}
                  onClick={() => setSaved((items) => items.includes(selected.id) ? items.filter((id) => id !== selected.id) : [...items, selected.id])}
                  aria-label="Save this plot"
                >{saved.includes(selected.id) ? "♥ Saved" : "♡ Save"}</button>
                <h2>{selected.address}</h2>
                <p>{selected.district}, 10{selected.id} Berlin</p>
              </div>
              <div className="site-sketch" aria-label="Illustrative plot diagram">
                <svg viewBox="0 0 190 105" role="img">
                  <path d="M11 77 L47 12 L173 24 L181 92 L68 99 Z" className="parcel" />
                  <path d="M54 26 L146 34 L148 75 L75 83 L48 68 Z" className="mass" />
                  <path d={selected.shape} className="courtyard" transform="translate(87 43)" />
                  <path d="M55 26 L76 15 M148 34 L160 24 M148 75 L161 84 M75 83 L67 96" className="guide" />
                  <text x="108" y="67">COURTYARD</text>
                </svg>
              </div>
              <div className="specs">
                <div><span>Plot area</span><strong>{selected.area.toLocaleString("de-DE")} m²</strong></div>
                <div><span>Likely floors</span><strong>{selected.floors}</strong></div>
                <div><span>Typology</span><strong>{selected.type}</strong></div>
                <div><span>Capacity</span><strong>~{selected.units} homes</strong></div>
              </div>
            </div>

            <div className="calculator">
              <div className="calc-head"><div><p className="eyebrow">QUICK FEASIBILITY</p><h3>Could your group fit?</h3></div><span className="beta">BETA</span></div>
              <div className="control-row">
                <label>Desired homes <strong>{desiredUnits}</strong></label>
                <input aria-label="Desired number of homes" type="range" min="6" max="30" value={desiredUnits} onChange={(e) => setDesiredUnits(Number(e.target.value))} />
                <div className="range-labels"><span>6</span><span>30</span></div>
              </div>
              <div className="control-row">
                <label>Group budget <strong>{budget.toFixed(1)}m €</strong></label>
                <input aria-label="Group budget in millions of euros" type="range" min="4" max="16" step=".5" value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
                <div className="range-labels"><span>4m €</span><span>16m €</span></div>
              </div>
              <div className={`fit-result ${fit < 0 || !budgetFit ? "warning" : ""}`}>
                <div className="fit-icon">{fit >= 0 && budgetFit ? "✓" : "!"}</div>
                <div><strong>{fit >= 0 ? `${fit || "Exact"} ${fit === 0 ? "fit" : "homes spare"}` : `${Math.abs(fit)} homes over capacity`}</strong><span>{budgetFit ? "Within your stated group budget" : `${money(totalCost - budget)}m above budget`}</span></div>
              </div>
              <div className="cost-line"><span>Rough project cost <small>incl. land + 18% buffer</small></span><strong>{money(totalCost)}m</strong></div>
              <div className="cost-line"><span>Per household</span><strong>~{money(perHousehold / 1000)}k</strong></div>
              <button className="primary-action">Open full feasibility <span>→</span></button>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
