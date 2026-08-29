# Daftar Issue Siap Tempel — MAPS Pintu Angin

Token GitHub yang terhubung tidak punya izin tulis Issues (`403 Resource not accessible by personal access token`), jadi 11 temuan ini ditulis di sini. Buka https://github.com/lmaloang-cmyk/bawakaraeng-hub/issues/new lalu salin judul + isi per bagian.

Label yang disarankan dibuat lebih dulu: `P0`, `P1`, `P2`, `maps`, `pwa`, `ux`, `build`, `chore`.

---

## 1. [P0][MAPS] Layer default `topo` masih dipanggil padahal sudah dihapus dari TILE_SOURCES

**Label:** P0, maps

**Masalah**
Commit `6153f42` (22 Agu 17:06) menghapus 13 baris di `index.html:3400-3418`, yaitu definisi layer `topo` dan `hybrid` di `TILE_SOURCES`. Tetapi kode inisialisasi peta masih memanggil `_addTileLayer('topo')`. Sebelum v20, branch lama (`6138f37`, `index.html:3457`) memanggil `_addTileLayer('osm')` — nilai inilah yang benar.

**Dampak**
`TILE_SOURCES['topo']` bernilai `undefined` → pembacaan `.url` melempar TypeError saat `initMaps()`. Peta tampil abu-abu kosong, dan seluruh kode setelah baris itu di dalam `initMaps()` tidak jalan (kontrol layer, GPS, waypoint).

**Perbaikan**
1. Ganti `_addTileLayer('topo')` → `_addTileLayer('osm')`.
2. Tambahkan pengaman di awal `_addTileLayer`:
```js
if (!TILE_SOURCES[key]) {
  console.warn('[Maps] layer "' + key + '" tidak ada, pakai osm');
  key = TILE_SOURCES.osm ? 'osm' : Object.keys(TILE_SOURCES)[0];
}
```
3. Validasi juga nilai lama di `localStorage.bwkMapLayer` (pengguna lama bisa tersimpan `'topo'`/`'hybrid'`).

**Selesai bila:** peta terbuka normal di perangkat baru maupun perangkat yang pernah memilih layer `topo`.

---

## 2. [P0][BUILD] Audit sisa konflik merge di index.html — risiko syntax error fatal

**Label:** P0, build

**Masalah**
Commit `dfe8e67` (v20) menambahkan **11.263 baris** dan menandai *semua* file sebagai "added" — ciri orphan branch yang di-merge (`d46b5dc`). Pola ini gampang meninggalkan potongan kode ganda atau properti menggantung. Indikasi ditemukan di sekitar `index.html:3675-3690` (mis. `scrollWheelZoom: true,` tanpa objek induk) dan pemanggilan `_initTileCache()` yang berpotensi dobel.

**Dampak**
Satu syntax error di file 1 MB = seluruh aplikasi blank. Tidak ada CI, jadi tidak ada yang menahan commit rusak.

**Perbaikan**
```bash
grep -n '^<<<<<<<\|^=======\|^>>>>>>>' index.html
node scripts/check-index.mjs
```
Tambahkan GitHub Action `.github/workflows/validate.yml` (tersedia di paket perbaikan) yang menjalankan pemeriksaan sintaks pada setiap push.

**Selesai bila:** `node scripts/check-index.mjs` lolos dan CI hijau.

---

## 3. [P0][MAPS] Download tile offline tanpa AbortController/timeout/retry

**Label:** P0, maps

**Masalah**
Commit `179c9bf` diberi pesan perbaikan downloader, tapi diff-nya hanya `+2/-1` di `index.html:5095` — tidak memuat perbaikan yang diklaim. Fungsi unduh tile saat ini: tanpa timeout, tanpa retry, tanpa batas paralel, tanpa tombol batal, tanpa penanganan `QuotaExceededError`.

**Dampak**
Di sinyal buruk (kondisi normal di jalur Bawakaraeng) unduhan menggantung selamanya; ratusan `fetch` serentak membekukan UI; penyimpanan penuh menghasilkan error diam.

**Perbaikan**
Pakai `maps-offline.js` dari paket perbaikan: AbortController + timeout 10 detik, retry 2× dengan backoff, paralel dibatasi 6, lewati tile yang sudah ada, tombol batal, daftar tile gagal untuk "coba lagi", dan pesan khusus saat kuota penuh.

**Selesai bila:** unduhan bisa dibatalkan, dilanjutkan, dan memberi pesan jelas saat gagal.

---

## 4. [P0][PWA] sw.js tidak terbaca via GitHub API (dugaan symlink/mode file salah)

**Label:** P0, pwa

**Masalah**
```
failed to inspect repository file: blob "ff58ce55a2706ef3d45b98831b31e1c119974917" is not a valid internal symbolic link target
```
Blob `sw.js` tercatat bukan sebagai file biasa.

**Dampak**
Vercel menyajikan isi yang salah → `navigator.serviceWorker.register()` gagal → seluruh mode offline mati tanpa pesan apa pun. Untuk aplikasi pendakian, ini kegagalan paling berbahaya.

**Perbaikan**
```bash
git ls-files -s sw.js   # harus 100644
curl -I https://bawakaraeng-hub.vercel.app/sw.js
```
Jadikan file biasa, lalu tambahkan header `Cache-Control: no-cache` untuk `/sw.js` di `vercel.json`.

