"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl";
import MapGL, { Layer, Marker, Source, type LayerProps, type MapRef } from "react-map-gl";
import { ChevronLeft, ChevronRight } from "lucide-react";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type GlobeMode = "risk" | "flood";

type CountryRisk = {
  iso3: string;
  country: string | null;
  status: "green" | "yellow" | "red";
  riskScore: number;
  floodPopExposed: number | null;
};

export type GlobeHighlight = {
  iso3: string;
  summary: string;
  center: [number, number]; // [lng, lat]
};

const countryBorderLayer: LayerProps = {
  id: "athena-country-risk-line",
  type: "line",
  source: "country-boundaries",
  "source-layer": "country_boundaries",
  paint: {
    "line-color": "rgba(200, 210, 230, 0.28)",
    "line-width": 0.6
  }
};

type AthenaGlobeProps = {
  mode: GlobeMode;
  highlights?: GlobeHighlight[];
};

type HoverInfo = {
  x: number;
  y: number;
  iso3: string;
};

export default function AthenaGlobe({ mode, highlights = [] }: AthenaGlobeProps) {
  const [mapError, setMapError] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<CountryRisk[]>([]);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [selectedIso3, setSelectedIso3] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const mapRef = useRef<MapRef | null>(null);

  const riskByIso = useMemo(() => {
    const out = new Map<string, CountryRisk>();
    riskData.forEach((item) => out.set(item.iso3, item));
    return out;
  }, [riskData]);

  // Reset index when highlights change
  useEffect(() => {
    setActiveIndex(0);
  }, [highlights]);

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

  const riskLayer: LayerProps = {
    id: "athena-country-risk-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": riskFillExpression as unknown as string,
      "fill-opacity": 0.45
    }
  };

  const floodLayer: LayerProps = {
    id: "athena-country-flood-fill",
    type: "fill",
    source: "country-boundaries",
    "source-layer": "country_boundaries",
    paint: {
      "fill-color": floodFillExpression as unknown as string,
      "fill-opacity": 0.55
    }
  };

  function onMapClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
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
    const iso3Candidate =
      (feature?.properties?.iso_3166_1_alpha_3 as string | undefined) ?? feature?.id;
    const iso3 =
      typeof iso3Candidate === "string"
        ? iso3Candidate
        : typeof iso3Candidate === "number"
          ? String(iso3Candidate)
          : null;
    if (!iso3 || !riskByIso.has(iso3)) {
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

  // Fly to active highlight
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || highlights.length === 0) {
      return;
    }
    const active = highlights[activeIndex];
    if (!active) return;
    map.flyTo({
      center: active.center,
      zoom: 4,
      duration: 2000,
    });
  }, [highlights, activeIndex]);

  const active = highlights.length > 0 ? highlights[activeIndex] : null;

  // Leader line offset: 8 right, 5 up from centroid
  const labelOffset: [number, number] | null = active
    ? [active.center[0] + 8, active.center[1] + 5]
    : null;

  const leaderLineGeoJSON: GeoJSON.FeatureCollection | null =
    active && labelOffset
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: [active.center, labelOffset],
              },
            },
          ],
        }
      : null;

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
        interactiveLayerIds={["athena-country-risk-fill", "athena-country-flood-fill"]}
        onClick={onMapClick}
        onMouseMove={onMapHover}
        onMouseLeave={() => setHoverInfo(null)}
      >
        <Source
          id="country-boundaries"
          type="vector"
          url="mapbox://mapbox.country-boundaries-v1"
          promoteId={{ country_boundaries: "iso_3166_1_alpha_3" }}
        >
          {mode === "risk" ? <Layer {...riskLayer} /> : null}
          {mode === "flood" ? <Layer {...floodLayer} /> : null}
          <Layer {...countryBorderLayer} />
        </Source>

        {/* Annotation dot at active country */}
        {active && (
          <Marker longitude={active.center[0]} latitude={active.center[1]} anchor="center">
            <div className="annotation-dot" />
          </Marker>
        )}

        {/* Leader line */}
        {leaderLineGeoJSON && (
          <Source id="leader-line" type="geojson" data={leaderLineGeoJSON}>
            <Layer
              id="leader-line-layer"
              type="line"
              paint={{
                "line-color": "#ef4444",
                "line-width": 1.5,
                "line-dasharray": [4, 2],
              }}
            />
          </Source>
        )}

        {/* Summary textbox at offset */}
        {active && labelOffset && (
          <Marker longitude={labelOffset[0]} latitude={labelOffset[1]} anchor="bottom-left">
            <div className="annotation-box">
              <strong>{active.iso3}</strong>
              <p style={{ margin: "4px 0 0" }}>{active.summary}</p>
            </div>
          </Marker>
        )}
      </MapGL>
      {mode === "risk" ? (
        <div className="map-legend">
          <span className="dot green" /> Safe
          <span className="dot yellow" /> Worrisome
          <span className="dot red" /> Crisis
        </div>
      ) : (
        <div className="map-legend">
          <span className="dot flood-q1" /> Q1
          <span className="dot flood-q2" /> Q2
          <span className="dot flood-q3" /> Q3
          <span className="dot flood-q4" /> Q4
          <span className="dot flood-q5" /> Q5
        </div>
      )}
      <div className="map-debug-badge">Mode: {mode} | Rows: {riskData.length}</div>
      {hoverInfo && hoveredCountry ? (
        <div
          className="hover-tooltip"
          style={{
            left: hoverInfo.x + 14,
            top: hoverInfo.y + 14
          }}
        >
          <div className="hover-title">
            {hoveredCountry.country ?? hoveredCountry.iso3} ({hoveredCountry.iso3})
          </div>
          <div className="hover-row">Status: {hoveredCountry.status}</div>
          <div className="hover-row">Risk: {hoveredCountry.riskScore.toFixed(3)}</div>
          <div className="hover-row">
            Flood exposed: {hoveredCountry.floodPopExposed?.toLocaleString() ?? "N/A"}
          </div>
        </div>
      ) : null}
      {selectedCountry ? (
        <div className="country-card">
          <div className="country-card-title">
            {selectedCountry.country ?? selectedCountry.iso3} ({selectedCountry.iso3})
          </div>
          <div className="country-card-row">Risk score: {selectedCountry.riskScore.toFixed(3)}</div>
          <div className="country-card-row">
            Flood exposed population: {selectedCountry.floodPopExposed?.toLocaleString() ?? "N/A"}
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
        </div>
      ) : null}

      {/* Navigation arrows */}
      {highlights.length > 1 && (
        <div className="annotation-nav">
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
        </div>
      )}

      {mapError ? <div className="map-fallback">{mapError}</div> : null}
      {riskError ? <div className="map-fallback">{riskError}</div> : null}
    </div>
  );
}
