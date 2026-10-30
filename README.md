# RideLink

Prototipe web intercom touring untuk dua pengendara. Repo ini memakai npm workspaces: aplikasi Next.js berada di `apps/web`, sedangkan layanan signaling Socket.IO terpisah berada di `apps/signaling`.

## Status implementasi

- **Tahap 1:** fondasi Next.js, Tailwind, signaling terpisah, dan landing page.
- **Tahap 2:** room privat dua peserta, sesi bearer sementara, reconnect grace, rate limiting, state participant, dan UI room.
- **Tahap 3:** WebRTC audio-only, signaling terotorisasi, mute, autoplay handling, ICE restart/recovery, dan diagnostik relay.
- **Tahap 4:** shared local music player dengan katalog demo orisinal, playback state ber-revision di signaling server, sinkronisasi waktu/posisi, dan volume lokal.
- **Belum dibuat:** navigasi dan audio ducking.

Protokol lintas platform untuk web dan Flutter ada di [`docs/socket-protocol.md`](docs/socket-protocol.md).
Detail katalog dan batas sinkronisasi ada di [`docs/shared-music.md`](docs/shared-music.md).

## Persyaratan

- Node.js 20.9+ (Next.js 16)
- npm 10+

## Menjalankan lokal

```sh
npm install
cp .env.example apps/web/.env.local
cp .env.example apps/signaling/.env
npm run dev
```

Di terminal lain, jalankan signaling:

```sh
npm run dev:signaling
```

Web tersedia di `http://localhost:3000`; signaling di `http://localhost:4000` dan health check di `/health`. Create/join room dan voice intercom sudah aktif. Untuk mikrofon dan geolocation, browser produksi memerlukan HTTPS/WSS.

## Validasi

