export default function CurrentLocationMarker({ location }) {
  return <span className="navigation-current-marker" aria-label={location ? "Posisi GPS pengguna" : "Menunggu posisi GPS"} />;
}
