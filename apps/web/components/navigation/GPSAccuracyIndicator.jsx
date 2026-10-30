export default function GPSAccuracyIndicator({ accuracy, permission }) {
  if (permission !== "granted" || !Number.isFinite(accuracy)) return <span className="gps-accuracy gps-accuracy-muted">Akurasi GPS belum tersedia</span>;
  const quality = accuracy <= 20 ? "baik" : accuracy <= 60 ? "sedang" : "rendah";
  return <span className={`gps-accuracy gps-accuracy-${quality}`}>Akurasi ±{Math.round(accuracy)} m · {quality}</span>;
}