```sh
npm run lint
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

Build memakai `next build --webpack`: Turbopack sebelumnya gagal membuka port worker lokal di sandbox, sedangkan build webpack berhasil.

Socket.IO tests menjalankan server/client nyata di loopback. Jika sandbox membatasi binding port lokal, jalankan `npm test` pada lingkungan yang memberi izin localhost.

Playwright membuka dua Chromium context. Tes intercom memakai mikrofon sintetis dan memeriksa peer/ICE connected, remote audio track, byte RTP masuk/keluar, mute, dan cleanup. Tes musik memutar WAV demo lokal, memeriksa `currentTime`, seek/drift sync, autoplay recovery, buffering state, volume independen, dan coexistence dengan intercom. Hasil otomatis ini tidak membuktikan audio terdengar melalui headset fisik atau kompatibilitas Safari iPhone. TURN, jaringan seluler publik, serta uji fisik iPhone belum dilakukan. Lihat [panduan verifikasi WebRTC](docs/webrtc-verification.md) dan [panduan shared music](docs/shared-music.md).

## Rooms dan keamanan

Room memakai kode undangan dengan 50 bit randomness kriptografis dan token bearer acak 256 bit. Server hanya menyimpan hash SHA-256 token. Browser menyimpan token pada `sessionStorage` untuk tab aktif; client Flutter harus menyimpan token di Keychain/Keystore. Token tidak boleh dimasukkan ke URL atau log.

Offer, answer, ICE candidates, dan restart request hanya diteruskan melalui Socket.IO terautentikasi; media mikrofon tidak pernah melewati server aplikasi. STUN development diarahkan ke alamat publik pada `.env.example`. TURN belum aktif secara default. Untuk produksi, konfigurasi `TURN_URLS` dan secret coturn REST API `TURN_SHARED_SECRET` di environment signaling; server menerbitkan username/password berumur pendek ke participant terautentikasi. Mode relay-only diagnostik akan tetap nonaktif sampai TURN tersedia.

State room disimpan dalam `MemoryRoomRepository`, sehingga hilang saat signaling restart. Jalankan satu instance saja; horizontal scaling belum didukung. Repository memiliki interface untuk migrasi ke Redis.

Variabel konfigurasi ada di `.env.example`. `SIGNALING_CORS_ORIGIN` menerima daftar origin dipisahkan koma dan wajib eksplisit. Rate limiting memakai alamat koneksi yang dilihat signaling; bila deploy di belakang proxy, atur forwarding IP pada trusted edge dan jangan mempercayai `X-Forwarded-For` dari client langsung.

## Navigasi Tahap 5

Room memiliki panel navigasi GPS lokal per perangkat. Lokasi tidak dipersistenkan atau dibagikan ke rider lain. Browser memerlukan HTTPS dan izin eksplisit. `NEXT_PUBLIC_MAPTILER_API_KEY` adalah public key browser: batasi HTTP origins ke domain lokal/deploy yang dibutuhkan dan pantau kuota. Bila kosong, panel memakai kanvas peta mock tanpa tiles; pilihan titik pada peta tersedia, tetapi rute jalan dan geocoding live memerlukan konfigurasi provider.

`OPENROUTESERVICE_API_KEY` hanya dibaca oleh Next.js Route Handlers dan tidak memakai prefiks `NEXT_PUBLIC_`. Directions dan geocoding memakai HeiGIT API (`api.heigit.org`) lewat adapter fixed-endpoint, timeout, validasi, rate limit lokal per proses, serta `cache: no-store`. Tidak ada respons provider yang disimpan permanen. `.env.example` memuat placeholder saja.

Kuota gratis provider terbatas dan dapat berubah. Saat penulisan ini, MapTiler Free mencantumkan 5.000 map sessions/bulan dan 100.000 API requests/bulan; layanan Free akan jeda sampai bulan selanjutnya ketika kuota tercapai. ORS Standard mencantumkan 2.000 Directions/hari dan 1.000 Geocoding/hari dengan batas per menit tambahan. Syarat MapTiler Free membatasi penggunaan pada nonkomersial serta R&D untuk aplikasi komersial; produksi komersial perlu memeriksa lisensi/plan terbaru sebelum dipakai. MapTiler dan OpenStreetMap attribution wajib terlihat pada peta. ORS results menggunakan CC-BY 4.0 dengan atribusi `© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors`. Routing menggunakan data OpenStreetMap sehingga cakupan dan akurasi Indonesia tidak dijamin di setiap jalan. Periksa [docs/provider-navigation.md](docs/provider-navigation.md) sebelum deployment.

Navigasi melakukan map matching/proyeksi geometry lokal, deteksi keluar jalur dengan beberapa sampel GPS dan cooldown, serta reroute melalui API proxy. TTS meminta `id-ID`; ketersediaan voice bergantung pada suara sistem/browser perangkat. Event lifecycle instruksi disiapkan untuk integrasi audio ducking tahap berikutnya, tetapi belum mengubah gain musik.

Panduan perangkat dan pemeriksaan manual ada di [docs/navigation-manual-test.md](docs/navigation-manual-test.md). Safari background/layar terkunci belum dijanjikan dan pengujian iPhone fisik belum dilakukan.

## Deployment

Deploy `apps/web` ke hosting Next.js dengan HTTPS. Deploy `apps/signaling` secara terpisah ke layanan Node.js yang menjaga proses tetap berjalan, lalu set `NEXT_PUBLIC_SIGNALING_URL` dan `SIGNALING_CORS_ORIGIN` ke origin produksi. Serverless function biasa tidak digunakan untuk proses signaling persisten. Produksi membutuhkan WSS, HTTPS, dan konfigurasi CORS origin yang eksplisit.

RideLink merupakan prototipe browser. Koneksi WebRTC terenkripsi menggunakan ICE, tetapi keberhasilan bergantung pada jaringan dan ketersediaan TURN. Perilaku Safari iPhone saat background, layar terkunci, perubahan jaringan, autoplay, serta routing audio Bluetooth perlu diuji pada perangkat sebenarnya; tidak ada klaim uji perangkat pada tahap ini.
# ridelink
