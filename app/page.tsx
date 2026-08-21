"use client";

import { PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import LichterfeldeGlobe from "../components/LichterfeldeGlobe";

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

type LocalityBoundary = {
  type: "Feature";
  properties: { name: string; officialId: string };
  geometry: GeoJSONGeometry;
};

type ProcessedBPlan = {
  type: "Feature";
  id: string;
  geometry: GeoJSONGeometry;
  properties: {
    planKey: string;
    title: string;
    planType: string;
    status: string;
    effectiveFrom: string | null;
    processingStatus: "machine_extracted" | "verified";
    ocrStatus: string;
    planSheetUrl: string;
    intersectingParcels: number;
    controllingParcels: number;
    geometrySource: "official_vector";
    geometryConfidence: "official";
  };
};

type ProcessedBPlanCollection = {
  type: "FeatureCollection";
  metadata: { planCount: number; definition: string; inventorySource: string; geometrySource: string };
  features: ProcessedBPlan[];
};

type Bounds = { west: number; east: number; south: number; north: number };
type ViewMode = "2d" | "3d";
type ToolPanel = "layers" | "filters" | "codes" | "share" | null;

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 740;
const GLOBE_CIRCUMFERENCE_RATIO = 1.25;
const GLOBE_SURFACE_SPAN_RADIANS = (2 * Math.PI) / GLOBE_CIRCUMFERENCE_RATIO;
const RESIDENTIAL_MASK_MIN_SHARE = 0.5;
const PARK_EXCLUSION_MIN_SHARE = 0.01;
const SHORTLIST_STORAGE_KEY = "baupal-shortlist-v1";
const COMPLETE_DENSITY_COLOUR = "#43116f";
const MARKET = {
  landPerSqm: 1100,
  completedPerSqm: 5600,
  constructionPerSqm: 3400,
  realizationFactor: 0.62,
};

const EU_COUNTRIES = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia", "Finland",
  "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg",
  "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
];

const MAJOR_EU_CITIES = [
  ["Berlin", "Germany"], ["Madrid", "Spain"], ["Rome", "Italy"], ["Paris", "France"], ["Vienna", "Austria"],
  ["Hamburg", "Germany"], ["Warsaw", "Poland"], ["Budapest", "Hungary"], ["Barcelona", "Spain"], ["Munich", "Germany"],
  ["Milan", "Italy"], ["Prague", "Czechia"], ["Sofia", "Bulgaria"], ["Cologne", "Germany"], ["Stockholm", "Sweden"],
  ["Naples", "Italy"], ["Turin", "Italy"], ["Amsterdam", "Netherlands"], ["Marseille", "France"], ["Zagreb", "Croatia"],
] as const;

const BERLIN_LOCALITIES = [
  "Adlershof", "Alt-Hohenschönhausen", "Alt-Treptow", "Altglienicke", "Baumschulenweg", "Biesdorf", "Blankenburg", "Blankenfelde", "Bohnsdorf", "Borsigwalde", "Britz", "Buch", "Buckow", "Charlottenburg", "Charlottenburg-Nord", "Dahlem", "Falkenberg", "Falkenhagener Feld", "Fennpfuhl", "Französisch Buchholz", "Friedenau", "Friedrichsfelde", "Friedrichshagen", "Friedrichshain", "Frohnau", "Gatow", "Gesundbrunnen", "Gropiusstadt", "Grunewald", "Grünau", "Hakenfelde", "Halensee", "Hansaviertel", "Haselhorst", "Heiligensee", "Heinersdorf", "Hellersdorf", "Hermsdorf", "Johannisthal", "Karlshorst", "Karow", "Kaulsdorf", "Kladow", "Konradshöhe", "Kreuzberg", "Köpenick", "Lankwitz", "Lichtenberg", "Lichtenrade", "Lichterfelde", "Lübars", "Mahlsdorf", "Malchow", "Mariendorf", "Marienfelde", "Marzahn", "Mitte", "Moabit", "Märkisches Viertel", "Müggelheim", "Neu-Hohenschönhausen", "Neukölln", "Niederschöneweide", "Niederschönhausen", "Nikolassee", "Oberschöneweide", "Pankow", "Plänterwald", "Prenzlauer Berg", "Rahnsdorf", "Reinickendorf", "Rosenthal", "Rudow", "Rummelsburg", "Schlachtensee", "Schmargendorf", "Schmöckwitz", "Schöneberg", "Siemensstadt", "Spandau", "Staaken", "Stadtrandsiedlung Malchow", "Steglitz", "Tegel", "Tempelhof", "Tiergarten", "Waidmannslust", "Wannsee", "Wartenberg", "Wedding", "Weißensee", "Westend", "Wilhelmsruh", "Wilhelmstadt", "Wilmersdorf", "Wittenau", "Zehlendorf",
];

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

