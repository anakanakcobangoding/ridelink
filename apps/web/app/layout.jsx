import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata = {
  title: "RideLink — Tetap terhubung di perjalanan",
  description:
    "Intercom touring berbasis browser untuk perjalanan yang lebih terhubung.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
