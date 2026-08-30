# PERUBAHAN v21 — Fullscreen Peta Jadi Halaman Khusus + Tombol Reset File Peta

Tanggal: 31 Agustus 2026

## 1. Fullscreen Peta Jalur & Peta Offline pindah ke halaman sendiri
- **File baru: `peta-fullscreen.html`** (`?map=jalur` / `?map=offline`).
  Peta tampil seluas layar — menggantikan overlay lama yang meng-clone div peta
  (hasil clone Leaflet tidak interaktif & sering tampil rusak).
- Tombol **⛶/🗺️ Layar Penuh** di bagian Peta Jalur & Peta Offline kini MEMBUKA
  halaman tersebut (`openMapFs()`; `toggleFs()` lama tetap berfungsi sebagai alias).
- **Tombol tidak lagi menutupi peta.** Dulu `position:absolute` di pojok kanan atas
  sehingga menumpuk kontrol zoom/layer Leaflet. Sekarang tombol berada di baris
  tombol di bawah peta, sejajar dengan tombol "Lokasi Saya" (`.map-actions`).
- Di halaman fullscreen tersedia **tombol ✕ ESC** (kiri atas) + dukungan **tombol
  keyboard ESC** untuk kembali ke Pintu Angin, persis ke bagian peta yang tadi
  dibuka. Caranya: halaman fullscreen kembali ke `index.html#peta` /
  `index.html#petaoffline`, dan index.html kini membaca hash saat load
  (deep-link view). Bonus: bisa dipakai juga untuk tautan langsung, mis.
  `index.html#peta`.
- Halaman fullscreen memakai **Leaflet lokal** (`leaflet.js`/`leaflet.css`) dan
  ikut di-pre-cache service worker → tetap terbuka saat offline di gunung.
- Data jalur (pos, sumber air, titik sinyal) diekstrak ke **`peta-data.js`** agar
  dipakai bersama index.html & peta-fullscreen.html — satu sumber data, tidak
  duplikat. Sekalian memperbaiki emoji rusak di data Puncak & kartu "Via Lembanna".

## 2. Tombol Reset di Maps Offline
- **`map-offline.js`**: kontrol baru `addResetControl` (🗑️ Reset file) + API publik
  `resetFiles(map)`. Menampilkan konfirmasi berisi daftar file, lalu menghapus
  SEMUA file GPX/KML/GeoJSON yang pernah di-upload (localStorage `bwkMapFiles`).
- Layer file yang sedang tampil ikut dilepas dari peta & kontrol layer
  (pelacakan layer via `map._bwkFileLayers` di `_addToLayerControl`).
- Tile peta offline hasil "Simpan area" **TIDAK** ikut terhapus.
- Tombol reset tersedia di 3 tempat:
  1. Kontrol 🗑️ pada peta offline di index.html (sejajar Simpan area/Upload),
  2. Tombol lebar "Reset — Hapus Semua File Peta yang Di-upload" di bawah status
     penyimpanan (`offResetMapFiles()`),
  3. Kontrol 🗑️ pada halaman fullscreen mode offline.

## 3. Service worker
- CACHE dinaikkan `bwk-v83` → `bwk-v84-offline-tiles`.
- ASSETS baru: `/peta-fullscreen.html`, `/peta-data.js`, `/leaflet.js`, `/leaflet.css`.

## Uji
- `node scripts/check-index.mjs` → 0 fatal.
- Uji browser (Playwright): navigasi tombol → halaman fullscreen → ESC kembali ke
  view asal; reset menghapus localStorage + melepas overlay dari kontrol layer;
  tombol fullscreen tidak lagi menumpuk peta.