function googleMapsUrl(parcel: MapParcel) {
  const coordinates = `${parcel.centroidLat.toFixed(7)},${parcel.centroidLng.toFixed(7)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
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

function geometryPoint(longitude: number, latitude: number, bounds: Bounds | null) {
  if (!bounds) return null;
  const padding = 24;
  const centreLatitude = (bounds.north + bounds.south) / 2;
  const longitudeScale = Math.cos((centreLatitude * Math.PI) / 180);
  const geographicWidth = Math.max((bounds.east - bounds.west) * longitudeScale, 0.00001);
  const geographicHeight = Math.max(bounds.north - bounds.south, 0.00001);
  const scale = Math.min(
    (WORLD_WIDTH - padding * 2) / geographicWidth,
    (WORLD_HEIGHT - padding * 2) / geographicHeight,
  );
  const renderedWidth = geographicWidth * scale;
  const renderedHeight = geographicHeight * scale;
  return {
    x: (WORLD_WIDTH - renderedWidth) / 2 + (longitude - bounds.west) * longitudeScale * scale,
    y: (WORLD_HEIGHT - renderedHeight) / 2 + renderedHeight - (latitude - bounds.south) * scale,
  };
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

function isInsideResidentialMask(parcel: MapParcel) {
  return parcel.parcelUseClass === "residential_candidate"
    && parcel.vacancyEligible === 1
    && (parcel.residentialOverlapShare ?? 0) >= RESIDENTIAL_MASK_MIN_SHARE
    && (parcel.parkOverlapShare ?? 0) < PARK_EXCLUSION_MIN_SHARE;
}

function potentialColour(score: number) {
  if (score >= 0.82) return "#ff6d16";
  if (score >= 0.6) return "#ff9d24";
  if (score >= 0.38) return "#ffc54b";
  if (score >= 0.16) return "#ffe394";
  return "#e8edf4";
}

function hasCompleteDensityEvidence(parcel: MapParcel) {
  return parcel.legalGrz != null && parcel.legalGfz != null;
}

function heatMapColour(parcel: MapParcel, score: number, enabled: boolean) {
  if (enabled) return potentialColour(score);
  return parcel.processingStatus === "vacant" ? "#ff7a1a" : "#ffc44c";
}

function globeBaseColour(parcel: MapParcel) {
  if (parcel.parcelUseClass === "street") return "#dce4ec";
  if (parcel.parcelUseClass === "park") return "#dcebdd";
  if (parcel.parcelUseClass === "public_space") return "#eee8dc";
  if (parcel.parcelUseClass === "residential_candidate") return "#e4ebf3";
  return "#e9edf2";
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

function Icon({ name }: { name: "layers" | "filter" | "codes" | "share" | "plus" | "minus" | "reset" | "external" }) {
  const paths: Record<typeof name, ReactNode> = {
    layers: <><path d="m12 3 8 4-8 4-8-4 8-4Z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    filter: <path d="M4 5h16l-6.5 7.3V19l-3 1v-7.7L4 5Z"/>,
    codes: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    share: <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.8 7.4-4.5m-7.4 6.9 7.4 4.5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    minus: <path d="M5 12h14"/>,
    reset: <><path d="M5 8a8 8 0 1 1-1 7"/><path d="M5 3v5H1"/></>,
    external: <><path d="M14 5h5v5M19 5l-9 9"/><path d="M17 13v6H5V7h6"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [mapData, setMapData] = useState<MapResponse | null>(null);
  const [buildings, setBuildings] = useState<BuildingFeatureCollection | null>(null);
  const [boundary, setBoundary] = useState<LocalityBoundary | null>(null);
  const [processedPlans, setProcessedPlans] = useState<ProcessedBPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [vacantOnly, setVacantOnly] = useState(true);
  const [underutilised, setUnderutilised] = useState(true);
  const [heatMap, setHeatMap] = useState(true);
  const [buildingHeight, setBuildingHeight] = useState(true);
  const [showDensityDots, setShowDensityDots] = useState(true);
  const [showProcessedPlans, setShowProcessedPlans] = useState(true);
  const [country, setCountry] = useState("Germany");
  const [city, setCity] = useState("Berlin");
  const [locality, setLocality] = useState("Lichterfelde");
  const [shortlistIds, setShortlistIds] = useState<string[]>([]);
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [shortlistLoaded, setShortlistLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT });
  const [globeScale, setGlobeScale] = useState(1.8);
  const [globeResetKey, setGlobeResetKey] = useState(0);
  const dragRef = useRef<{ x: number; y: number; viewX: number; viewY: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/lichterfelde-parcels-demo.json").then((response) => {
        if (!response.ok) throw new Error("The Lichterfelde parcel snapshot could not be loaded.");
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
      fetch("/data/lichterfelde-boundary.geojson").then((response) => {
        if (!response.ok) throw new Error("Lichterfelde boundary could not be loaded.");
        return response.json() as Promise<LocalityBoundary>;
      }),
      fetch("/data/lichterfelde-processed-bplans.geojson").then((response) => {
        if (!response.ok) throw new Error("Processed B-Plan outlines could not be loaded.");
        return response.json() as Promise<ProcessedBPlanCollection>;
      }),
    ])
      .then(([parcels, buildingLayer, landUseScreen, localityBoundary, processedPlanLayer]) => {
        if (cancelled) return;
        const landByParcel = new Map(landUseScreen.parcels.map((parcel) => [parcel.id, parcel]));
        const screenedParcels = parcels.parcels.map((parcel) => {
          const land = landByParcel.get(parcel.id);
          if (!land) return { ...parcel, processingStatus: "other_or_review" as const };
          const residentialEligible = land.parcelUseClass === "residential_candidate"
            && land.vacancyEligible
            && land.residentialOverlapShare >= RESIDENTIAL_MASK_MIN_SHARE
            && land.parkOverlapShare < PARK_EXCLUSION_MIN_SHARE;
          const processingStatus = residentialEligible
            ? capacityStatus(parcel)
            : land.parcelUseClass === "residential_candidate" ? "other_or_review" : land.parcelUseClass;
          return { ...parcel, ...land, vacancyEligible: residentialEligible ? 1 : 0, processingStatus };
        });
        const counts = screenedParcels.reduce<Record<string, number>>((result, parcel) => {
          result[parcel.processingStatus] = (result[parcel.processingStatus] ?? 0) + 1;
          return result;
        }, {});
        const screenedMapData = { ...parcels, parcels: screenedParcels, counts };
        setMapData(screenedMapData);
        setBuildings(buildingLayer);
        setBoundary(localityBoundary);
        setProcessedPlans(processedPlanLayer.features);
        const firstOpportunity = screenedParcels.find((parcel) => parcel.processingStatus === "vacant")
          ?? screenedParcels.find((parcel) => parcel.processingStatus === "high_potential");
        setSelectedId(firstOpportunity?.id ?? null);
      })
      .catch((loadError: Error) => !cancelled && setError(loadError.message));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SHORTLIST_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) {
        setShortlistIds(parsed.filter((id): id is string => typeof id === "string"));
      }
    } catch {
      // Keep the in-memory shortlist available when browser storage is blocked.
    } finally {
      setShortlistLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!shortlistLoaded) return;
    try {
      window.localStorage.setItem(SHORTLIST_STORAGE_KEY, JSON.stringify(shortlistIds));
    } catch {
      // The drawer still works for the current session without persistence.
    }
  }, [shortlistIds, shortlistLoaded]);

  const parcels = useMemo(() => mapData?.parcels ?? [], [mapData]);
  const bounds = useMemo(() => calculateBounds(parcels), [parcels]);
  const selected = useMemo(() => parcels.find((parcel) => parcel.id === selectedId) ?? null, [parcels, selectedId]);
  const shortlistIdSet = useMemo(() => new Set(shortlistIds), [shortlistIds]);
  const shortlistedParcels = useMemo(() => shortlistIds
    .map((id) => parcels.find((parcel) => parcel.id === id))
    .filter((parcel): parcel is MapParcel => Boolean(parcel)), [parcels, shortlistIds]);
  const selectedPlan = useMemo(() => processedPlans.find((plan) => plan.properties.planKey === selectedPlanKey) ?? null, [processedPlans, selectedPlanKey]);
  const parcelPaths = useMemo(() => parcels.map((parcel) => ({ parcel, path: geometryPath(parcel.geometry, bounds) })), [parcels, bounds]);
  const processedPlanPaths = useMemo(() => processedPlans.map((plan) => ({ plan, path: geometryPath(plan.geometry, bounds) })), [processedPlans, bounds]);
  const buildingPath = useMemo(() => {
    if (!buildings || !bounds) return "";
    return buildings.features.map((feature) => geometryPath(feature.geometry, bounds)).join(" ");
  }, [buildings, bounds]);

  const scenarioScore = (parcel: MapParcel) => {
    if (!isInsideResidentialMask(parcel)) return 0;
    return basePotential(parcel);
  };

  const visibleParcels = parcelPaths.filter(({ parcel }) => {
    if (!isInsideResidentialMask(parcel)) return false;
    if (heatMap && hasCompleteDensityEvidence(parcel)) return true;
    if (parcel.processingStatus === "vacant") return vacantOnly;
    if (parcel.processingStatus === "high_potential" || parcel.processingStatus === "moderate_potential") return underutilised;
    return !vacantOnly && !underutilised;
  });

  const globeParcels = useMemo(() => parcels.map((parcel) => {
    const residentialEligible = isInsideResidentialMask(parcel);
    const isVacant = parcel.processingStatus === "vacant";
    const isUnderutilised = parcel.processingStatus === "high_potential" || parcel.processingStatus === "moderate_potential";
    const visible = residentialEligible && ((isVacant && vacantOnly) || (isUnderutilised && underutilised) || (!vacantOnly && !underutilised && !isVacant && !isUnderutilised));
    const score = basePotential(parcel);
    const completeDensityEvidence = hasCompleteDensityEvidence(parcel);
    const opportunityColour = heatMapColour(parcel, score, heatMap);
    return {
      id: parcel.id,
      geometry: parcel.geometry,
      centroidLng: parcel.centroidLng,
      centroidLat: parcel.centroidLat,
      colour: visible || (heatMap && residentialEligible && completeDensityEvidence)
        ? opportunityColour
        : globeBaseColour(parcel),
      outlineColour: selectedId === parcel.id ? "#3b78c1" : "#ffffff",
      completeDensityEvidence: showDensityDots && completeDensityEvidence,
    };
  }), [heatMap, parcels, selectedId, showDensityDots, underutilised, vacantOnly]);

  const completeDensityCount = useMemo(() => parcels.filter((parcel) =>
    isInsideResidentialMask(parcel) && hasCompleteDensityEvidence(parcel)).length, [parcels]);

  const globeBuildings = useMemo(() => buildings?.features.map((feature) => ({
    geometry: feature.geometry,
    storeys: feature.properties.storeys,
  })) ?? [], [buildings]);
  const globePlanOutlines = useMemo(() => showProcessedPlans ? processedPlans.map((plan) => ({
    planKey: plan.properties.planKey,
    geometry: plan.geometry,
  })) : [], [processedPlans, showProcessedPlans]);

  const selectedResidentialEligible = selected ? isInsideResidentialMask(selected) : false;
  const selectedAdditionalGfa = selectedResidentialEligible
    ? selected?.remainingFloorAreaSqm ?? (selected?.processingStatus === "vacant" ? selected.maxLegalFloorAreaSqm : null)
    : null;
  const selectedLandValue = selectedResidentialEligible && selected ? selected.areaSqm * MARKET.landPerSqm : null;
  const selectedPotentialValue = selectedAdditionalGfa == null
    ? null
    : Math.max(0, selectedAdditionalGfa * (MARKET.completedPerSqm - MARKET.constructionPerSqm) * MARKET.realizationFactor);
  const selectedUnits = selectedAdditionalGfa == null ? null : Math.max(0, Math.floor(selectedAdditionalGfa / 95));
  const selectedDominantOverlap = selected ? dominantOverlap(selected) : null;
  const availableCities = useMemo(() => MAJOR_EU_CITIES.filter(([, nation]) => nation === country), [country]);

  function zoom(factor: number) {
    if (viewMode === "3d") {
      setGlobeScale((current) => Math.min(2.7, Math.max(0.9, current / factor)));
      return;
    }
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
    setGlobeScale(1.8);
    setGlobeResetKey((current) => current + 1);
  }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    setViewBox({ x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_HEIGHT });
    if (mode === "3d") setGlobeResetKey((current) => current + 1);
  }

  function toggleShortlist() {
    if (!selected) return;
    const isShortlisted = shortlistIdSet.has(selected.id);
    setShortlistIds((current) => isShortlisted
      ? current.filter((id) => id !== selected.id)
      : [...current, selected.id]);
    if (!isShortlisted) setShortlistOpen(true);
    setNotice(isShortlisted ? "Plot removed from shortlist." : "Plot added to shortlist.");
    window.setTimeout(() => setNotice(null), 2600);
  }

  function selectShortlistedPlot(parcelId: string) {
    setSelectedId(parcelId);
    setSelectedPlanKey(null);
    setNotice("Shortlisted plot selected.");
    window.setTimeout(() => setNotice(null), 1800);
  }

  function removeShortlistedPlot(parcelId: string) {
    setShortlistIds((current) => current.filter((id) => id !== parcelId));
    setNotice("Plot removed from shortlist.");
    window.setTimeout(() => setNotice(null), 1800);
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
        </header>

        <section className="mission-banner" aria-label="Location and purpose">
          <p className="mission-statement">Explore vacant or underutilised plots and see what your group could build — based on local planning evidence.</p>
          <div className="location-control" aria-label="Demo location">
            <label className="location-field" htmlFor="country">
              <span>Country</span>
              <select id="country" value={country} onChange={(event) => {
                const nextCountry = event.target.value;
                const nextCity = MAJOR_EU_CITIES.find(([, nation]) => nation === nextCountry)?.[0] ?? "";
                setCountry(nextCountry);
                setCity(nextCity);
                setLocality(nextCity === "Berlin" ? "Lichterfelde" : "");
              }}>
                {EU_COUNTRIES.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            <label className="location-field" htmlFor="city">
              <span>City</span>
              <select id="city" value={city} disabled={availableCities.length === 0} onChange={(event) => {
                const nextCity = event.target.value;
                setCity(nextCity);
                setLocality(nextCity === "Berlin" ? "Lichterfelde" : "");
              }}>
                {availableCities.length
                  ? availableCities.map(([name]) => <option key={name} value={name}>{name}</option>)
                  : <option value="">Major-city data coming soon</option>}
              </select>
            </label>
            <label className="location-field" htmlFor="district">
              <span>District / locality</span>
              <select id="district" value={locality} disabled={city !== "Berlin"} onChange={(event) => setLocality(event.target.value)}>
                {city === "Berlin"
                  ? BERLIN_LOCALITIES.map((name) => <option key={name}>{name}</option>)
                  : <option value="">District data coming soon</option>}
              </select>
            </label>
          </div>
        </section>

        <div className="workspace" id="explore">
          <aside className="control-panel analysis-panel" id="analysis">
            <header className="panel-heading">
              <span>01</span>
              <div><b>Explore</b><small>Choose opportunity and evidence layers</small></div>
            </header>
            <section className="control-section">
              <h2>What do you want to see?</h2>
              <label>Vacant plots only <Toggle label="Show vacant plots" checked={vacantOnly} onChange={() => setVacantOnly((value) => !value)} /></label>
              <label>Underutilised plots <Toggle label="Show underutilised plots" checked={underutilised} onChange={() => setUnderutilised((value) => !value)} /></label>
              <label>Heat map <Toggle label="Show heat map" checked={heatMap} onChange={() => setHeatMap((value) => !value)} /></label>
              <label>Building height <Toggle label="Show building height" checked={buildingHeight} onChange={() => setBuildingHeight((value) => !value)} /></label>
              <label>GRZ + GFZ evidence <Toggle label="Show GRZ and GFZ evidence dots" checked={showDensityDots} onChange={() => setShowDensityDots((value) => !value)} /></label>
              <label>Processed B-Plan outlines <Toggle label="Show processed B-Plan outlines" checked={showProcessedPlans} onChange={() => {
                setShowProcessedPlans((value) => !value);
                if (showProcessedPlans) setSelectedPlanKey(null);
              }} /></label>
            </section>

            <div className="legend-card">
              <div><span>Development potential</span><button title="Potential reflects the vacancy and legal-capacity screening.">i</button></div>
              <div className="gradient" />
              <div className="legend-range"><span>Low</span><span>High</span></div>
              <div className="complete-density-key">
                <span aria-hidden="true" />
                <div><b>GRZ + GFZ available</b><small>Purple dot · {fmt(completeDensityCount)} eligible parcels</small></div>
              </div>
            </div>

          </aside>

          <section className="map-stage" aria-label="Interactive Lichterfelde development potential map">
            <div className="view-toggle" aria-label="Map view">
              <button className={viewMode === "2d" ? "active" : ""} onClick={() => changeViewMode("2d")}>2D</button>
              <button className={viewMode === "3d" ? "active" : ""} onClick={() => changeViewMode("3d")}>3D</button>
            </div>
            <div className="compass"><b>N</b><span>⌃</span></div>
            <div className="zoom-controls">
              <button onClick={() => zoom(0.74)} aria-label="Zoom in"><Icon name="plus" /></button>
              <button onClick={() => zoom(1.35)} aria-label="Zoom out"><Icon name="minus" /></button>
              <button onClick={resetView} aria-label="Reset map"><Icon name="reset" /></button>
            </div>

            <div className={`micro-world ${viewMode === "3d" ? "is-3d" : "is-2d"}`}>
              {error ? <div className="map-message error">{error}</div> : !mapData ? <div className="map-message">Loading the Lichterfelde evidence layer…</div> : null}
              <div className="globe-assembly">
                {viewMode === "3d" ? (
                  <LichterfeldeGlobe
                    parcels={globeParcels}
                    buildings={globeBuildings}
                    planOutlines={globePlanOutlines}
                    selectedPlanKey={selectedPlanKey}
                    boundary={boundary?.geometry ?? null}
                    bounds={bounds}
                    geometryVersion={`${mapData?.returned ?? 0}:${buildings?.metadata.buildingCount ?? 0}:${boundary?.properties.officialId ?? ""}:${processedPlans.length}`}
                    showBuildings={buildingHeight}
                    scale={globeScale}
                    resetKey={globeResetKey}
                    surfaceSpanRadians={GLOBE_SURFACE_SPAN_RADIANS}
                    onZoom={zoom}
                    onSelect={setSelectedId}
                    onSelectPlan={setSelectedPlanKey}
                  />
                ) : <div className="world-aura" />}
                {viewMode === "2d" ? (
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
                      onClick={(event) => { event.stopPropagation(); setSelectedId(parcel.id); }}
                    >
                      <title>{`${statusLabels[parcel.processingStatus]} · ${fmt(parcel.areaSqm)} m²`}</title>
                    </path>
                  ))}
                </g>
                {buildingPath && <path className={`buildings ${buildingHeight ? "raised" : ""}`} d={buildingPath} filter={buildingHeight ? "url(#buildingShadow)" : undefined} />}
                <g className="parcel-layer">
                  {visibleParcels.map(({ parcel, path }) => {
                    const score = scenarioScore(parcel);
                    const colour = heatMapColour(parcel, score, heatMap);
                    return (
                      <path
                        key={parcel.id}
                        d={path}
                        className={`parcel ${selectedId === parcel.id ? "selected" : ""}`}
                        style={{ fill: colour }}
                        onClick={(event) => { event.stopPropagation(); setSelectedId(parcel.id); }}
                      >
                        <title>{`${statusLabels[parcel.processingStatus]} · ${fmt(parcel.areaSqm)} m² · ${fmt(parcel.remainingFloorAreaSqm)} m² remaining GFA${hasCompleteDensityEvidence(parcel) ? ` · GRZ ${fmt(parcel.legalGrz, 2)} · GFZ ${fmt(parcel.legalGfz, 2)}` : ""}`}</title>
                      </path>
                    );
                  })}
                </g>
                {showDensityDots ? <g className="density-evidence-layer" aria-label="Parcels with complete GRZ and GFZ evidence">
                  {visibleParcels.filter(({ parcel }) => hasCompleteDensityEvidence(parcel)).map(({ parcel }) => {
                    const point = geometryPoint(parcel.centroidLng, parcel.centroidLat, bounds);
                    return point ? (
                      <circle key={`density-${parcel.id}`} className="density-evidence-dot" cx={point.x} cy={point.y} r="2.2">
                        <title>{`GRZ ${fmt(parcel.legalGrz, 2)} · GFZ ${fmt(parcel.legalGfz, 2)}`}</title>
                      </circle>
                    ) : null;
                  })}
                </g> : null}
                {showProcessedPlans ? (
                  <g className="processed-plan-layer" aria-label="Processed B-Plan outlines">
                    {processedPlanPaths.map(({ plan, path }) => (
                      <path
                        key={`plan-${plan.properties.planKey}`}
                        d={path}
                        className={`processed-plan-outline ${selectedPlanKey === plan.properties.planKey ? "selected" : ""}`}
                        onClick={(event) => { event.stopPropagation(); setSelectedPlanKey(plan.properties.planKey); }}
                      >
                        <title>{`${plan.properties.title} · processed plan sheet · official scope`}</title>
                      </path>
                    ))}
                  </g>
                ) : null}
                </svg>
                ) : null}
              </div>
            </div>
            {selectedPlan ? (
              <aside className="plan-selection-card" aria-live="polite">
                <button onClick={() => setSelectedPlanKey(null)} aria-label="Close B-Plan details">×</button>
                <span>Processed B-Plan</span>
                <b>{selectedPlan.properties.title}</b>
                <small>{selectedPlan.properties.status.replaceAll("_", " ")} · official plan scope</small>
                <a href={selectedPlan.properties.planSheetUrl} target="_blank" rel="noreferrer">Open plan sheet <Icon name="external" /></a>
                <em>Machine-extracted; not yet a legal verification.</em>
              </aside>
            ) : null}
          </section>

          <aside className="control-panel build-panel" id="build">
            <header className="panel-heading">
              <span>02</span>
              <div><b>Plot results</b><small>Dimensions, capacity and value</small></div>
            </header>

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
                    {selectedResidentialEligible ? "Inside Wohnbauflächen eligibility mask" : selected.parcelUseClass ? landUseLabels[selected.parcelUseClass] : "Land-use screen unavailable"}
                    {selectedDominantOverlap && (selectedDominantOverlap[1] ?? 0) > 0 ? ` · ${fmt((selectedDominantOverlap[1] ?? 0) * 100)}% ${selectedDominantOverlap[0]} overlap` : ""}
                  </p>
                  <a className="maps-button" href={googleMapsUrl(selected)} target="_blank" rel="noreferrer" aria-label={`Open selected parcel ${selected.id} in Google Maps`}>
                    <span>Open in Google Maps</span>
                    <small>{selected.centroidLat.toFixed(6)}, {selected.centroidLng.toFixed(6)}</small>
                    <Icon name="external" />
                  </a>
                </>
              ) : <p className="empty-state">Click an orange parcel to inspect its evidence.</p>}
            </section>

            <section className="shortlist-section">
              <button
                className="shortlist-heading"
                type="button"
                onClick={() => setShortlistOpen((open) => !open)}
                aria-expanded={shortlistOpen}
                aria-controls="shortlist-drawer"
              >
                <span className="shortlist-title">
                  <b>Shortlist</b>
                  <small>{shortlistIds.length} {shortlistIds.length === 1 ? "plot" : "plots"} saved</small>
                </span>
                <span className={`shortlist-chevron ${shortlistOpen ? "open" : ""}`} aria-hidden="true">⌄</span>
              </button>
              {shortlistOpen ? (
                <div className="shortlist-drawer" id="shortlist-drawer">
                  {shortlistedParcels.length ? shortlistedParcels.map((parcel) => (
                    <div className={`shortlist-item ${selectedId === parcel.id ? "selected" : ""}`} key={parcel.id}>
                      <button
                        className="shortlist-item-main"
                        type="button"
                        onClick={() => selectShortlistedPlot(parcel.id)}
                        aria-label={`Select shortlisted parcel ${parcel.id}`}
                      >
                        <b>{parcel.id.replaceAll("_", " / ")}</b>
                        <span>{statusLabels[parcel.processingStatus]} · {fmt(parcel.areaSqm)} m²</span>
                      </button>
                      <button
                        className="shortlist-remove"
                        type="button"
                        onClick={() => removeShortlistedPlot(parcel.id)}
                        aria-label={`Remove parcel ${parcel.id} from shortlist`}
                        title="Remove from shortlist"
                      >×</button>
                    </div>
                  )) : (
                    <p className="shortlist-empty">Select a plot on the map and add it here for quick comparison.</p>
                  )}
                </div>
              ) : null}
              <button
                className={selected && shortlistIdSet.has(selected.id) ? "shortlist-button active" : "shortlist-button"}
                onClick={toggleShortlist}
                disabled={!selected}
              >
                {selected && shortlistIdSet.has(selected.id) ? "Remove selected" : "Shortlist selected"}
              </button>
            </section>

            <section className="build-summary">
              <span className="prototype-pill">Prototype estimate</span>
              <h2>{selectedUnits == null ? "Select a parcel" : `Room for ≈ ${fmt(selectedUnits)} homes`}</h2>
              <p>Indicative capacity from legal GFZ and estimated existing floor area. Not a permit determination.</p>
              <div className="value-row"><span>Imputed land value</span><b>{money(selectedLandValue)}</b></div>
              <div className="value-row"><span>Indicative development upside</span><b>{money(selectedPotentialValue)}</b></div>
              <small>Demo assumptions: land €{fmt(MARKET.landPerSqm)}/m², completed space €{fmt(MARKET.completedPerSqm)}/m², construction €{fmt(MARKET.constructionPerSqm)}/m². These are imputed placeholders, not trained-model output.</small>
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
            {toolPanel === "layers" && <><b>Visible map layers</b><p>ALKIS parcels · ALKIS buildings · QGIS streets, parks, public space and residential land · development-capacity screening{showProcessedPlans ? ` · ${processedPlans.length} processed B-Plan official scopes` : ""}</p></>}
            {toolPanel === "filters" && <><b>Current opportunity filter</b><p>{vacantOnly ? "Vacant" : ""}{vacantOnly && underutilised ? " + " : ""}{underutilised ? "underutilised" : "All parcels"} · inside the residential eligibility mask</p></>}
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
