export default function DestinationMarker({ destination }) {
  return destination ? <span className="navigation-destination-marker" aria-label={`Tujuan: ${destination.label}`} /> : null;
}
