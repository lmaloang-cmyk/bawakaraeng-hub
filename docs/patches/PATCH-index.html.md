# PATCH index.html — langkah manual

File `index.html` berukuran ~1 MB, jadi paket ini **tidak** menimpanya. Ikuti langkah cari-dan-ganti berikut di editor (VS Code: `Ctrl/Cmd + H`).

> Backup dulu: `cp index.html index.html.bak`

---

## 1. [P0] Perbaiki layer default yang sudah tidak ada

Commit `6153f42` menghapus `topo` dan `hybrid` dari `TILE_SOURCES`, tapi kode inisialisasi masih memanggil `_addTileLayer('topo')`. Akibatnya peta bisa muncul kosong/abu-abu saat pertama dibuka.

**Cari:**
```js
_addTileLayer('topo');
```
**Ganti:**
```js
_addTileLayer('osm');
```

Lalu tambahkan pengaman di dalam fungsi `_addTileLayer` supaya kejadian ini tidak fatal lagi.

**Cari** (baris pertama di dalam `function _addTileLayer(key)`):
```js
function _addTileLayer(key) {
```
**Ganti:**
```js
function _addTileLayer(key) {
  if (!TILE_SOURCES[key]) {
    console.warn('[Maps] layer "' + key + '" tidak ada, pakai osm sebagai cadangan');
    key = TILE_SOURCES.osm ? 'osm' : Object.keys(TILE_SOURCES)[0];
  }
```

Cek juga nilai tersimpan pengguna lama:

**Cari:**
```js
localStorage.getItem('bwkMapLayer')
```
**Pastikan hasilnya divalidasi**, contoh:
```js
var _saved = localStorage.getItem('bwkMapLayer');
var _startLayer = (_saved && TILE_SOURCES[_saved]) ? _saved : 'osm';
_addTileLayer(_startLayer);
```

---

## 2. [P0] Audit sisa konflik merge

Jalankan sebelum commit:
```bash
node scripts/check-index.mjs
grep -n '^<<<<<<<\|^=======\|^>>>>>>>' index.html
```
Perhatikan sekitar baris 3675–3690 (inisialisasi peta) — pernah ada properti menggantung seperti `scrollWheelZoom: true,` tanpa objek induk.

---

## 3. Hapus pemanggilan `_initTileCache()` ganda

Cari `_initTileCache` — harus muncul **satu kali** sebagai definisi dan **satu kali** sebagai panggilan. Kalau ada lebih, hapus duplikatnya (sisa merge orphan-branch `dfe8e67`).

Setelah modul baru dipasang, `_initTileCache()` boleh dipensiunkan: cache tile ditangani `maps-offline.js` (DB `bwk-tiles-db`). DB lama `bwk-maps-db` tidak diutak-atik supaya data pengguna lama tetap aman.

---

## 4. Pasang modul baru

Di bagian `<head>`, sesudah `leaflet.css`:
```html
<link rel="stylesheet" href="maps-ui.css">
```

Tepat sebelum `</body>` (urutan wajib seperti ini):
```html
<script src="maps-storage.js"></script>
<script src="maps-offline.js"></script>
<script src="maps-safety.js"></script>
<script src="maps-ui.js"></script>
```

---

## 5. Aktifkan UI baru di akhir `initMaps()`

**Cari** akhir fungsi `initMaps()` (sesudah peta & layer control siap), **tambahkan:**
```js
// --- Paket perbaikan MAPS (audit 2026-08-23) ---
try {
  if (window.BWKMapsUI) {
    BWKMapsUI.boot({
      map: mapsMap,
      source: 'osm',
      bounds: { north: -5.22, south: -5.40, east: 120.00, west: 119.85 },
      route: (window.JALUR_PINTU_ANGIN || []),        // ganti dengan array jalur resmi kamu
      checkpoints: (window.BWK_CHECKPOINTS || []),    // 11 checkpoint @100 m
      hooks: {
        locate: function () { if (window.toggleGPS) toggleGPS(); },
        addWaypoint: function () { if (window.addWaypoint) addWaypoint(); },
        toggleRecording: function () { if (window.toggleTrackRecording) toggleTrackRecording(); },
        toggleMeasure: function () { if (window.toggleMeasure) toggleMeasure(); },
        toggleCompass: function () { if (window.toggleCompass) toggleCompass(); },
        sos: function () { if (window.openSOS) openSOS(); else location.hash = '#sos'; }
      }
    });
  }
} catch (e) { console.warn('[Maps] UI baru gagal dimuat:', e); }
```
Sesuaikan nama fungsi di `hooks` dengan fungsi yang benar-benar ada di `index.html`. Kalau salah satu belum ada, tombolnya tetap muncul dan memberi pesan ramah, bukan error.

---

## 6. Gunakan layer offline-first (opsional tapi disarankan)

Agar peta yang sudah diunduh benar-benar terpakai saat tanpa sinyal, ganti pembuatan `L.tileLayer(...)` di `_addTileLayer` dengan:
```js
var layer = (window.BWKOfflineTiles)
  ? BWKOfflineTiles.createLayer(L, key)
  : L.tileLayer(TILE_SOURCES[key].url, { maxZoom: TILE_SOURCES[key].maxZoom || 18 });
```

---

## 7. Sembunyikan tombol lama yang di-`display:none`

Cari CSS/inline style yang menyembunyikan tombol WP / Rekam / Ukur. Hapus `display:none` tersebut — tombol sekarang diatur oleh Mode Simpel / Mode Pro. Kalau kamu ingin tetap memakai tombol lama, cukup buang tombol `bwk-pro-only` yang sepadan dari `maps-ui.js`.

---

## 8. Verifikasi

```bash
node scripts/check-index.mjs        # harus 0 masalah fatal
python3 -m http.server 8080         # buka http://localhost:8080
```
Cek di DevTools:
- Console bersih dari error `[Maps]`
- Application → IndexedDB: muncul `bwk-tiles-db` dan `bwk-data-db`
- Matikan jaringan (Offline) lalu reload: peta area yang sudah diunduh tetap tampil
