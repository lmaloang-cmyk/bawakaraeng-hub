# Audit Panel “Maps Pintu Angin” — bawakaraeng-hub

**Tanggal:** 23 Agustus 2026
**Repo:** `lmaloang-cmyk/bawakaraeng-hub` (branch `main`, tree `d46b5dc`)
**Live:** https://bawakaraeng-hub.vercel.app (tidak dapat diakses saat audit)

---

## 1. Metode & keterbatasan

Audit dilakukan lewat GitHub API: daftar file, riwayat commit, dan diff per commit.

Keterbatasan yang perlu diketahui:
- `index.html` berukuran 1.021.150 byte sehingga tidak bisa dibaca utuh; analisis bertumpu pada **diff commit** dan potongan konteks di sekitar baris yang berubah.
- `sw.js` **gagal dibaca** lewat API (lihat temuan P0 #4).
- Situs live tidak merespons, jadi tidak ada verifikasi runtime.
- Pencarian kode GitHub mengembalikan 0 hasil (repo belum terindeks), jadi beberapa temuan bersifat **dugaan kuat berbasis diff**, bukan pembacaan baris demi baris. Tandanya disebut eksplisit di tiap temuan.

---

## 2. Peta fungsi panel MAPS

| Area | Simbol kunci | Lokasi | Catatan |
|---|---|---|---|
| Konfigurasi layer | `TILE_SOURCES` | `index.html:~3400` | Tersisa `osm`, satelit Esri, `dark`. `topo` & `hybrid` dihapus di `6153f42` |
| Inisialisasi | `initMaps()` | `index.html:~3426` | Membuat peta, layer, kontrol |
| Layer | `_addTileLayer(key)` | `index.html:~3457` | Dipanggil dengan `'topo'` — sudah tidak ada |
| Kontrol layer | `L.control.layers()` + `addBaseLayer` | `index.html:~3463` | |
| Cache tile | `_initTileCache()`, IndexedDB `bwk-maps-db`, store `tiles` | — | Berpotensi dipanggil ganda |
| Data peta | `_loadMapsData()` | `index.html:~5095` | Lokasi lokal, waypoint |
| Lokasi | `BWK_LOCAL_LOCATIONS` (40 lokasi + alias) | — | Basis pencarian offline |
| Penanda | `mapsWaypoints`, flag `_bwkCustom` / `_bwkTrack` / `_bwkDefault` | — | |
| Pendakian | `hikeStart()`, `hikeCheckin()`, `hikeOfflineGuide()`, `renderHikeTracker` | `hike.js` | 11 checkpoint radius 100 m |
| Penyimpanan | `bwkWaypoints`, `bwkTracks`, `bwkMapLayer`, `bwkHikeProgress`, `bwkOfflineCheckins`, `bwkTrailCheckins` | localStorage | Semua di localStorage |
| PWA | cache `bwk-v76-tts-sos-fix` → `bwk-v77-leaflet-offline` | `sw.js` | File bermasalah |

---

## 3. Temuan

### 🔴 Kritis (P0)
1. **Layer default `topo` sudah tidak ada** — peta bisa gagal render total, dan sisa `initMaps()` ikut mati.
2. **Sisa konflik merge di `index.html`** — v20 masuk sebagai orphan branch (11.263 baris "added"), berisiko syntax error.
3. **Downloader tile tanpa timeout/retry/batal** — commit yang mengklaim perbaikan ternyata hanya `+2/-1`.
4. **`sw.js` bermasalah di level git** — mode offline berpotensi mati diam-diam.
5. **Bulk download OSM/Esri melanggar Tile Usage Policy** — risiko pemblokiran.

### 🟠 Penting (P1)
6. Tombol WP/Rekam/Ukur dimatikan dengan `display:none`, bukan solusi UX.
7. Track & waypoint di localStorage — batas 5 MB, API sinkron, mudah hilang.
8. Hiking tracker tanpa error boundary GPS, tanpa reset progress, `_sbClient()` rapuh.
9. `index.html` 1 MB monolit — cache dan first paint buruk.

### 🟡 Perbaikan berkelanjutan (P2)
10. Peta offline kelas atas: PMTiles + kontur + hillshade, profil elevasi, ETA, alarm keluar jalur, outbox + Background Sync, mode malam.
11. Kebersihan repo: aset duplikat, file DB ter-commit, PDF 2,3 MB, rotasi kunci bila pernah bocor.

---

## 4. Rancangan peta offline yang kuat

| Lapisan | Isi | Ukuran perkiraan |
|---|---|---|
| Basemap | PMTiles zoom 10–16, bbox 119.85–120.00 BT / -5.40–-5.22 LS | 20–60 MB |
| Kontur | DEMNAS/SRTM interval 12,5 m, GeoJSON → vector tile | 5–15 MB |
| Hillshade | Raster pra-render zoom 12–14 | 10–20 MB |
| Jalur | 7 jalur resmi sebagai GeoJSON di dalam bundel aplikasi | < 1 MB |
| POI | Basecamp, pos air, shelter, titik sinyal | < 1 MB |

Pilihan unduhan untuk pengguna: **Ringan** (zoom ≤14), **Sedang** (≤15), **Detail** (≤16) — masing-masing menampilkan perkiraan MB sebelum mulai.

---

## 5. Prioritas ramah pemula

1. Onboarding 3 langkah: unduh peta → pilih jalur → mulai jalur.
2. Mode Simpel (4 tombol besar) vs Mode Pro (alat lengkap).
3. Bar status yang jujur: “Peta offline siap · 3.402 petak”, “GPS ±12 m”, “Tanpa sinyal”.
4. Pesan error berbahasa manusia, selalu disertai langkah tindakan.
5. Target sentuh ≥ 56 px, kontras tinggi, mode malam merah.
6. Semua teks Bahasa Indonesia, tanpa istilah teknis (“petak peta”, bukan “tile”).

---

## 6. Rencana kerja

**Minggu 1 (P0):** perbaiki layer default, audit konflik merge + pasang CI, ganti downloader tile, betulkan `sw.js`, hentikan bulk download sumber terlarang.
**Minggu 2–3 (P1):** Mode Simpel/Pro + onboarding, migrasi IndexedDB, perbaikan hiking tracker, mulai memecah `index.html`.
**Bulan 2 (P2):** PMTiles + kontur/hillshade, profil elevasi & ETA, alarm keluar jalur, outbox + Background Sync, bersih-bersih repo.

---

## 7. Cara memverifikasi setiap perbaikan

```bash
node scripts/check-index.mjs             # 0 masalah fatal
git ls-files -s sw.js                    # 100644
curl -I https://bawakaraeng-hub.vercel.app/sw.js
```
Di perangkat: aktifkan mode pesawat setelah mengunduh area → peta harus tetap tampil, GPS tetap jalan, check-in masuk antrean dan terkirim otomatis begitu sinyal kembali.
