"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Layer, Source, type LayerProps, type MapRef } from "react-map-gl";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type CountryRisk = {
  iso3: string;
  status: "green" | "yellow" | "red";
  riskScore: number;
};

const countryFillLayer: LayerProps = {
  id: "athena-country-risk-fill",
  type: "fill",
  source: "country-boundaries",
  "source-layer": "country_boundaries",
  paint: {
    "fill-color": [
      "case",
      ["==", ["feature-state", "status"], "red"],
      "#ef4444",
      ["==", ["feature-state", "status"], "yellow"],
      "#f59e0b",
      ["==", ["feature-state", "status"], "green"],
      "#22c55e",
      "rgba(120,130,150,0.15)"
    ],
    "fill-opacity": 0.45
  }
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

export default function AthenaGlobe() {
  const [mapError, setMapError] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<CountryRisk[]>([]);
  const [riskError, setRiskError] = useState<string | null>(null);
  const mapRef = useRef<MapRef | null>(null);

  const riskByIso = useMemo(() => {
    const out = new Map<string, CountryRisk>();
    riskData.forEach((item) => out.set(item.iso3, item));
    return out;
  }, [riskData]);

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
            status?: string;
            riskScore?: number;
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
            status: row.status as "green" | "yellow" | "red",
            riskScore: row.riskScore as number
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
    const map = mapRef.current?.getMap();
    if (!map) {
      return;
    }
    riskByIso.forEach((row, iso3) => {
      map.setFeatureState(
        {
          source: "country-boundaries",
          sourceLayer: "country_boundaries",
          id: iso3
        },
        { status: row.status, riskScore: row.riskScore }
      );
    });
  }, [riskByIso]);

  if (!mapboxToken) {
    return (
      <div className="map-fallback">
        Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to run the globe view.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
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
      >
        <Source
          id="country-boundaries"
          type="vector"
          url="mapbox://mapbox.country-boundaries-v1"
          promoteId={{ country_boundaries: "iso_3166_1_alpha_3" }}
        >
          <Layer {...countryFillLayer} />
          <Layer {...countryBorderLayer} />
        </Source>
      </MapGL>
      <div className="map-legend">
        <span className="dot green" /> Safe
        <span className="dot yellow" /> Worrisome
        <span className="dot red" /> Crisis
      </div>
      {mapError ? <div className="map-fallback">{mapError}</div> : null}
      {riskError ? <div className="map-fallback">{riskError}</div> : null}
    </div>
  );
}
