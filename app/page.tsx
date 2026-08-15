"use client";

import { PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

type GeoJSONGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type MapParcel = {
  id: string;
  areaSqm: number;
  centroidLng: number;
  centroidLat: number;
  geometry: GeoJSONGeometry;
  processingStatus: "vacant" | "high_potential" | "moderate_potential" | "near_full" | "unassessed" | "street" | "park" | "public_space" | "other_or_review";
  legalLandUseLabel: string | null;
  legalGrz: number | null;
  legalGfz: number | null;
  legalStoreysMax: number | null;
  buildingForm: string | null;
  maxLegalFloorAreaSqm: number | null;
  observedFootprintSqm: number | null;
  estimatedFloorAreaSqm: number | null;
  apparentGfz: number | null;
  remainingFloorAreaSqm: number | null;
  occupancyScreening: string | null;
  controllingPlanKeys: string[];
  parcelUseClass: "street" | "park" | "public_space" | "residential_candidate" | "other_or_review" | null;
  vacancyEligible: number | null;
  streetOverlapShare: number | null;
  parkOverlapShare: number | null;
  publicSpaceOverlapShare: number | null;
  residentialOverlapShare: number | null;
};

type MapResponse = {
  parcels: MapParcel[];
  counts: Record<string, number>;
  returned: number;
  caveat: string;
};

type LandUseScreen = {
  metadata: { source: string; method: string; dominantShareThreshold: number; crs: string };
  parcels: Array<{
    id: string;
    parcelUseClass: NonNullable<MapParcel["parcelUseClass"]>;
    vacancyEligible: boolean;
    streetOverlapShare: number;
    parkOverlapShare: number;
    publicSpaceOverlapShare: number;
    residentialOverlapShare: number;
  }>;
};

type BuildingFeatureCollection = {
  type: "FeatureCollection";
  metadata: { buildingCount: number; sourceTitle: string; sourceUrl: string; sourceUpdatedAt: string | null };
  features: Array<{ id: string; geometry: GeoJSONGeometry; properties: { storeys: number | null } }>;
};

type Bounds = { west: number; east: number; south: number; north: number };
type ViewMode = "2d" | "3d";
type AnalysisTab = "analysis" | "build";
type ToolPanel = "layers" | "filters" | "codes" | "share" | null;

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 740;
const MARKET = {
  landPerSqm: 1100,
  completedPerSqm: 5600,
  constructionPerSqm: 3400,
  realizationFactor: 0.62,
};

const statusLabels: Record<MapParcel["processingStatus"], string> = {
  vacant: "Vacant",
  high_potential: "High potential",
  moderate_potential: "Moderate potential",
  near_full: "Near full potential",
  unassessed: "Capacity unresolved",
  street: "Street — excluded",
  park: "Park — excluded",
  public_space: "Public space — excluded",
  other_or_review: "Land use review",
};

const landUseLabels: Record<NonNullable<MapParcel["parcelUseClass"]>, string> = {
  street: "Street space",
  park: "Park / green space",
  public_space: "Public square",
  residential_candidate: "Residential candidate",
  other_or_review: "Other land / review",
};

function fmt(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
}

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

function geometryRings(geometry: GeoJSONGeometry) {
  return geometry.type === "Polygon"
    ? [(geometry.coordinates as number[][][])[0]]
    : (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
}

function calculateBounds(geometries: Array<{ geometry: GeoJSONGeometry }>): Bounds | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const item of geometries) {
    for (const ring of geometryRings(item.geometry)) {
      for (const point of ring) {
        if (point[0] < west) west = point[0];
        if (point[0] > east) east = point[0];
        if (point[1] < south) south = point[1];
        if (point[1] > north) north = point[1];
      }
    }
  }
  return Number.isFinite(west) ? { west, east, south, north } : null;
}

