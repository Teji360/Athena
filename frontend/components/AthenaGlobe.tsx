"use client";

import Map from "react-map-gl";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export default function AthenaGlobe() {
  if (!mapboxToken) {
    return (
      <div className="map-fallback">
        Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to run the globe view.
      </div>
    );
  }

  return (
    <Map
      mapboxAccessToken={mapboxToken}
      initialViewState={{
        longitude: 0,
        latitude: 20,
        zoom: 1.5
      }}
      projection={{ name: "globe" }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
    />
  );
}
