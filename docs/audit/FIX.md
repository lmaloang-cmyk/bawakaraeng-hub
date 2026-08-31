# FIX — Catatan Fix & Bug yang Sudah Diperbaiki

**Tujuan**: Dokumen rujukan singkat untuk hal-hal yang **sudah benar** dan bekerja dengan baik di aplikasi.
Kalau suatu hari muncul masalah (regression, laporan user, dsb.), cek dulu di sini apakah komponen
itu pernah dilaporkan bermasalah dan sudah diperbaiki — supaya kita tidak troubleshoot dari nol.

> **Tidak untuk**: rencana/perubahan masa depan (lihat `docs/changelog/PERUBAHAN-vXX.md`),
> atau catatan audit besar per topik (lihat `docs/audit/` lainnya seperti `BUGFIX-*.md`).

---

## Cara Pakai

- Tambah entri baru di bagian paling atas (di bawah "Update Terakhir") setiap kali ada fix
  atau bug yang perlu dirujuk.
- Format entry: **tanggal · judul singkat · file/scope · apa yang diperbaiki · cara verifikasi**.
- Kalau sudah ada entry lama yang terkait, **referensikan** saja (jangan duplikat).

---

## Update Terakhir

### 2026-08-31 · Radio PTT Offline (v22) — fungsi utama sudah benar & terverifikasi otomatis

**Scope**: `radio.html`, `radio-ptt.js`, `radio-qr.js`, `index.html` (chip + card), `sw.js`.

**Status kode**: ✅ Bekerja dengan benar untuk semua jalur non-WebRTC.

#### Yang sudah diverifikasi lulus (uji otomatis)

- **Logika murni** (`test-ptt-logic.cjs`, 41/41 lulus):
  - `createRoom`, `encodeRoom`/`parseCode` roundtrip (kode ruangan `BWKR1|R|...`).
  - Reject malformed: `null`, empty, prefix salah, type salah, slot non-numerik, base64 rusak.
  - `deleteRoom` removes by id, listRooms tetap utuh untuk ruangan lain.
  - `CompressionStream` deflate/inflate roundtrip (SDP offer/answer encoding).
  - `QRGen.make`/`toCanvas` render ke canvas dengan matrix valid (versi 1–40).
  - `startScan` graceful saat `BarcodeDetector` tidak ada (return error `no-bd`, no crash).
  - `PTT toggle` di event: `setTalking(true/false)` update `micTrack.enabled` & state.
  - `leave()` reset stream/micTrack/actx/pcs/semua state.
- **Browser headless** (`test-ptt-e2e.cjs`, 27/29 lulus; 2 skip butuh mic sungguhan):
  - UI `radio.html` render lengkap di Chromium.
  - `uiCreateRoom` → `viewRoom` aktif, QR canvas dapat konteks 2D, roomName/ssid/pass ter-render.
  - QR canvas punya pixel pattern valid (294×294, ~30k dark pixels).
  - `joinRoomByText` anggota gabung ruangan via kode (textarea di-clear).
  - Tombol PTT toggle benar: `pointerdown` → `on=true` + label "BICARA…"; `pointerup` → `on=false` + label "TAHAN UNTUK BICARA".
  - Shortcut chip PTT di hero beranda render & link ke `radio.html`.

#### Yang TIDAK diuji otomatis & butuh verifikasi manual di 2 HP

- WebRTC handshake benar-benar `connected` (butuh 2 device).
- Audio beneran mengalir antar 2 mic via WebRTC (butuh `getUserMedia` asli).
- Visual chip PTT tidak bertumpukan dengan elemen lain di semua ukuran HP.

**Catatan jujur**: Kode dirancang dengan benar (SDP offer/answer, ICE, mix-minus via Web Audio, PTT
toggle matikan micTrack saat tidak ditekan). Pola ini standar dan terbukti di banyak lib walkie-talkie
web. **"desain benar" ≠ "berfungsi di HP saya"** sampai diuji manual 2 HP Android Chrome/Edge tersambung
ke satu hotspot WiFi.

---

### 2026-08-31 · Chip shortcut PTT di hero beranda — posisi tidak menutupi info penting

**File**: `index.html` (`.ptt-chip` CSS), `sw.js`.

**Masalah yang diperbaiki**:
1. ~~Chip di pojok kanan-bawah (`bottom:11px`) menutupi card cuaca "Prakiraan BMKG" pada
   layar HP sempit (terlihat di screenshot user, card "16° Cerah" bagian bawahnya tertutup chip).~~
2. ~~Chip di pojok kanan-bawah juga bertumpukan dengan card cuaca (`hx-wx` 152px flex-end)
   di breakpoint ≤420px.~~

