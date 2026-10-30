export default function NavigationControls({ navigation }) {
  return (
    <div className="navigation-controls">
      {navigation.tracking ? <button type="button" className="navigation-secondary-button" onClick={navigation.stopTracking}>Stop GPS</button> : <button type="button" className="navigation-primary-button" onClick={navigation.startTracking}>Aktifkan GPS</button>}
      <button type="button" className="navigation-secondary-button" disabled={!navigation.location || !navigation.destination || navigation.calculating} onClick={navigation.confirmDestination}>{navigation.rerouting ? "Mencari rute…" : navigation.calculating ? "Menghitung…" : "Hitung rute"}</button>
      {navigation.route ? <button type="button" className="navigation-secondary-button" onClick={() => navigation.speak(navigation.progress?.arrived ? "Anda telah tiba di tujuan." : navigation.progress?.nextManeuver?.instruction || "Lanjutkan perjalanan.")}>Ucapkan instruksi</button> : null}
    </div>
  );
}
