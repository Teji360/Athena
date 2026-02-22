"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl";
import MapGL, { Layer, Marker, Source, type LayerProps, type MapRef } from "react-map-gl";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import conflictRaw from "@/lib/countryConflictData.json";
import countyResourcesRaw from "@/lib/ssdCountyResources.json";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type ConflictEntry = {
  country?: string;
  conflictLevel?: string;
  conflictRank?: number;
  deadlinessValue?: number;
  dangerValue?: number;
  diffusionValue?: number;
  events2025?: number;
  events2024?: number;
  eventsYoY?: number;
};

const conflictData = conflictRaw as Record<string, ConflictEntry>;

type CountyFacility = {
  name: string;
  type: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  distKm: number;
};

type CountyMarket = {
  name: string;
  county: string;
  state: string;
  lat: number;
  lon: number;
  distKm: number;
};

type CountyResources = {
  pcode: string;
  county: string;
  state: string;
  centroidLat: number;
  centroidLon: number;
  topFacilities: CountyFacility[];
  topMarkets: CountyMarket[];
};

const countyResourcesData = countyResourcesRaw as Record<string, CountyResources>;

// Build lookup by normalized county name → resources (handles name mismatches gracefully)
const countyResourcesByName = new Map<string, CountyResources>();
for (const entry of Object.values(countyResourcesData)) {
  countyResourcesByName.set(entry.county.toLowerCase(), entry);
  // Also index common name variants (hyphen vs space, etc.)
  countyResourcesByName.set(entry.county.toLowerCase().replace(/-/g, " "), entry);
}

type GlobeMode = "risk" | "flood" | "sudan_map" | "forecast_30d";

type SudanMapLayers = {
  hunger: boolean;
  displacement: boolean;
  facilities: boolean;
  markets: boolean;
};

type CountryRisk = {
  iso3: string;
  country: string | null;
  status: "green" | "yellow" | "red";
  riskScore: number;
  floodPopExposed: number | null;
};

type CountryForecast = {
  iso3: string;
  country: string | null;
  asOfDate: string | null;
  currentRiskScore: number;
  forecastRiskScore: number;
  forecastStatus: "green" | "yellow" | "red";
};

export type GlobeHighlight = {
  iso3: string;
  summary: string;
  center: [number, number]; // [lng, lat]
};

type SsdHungerSummary = {
  avgPriority: number | null;
  redCount: number;
  yellowCount: number;
  greenCount: number;
  topCounty: string | null;
  topState: string | null;
  topScore: number | null;
};

type SsdCountyHungerRow = {
  adm1State: string;
  adm2County: string;
  hungerGamPct: number | null;
  priorityScore: number | null;
  priorityBand: "green" | "yellow" | "red";
  healthFacilityCount: number | null;
  idpIndividuals: number | null;
  latitude: number | null;
  longitude: number | null;
  facilityLatitude: number | null;
  facilityLongitude: number | null;
  marketLatitude: number | null;
  marketLongitude: number | null;
};

const countryBorderLayer: LayerProps = {
  id: "angel-country-risk-line",
  type: "line",
  source: "country-boundaries",
  "source-layer": "country_boundaries",
  paint: {
    "line-color": "rgba(200, 210, 230, 0.28)",
    "line-width": 0.6
  }
};

const LABEL_OFFSET_LNG = 8;
const LABEL_OFFSET_LAT = 5;

type AngelGlobeProps = {
  mode: GlobeMode;
  highlights?: GlobeHighlight[];
  sudanLayers: SudanMapLayers;
};

type HoverInfo = {
  x: number;
  y: number;
  iso3: string;
};