**Fix**: Pindahkan chip ke **pojok kanan-atas** (`top:46px`, di breakpoint ≤420px `top:48px`),
di antara baris `hx-top` ("LANGSUNG" + jam) dan greeting — area kosong di hero. Background
diperkuat (`rgba(8,8,25,.62)`, border alpha 0.28) supaya tetap kebaca di atas background hero.

**Verifikasi**: Buka `index.html` di HP Android/iOS, pastikan card cuaca tampil lengkap
dan chip tidak bertumpukan dengan elemen lain.

**Cache SW**: v86 (awal) → v87 (visual hero) → v88 (hapus gempa) → v89 (pindah chip).

---

### 2026-08-31 · Info gempa di hero — duplikasi & nutupi chip pada layar kecil

**File**: `index.html` (`.hx-quake` markup & `wQuake` JS update).

**Masalah**: Elemen `.hx-quake` di hero menampilkan info gempa dari `/api/bmkg` dengan style
pinned bottom. Pada layar HP kecil (≤420px), elemen ini menutupi shortcut chip PTT yang
sebelumnya ada di pojok kanan-bawah hero.

**Fix**: Hapus `.hx-quake` dari hero dan hapus JS update `wQuake`/`wqMag`/`wqLoc`. Info gempa
tetap tampil dari `loadAlerts()` di section Kondisi Kawasan (`#alertBox`) yang feed-nya
mengambil dari **USGS** (`earthquake.usgs.gov`, M≥4 radius 350 km).

**Tambahan**: Fallback ke `/api/bmkg.d.gempa` kalau USGS gagal/offline, supaya info gempa
tetap muncul saat koneksi ke `earthquake.usgs.gov` putus (mis. di gunung). Cek otomatis
`if(!al.some(...Gempa...))` supaya tidak duplikat.

**Verifikasi**: Buka `index.html`, section Kondisi Kawasan harus menampilkan "Gempa M X.X
terkini" dari USGS; kalau USGS gagal/offline, dari BMKG proxy. Hero lebih lega tanpa `.hx-quake`.

---

### 2026-08-31 · Poles visual Radio PTT (radio.html) — hero & tombol PTT lebih dramatis

**File**: `radio.html` (CSS hero + PTT button, markup, JS timer).

**Yang ditambah** (non-breaking, tidak mengubah logika PTT):
- **Hero `.card.hero`**: gradient indigo→teal→hijau (`#0c1f3a`→`#1c3a5e`→`#1f5a4e`→`#2f8a70`),
  radial glow overlay, ikon walkie-talkie SVG (ganti emoji 📻🗣️), badge **"LIVE · OFFLINE"**
  dengan pulse merah, ripple broadcast 3 lapis (animasi `bcastRipple 2.4s`), chip dengan
  icon-circle 18px.
- **Tombol PTT 200px**: gradient glossy hijau dengan inner highlight, mic SVG (ganti emoji 🎙️),
  pulse ring idle (animasi `pttIdle 2.6s`), pressed state jadi gradient merah dengan
  ripple ekspansif (`pttRipple 0.7s`), label 2-baris dengan `<br/>`, counter durasi realtime
  via `requestAnimationFrame` saat ditahan, reset ke `0.0s` saat dilepas (delay 220ms).
- **A11y**: `prefers-reduced-motion` matikan animasi ripple/pulse; `aria-pressed` ditoggle
  oleh JS; SVG `aria-hidden="true"`.

**Verifikasi**: Buka `radio.html` di HP/desktop, animasi halus tidak bikin lambat; tombol
PTT menampilkan counter `0.0s`/`0.5s`/dst saat ditahan; gradient merah saat `.on`.

---

## Index Komponen Kritis (untuk rujukan cepat)

| Komponen | File | Status | Verifikasi terakhir |
|---|---|---|---|
| Ruangan (create/encode/parse/delete) | `radio-ptt.js` | ✅ OK | 2026-08-31 logic test |
| QR generator | `radio-qr.js` | ✅ OK | 2026-08-31 logic test |
| PTT toggle (setTalking) | `radio-ptt.js` | ✅ OK | 2026-08-31 e2e test |
| leave() reset state | `radio-ptt.js` | ✅ OK | 2026-08-31 e2e test |
| WebRTC signaling | `radio-ptt.js` | ⚠️ Butuh uji 2 HP | 2026-08-31 (desain review only) |
| Hero chip PTT posisi | `index.html` `.ptt-chip` | ✅ FIXED (pojok kanan-atas) | 2026-08-31 |
| Info gempa Kondisi Kawasan | `index.html` `loadAlerts` | ✅ OK (USGS + BMKG fallback) | 2026-08-31 |
| Hero visual polish | `radio.html` | ✅ OK | 2026-08-31 |
| Service Worker | `sw.js` | ✅ OK (cache v89) | 2026-08-31 |

---

## Update Log

- 2026-08-31: FIX.md dibuat, entry pertama: Radio PTT v22 (status) + chip posisi + gempa hero + visual polish.