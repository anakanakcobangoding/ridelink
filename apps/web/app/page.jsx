import Link from "next/link";
import RoomLobby from "../components/RoomLobby.jsx";

const SignalIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="brand-mark">
    <path d="M4.5 17.5a10.6 10.6 0 0 1 15 0M7.7 14.3a6.1 6.1 0 0 1 8.6 0M10.9 11.1a1.55 1.55 0 0 1 2.2 0" />
    <circle cx="12" cy="20" r="1" />
  </svg>
);

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="RideLink beranda">
          <span className="brand-icon"><SignalIcon /></span>
          <span>ride<span className="brand-light">link</span></span>
        </Link>
        <div className="topbar-note"><span className="status-dot" /> PROTOTIPE WEB</div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> TOURING, TETAP TERHUBUNG</p>
          <h1 id="hero-title">Jalan bareng.<br /><span>Tetap terhubung.</span></h1>
          <p className="hero-description">
            Ruang privat untuk dua rider, intercom suara, musik bersama, dan navigasi GPS per perangkat.
          </p>

          <RoomLobby />
        </div>

        <aside className="ride-visual" aria-label="Ilustrasi perjalanan touring">
          <div className="visual-topline"><span>PERJALANAN BERSAMA</span><span>01 — 02</span></div>
          <div className="route-art" aria-hidden="true">
            <div className="map-grid" />
            <svg className="route-line" viewBox="0 0 500 540" preserveAspectRatio="none">
              <path className="route-shadow" d="M95 480 C115 420 210 445 190 365 C170 285 300 300 278 220 C258 145 345 180 360 105 C368 65 405 72 424 35" />
              <path className="route-dash" d="M95 480 C115 420 210 445 190 365 C170 285 300 300 278 220 C258 145 345 180 360 105 C368 65 405 72 424 35" />
            </svg>
            <div className="map-label label-start"><span className="map-pin" /> KAMU</div>
            <div className="map-label label-end"><span className="map-destination" /> TUJUAN</div>
            <div className="route-coordinates">-6° 12&apos; 14.2&quot; S<br />106° 49&apos; 32.1&quot; E</div>
            <div className="road-label road-one">JALAN RAYA</div>
            <div className="road-label road-two">RUTE BERSAMA</div>
            <div className="compass" aria-label="Arah utara">N <span>↑</span></div>
            <div className="visual-caption"><span className="caption-marker" /> ILUSTRASI RUTE · NAVIGASI MENYUSUL</div>
          </div>
          <div className="visual-footer"><span>SUARA JERNIH, JALUR TERBUKA</span><span>RIDER-TO-RIDER</span></div>
        </aside>
      </section>

      <section className="compatibility" aria-label="Informasi kompatibilitas">
        <div className="compatibility-heading"><span className="compatibility-icon">i</span><span>TENTANG PROTOTIPE</span></div>
        <p>Dirancang untuk Safari iPhone dengan koneksi internet. Kinerja audio dapat berubah saat aplikasi di latar belakang atau layar terkunci.</p>
        <span className="https-badge"><span className="lock-icon" aria-hidden="true">▣</span> HTTPS DIPERLUKAN</span>
      </section>

      <footer className="footer"><span>© 2026 RIDELINK</span><span>PERHATIKAN JALAN. GUNAKAN SAAT BERHENTI.</span></footer>
    </main>
  );
}