**Selesai bila:** `curl -s .../sw.js | head -5` menampilkan kode JS asli dan SW terdaftar di DevTools → Application.

---

## 5. [P0][MAPS] Bulk download tile OSM/Esri melanggar Tile Usage Policy

**Label:** P0, maps

**Masalah**
Fitur "unduh area" menarik ribuan tile dari `tile.openstreetmap.org` dan ArcGIS. Keduanya melarang bulk downloading; risikonya IP/host diblokir dan peta mati untuk semua pengguna.

**Perbaikan**
- Cache oportunistik (tile yang memang dilihat pengguna) → tetap boleh.
- Untuk unduh area, pindah ke penyedia berizin (MapTiler/Stadia/Thunderforest) atau host sendiri dengan **PMTiles** (satu file `.pmtiles` di storage, bbox 119.85–120.00 BT / -5.40–-5.22 LS, zoom 10–16, ±20–60 MB).
- Sementara itu, `maps-offline.js` memblokir unduh massal untuk sumber ber-flag `allowBulkDownload:false`.

---

## 6. [P1][UI] Tombol WP/Rekam/Ukur disembunyikan `display:none` → ganti Mode Simpel & Mode Pro

**Label:** P1, ux

**Masalah**
Tombol lanjutan dimatikan lewat CSS, bukan dihapus — fitur mati tapi kodenya tetap dieksekusi. Pemula juga tidak punya panduan langkah pertama.

**Perbaikan**
`maps-ui.js` + `maps-ui.css`: Mode Simpel (4 tombol besar ≥ 56 px: Lokasi Saya, Mulai Jalur, Tandai Titik, SOS) dan Mode Pro (menambah Unduh Peta, Rekam Trek, Ukur Jarak, Kompas). Pilihan tersimpan di `localStorage.bwkMapsMode`. Ditambah onboarding 3 langkah dan bar status "Peta offline siap · N petak".

---

## 7. [P1][MAPS] Track & waypoint di localStorage → migrasi ke IndexedDB + manajemen kuota

**Label:** P1, maps

**Masalah**
`bwkTracks`, `bwkWaypoints`, `bwkOfflineCheckins`, `bwkTrailCheckins` disimpan di localStorage: batas ~5 MB, API sinkron (memblokir UI saat merekam trek panjang), dan mudah terhapus browser.

**Perbaikan**
`maps-storage.js`: IndexedDB `bwk-data-db` (stores `tracks`, `waypoints`, `outbox`, `meta`), migrasi otomatis sekali jalan dengan cadangan, `navigator.storage.persist()`, dan indikator pemakaian penyimpanan.

---

## 8. [P1][HIKE] Hiking tracker: tanpa error boundary GPS, tanpa reset progress, `_sbClient()` rapuh

**Label:** P1, maps

**Masalah** (`hike.js`)
- `watchPosition` tanpa penanganan error yang informatif → pengguna menatap layar diam.
- `bwkHikeProgress` tidak bisa direset dari UI.
- `_sbClient()` mengasumsikan Supabase sudah termuat; saat offline, `hikeCheckin()` bisa melempar error tak tertangkap.
- Tidak ada filter akurasi → titik loncat-loncat mengacaukan jarak tempuh.

**Perbaikan**
`maps-safety.js`: pesan error GPS berbahasa manusia untuk tiap kode error, penjaga "sinyal hilang > 1 menit", filter akurasi > 30 m, buang lompatan > 40 m/detik, `resetProgress()`, dan check-in masuk outbox saat offline.

---

## 9. [P1][PERF] index.html 1 MB monolit → pecah per modul

**Label:** P1, build

**Masalah**
`index.html` = 1.021.150 byte. Setiap perubahan satu baris membatalkan cache seluruh file, dan first paint di 3G lambat.

**Perbaikan**
Pindahkan blok MAPS ke `maps-*.js` (paket ini sudah memulainya), lalu blok lain menyusul. Target: `index.html` < 150 KB, sisanya file JS ber-cache 1 tahun dengan nama ber-hash.

---

## 10. [P2][MAPS] Peta offline yang benar-benar kuat: PMTiles + kontur/hillshade, profil elevasi, ETA

**Label:** P2, maps

**Isi**
- `.pmtiles` untuk basemap + kontur 12,5 m dari DEMNAS/SRTM (paling berguna untuk pendaki).
- Hillshade untuk membaca punggungan vs lembah.
- Profil elevasi jalur + sisa tanjakan + ETA (Tobler) — sudah tersedia di `maps-safety.js`.
- Alarm keluar jalur 50 m dengan histeresis, getar + bunyi.
- Outbox + Background Sync untuk check-in/SOS yang dibuat saat tanpa sinyal.
- Mode malam (filter merah) supaya penglihatan gelap tidak rusak.

---

## 11. [P2][CHORE] Bersihkan aset duplikat & file DB ter-commit

**Label:** P2, chore

**Isi**
- `manifest.json` dan `manifest.json.json` — sisakan satu.
- `env.example` dan `.env.example` — sisakan satu, pastikan tidak ada nilai asli.
- `knowledge.db`, `knowledge.db-shm`, `knowledge.db-wal` ter-commit — keluarkan dari git, masukkan `.gitignore`.
- `Panduan-Pintu-Angin.pdf` (2,3 MB) — pertimbangkan Git LFS atau storage eksternal.
- Cek riwayat: kalau kunci Supabase/Gemini pernah ter-commit, **rotasi kuncinya**.
