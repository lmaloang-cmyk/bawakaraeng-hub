# Paket Perbaikan MAPS Pintu Angin

Hasil audit 23 Agustus 2026 untuk `lmaloang-cmyk/bawakaraeng-hub`.
Semua file di sini siap kamu salin ke repo lalu push manual — tidak ada yang menimpa `index.html` atau `sw.js`.

## Isi paket

| File | Fungsi | Aksi |
|---|---|---|
| `maps-storage.js` | IndexedDB untuk track/waypoint + outbox kirim-nanti + manajemen kuota | salin ke root repo |
| `maps-offline.js` | Unduh & baca tile offline: AbortController, timeout, retry, batal, layer offline-first | salin ke root repo |
| `maps-safety.js` | Alarm keluar jalur, checkpoint, ETA, wake lock, error boundary GPS, ekspor GPX | salin ke root repo |
| `maps-ui.js` | Mode Simpel / Mode Pro, onboarding 3 langkah, panel unduh peta, bar status | salin ke root repo |
| `maps-ui.css` | Tampilan tombol besar, panel, mode malam | salin ke root repo |
| `scripts/check-index.mjs` | Validator: konflik merge, sintaks `<script>` inline, fungsi ganda, layer tak dikenal, aset hilang | salin ke `scripts/` |
| `.github/workflows/validate.yml` | CI yang menjalankan validator tiap push | salin ke `.github/workflows/` |
| `PATCH-index.html.md` | Langkah cari-ganti untuk `index.html` | ikuti manual |
| `PATCH-sw.js.md` | Langkah untuk `sw.js` + `vercel.json` | ikuti manual |
| `ISSUES.md` | 11 temuan siap tempel jadi GitHub Issue | salin per bagian |
| `AUDIT-MAPS-PINTU-ANGIN.md` | Laporan audit lengkap + roadmap | simpan di repo (opsional) |

## Urutan pemasangan

```bash
cd bawakaraeng-hub
git checkout -b fix/maps-offline-kit

# 1) salin file baru
cp /path/paket/maps-*.js /path/paket/maps-ui.css .
mkdir -p scripts .github/workflows
cp /path/paket/scripts/check-index.mjs scripts/
cp /path/paket/.github/workflows/validate.yml .github/workflows/
cp /path/paket/AUDIT-MAPS-PINTU-ANGIN.md .

# 2) patch manual
#    ikuti PATCH-index.html.md lalu PATCH-sw.js.md

# 3) validasi sebelum commit
node scripts/check-index.mjs
for f in maps-*.js; do node --check "$f"; done
git ls-files -s sw.js     # harus 100644

# 4) uji lokal
python3 -m http.server 8080

# 5) push
git add -A
git commit -m "fix(maps): perbaikan P0 layer default, downloader offline, UI pemula"
git push -u origin fix/maps-offline-kit
```

Urutan `<script>` di `index.html` wajib: `maps-storage.js` → `maps-offline.js` → `maps-safety.js` → `maps-ui.js`.

## Prinsip yang dipakai paket ini

- **Tidak merusak yang sudah jalan.** Semua kode baru berada di namespace `BWK*` dan database IndexedDB terpisah (`bwk-data-db`, `bwk-tiles-db`), sehingga `bwk-maps-db` lama beserta datanya tidak tersentuh.
- **Gagal dengan anggun.** Kalau salah satu modul tidak dimuat, peta lama tetap berfungsi seperti sebelumnya.
- **Bahasa manusia.** Setiap error GPS/penyimpanan/jaringan diterjemahkan jadi kalimat yang bisa ditindaklanjuti pendaki, bukan kode error.
- **Hormati penyedia peta.** Unduh massal diblokir untuk sumber yang melarangnya; cache oportunistik tetap jalan.

## Checklist verifikasi setelah deploy

- [ ] Peta terbuka tanpa error di console (termasuk pengguna lama yang pernah memilih layer `topo`)
- [ ] DevTools → Application → Service Workers: `sw.js` terdaftar & aktif
- [ ] IndexedDB berisi `bwk-tiles-db` setelah unduh area
- [ ] Mode pesawat: peta area terunduh tetap tampil
- [ ] Tombol “Mulai Jalur” memberi peringatan saat menjauh > 50 m dari jalur
- [ ] Check-in saat offline masuk antrean dan terkirim otomatis saat online
- [ ] Mode Simpel menampilkan 4 tombol, Mode Pro menampilkan 8
- [ ] CI `Validasi MAPS` hijau

## Catatan

Issue di GitHub belum dibuat karena token yang terhubung tidak punya izin tulis Issues (`403 Resource not accessible by personal access token`). Isinya sudah disiapkan di `ISSUES.md` — tinggal salin-tempel, atau beri izin **Issues: Read and write** pada token lalu minta dibuatkan otomatis.