export default function AngelGlobe({ mode, highlights = [], sudanLayers }: AngelGlobeProps) {
  const [mapError, setMapError] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<CountryRisk[]>([]);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [forecastData, setForecastData] = useState<CountryForecast[]>([]);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [ssdSummary, setSsdSummary] = useState<SsdHungerSummary | null>(null);
  const [ssdCountyRows, setSsdCountyRows] = useState<SsdCountyHungerRow[]>([]);
  const [ssdError, setSsdError] = useState<string | null>(null);
  const [selectedIso3, setSelectedIso3] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [pixelPositions, setPixelPositions] = useState<{
    dot: { x: number; y: number };
    box: { x: number; y: number };
  } | null>(null);
  const [hoverCounty, setHoverCounty] = useState<SsdCountyHungerRow | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const activeRef = useRef<GlobeHighlight | null>(null);
  const animFrameRef = useRef<number>(0);

  const riskByIso = useMemo(() => {
    const out = new Map<string, CountryRisk>();
    riskData.forEach((item) => out.set(item.iso3, item));
    return out;
  }, [riskData]);

  const forecastByIso = useMemo(() => {
    const out = new Map<string, CountryForecast>();
    forecastData.forEach((item) => out.set(item.iso3, item));
    return out;
  }, [forecastData]);

  const conflictByIso = useMemo(() => {
    const out = new Map<string, ConflictEntry>();
    for (const [iso3, entry] of Object.entries(conflictData)) {
      out.set(iso3, entry);
    }
    return out;
  }, []);

  const active = !dismissed && highlights.length > 0 ? highlights[activeIndex] : null;
  activeRef.current = active;

  const dismiss = useCallback(() => {
    setDismissed(true);
    setPixelPositions(null);
    const map = mapRef.current?.getMap();
    if (map) {
      map.flyTo({ center: [0, 20], zoom: 1.5, duration: 1500 });
    }
  }, []);

  function updatePixels() {
    const map = mapRef.current;
    const hl = activeRef.current;
    if (!map || !hl) {
      setPixelPositions(null);
      return;
    }
    const dotPx = map.project(hl.center);
    const boxPx = map.project([
      hl.center[0] + LABEL_OFFSET_LNG,
      hl.center[1] + LABEL_OFFSET_LAT,
    ]);
    const container = map.getContainer();
    const maxX = container.clientWidth - 440;
    const maxY = container.clientHeight - 160;
    setPixelPositions({
      dot: { x: dotPx.x, y: dotPx.y },
      box: { x: Math.min(boxPx.x, maxX), y: Math.max(60, Math.min(boxPx.y, maxY)) },
    });
  }

  // Reset index + dismissed when highlights change
  useEffect(() => {
    setActiveIndex(0);
    setDismissed(false);
  }, [highlights]);

  // Escape key dismisses annotations
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && highlights.length > 0 && !dismissed) {
        dismiss();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [highlights, dismissed, dismiss]);

  // Fetch risk data
  useEffect(() => {
    async function fetchRiskData() {
      try {
        const response = await fetch("/api/countries/risk");
        if (!response.ok) {
          throw new Error(`Risk API request failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: Array<{
            iso3?: string;
            country?: string | null;
            status?: string;
            riskScore?: number;
            floodPopExposed?: number | null;
          }>;
        };
        const rows = (payload.data ?? [])
          .filter(
            (row) =>
              typeof row.iso3 === "string" &&
              (row.status === "green" || row.status === "yellow" || row.status === "red") &&
              typeof row.riskScore === "number"
          )
          .map((row) => ({
            iso3: row.iso3 as string,
            country: typeof row.country === "string" ? row.country : null,
            status: row.status as "green" | "yellow" | "red",
            riskScore: row.riskScore as number,
            floodPopExposed: typeof row.floodPopExposed === "number" ? row.floodPopExposed : null
          }));
        setRiskData(rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load risk data";
        setRiskError(message);
      }
    }

    void fetchRiskData();
  }, []);

  useEffect(() => {
    async function fetchForecastData() {
      try {
        const response = await fetch("/api/countries/forecast");
        if (!response.ok) {
          throw new Error(`Forecast API request failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: Array<{
            iso3?: string;
            country?: string | null;
            asOfDate?: string | null;
            currentRiskScore?: number;
            forecastRiskScore?: number;
            forecastStatus?: "green" | "yellow" | "red";
          }>;
        };
        const rows = (payload.data ?? [])
          .filter(
            (row) =>
              typeof row.iso3 === "string" &&
              (row.forecastStatus === "green" ||
                row.forecastStatus === "yellow" ||
                row.forecastStatus === "red") &&
              typeof row.currentRiskScore === "number" &&
              typeof row.forecastRiskScore === "number"
          )
          .map((row) => ({
            iso3: row.iso3 as string,
            country: typeof row.country === "string" ? row.country : null,
            asOfDate: typeof row.asOfDate === "string" ? row.asOfDate : null,
            currentRiskScore: row.currentRiskScore as number,
            forecastRiskScore: row.forecastRiskScore as number,
            forecastStatus: row.forecastStatus as "green" | "yellow" | "red"
          }));
        setForecastData(rows);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load forecast data";
        setForecastError(message);
      }
    }

    void fetchForecastData();
  }, []);

  useEffect(() => {
    async function fetchSsdHungerSummary() {
      try {
        const response = await fetch("/api/south-sudan/hunger");
        if (!response.ok) {
          throw new Error(`South Sudan hunger API request failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          avgPriority?: number | null;
          statusCounts?: { red?: number; yellow?: number; green?: number };
          data?: Array<{
            adm1State?: string;
            adm2County?: string;
            hungerGamPct?: number | null;
            priorityScore?: number | null;
            priorityBand?: "green" | "yellow" | "red";
            healthFacilityCount?: number | null;
            idpIndividuals?: number | null;
            latitude?: number | null;
            longitude?: number | null;
            facilityLatitude?: number | null;
            facilityLongitude?: number | null;
            marketLatitude?: number | null;
            marketLongitude?: number | null;
          }>;
        };
        const countyRows = (payload.data ?? [])
          .filter(
            (row) =>
              typeof row.adm1State === "string" &&
              typeof row.adm2County === "string" &&
              (row.priorityBand === "green" || row.priorityBand === "yellow" || row.priorityBand === "red")
          )
          .map((row) => ({
            adm1State: row.adm1State as string,
            adm2County: row.adm2County as string,
            hungerGamPct: typeof row.hungerGamPct === "number" ? row.hungerGamPct : null,
            priorityScore: typeof row.priorityScore === "number" ? row.priorityScore : null,
            priorityBand: row.priorityBand as "green" | "yellow" | "red",
            healthFacilityCount: typeof row.healthFacilityCount === "number" ? row.healthFacilityCount : null,
            idpIndividuals: typeof row.idpIndividuals === "number" ? row.idpIndividuals : null,
            latitude: typeof row.latitude === "number" ? row.latitude : null,
            longitude: typeof row.longitude === "number" ? row.longitude : null,
            facilityLatitude: typeof row.facilityLatitude === "number" ? row.facilityLatitude : null,
            facilityLongitude: typeof row.facilityLongitude === "number" ? row.facilityLongitude : null,
            marketLatitude: typeof row.marketLatitude === "number" ? row.marketLatitude : null,
            marketLongitude: typeof row.marketLongitude === "number" ? row.marketLongitude : null
          }));
        setSsdCountyRows(countyRows);
        const top = payload.data?.[0];
        setSsdSummary({
          avgPriority: typeof payload.avgPriority === "number" ? payload.avgPriority : null,
          redCount: Number(payload.statusCounts?.red ?? 0),
          yellowCount: Number(payload.statusCounts?.yellow ?? 0),
          greenCount: Number(payload.statusCounts?.green ?? 0),
          topCounty: typeof top?.adm2County === "string" ? top.adm2County : null,
          topState: typeof top?.adm1State === "string" ? top.adm1State : null,
          topScore: typeof top?.priorityScore === "number" ? top.priorityScore : null
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load South Sudan hunger data";
        setSsdError(message);
      }
    }
    void fetchSsdHungerSummary();
  }, []);

  useEffect(() => {
    if (mode === "sudan_map") {
      mapRef.current?.flyTo({ center: [31.5, 7.5], zoom: 4.6, duration: 900 });
    }
  }, [mode]);

  const floodBandByIso = useMemo(() => {
    const floodValues = [...riskByIso.values()]
      .map((row) => row.floodPopExposed)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    const q1 = floodValues.length ? floodValues[Math.floor(floodValues.length * 0.2)] : 0;
    const q2 = floodValues.length ? floodValues[Math.floor(floodValues.length * 0.4)] : 0;
    const q3 = floodValues.length ? floodValues[Math.floor(floodValues.length * 0.6)] : 0;
    const q4 = floodValues.length ? floodValues[Math.floor(floodValues.length * 0.8)] : 0;
    const out = new Map<string, number>();
    riskByIso.forEach((row, iso3) => {
      let floodBand = 0;
      const floodValue = row.floodPopExposed ?? 0;
      if (floodValue > 0) {
        if (floodValue >= q4) {
          floodBand = 5;
        } else if (floodValue >= q3) {
          floodBand = 4;
        } else if (floodValue >= q2) {
          floodBand = 3;
        } else if (floodValue >= q1) {
          floodBand = 2;
        } else {
          floodBand = 1;
        }
      }
      out.set(iso3, floodBand);
    });
    return out;
  }, [riskByIso]);

  const riskFillExpression = useMemo(() => {
    const expression: unknown[] = ["match", ["get", "iso_3166_1_alpha_3"]];
    riskByIso.forEach((row, iso3) => {
      const color = row.status === "red" ? "#ef4444" : row.status === "yellow" ? "#f59e0b" : "#22c55e";
      expression.push(iso3, color);
    });
    expression.push("rgba(120,130,150,0.15)");
    return expression as LayerProps["paint"];
  }, [riskByIso]);

  const floodFillExpression = useMemo(() => {
    const expression: unknown[] = ["match", ["get", "iso_3166_1_alpha_3"]];
    floodBandByIso.forEach((band, iso3) => {
      const color =
        band >= 5
          ? "#1e3a8a"
          : band === 4
            ? "#1d4ed8"
            : band === 3
              ? "#3b82f6"
              : band === 2
                ? "#60a5fa"
                : band === 1
                  ? "#bfdbfe"
                  : "rgba(120,130,150,0.15)";
      expression.push(iso3, color);
    });
    expression.push("rgba(120,130,150,0.15)");
    return expression as LayerProps["paint"];
  }, [floodBandByIso]);

  const forecastFillExpression = useMemo(() => {
    const expression: unknown[] = ["match", ["get", "iso_3166_1_alpha_3"]];
    forecastByIso.forEach((row, iso3) => {
      const color =
        row.forecastStatus === "red"
          ? "#dc2626"
          : row.forecastStatus === "yellow"
          ? "#f59e0b"
          : "#22c55e";
      expression.push(iso3, color);
    });
    expression.push("rgba(120,130,150,0.15)");
    return expression as LayerProps["paint"];
  }, [forecastByIso]);

  const ssdCountryFillExpression = useMemo(() => {
    const expression: unknown[] = ["match", ["get", "iso_3166_1_alpha_3"]];
    const score = ssdSummary?.avgPriority ?? null;
    const ssdColor =
      score == null ? "rgba(120,130,150,0.15)" : score >= 0.66 ? "#ef4444" : score >= 0.4 ? "#f59e0b" : "#22c55e";
    expression.push("SSD", ssdColor);
    expression.push("rgba(120,130,150,0.08)");
    return expression as LayerProps["paint"];
  }, [ssdSummary]);

  const riskLayer: LayerProps = {
    id: "angel-country-risk-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": riskFillExpression as unknown as string,
      "fill-opacity": 0.45
    }
  };

  const floodLayer: LayerProps = {
    id: "angel-country-flood-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": floodFillExpression as unknown as string,
      "fill-opacity": 0.55
    }
  };

  const forecastLayer: LayerProps = {
    id: "angel-country-forecast-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": forecastFillExpression as unknown as string,
      "fill-opacity": 0.5
    }
  };

  const ssdHungerLayer: LayerProps = {
    id: "angel-country-ssd-hunger-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": ssdCountryFillExpression as unknown as string,
      "fill-opacity": 0.35
    }
  };

  const ssdHungerBorderLayer: LayerProps = {
    id: "angel-country-ssd-hunger-line",
    type: "line",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "line-color": "rgba(220, 233, 255, 0.45)",
      "line-width": 0.8
    }
  };

  const ssdCountyGeojson = useMemo(() => {
    const features = ssdCountyRows
      .filter((row) => row.latitude != null && row.longitude != null)
      .map((row) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [row.longitude as number, row.latitude as number]
        },
        properties: {
          adm1State: row.adm1State,
          adm2County: row.adm2County,
          priorityBand: row.priorityBand,
          priorityScore: row.priorityScore,
          hungerGamPct: row.hungerGamPct,
          healthFacilityCount: row.healthFacilityCount,
          idpIndividuals: row.idpIndividuals
        }
      }));
    return {
      type: "FeatureCollection" as const,
      features
    };
  }, [ssdCountyRows]);

  const ssdCountyCircleLayer: LayerProps = {
    id: "angel-ssd-county-circles",
    type: "circle",
    source: "ssd-county-points",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "priorityScore"], 0],
        0,
        4,
        1,
        12
      ],
      "circle-color": [
        "match",
        ["get", "priorityBand"],
        "red",
        "#ef4444",
        "yellow",
        "#f59e0b",
        "#22c55e"
      ],
      "circle-opacity": 0.9,
      "circle-stroke-color": "#dbeafe",
      "circle-stroke-width": 1
    }
  };

  const ssdDisplacementCircleLayer: LayerProps = {
    id: "angel-ssd-county-displacement-circles",
    type: "circle",
    source: "ssd-county-points",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["coalesce", ["get", "idpIndividuals"], 0],
        0,
        2,
        50000,
        10,
        150000,
        16
      ],
      "circle-color": "#60a5fa",
      "circle-opacity": 0.45
    }
  };

  const ssdFacilityGeojson = useMemo(() => {
    const features = ssdCountyRows
      .filter((row) => row.facilityLatitude != null && row.facilityLongitude != null)
      .map((row) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [row.facilityLongitude as number, row.facilityLatitude as number]
        },
        properties: {
          adm1State: row.adm1State,
          adm2County: row.adm2County,
          kind: "facility",
          count: row.healthFacilityCount
        }
      }));
    return { type: "FeatureCollection" as const, features };
  }, [ssdCountyRows]);

  const ssdFacilityLayer: LayerProps = {
    id: "angel-ssd-facility-circles",
    type: "circle",
    source: "ssd-facility-points",
    paint: {
      "circle-radius": 4,
      "circle-color": "#22d3ee",
      "circle-opacity": 0.85,
      "circle-stroke-color": "#0e7490",
      "circle-stroke-width": 1
    }
  };

  const ssdMarketGeojson = useMemo(() => {
    const features = ssdCountyRows
      .filter((row) => row.marketLatitude != null && row.marketLongitude != null)
      .map((row) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [row.marketLongitude as number, row.marketLatitude as number]
        },
        properties: {
          adm1State: row.adm1State,
          adm2County: row.adm2County,
          kind: "market"
        }
      }));
    return { type: "FeatureCollection" as const, features };
  }, [ssdCountyRows]);

  const ssdMarketLayer: LayerProps = {
    id: "angel-ssd-market-circles",
    type: "circle",
    source: "ssd-market-points",
    paint: {
      "circle-radius": 3,
      "circle-color": "#a78bfa",
      "circle-opacity": 0.9
    }
  };

  function onMapClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (
      mode === "sudan_map" &&
      (feature?.layer?.id === "angel-ssd-county-circles" ||
        feature?.layer?.id === "angel-ssd-county-displacement-circles")
    ) {
      const props = feature.properties ?? {};
      const row: SsdCountyHungerRow = {
        adm1State: typeof props.adm1State === "string" ? props.adm1State : "Unknown state",
        adm2County: typeof props.adm2County === "string" ? props.adm2County : "Unknown county",
        priorityBand:
          props.priorityBand === "red" || props.priorityBand === "yellow" ? props.priorityBand : "green",
        priorityScore: toNumber(props.priorityScore),
        hungerGamPct: toNumber(props.hungerGamPct),
        healthFacilityCount: toNumber(props.healthFacilityCount),
        idpIndividuals: toNumber(props.idpIndividuals),
        latitude: null,
        longitude: null,
        facilityLatitude: null,
        facilityLongitude: null,
        marketLatitude: null,
        marketLongitude: null
      };
      setHoverCounty(row);
      return;
    }
    setHoverCounty(null);
    const iso3Candidate =
      (feature?.properties?.iso_3166_1_alpha_3 as string | undefined) ?? feature?.id;
    const iso3 =
      typeof iso3Candidate === "string"
        ? iso3Candidate
        : typeof iso3Candidate === "number"
          ? String(iso3Candidate)
          : null;
    setSelectedIso3(iso3);
  }

  function onMapHover(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (
      mode === "sudan_map" &&
      (feature?.layer?.id === "angel-ssd-county-circles" ||
        feature?.layer?.id === "angel-ssd-county-displacement-circles")
    ) {
      setHoverInfo(null);
      return;
    }
    const iso3Candidate =
      (feature?.properties?.iso_3166_1_alpha_3 as string | undefined) ?? feature?.id;
    const iso3 =
      typeof iso3Candidate === "string"
        ? iso3Candidate
        : typeof iso3Candidate === "number"
          ? String(iso3Candidate)
          : null;
    const hasCountryData =
      mode === "forecast_30d"
        ? forecastByIso.has(iso3 ?? "") || conflictByIso.has(iso3 ?? "")
        : riskByIso.has(iso3 ?? "") || conflictByIso.has(iso3 ?? "");
    if (!iso3 || !hasCountryData) {
      setHoverInfo(null);
      return;
    }
    setHoverInfo({
      x: event.point.x,
      y: event.point.y,
      iso3
    });
  }

  const selectedCountry = selectedIso3 ? riskByIso.get(selectedIso3) ?? null : null;
  const hoveredCountry = hoverInfo ? riskByIso.get(hoverInfo.iso3) ?? null : null;
  const selectedForecast = selectedIso3 ? forecastByIso.get(selectedIso3) ?? null : null;
  const hoveredForecast = hoverInfo ? forecastByIso.get(hoverInfo.iso3) ?? null : null;
  const selectedConflict = selectedIso3 ? conflictByIso.get(selectedIso3) ?? null : null;
  const hoveredConflict = hoverInfo ? conflictByIso.get(hoverInfo.iso3) ?? null : null;
  function toNumber(value: unknown): number | null {
    if (value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // Fly to highlight
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || highlights.length === 0) return;
    const hl = highlights[activeIndex];
    if (!hl) return;

    map.flyTo({
      center: hl.center,
      zoom: 4,
      duration: 2000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights, activeIndex]);

  // Continuously track pixel positions via rAF while a highlight is active
  useEffect(() => {
    if (!active) {
      setPixelPositions(null);
      return;
    }

    let running = true;
    function tick() {
      if (!running) return;
      updatePixels();
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!mapboxToken) {
    return (
      <div className="map-fallback">
        Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to run the globe view.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <MapGL
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: 0,
          latitude: 20,
          zoom: 1.5
        }}
        projection={{ name: "globe" }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        onError={(event) => setMapError(event.error?.message ?? "Map render error")}
        interactiveLayerIds={[
          "angel-country-risk-fill",
          "angel-country-flood-fill",
          "angel-country-forecast-fill",
          "angel-country-ssd-hunger-fill",
          "angel-ssd-county-circles",
          "angel-ssd-county-displacement-circles",
          "angel-ssd-facility-circles",
          "angel-ssd-market-circles"
        ]}
        onClick={onMapClick}
        onMouseMove={onMapHover}
        onMouseLeave={() => {
          setHoverInfo(null);
          setHoverCounty(null);
        }}
      >
        <Source
          id="country-boundaries"
          type="vector"
          url="mapbox://mapbox.country-boundaries-v1"
          promoteId={{ country_boundaries: "iso_3166_1_alpha_3" }}
        >
          {mode === "risk" ? <Layer {...riskLayer} /> : null}
          {mode === "flood" ? <Layer {...floodLayer} /> : null}
          {mode === "forecast_30d" ? <Layer {...forecastLayer} /> : null}
          {mode === "sudan_map" ? null : <Layer {...countryBorderLayer} />}
        </Source>
        {/* Annotation dot */}
        {active && (
          <Marker longitude={active.center[0]} latitude={active.center[1]} anchor="center">
            <div className="annotation-dot annotation-dot-active" />
          </Marker>
        )}
        {mode === "sudan_map" ? (
          <>
            <Layer {...ssdHungerLayer} />
            <Layer {...ssdHungerBorderLayer} />
            <Source id="ssd-county-points" type="geojson" data={ssdCountyGeojson}>
              {sudanLayers.displacement ? <Layer {...ssdDisplacementCircleLayer} /> : null}
              {sudanLayers.hunger ? <Layer {...ssdCountyCircleLayer} /> : null}
            </Source>
            {sudanLayers.facilities ? (
              <Source id="ssd-facility-points" type="geojson" data={ssdFacilityGeojson}>
                <Layer {...ssdFacilityLayer} />
              </Source>
            ) : null}
            {sudanLayers.markets ? (
              <Source id="ssd-market-points" type="geojson" data={ssdMarketGeojson}>
                <Layer {...ssdMarketLayer} />
              </Source>
            ) : null}
          </>
        ) : null}
      </MapGL>

      {/* SVG overlay — line + box track in real time */}
      {active && pixelPositions && (
        <div className="annotation-overlay">
          <svg className="annotation-svg" width="100%" height="100%">
            <defs>
              <filter id="line-glow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <line
              className="annotation-line"
              x1={pixelPositions.dot.x}
              y1={pixelPositions.dot.y}
              x2={pixelPositions.box.x}
              y2={pixelPositions.box.y}
              filter="url(#line-glow)"
            />
          </svg>
          <div
            className="annotation-box annotation-active"
            style={{
              left: pixelPositions.box.x,
              top: pixelPositions.box.y,
              transform: "translateY(-50%)",
            }}
          >
            <span className="annotation-iso">{active.iso3}</span>
            <p style={{ margin: "4px 0 0" }}>{active.summary}</p>
          </div>
        </div>
      )}

      {mode === "risk" ? (
        <div className="map-legend">
          <span className="dot green" /> Safe
          <span className="dot yellow" /> Worrisome
          <span className="dot red" /> Crisis
        </div>
      ) : mode === "flood" ? (
        <div className="map-legend">
          <span className="dot flood-q1" /> Q1
          <span className="dot flood-q2" /> Q2
          <span className="dot flood-q3" /> Q3
          <span className="dot flood-q4" /> Q4
          <span className="dot flood-q5" /> Q5
        </div>
      ) : mode === "forecast_30d" ? (
        <div className="map-legend">
          <span className="dot green" /> Forecast 30d safe
          <span className="dot yellow" /> Forecast 30d worrisome
          <span className="dot red" /> Forecast 30d crisis
        </div>
      ) : (
        <div className="map-legend">
          {sudanLayers.hunger ? (
            <>
              <span className="dot green" /> Hunger low
              <span className="dot yellow" /> Hunger elevated
              <span className="dot red" /> Hunger critical
            </>
          ) : null}
          {sudanLayers.displacement ? (
            <>
              <span className="dot flood-q3" /> Displacement
            </>
          ) : null}
          {sudanLayers.facilities ? (
            <>
              <span className="dot green" /> Facilities
            </>
          ) : null}
          {sudanLayers.markets ? (
            <>
              <span className="dot yellow" /> Markets
            </>
          ) : null}
        </div>
      )}
      <div className="map-debug-badge">
        Mode: {mode} | Rows: {mode === "forecast_30d" ? forecastData.length : riskData.length}
      </div>
      {mode !== "sudan_map" && hoverInfo && (hoveredCountry ?? hoveredForecast ?? hoveredConflict) ? (
        <div
          className="hover-tooltip"
          style={{ left: hoverInfo.x + 14, top: hoverInfo.y + 14 }}
        >
          <div className="hover-title">
            {(hoveredCountry?.country ?? hoveredForecast?.country ?? hoveredConflict?.country ?? hoverInfo.iso3)}{" "}
            <span style={{ opacity: 0.55, fontWeight: 400 }}>({hoverInfo.iso3})</span>
          </div>

          {/* Conflict level badge */}
          {hoveredConflict?.conflictLevel ? (
            <div className="hover-row hover-conflict-row">
              <span
                className="hover-conflict-badge"
                style={{
                  background:
                    hoveredConflict.conflictLevel === "Extreme" ? "rgba(239,68,68,0.2)" :
                    hoveredConflict.conflictLevel === "High" ? "rgba(249,115,22,0.2)" :
                    hoveredConflict.conflictLevel === "Turbulent" ? "rgba(234,179,8,0.2)" :
                    "rgba(34,197,94,0.15)",
                  color:
                    hoveredConflict.conflictLevel === "Extreme" ? "#ef4444" :
                    hoveredConflict.conflictLevel === "High" ? "#f97316" :
                    hoveredConflict.conflictLevel === "Turbulent" ? "#eab308" :
                    "#22c55e",
                }}
              >
                {hoveredConflict.conflictLevel}
              </span>
              <span style={{ color: "#7a9cd4", marginLeft: 6 }}>
                ACLED rank #{hoveredConflict.conflictRank}
              </span>
            </div>
          ) : null}

          {/* Political violence events */}
          {hoveredConflict?.events2025 != null ? (
            <div className="hover-row">
              Violence events 2025:{" "}
              <strong>{hoveredConflict.events2025.toLocaleString()}</strong>
              {hoveredConflict.eventsYoY != null ? (
                <span
                  style={{
                    marginLeft: 6,
                    color: hoveredConflict.eventsYoY > 0 ? "#ef4444" : "#22c55e",
                    fontSize: 10
                  }}
                >
                  {hoveredConflict.eventsYoY > 0 ? "▲" : "▼"}{Math.abs(hoveredConflict.eventsYoY)}% YoY
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Risk/forecast rows */}
          {mode === "forecast_30d" && hoveredForecast ? (
            <>
              <div className="hover-row">Forecast status: {hoveredForecast.forecastStatus}</div>
              <div className="hover-row">Current risk: {hoveredForecast.currentRiskScore.toFixed(3)}</div>
              <div className="hover-row">30d forecast: {hoveredForecast.forecastRiskScore.toFixed(3)}</div>
            </>
          ) : hoveredCountry ? (
            <>
              <div className="hover-row">Risk: {hoveredCountry.riskScore.toFixed(3)} · {hoveredCountry.status}</div>
              <div className="hover-row">
                Flood exposed: {hoveredCountry.floodPopExposed?.toLocaleString() ?? "N/A"}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {mode === "sudan_map" && hoverCounty ? (() => {
        const resources =
          countyResourcesByName.get(hoverCounty.adm2County.toLowerCase()) ??
          countyResourcesByName.get(hoverCounty.adm2County.toLowerCase().replace(/-/g, " ")) ??
          null;
        const bandColor =
          hoverCounty.priorityBand === "red" ? "#ef4444" :
          hoverCounty.priorityBand === "yellow" ? "#f59e0b" : "#22c55e";
        return (
          <div className="county-action-card">
            {/* Header */}
            <div className="county-action-header">
              <div>
                <span className="county-action-name">{hoverCounty.adm2County}</span>
                <span className="county-action-state">{hoverCounty.adm1State}</span>
              </div>
              <button
                type="button"
                className="county-action-close"
                onClick={() => setHoverCounty(null)}
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </div>

            {/* Priority strip */}
            <div className="county-action-strip" style={{ borderColor: bandColor }}>
              <span className="county-action-band" style={{ color: bandColor, borderColor: bandColor }}>
                {hoverCounty.priorityBand.toUpperCase()}
              </span>
              <span className="county-action-stat">
                Score <strong>{hoverCounty.priorityScore?.toFixed(3) ?? "—"}</strong>
              </span>
              <span className="county-action-stat">
                Hunger GAM <strong>{hoverCounty.hungerGamPct != null ? `${hoverCounty.hungerGamPct.toFixed(1)}%` : "—"}</strong>
              </span>
              <span className="county-action-stat">
                IDPs <strong>{hoverCounty.idpIndividuals != null ? hoverCounty.idpIndividuals.toLocaleString() : "—"}</strong>
              </span>
            </div>

            {/* Health facilities */}
            <div className="county-action-section">
              <div className="county-action-section-title" style={{ color: "#ef4444" }}>
                + Top Hospitals &amp; Health Facilities
              </div>
              {resources?.topFacilities.length ? (
                <div className="county-action-list">
                  {resources.topFacilities.map((f, i) => (
                    <div key={i} className="county-action-item">
                      <span className="county-action-rank">{i + 1}</span>
                      <div className="county-action-item-body">
                        <span className="county-action-item-name">{f.name}</span>
                        <span className="county-action-item-meta">
                          {f.type} · {f.distKm} km away
                          {f.county !== hoverCounty.adm2County ? ` · ${f.county}` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="county-action-empty">
                  No facility data · {hoverCounty.healthFacilityCount ?? 0} facilities in county
                </div>
              )}
            </div>

            {/* Food markets */}
            <div className="county-action-section">
              <div className="county-action-section-title" style={{ color: "#f97316" }}>
                Food &amp; Shelter Distribution Points
              </div>
              {resources?.topMarkets.length ? (
                <div className="county-action-list">
                  {resources.topMarkets.map((m, i) => (
                    <div key={i} className="county-action-item">
                      <span className="county-action-rank">{i + 1}</span>
                      <div className="county-action-item-body">
                        <span className="county-action-item-name">{m.name} Market</span>
                        <span className="county-action-item-meta">
                          WFP food point · {m.distKm} km away
                          {m.county !== hoverCounty.adm2County ? ` · ${m.county}` : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="county-action-empty">No WFP market data for this county</div>
              )}
            </div>

            <div className="county-action-footer">
              WHO MFL Apr 2025 · WFP Markets · DTM R16
            </div>
          </div>
        );
      })() : null}
      {mode === "sudan_map" && ssdSummary ? (
        <div className="country-card">
          <div className="country-card-title">South Sudan county hunger priority</div>
          <div className="country-card-row">
            Avg county priority score: {ssdSummary.avgPriority?.toFixed(3) ?? "N/A"}
          </div>
          <div className="country-card-row">
            County bands: red {ssdSummary.redCount} | yellow {ssdSummary.yellowCount} | green{" "}
            {ssdSummary.greenCount}
          </div>
          <div className="country-card-row">
            Top county:{" "}
            {ssdSummary.topCounty && ssdSummary.topState
              ? `${ssdSummary.topCounty}, ${ssdSummary.topState} (${ssdSummary.topScore?.toFixed(3) ?? "N/A"})`
              : "N/A"}
          </div>
        </div>
      ) : null}
      {mode !== "sudan_map" && (selectedCountry ?? selectedForecast ?? selectedConflict) ? (
        <div className="country-card">
          <div className="country-card-title">
            {selectedCountry?.country ?? selectedForecast?.country ?? selectedConflict?.country ?? selectedIso3}
            {selectedIso3 ? <span style={{ opacity: 0.5, fontWeight: 400 }}> ({selectedIso3})</span> : null}
          </div>

          {/* Conflict section */}
          {selectedConflict?.conflictLevel ? (
            <>
              <div className="country-card-row country-card-conflict-row">
                <span
                  className="hover-conflict-badge"
                  style={{
                    background:
                      selectedConflict.conflictLevel === "Extreme" ? "rgba(239,68,68,0.2)" :
                      selectedConflict.conflictLevel === "High" ? "rgba(249,115,22,0.2)" :
                      selectedConflict.conflictLevel === "Turbulent" ? "rgba(234,179,8,0.2)" :
                      "rgba(34,197,94,0.15)",
                    color:
                      selectedConflict.conflictLevel === "Extreme" ? "#ef4444" :
                      selectedConflict.conflictLevel === "High" ? "#f97316" :
                      selectedConflict.conflictLevel === "Turbulent" ? "#eab308" :
                      "#22c55e",
                  }}
                >
                  {selectedConflict.conflictLevel}
                </span>
                <span style={{ color: "#7a9cd4", marginLeft: 8, fontSize: 11 }}>
                  ACLED Global Rank #{selectedConflict.conflictRank} / 244
                </span>
              </div>
              {selectedConflict.events2025 != null ? (
                <div className="country-card-row">
                  Violence events 2025:{" "}
                  <strong>{selectedConflict.events2025.toLocaleString()}</strong>
                  {selectedConflict.eventsYoY != null ? (
                    <span
                      style={{
                        marginLeft: 8,
                        color: selectedConflict.eventsYoY > 0 ? "#ef4444" : "#22c55e",
                        fontSize: 11,
                      }}
                    >
                      {selectedConflict.eventsYoY > 0 ? "▲" : "▼"}{Math.abs(selectedConflict.eventsYoY)}% vs 2024
                    </span>
                  ) : null}
                </div>
              ) : null}
              {selectedConflict.events2024 != null ? (
                <div className="country-card-row" style={{ color: "#7a9cd4" }}>
                  Violence events 2024: {selectedConflict.events2024.toLocaleString()}
                </div>
              ) : null}
              {selectedConflict.deadlinessValue != null ? (
                <div className="country-card-row" style={{ color: "#7a9cd4" }}>
                  Deadliness: {selectedConflict.deadlinessValue.toLocaleString()} · Danger: {selectedConflict.dangerValue?.toLocaleString() ?? "N/A"}
                </div>
              ) : null}
            </>
          ) : null}

          {/* Forecast rows */}
          {mode === "forecast_30d" && selectedForecast ? (
            <>
              <div className="country-card-row">Current risk: {selectedForecast.currentRiskScore.toFixed(3)}</div>
              <div className="country-card-row">Forecast (30d): {selectedForecast.forecastRiskScore.toFixed(3)}</div>
              <div className="country-card-row">As-of: {selectedForecast.asOfDate ?? "N/A"}</div>
              <div className="case-swatches">
                <span className={`case-chip ${selectedForecast.forecastStatus === "green" ? "case-active" : ""}`}>
                  <span className="dot green" /> green
                </span>
                <span className={`case-chip ${selectedForecast.forecastStatus === "yellow" ? "case-active" : ""}`}>
                  <span className="dot yellow" /> yellow
                </span>
                <span className={`case-chip ${selectedForecast.forecastStatus === "red" ? "case-active" : ""}`}>
                  <span className="dot red" /> red
                </span>
              </div>
            </>
          ) : selectedCountry ? (
            <>
              <div className="country-card-row">Risk score: {selectedCountry.riskScore.toFixed(3)}</div>
              <div className="country-card-row">
                Flood exposed: {selectedCountry.floodPopExposed?.toLocaleString() ?? "N/A"}
              </div>
              <div className="case-swatches">
                <span className={`case-chip ${selectedCountry.status === "green" ? "case-active" : ""}`}>
                  <span className="dot green" /> green
                </span>
                <span className={`case-chip ${selectedCountry.status === "yellow" ? "case-active" : ""}`}>
                  <span className="dot yellow" /> yellow
                </span>
                <span className={`case-chip ${selectedCountry.status === "red" ? "case-active" : ""}`}>
                  <span className="dot red" /> red
                </span>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {highlights.length > 0 && !dismissed && (
        <div className="annotation-nav">
          {highlights.length > 1 && (
            <>
              <button
                type="button"
                className="icon-btn"
                disabled={activeIndex === 0}
                onClick={() => setActiveIndex((i) => i - 1)}
                aria-label="Previous country"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="annotation-nav-counter">
                {activeIndex + 1} / {highlights.length}
              </span>
              <button
                type="button"
                className="icon-btn"
                disabled={activeIndex === highlights.length - 1}
                onClick={() => setActiveIndex((i) => i + 1)}
                aria-label="Next country"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn annotation-close-btn"
            onClick={dismiss}
            aria-label="Close annotations"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {mapError ? <div className="map-fallback">{mapError}</div> : null}
      {riskError ? <div className="map-fallback">{riskError}</div> : null}
      {forecastError ? <div className="map-fallback">{forecastError}</div> : null}
      {ssdError ? <div className="map-fallback">{ssdError}</div> : null}
    </div>
  );
}
