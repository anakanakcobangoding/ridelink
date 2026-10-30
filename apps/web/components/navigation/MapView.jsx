"use client";

import { useEffect, useRef, useState } from "react";
import CurrentLocationMarker from "./CurrentLocationMarker.jsx";
import DestinationMarker from "./DestinationMarker.jsx";
import RouteLayer from "./RouteLayer.jsx";

const MAPTILER_ATTRIBUTION = '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>';
const MAPTILER_LOGO = "https://api.maptiler.com/resources/logo.svg";

export default function MapView({ location, destination, route, onDestination, onCenter, accuracy }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ current: null, destination: null });
  const firstLocationRef = useRef(false);
  const lastRouteRef = useRef(null);
  const onDestinationRef = useRef(onDestination);
  const [mapStatus, setMapStatus] = useState("loading");
  const [mapError, setMapError] = useState("");
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => { onDestinationRef.current = onDestination; }, [onDestination]);

  useEffect(() => {
    let disposed = false;
    let map;
    async function createMap() {
      try {
        const maplibreModule = await import("maplibre-gl");
        const maplibre = maplibreModule;
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());
        if (disposed || !containerRef.current) return;
        const key = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
        const configuredStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
        const usesMapTiler = Boolean(key || configuredStyle?.includes("maptiler.com"));
        const style = configuredStyle || (key
          ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`
          : { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#1b2420" } }] });
        map = new maplibre.Map({
          container: containerRef.current,
          style,
          center: [106.8272, -6.1754],
          zoom: 4,
          attributionControl: usesMapTiler ? { compact: true, customAttribution: MAPTILER_ATTRIBUTION } : false,
          cooperativeGestures: true,
        });
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        if (!usesMapTiler) map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
        map.on("load", () => {
          if (disposed) return;
          setMapStatus(key || configuredStyle ? "ready" : "mock");
          setMapReady(true);
          map.addSource("ridelink-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          map.addLayer({ id: "ridelink-route-casing", type: "line", source: "ridelink-route", paint: { "line-color": "#101613", "line-width": 8, "line-opacity": 0.9 } });
          map.addLayer({ id: "ridelink-route-line", type: "line", source: "ridelink-route", paint: { "line-color": "#b9e45b", "line-width": 4 } });
        });
        map.on("error", (event) => {
          if (event?.error) setMapError("Tile peta tidak dapat dimuat. Periksa API key, domain yang diizinkan, dan kuota MapTiler.");
        });
        map.on("click", (event) => onDestinationRef.current({ label: "Titik pada peta", coordinates: [event.lngLat.lng, event.lngLat.lat] }));
        mapRef.current = map;
      } catch {
        if (!disposed) { setMapStatus("error"); setMapError("Komponen peta tidak dapat dimuat."); }
      }
    }
    void createMap();
    return () => { disposed = true; map?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    import("maplibre-gl").then((module) => {
      const maplibre = module;
      const map = mapRef.current;
      if (!map) return;
      for (const type of ["current", "destination"]) {
        const data = type === "current" ? location : destination?.coordinates;
        if (data && !markersRef.current[type]) {
          const element = document.createElement("div");
          if (type === "current") element.className = "navigation-marker-host navigation-marker-current";
          else element.className = "navigation-marker-host navigation-marker-destination";
          markersRef.current[type] = new maplibre.Marker({ element, anchor: "center" }).setLngLat(data).addTo(map);
        } else if (!data && markersRef.current[type]) {
          markersRef.current[type].remove(); markersRef.current[type] = null;
        } else if (data && markersRef.current[type]) markersRef.current[type].setLngLat(data);
      }
      const source = map.getSource("ridelink-route");
      if (source) source.setData({ type: "FeatureCollection", features: route ? [{ type: "Feature", properties: {}, geometry: route.geometry }] : [] });
      if (location && !firstLocationRef.current) {
        map.setCenter(location);
        map.setZoom(13);
        firstLocationRef.current = true;
      }
      if (route && route !== lastRouteRef.current) {
        const bounds = new maplibre.LngLatBounds();
        for (const coordinate of route.geometry.coordinates) bounds.extend(coordinate);
        map.fitBounds(bounds, { padding: 42, maxZoom: 15, duration: 350 });
        lastRouteRef.current = route;
      }
    });
  }, [destination, location, mapReady, route]);

  function centerOnUser() { if (location) mapRef.current?.flyTo({ center: location, zoom: 15, duration: 450 }); onCenter?.(); }

  return (
    <div className="navigation-map-wrap">
      <div className="navigation-map" ref={containerRef} role="application" aria-label="Peta navigasi; sentuh peta untuk memilih tujuan" />
      <div className="navigation-map-overlay"><button type="button" className="navigation-map-center" onClick={centerOnUser} disabled={!location} aria-label="Kembali ke posisi saya">◎</button></div>
      {mapStatus === "mock" ? <p className="map-provider-note">Tampilan peta demo tanpa tiles. Tambahkan MapTiler key untuk memuat peta jalan.</p> : null}
      {process.env.NEXT_PUBLIC_MAPTILER_API_KEY || process.env.NEXT_PUBLIC_MAP_STYLE_URL?.includes("maptiler.com") ? (
        <a className="maptiler-logo" href="https://www.maptiler.com" target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- MapTiler Free requires its logo on the map. */}
          <img src={MAPTILER_LOGO} alt="MapTiler" />
        </a>
      ) : null}
      {mapError ? <p className="map-provider-error" role="status">{mapError}</p> : null}
      <div className="navigation-map-legend"><span><CurrentLocationMarker location={location} /> Posisi Anda</span>{destination ? <span><DestinationMarker destination={destination} /> {destination.label}</span> : null}<RouteLayer route={route} /></div>
      {Number.isFinite(accuracy) ? <span className="sr-only">Akurasi GPS sekitar {Math.round(accuracy)} meter</span> : null}
    </div>
  );
}
