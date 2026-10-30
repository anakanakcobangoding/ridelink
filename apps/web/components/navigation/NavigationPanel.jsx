"use client";

import { useEffect, useState } from "react";
import { useNavigation } from "../../hooks/useNavigation.js";
import GPSAccuracyIndicator from "./GPSAccuracyIndicator.jsx";
import MapView from "./MapView.jsx";
import NavigationControls from "./NavigationControls.jsx";

export default function NavigationPanel() {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState([]);
  const searchPlaces = navigation.search;

  useEffect(() => {
    const value = query.trim();
    if (value.length < 3) return undefined;
    const timer = setTimeout(async () => setPlaces(await searchPlaces(value)), 450);
    return () => clearTimeout(timer);
  }, [searchPlaces, query]);

  const next = navigation.progress?.nextManeuver;
  const instruction = navigation.progress?.arrived ? "Anda telah tiba di tujuan." : next?.instruction || "Aktifkan GPS lalu pilih tujuan.";

  return (
    <section className="room-panel navigation-panel" aria-labelledby="navigation-title">
      <div className="room-panel-heading navigation-heading">
        <div><p className="room-kicker">NAVIGASI PERANGKAT INI</p><h2 id="navigation-title">Rute & GPS</h2></div>
        <GPSAccuracyIndicator accuracy={navigation.accuracy} permission={navigation.permission} />
      </div>
      <p className="navigation-safety-copy">Siapkan tujuan sebelum berkendara. RideLink tidak membagikan lokasi ke rider lain.</p>
      <div className="navigation-search">
        <label className="room-kicker" htmlFor="navigation-destination">TUJUAN</label>
        <div className="navigation-search-row"><input id="navigation-destination" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari alamat atau tempat" autoComplete="off" /><span aria-live="polite">{navigation.searching ? "…" : "⌕"}</span></div>
        {query.trim().length >= 3 && places.length ? <ul className="navigation-search-results" aria-label="Hasil pencarian">{places.map((place) => <li key={place.id}><button type="button" onClick={() => { navigation.selectDestination(place); setQuery(""); setPlaces([]); }}>{place.label}</button></li>)}</ul> : null}
        <p className="navigation-map-hint">Atau sentuh peta untuk memilih titik tujuan.</p>
      </div>
      <MapView location={navigation.location} destination={navigation.destination} route={navigation.route} accuracy={navigation.accuracy} onDestination={navigation.selectDestination} />
      <div className="navigation-status-row"><span className={`navigation-location-state navigation-state-${navigation.permission}`}>{navigation.permission === "granted" ? "GPS aktif" : navigation.permission === "denied" ? "Izin lokasi ditolak" : navigation.permission === "requesting" ? "Meminta izin GPS…" : "GPS mati"}</span><span>{navigation.location ? `${navigation.location[1].toFixed(5)}, ${navigation.location[0].toFixed(5)}` : "Koordinat tidak tersedia"}</span></div>
      {navigation.destination ? <p className="navigation-selected-destination">Tujuan: <strong>{navigation.destination.label}</strong></p> : null}
      <NavigationControls navigation={navigation} />
      {navigation.route ? <div className="navigation-guidance" aria-live="polite"><p className="room-kicker">{navigation.rerouting ? "MENGHITUNG ULANG" : "MANUVER BERIKUTNYA"}</p><strong>{instruction}</strong><div><span>{next ? navigation.formatDistance(next.distanceToManeuverMeters) : ""}</span><span>{navigation.formatDistance(navigation.route.distanceMeters)} total · {Math.ceil(navigation.route.durationSeconds / 60)} menit</span></div></div> : null}
      {navigation.error ? <p className="navigation-error" role="alert">{navigation.error}</p> : null}
      {navigation.speech === "fallback" ? <p className="navigation-notice">Suara `id-ID` tidak terdeteksi; Safari dapat menggunakan suara sistem lain atau mengabaikan bahasa yang diminta.</p> : null}
      {navigation.speech === "unavailable" ? <p className="navigation-notice">TTS tidak tersedia. Instruksi tetap terlihat di layar.</p> : null}
      {navigation.accuracy > 60 ? <p className="navigation-notice">Akurasi GPS rendah dapat menunda progres atau perhitungan ulang rute.</p> : null}
      <p className="navigation-attribution">Rute © openrouteservice.org by HeiGIT · Data peta © OpenStreetMap contributors</p>
    </section>
  );
}
