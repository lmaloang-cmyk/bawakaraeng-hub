# Perubahan v20 — MAPS Pintu Angin Offline Powerfull

## 1. Pre-cache Leaflet via SW (Offline Total)
- Download Leaflet CSS/JS lokal ke root folder
- Download Leaflet images (marker-icon, layers, shadow) ke folder /images/
- Update SW cache dari `bwk-v76-tts-sos-fix` → `bwk-v77-leaflet-offline`
- Tambahkan asset lokal ke SW cache list
- Update `ensureLeaflet()` load dari `/leaflet.css` dan `/leaflet.js` lokal (bukan CDN unpkg)
- Peta sekarang bisa dibuka 100% offline setelah pertama kali install

## 2. Tombol Download Area Offline
- Panel baru "Download Area untuk Offline" dengan UI progress bar
- User bisa pilih zoom level: 14 (ringan), 15 (sedang), 16 (detail)
- Download tile area saat online → disimpan di IndexedDB
- Progress real-time: persen, jumlah tile, status
- Batch processing (30 tile per batch) agar tidak freeze
- Cek tile yang sudah ada sebelum download ulang
- Validasi: hanya Topo/OSM yang bisa didownload, perlu koneksi internet

## 3. Perluas Geocoding Offline
- Tambah 29 lokasi baru di `BWK_LOCAL_LOCATIONS`
- Tambah field `aliases` untuk setiap lokasi (cari dengan kata kunci alternatif)
- Peningkatan algoritma pencarian: exact match → partial word match
- Contoh pencarian offline: "Pos 1", "Puncak", "Bonto", "Air Terjun", "Sungai", dll
- Placeholder search diperbarui dengan contoh yang lebih jelas

## Lokasi Baru yang Ditambahkan:
- Puncak Bawakaraeng / Summit
- Pos 1-9 di jalur pendakian
- Memorial, Pintu Rimba
- Lembah Ramma, Lembah Loe
- Spot Sunset, Area Camping
- Jalur Bonto, Ballea, Panaikang, Tassoso, Kanre Apia, Ridge Traverse

---
*Update: 12 Agustus 2026*
