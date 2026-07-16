# Bawakaraeng Hub — Versi Online (dengan API Pemerintah)

Paket ini membuat aplikasi kamu **online** dan menariknya **data resmi pemerintah**:

- 🌦️ **Cuaca & Gempa** dari **BMKG** (`data.bmkg.go.id` / `api.bmkg.go.id`)
- 🔥 **Titik panas / hotspot kebakaran** di sekitar Gunung Bawakaraeng (default NASA FIRMS/VIIRS — sumber yang juga dipakai SIPONGI-KLHK)

Data ini muncul otomatis di tab **Pantau Pohon** (kartu "Data Langsung" + titik api merah di peta). Kalau API/koneksi gagal, aplikasi tetap jalan memakai data statis (fallback aman).

---

## Struktur folder

```
bawakaraeng-online/
├── index.html        # aplikasi (sudah berisi kode integrasi + fallback)
├── api/
│   ├── bmkg.js       # proxy cuaca + gempa BMKG
│   └── hotspot.js    # proxy titik panas (NASA FIRMS / bisa diganti SIPONGI)
└── vercel.json
```

> Kenapa perlu "proxy"? Browser tidak boleh memanggil API pemerintah langsung (aturan CORS). Fungsi di folder `api/` berjalan di server (Vercel) dan meneruskan data ke aplikasi.

---

## Cara deploy (gratis, ~10 menit)

### Opsi A — via GitHub + Vercel (paling mudah)
1. Buat akun gratis di **https://vercel.com** (login pakai GitHub).
2. Upload folder `bawakaraeng-online` ke sebuah repository GitHub.
3. Di Vercel: **Add New → Project → Import** repo tersebut → **Deploy**.
4. Selesai. Aplikasi live di `https://<nama-proyek>.vercel.app`.

### Opsi B — via Vercel CLI
```bash
npm i -g vercel
cd bawakaraeng-online
vercel        # ikuti prompt, pilih deploy
vercel --prod # untuk rilis produksi
```

---

## Environment Variables (diisi di dashboard Vercel → Settings → Environment Variables)

| Nama | Wajib? | Isi |
|------|--------|-----|
| `FIRMS_MAP_KEY` | untuk hotspot | MAP KEY gratis dari https://firms.modaps.eosdis.nasa.gov/api/ |
| `BMKG_ADM4` | opsional | Kode wilayah (adm4) desa/kelurahan terdekat Bawakaraeng (Kab. Gowa). Default sudah diisi contoh. |

Setelah menambah/mengubah env var, lakukan **Redeploy**.

---

## Menguji API
Setelah live, buka di browser:
- `https://<proyek>.vercel.app/api/bmkg` → harus muncul JSON cuaca + gempa
- `https://<proyek>.vercel.app/api/hotspot` → JSON daftar titik panas

Aplikasi otomatis memanggil `/api/bmkg` dan `/api/hotspot` di domain yang sama, jadi tidak perlu konfigurasi tambahan. (Kalau API kamu taruh di domain berbeda, ubah `window.API_BASE` di bagian bawah `index.html`.)

---

## Menyesuaikan / catatan penting
- **Kode wilayah cuaca BMKG**: cari kode adm4 desa terdekat Bawakaraeng, lalu set `BMKG_ADM4`. Pemetaan field JSON BMKG bisa berubah sewaktu-waktu — sesuaikan di `api/bmkg.js` bila perlu.
- **Ganti ke sumber resmi Indonesia (SIPONGI-KLHK)**: ganti blok `fetch(...)` di `api/hotspot.js` dengan endpoint SIPONGI (format GeoJSON/JSON) setelah akses/token diperoleh. Struktur output (`{hotspots:[{lat,lng,date,conf}]}`) dipertahankan agar aplikasi tidak perlu diubah.
- **Sumber pemerintah lain** yang mudah ditambah dengan pola proxy yang sama: InaRISK-BNPB (indeks risiko), BPS (statistik kehutanan), Badan Informasi Geospasial (basemap RBI), Satu Data Indonesia.

---

## Lanjut ke Play Store
Setelah online:
1. Jadikan **PWA** (tambah `manifest.json` + service worker + ikon).
2. Bungkus jadi APK/AAB dengan **PWABuilder** (https://www.pwabuilder.com) atau **Bubblewrap**.
3. Upload AAB ke **Google Play Console** (biaya daftar sekali ~$25). Siapkan ikon, screenshot, privacy policy, dan data safety.
