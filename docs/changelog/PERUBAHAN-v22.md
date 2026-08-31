# PERUBAHAN v22 — Mode RELAY: Jangkauan Radio PTT Berantai Antar-Hotspot

Tanggal: 31 Agustus 2026

## 1. Mode RELAY (penerus sinyal) di Radio PTT
- **Masalah:** arsitektur PTT sebelumnya topologi bintang murni — semua HP harus
  berada dalam radius hotspot WiFi HP host. HP yang keluar radius langsung putus.
- **Solusi:** HP yang sanggup **WiFi + hotspot bersamaan** (mis. Samsung
  "Wi-Fi sharing", sebagian Xiaomi) kini bisa menjadi menara penerus: jadi
  anggota bagi menara depan SEKALIGUS host bagi anggota di belakangnya.
  Jangkauan berlipat mengikuti jumlah HP relay dalam rantai
  (contoh: ketua di depan → relay 1 di ±30 m → relay 2 di ±60 m, dst).

## 2. Perubahan `radio-ptt.js`
- **Fungsi baru `relayAnswer(offerText)`**: seperti `memberAnswer`, tetapi yang
  dikirim ke menara depan bukan mic mentah, melainkan **campuran uplink**
  (`MediaStreamDestination`): mic relay + mic semua anggota bawahan.
- **Penerusan downlink**: track audio dari menara depan (`upstreamSrc`)
  diperdengarkan di speaker relay dan diteruskan ke mix setiap bawahan
  (otomatis juga untuk bawahan yang bergabung belakangan, lewat penambahan
  wiring di `hostMakeOffer`).
- **Penerusan uplink**: mic bawahan yang masuk (`hostWireIncomingTrack`)
  otomatis ikut disambungkan ke campuran uplink menuju menara depan.
- **Anti-gema & mix-minus tetap terjaga**: menara depan mengirim mix-minus
  terhadap relay (kontribusi uplink relay tidak kembali), dan tiap bawahan
  tetap tidak mendengar suaranya sendiri.
- `watchPc(pc, slot, isUp)`: status koneksi ke menara depan kini dicatat
  terpisah (`S.upState`) agar tidak bertabrakan dengan slot bawahan; event
  `peer` membawa penanda `up`.
- API baru: `relayAnswer`, `upstreamState()`, `role()`.
- Peran tersimpan di `S.role` (`'host' | 'member' | 'relay'`) dan dibersihkan
  saat `leave()`.

## 3. Perubahan `radio.html`
- Tombol baru **"🔀 Aktivasi sebagai RELAY (penerus)"** di detail ruangan.
- Alur relay: pindai QR tawaran HP depan (seperti anggota) → setelah tersambung,
  layar radio menampilkan tombol **"📡 Sambungkan Anggota Belakang"** yang
  memakai ulang alur QR tawaran/jawaban host untuk bawahan.
- Layar radio relay menampilkan chip **"⛓ Menara depan"** (status koneksi ke
  depan) dan daftar **"Bawahan #N"**; anggota biasa kini juga melihat chip
  **"📡 Ketua"**.
- Kartu panduan baru **"Mode RELAY — Perjauh Jangkauan"**: syarat HP
  (cara cek Samsung Wi-Fi sharing / tes Xiaomi), susunan posisi berantai,
  dan langkah aktivasi.
- Tips lapangan & troubleshooting diperbarui dengan catatan relay.

## 4. Pengujian
- Uji end-to-end headless Chromium, 3 instance (host ↔ relay ↔ member) lewat
  WebRTC asli: **15/15 asersi lulus** — semua koneksi `connected`, grafik audio
  uplink/downlink benar, anti-gema dan mix-minus terverifikasi.

## 5. Service worker
- CACHE dinaikkan `bwk-v89-offline-tiles` → `bwk-v90-radio-relay` agar HP yang
  sudah pernah membuka Pintu Angin mengambil versi radio terbaru.

## Catatan batasan
- Mode relay **butuh HP yang mendukung WiFi + hotspot bersamaan** — ini fitur
  perangkat keras/OS, tidak bisa diakali dari browser. HP tanpa fitur ini tetap
  bisa jadi anggota/host biasa.
- Tiap lompatan menambah jeda suara ±0,1–0,2 detik; 1–2 relay masih nyaman.
- Untuk mesh tanpa hotspot berantai sama sekali perlu aplikasi Android native
  (Nearby Connections API) — di luar jangkauan aplikasi web.