function geometryPath(geometry: GeoJSONGeometry, bounds: Bounds | null) {
  if (!bounds) return "";
  const padding = 24;
  const latitude = (bounds.north + bounds.south) / 2;
  const longitudeScale = Math.cos((latitude * Math.PI) / 180);
  const geographicWidth = Math.max((bounds.east - bounds.west) * longitudeScale, 0.00001);
  const geographicHeight = Math.max(bounds.north - bounds.south, 0.00001);
  const scale = Math.min(
    (WORLD_WIDTH - padding * 2) / geographicWidth,
    (WORLD_HEIGHT - padding * 2) / geographicHeight,
  );
  const renderedWidth = geographicWidth * scale;
  const renderedHeight = geographicHeight * scale;
  const offsetX = (WORLD_WIDTH - renderedWidth) / 2;
  const offsetY = (WORLD_HEIGHT - renderedHeight) / 2;

  return geometryRings(geometry)
    .map((ring) =>
      ring
        .map((point, index) => {
          const x = offsetX + (point[0] - bounds.west) * longitudeScale * scale;
          const y = offsetY + renderedHeight - (point[1] - bounds.south) * scale;
          return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ") + " Z",
    )
    .join(" ");
}

function basePotential(parcel: MapParcel) {
  if (parcel.processingStatus === "vacant") return 1;
  if (parcel.processingStatus === "high_potential") return 0.86;
  if (parcel.processingStatus === "moderate_potential") return 0.58;
  if (parcel.processingStatus === "near_full") return 0.18;
  return 0.06;
}

function capacityStatus(parcel: MapParcel): MapParcel["processingStatus"] {
  if (parcel.occupancyScreening === "no_building_footprint_detected") return "vacant";
  if (parcel.legalGfz == null || parcel.apparentGfz == null) return "unassessed";
  const utilisation = parcel.apparentGfz / parcel.legalGfz;
  if (utilisation < 0.5) return "high_potential";
  if (utilisation < 0.8) return "moderate_potential";
  return "near_full";
}

function potentialColour(score: number) {
  if (score >= 0.82) return "#ff6d16";
  if (score >= 0.6) return "#ff9d24";
  if (score >= 0.38) return "#ffc54b";
  if (score >= 0.16) return "#ffe394";
  return "#e8edf4";
}

function dominantOverlap(parcel: MapParcel) {
  const values = [
    ["street", parcel.streetOverlapShare],
    ["park", parcel.parkOverlapShare],
    ["public", parcel.publicSpaceOverlapShare],
    ["residential", parcel.residentialOverlapShare],
  ] as Array<[string, number | null]>;
  return values.reduce((best, current) => (current[1] ?? 0) > (best[1] ?? 0) ? current : best, values[0]);
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button className={`switch ${checked ? "on" : ""}`} onClick={onChange} aria-pressed={checked} aria-label={label}>
      <span />
    </button>
  );
}

function Icon({ name }: { name: "search" | "bell" | "layers" | "filter" | "codes" | "share" | "folder" | "plus" | "minus" | "reset" }) {
  const paths: Record<typeof name, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 4 4"/></>,
    bell: <><path d="M7 9a5 5 0 0 1 10 0c0 6 2.5 6 2.5 6h-15S7 15 7 9Z"/><path d="M10 19h4"/></>,
    layers: <><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    filter: <path d="M4 5h16l-6.5 7.3V19l-3 1v-7.7L4 5Z"/>,
    codes: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.8 7.4-4.5m-7.4 6.9 7.4 4.5"/></>,
    folder: <path d="M3 7h7l2 2h9v10H3V7Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    minus: <path d="M5 12h14"/>,
    reset: <><path d="M5 8a8 8 0 1 1-1 7"/><path d="M5 3v5H1"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeatureCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("analysis");
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [vacantOnly, setVacantOnly] = useState(true);
  const [underutilised, setUnderutilised] = useState(true);
  const [heatMap, setHeatMap] = useState(true);
  const [buildingHeight, setBuildingHeight] = useState(true);
  const [zoningOverlay, setZoningOverlay] = useState(false);
  const [units, setUnits] = useState(12);
  const [stories, setStories] = useState(4);
  const [usage, setUsage] = useState("Residential");
  const [buildingType, setBuildingType] = useState("Multi-family");
  const [parking, setParking] = useState(8);
  const [applied, setApplied] = useState({ units: 12, stories: 4, usage: "Residential", buildingType: "Multi-family", parking: 8 });
  const [notice, setNotice] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT });
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/parcels/map?borough=Steglitz-Zehlendorf&locality=Lichterfelde&all=true&mode=capacity").then((response) => {
        if (!response.ok) throw new Error("Parcel database could not be reached.");
        return response.json() as Promise<MapResponse>;
      }),
      fetch("/data/lichterfelde-alkis-buildings.geojson").then((response) => {
        if (!response.ok) throw new Error("ALKIS building layer could not be loaded.");
        return response.json() as Promise<BuildingFeatureCollection>;
      }),
      fetch("/data/lichterfelde-land-use-screen.json").then((response) => {
        if (!response.ok) throw new Error("QGIS land-use screen could not be loaded.");
        return response.json() as Promise<LandUseScreen>;
      }),
    ])
      .then(([parcels, buildingLayer, landUseScreen]) => {
        if (cancelled) return;
        const landByParcel = new Map(landUseScreen.parcels.map((parcel) => [parcel.id, parcel]));
        const screenedParcels = parcels.parcels.map((parcel) => {
          const land = landByParcel.get(parcel.id);
          if (!land) return { ...parcel, processingStatus: "other_or_review" as const };
          const processingStatus = land.parcelUseClass === "residential_candidate"
            ? capacityStatus(parcel)
            : land.parcelUseClass;
          return { ...parcel, ...land, vacancyEligible: land.vacancyEligible ? 1 : 0, processingStatus };
        });
        const counts = screenedParcels.reduce<Record<string, number>>((result, parcel) => {
          result[parcel.processingStatus] = (result[parcel.processingStatus] ?? 0) + 1;
          return result;
        }, {});
        const screenedMapData = { ...parcels, parcels: screenedParcels, counts };
        setMapData(screenedMapData);
        setBuildings(buildingLayer);
        const firstOpportunity = screenedParcels.find((parcel) => parcel.processingStatus === "vacant")
          ?? screenedParcels.find((parcel) => parcel.processingStatus === "high_potential");
        setSelectedId(firstOpportunity?.id ?? null);
      })
      .catch((loadError: Error) => !cancelled && setError(loadError.message));
    return () => { cancelled = true; };
  }, []);

  const parcels = useMemo(() => mapData?.parcels ?? [], [mapData]);
  const bounds = useMemo(() => calculateBounds(parcels), [parcels]);
  const selected = useMemo(() => parcels.find((parcel) => parcel.id === selectedId) ?? null, [parcels, selectedId]);
  const parcelPaths = useMemo(() => parcels.map((parcel) => ({ parcel, path: geometryPath(parcel.geometry, bounds) })), [parcels, bounds]);
  const buildingPath = useMemo(() => {
    if (!buildings || !bounds) return "";
    return buildings.features.map((feature) => geometryPath(feature.geometry, bounds)).join(" ");
  }, [buildings, bounds]);

  const requiredFloorArea = applied.units * 95;
  const scenarioScore = (parcel: MapParcel) => {
    const available = parcel.remainingFloorAreaSqm ?? (parcel.processingStatus === "vacant" ? parcel.maxLegalFloorAreaSqm : null);
    const capacityFit = available == null ? 0 : Math.min(1, available / Math.max(1, requiredFloorArea));
    const storeyFit = parcel.legalStoreysMax == null ? 0.4 : parcel.legalStoreysMax >= applied.stories ? 1 : 0.3;
    return Math.min(1, basePotential(parcel) * 0.58 + capacityFit * 0.3 + storeyFit * 0.12);
  };

  const visibleParcels = parcelPaths.filter(({ parcel }) => {
    if (parcel.processingStatus === "vacant") return vacantOnly;
    if (parcel.processingStatus === "high_potential" || parcel.processingStatus === "moderate_potential") return underutilised;
    return !vacantOnly && !underutilised;
  });

  const opportunityCount = (mapData?.counts.vacant ?? 0) + (mapData?.counts.high_potential ?? 0) + (mapData?.counts.moderate_potential ?? 0);
  const withheldCount = (mapData?.counts.street ?? 0) + (mapData?.counts.park ?? 0) + (mapData?.counts.public_space ?? 0) + (mapData?.counts.other_or_review ?? 0);
  const selectedAdditionalGfa = selected?.remainingFloorAreaSqm
    ?? (selected?.processingStatus === "vacant" ? selected.maxLegalFloorAreaSqm : null);
  const selectedLandValue = selected ? selected.areaSqm * MARKET.landPerSqm : null;
  const selectedPotentialValue = selectedAdditionalGfa == null
    ? null
    : Math.max(0, selectedAdditionalGfa * (MARKET.completedPerSqm - MARKET.constructionPerSqm) * MARKET.realizationFactor);
  const selectedUnits = selectedAdditionalGfa == null ? null : Math.max(0, Math.floor(selectedAdditionalGfa / 95));
  const selectedDominantOverlap = selected ? dominantOverlap(selected) : null;

  function zoom(factor: number) {
    setViewBox((current) => {
      const width = Math.min(WORLD_WIDTH, Math.max(220, current.width * factor));
      const height = width * (WORLD_HEIGHT / WORLD_WIDTH);
      return {
        x: Math.max(0, Math.min(WORLD_WIDTH - width, current.x + (current.width - width) / 2)),
        y: Math.max(0, Math.min(WORLD_HEIGHT - height, current.y + (current.height - height) / 2)),
        width,
        height,
      };
    });
  }

  function startDrag(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, viewX: viewBox.x, viewY: viewBox.y };
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = ((event.clientX - dragRef.current.x) / rect.width) * viewBox.width;
    const dy = ((event.clientY - dragRef.current.y) / rect.height) * viewBox.height;
    setViewBox((current) => ({
      ...current,
      x: Math.max(0, Math.min(WORLD_WIDTH - current.width, dragRef.current!.viewX - dx)),
      y: Math.max(0, Math.min(WORLD_HEIGHT - current.height, dragRef.current!.viewY - dy)),
    }));
  }

  function resetView() {
    setViewBox({ x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT });
  }

  function updatePotential() {
    setApplied({ units, stories, usage, buildingType, parking });
    setNotice("Potential scores updated for your building brief.");
    window.setTimeout(() => setNotice(null), 2600);
  }

  async function shareDemo() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice("Demo link copied.");
    } catch {
      setNotice("Share this page from your browser address bar.");
    }
    window.setTimeout(() => setNotice(null), 2600);
  }

  return (
    <main className="site-canvas">
      <section className="dashboard-shell">
        <header className="top-nav">
          <a className="wordmark" href="#" aria-label="bau pal home">bau pal</a>
          <nav aria-label="Primary navigation">
            <a className="active" href="#explore">Explore</a>
            <a href="#analysis">Analyze</a>
            <a href="#projects">Projects</a>
            <a href="#data">Data</a>
            <a href="#about">About</a>
          </nav>
          <div className="nav-actions">
            <button aria-label="Search"><Icon name="search" /></button>
            <button aria-label="Notifications"><Icon name="bell" /></button>
            <span className="avatar">V</span>
          </div>
        </header>

        <div className="workspace" id="explore">
          <aside className="intro-panel">
            <label className="location-label" htmlFor="place">Location</label>
            <select id="place" className="location-select" defaultValue="lichterfelde">
              <option value="lichterfelde">Lichterfelde, Berlin</option>
              <option disabled>Steglitz, Berlin · coming soon</option>
              <option disabled>Hamburg · coming soon</option>
              <option disabled>Munich · coming soon</option>
            </select>
            <h1>Find potential.<br />Build <em>together.</em></h1>
            <p className="lede">Explore vacant or underutilised plots and see what your group could build — based on local planning evidence.</p>
            <button className="primary-action" onClick={() => setNotice("New project started with the current Lichterfelde brief.")}><Icon name="plus" /> New project</button>
            <button className="text-action" onClick={() => setNotice("Project loading is ready for the next demo iteration.")}><Icon name="folder" /> Load project</button>

            <div className="legend-card">
              <div><span>Development potential</span><button title="Potential combines legal capacity and your building brief.">i</button></div>
              <div className="gradient" />
              <div className="legend-range"><span>Low</span><span>High</span></div>
            </div>
          </aside>

          <section className="map-stage" aria-label="Interactive Lichterfelde development potential map">
            <div className="view-toggle" aria-label="Map view">
              <button className={viewMode === "2d" ? "active" : ""} onClick={() => setViewMode("2d")}>2D</button>
              <button className={viewMode === "3d" ? "active" : ""} onClick={() => setViewMode("3d")}>3D</button>
            </div>
            <div className="compass"><b>N</b><span>⌃</span></div>
            <div className="zoom-controls">
              <button onClick={() => zoom(0.74)} aria-label="Zoom in"><Icon name="plus" /></button>
              <button onClick={() => zoom(1.35)} aria-label="Zoom out"><Icon name="minus" /></button>
              <button onClick={resetView} aria-label="Reset map"><Icon name="reset" /></button>
            </div>

            <div className={`micro-world ${viewMode === "3d" ? "is-3d" : "is-2d"}`}>
              <div className="world-aura" />
              {error ? <div className="map-message error">{error}</div> : !mapData ? <div className="map-message">Loading the Lichterfelde evidence layer…</div> : null}
              <svg
                className="world-map"
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={() => { dragRef.current = null; }}
                onPointerCancel={() => { dragRef.current = null; }}
                onWheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : 0.88); }}
              >
                <defs>
                  <filter id="buildingShadow" x="-10%" y="-10%" width="120%" height="140%">
                    <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#7890ac" floodOpacity=".28" />
                  </filter>
                </defs>
                <g className="parcel-base-layer">
                  {parcelPaths.map(({ parcel, path }) => (
                    <path
                      key={`base-${parcel.id}`}
                      d={path}
                      className={`parcel-base use-${parcel.parcelUseClass ?? "unclassified"} ${selectedId === parcel.id ? "selected" : ""}`}
                      onClick={(event) => { event.stopPropagation(); setSelectedId(parcel.id); setAnalysisTab("analysis"); }}
                    >
                      <title>{`${statusLabels[parcel.processingStatus]} · ${fmt(parcel.areaSqm)} m²`}</title>
                    </path>
                  ))}
                </g>
                {buildingPath && <path className={`buildings ${buildingHeight ? "raised" : ""}`} d={buildingPath} filter={buildingHeight ? "url(#buildingShadow)" : undefined} />}
                <g className="parcel-layer">
                  {visibleParcels.map(({ parcel, path }) => {
                    const score = scenarioScore(parcel);
                    const colour = heatMap ? potentialColour(score) : parcel.processingStatus === "vacant" ? "#ff7a1a" : "#ffc44c";
                    return (
                      <path
                        key={parcel.id}
                        d={path}
                        className={`parcel ${selectedId === parcel.id ? "selected" : ""} ${zoningOverlay && parcel.legalGfz != null ? "zoned" : ""}`}
                        style={{ fill: colour }}
                        onClick={(event) => { event.stopPropagation(); setSelectedId(parcel.id); setAnalysisTab("analysis"); }}
                      >
                        <title>{`${statusLabels[parcel.processingStatus]} · ${fmt(parcel.areaSqm)} m² · ${fmt(parcel.remainingFloorAreaSqm)} m² remaining GFA`}</title>
                      </path>
                    );
                  })}
                </g>
              </svg>
            </div>
            <p className="map-caption"><b>{fmt(opportunityCount)}</b> screened opportunities · <b>{fmt(withheldCount)}</b> non-building or review parcels withheld</p>
          </section>

          <aside className="control-panel" id="analysis">
            <div className="panel-tabs">
              <button className={analysisTab === "analysis" ? "active" : ""} onClick={() => setAnalysisTab("analysis")}>Analysis</button>
              <button className={analysisTab === "build" ? "active" : ""} onClick={() => setAnalysisTab("build")}>Build</button>
            </div>

            {analysisTab === "analysis" ? (
              <>
                <section className="control-section">
                  <h2>What do you want to see?</h2>
                  <label>Vacant plots only <Toggle label="Show vacant plots" checked={vacantOnly} onChange={() => setVacantOnly((value) => !value)} /></label>
                  <label>Underutilised plots <Toggle label="Show underutilised plots" checked={underutilised} onChange={() => setUnderutilised((value) => !value)} /></label>
                  <label>Heat map <Toggle label="Show heat map" checked={heatMap} onChange={() => setHeatMap((value) => !value)} /></label>
                  <label>Building height <Toggle label="Show building height" checked={buildingHeight} onChange={() => setBuildingHeight((value) => !value)} /></label>
                  <label>Zoning overlay <Toggle label="Show zoning overlay" checked={zoningOverlay} onChange={() => setZoningOverlay((value) => !value)} /></label>
                </section>

                <section className="parcel-card">
                  <div className="parcel-card-head"><span>Selected plot</span><b>{selected ? statusLabels[selected.processingStatus] : "Choose a plot"}</b></div>
                  {selected ? (
                    <>
                      <h3>{selected.id.replaceAll("_", " / ")}</h3>
                      <div className="metric-grid">
                        <div><span>Plot area</span><b>{fmt(selected.areaSqm)} m²</b></div>
                        <div><span>Remaining GFA</span><b>{fmt(selectedAdditionalGfa)} m²</b></div>
                        <div><span>Legal GFZ / GRZ</span><b>{fmt(selected.legalGfz, 2)} / {fmt(selected.legalGrz, 2)}</b></div>
                        <div><span>Max storeys</span><b>{fmt(selected.legalStoreysMax)}</b></div>
                      </div>
                      <p className={`eligibility-line ${selected.vacancyEligible ? "eligible" : "excluded"}`}>
                        {selected.parcelUseClass ? landUseLabels[selected.parcelUseClass] : "Land-use screen unavailable"}
                        {selectedDominantOverlap && (selectedDominantOverlap[1] ?? 0) > 0 ? ` · ${fmt((selectedDominantOverlap[1] ?? 0) * 100)}% ${selectedDominantOverlap[0]} overlap` : ""}
                      </p>
                      <p className="code-line">{selected.legalLandUseLabel ?? "Land use unresolved"}{selected.controllingPlanKeys.length ? ` · ${selected.controllingPlanKeys.join(", ")}` : ""}</p>
                    </>
                  ) : <p className="empty-state">Click an orange parcel to inspect its evidence.</p>}
                </section>
              </>
            ) : (
              <section className="build-summary">
                <span className="prototype-pill">Prototype estimate</span>
                <h2>{selectedUnits == null ? "Select a parcel" : `Room for ≈ ${fmt(selectedUnits)} homes`}</h2>
                <p>Indicative capacity from legal GFZ and estimated existing floor area. Not a permit determination.</p>
                <div className="value-row"><span>Imputed land value</span><b>{money(selectedLandValue)}</b></div>
                <div className="value-row"><span>Indicative development upside</span><b>{money(selectedPotentialValue)}</b></div>
                <small>Demo assumptions: land €{fmt(MARKET.landPerSqm)}/m², completed space €{fmt(MARKET.completedPerSqm)}/m², construction €{fmt(MARKET.constructionPerSqm)}/m². These are imputed placeholders, not trained-model output.</small>
              </section>
            )}

            <section className="control-section goals">
              <h2>Your building goals</h2>
              <label>Apartment units <Stepper value={units} min={2} max={80} setValue={setUnits} /></label>
              <label>Storeys (target) <Stepper value={stories} min={1} max={8} setValue={setStories} /></label>
              <label>Usage <select value={usage} onChange={(event) => setUsage(event.target.value)}><option>Residential</option><option>Mixed use</option><option>Community</option></select></label>
              <label>Building type <select value={buildingType} onChange={(event) => setBuildingType(event.target.value)}><option>Multi-family</option><option>Courtyard block</option><option>Townhouses</option></select></label>
              <label>Parking spaces <Stepper value={parking} min={0} max={40} setValue={setParking} /></label>
              <button className="update-button" onClick={updatePotential}>Update potential</button>
            </section>
          </aside>
        </div>

        <div className="utility-bar">
          <button className={toolPanel === "layers" ? "active" : ""} onClick={() => setToolPanel(toolPanel === "layers" ? null : "layers")}><Icon name="layers" /><span>Layers</span></button>
          <button className={toolPanel === "filters" ? "active" : ""} onClick={() => setToolPanel(toolPanel === "filters" ? null : "filters")}><Icon name="filter" /><span>Filters</span></button>
          <button className={toolPanel === "codes" ? "active" : ""} onClick={() => setToolPanel(toolPanel === "codes" ? null : "codes")}><Icon name="codes" /><span>Codes</span></button>
          <button onClick={shareDemo}><Icon name="share" /><span>Share</span></button>
        </div>

        {toolPanel && toolPanel !== "share" ? (
          <div className="tool-popover">
            <button className="popover-close" onClick={() => setToolPanel(null)}>×</button>
            {toolPanel === "layers" && <><b>Visible map layers</b><p>ALKIS parcels · ALKIS buildings · QGIS streets, parks, public space and residential land · development-capacity screening{zoningOverlay ? " · planning evidence" : ""}</p></>}
            {toolPanel === "filters" && <><b>Current opportunity filter</b><p>{vacantOnly ? "Vacant" : ""}{vacantOnly && underutilised ? " + " : ""}{underutilised ? "underutilised" : "All parcels"} · target {applied.units} homes · {applied.stories} storeys</p></>}
            {toolPanel === "codes" && <><b>Planning evidence</b><p>{selected ? `${selected.legalLandUseLabel ?? "Use unresolved"}; GFZ ${fmt(selected.legalGfz, 2)}; GRZ ${fmt(selected.legalGrz, 2)}; ${fmt(selected.legalStoreysMax)} storeys.` : "Select a parcel to view its resolved planning fields."}</p></>}
          </div>
        ) : null}

        <footer id="data">
          <span><b>Evidence:</b> Berlin ALKIS parcels and buildings · user-provided QGIS land-use layers · resolved B-Plan / Baunutzungsplan profiles</span>
          <span>Planning and capacity values are screening evidence, not legal advice. Market values are imputed for this demo.</span>
        </footer>
        {notice && <div className="toast" role="status">{notice}</div>}
      </section>
    </main>
  );
}

function Stepper({ value, min, max, setValue }: { value: number; min: number; max: number; setValue: (value: number) => void }) {
  return (
    <span className="stepper">
      <b>{value}</b>
      <button onClick={() => setValue(Math.max(min, value - 1))} aria-label="Decrease"><Icon name="minus" /></button>
      <button onClick={() => setValue(Math.min(max, value + 1))} aria-label="Increase"><Icon name="plus" /></button>
    </span>
  );
}
