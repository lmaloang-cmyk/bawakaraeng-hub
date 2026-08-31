# Pintu Angin — Bawakaraeng Hub

PWA (Progressive Web App) untuk pemantauan dan keselamatan pendakian **Gunung Bawakaraeng** bersama RCS.CBS. Satu file `index.html` berisi seluruh aplikasi frontend, didukung serverless functions di `api/` dan database Supabase.

## Fitur utama

- **Pantau kondisi** — cuaca & gempa dari BMKG, titik panas kebakaran dari NASA FIRMS (via proxy `api/` karena CORS)
- **SOS & keselamatan** — tombol darurat tetap terbuka tanpa login, notifikasi Web Push, relay ke ranger
- **Live tracking** — pelacakan lokasi pendaki real-time (`tracker.html`) dengan family tracking
- **Peta jalur** — peta jalur pendakian (Leaflet, dengan cadangan offline)
- **AI Pendamping** — panduan lokal berbasis Google Gemini dengan fallback multi-provider
- **Konservasi** — adopsi pohon, donasi via QRIS, jurnal pendakian

## Struktur repo

```
├── index.html          # Aplikasi utama (SPA)
├── tracker.html        # Halaman live tracking
├── PANDUAN.html        # Panduan penggunaan
├── dont-panic.html     # Game ringan di menu SOS
├── sos-diag.html       # Halaman diagnostik SOS
├── *.js / *.css        # Modul frontend (dimuat index.html & tracker.html)
├── manifest.json       # Manifest PWA
├── sw.js               # Service worker
├── api/                # Serverless functions Vercel (backend)
├── lib/                # Modul bersama untuk api/ (security, ops)
├── supabase/
│   ├── migrations/     # Migrasi bernomor (001, 002, ...)
│   └── manual/         # Skrip SQL ad-hoc yang dijalankan manual
├── scripts/            # Script pemeriksa kualitas (node)
├── guide-assets/       # Gambar untuk PANDUAN.html
├── screenshots/        # Screenshot PWA (direferensikan manifest.json)
├── history/            # Catatan riwayat pengembangan
└── docs/
    ├── changelog/      # Catatan perubahan per versi (PERUBAHAN-v*.md)
    ├── patches/        # Catatan patch teknis
    ├── audit/          # Laporan audit, isu, dan bugfix
    └── setup/          # Panduan setup fitur (tracking, deploy, optimasi)
```

## Deploy (Vercel)

1. Import repo ini di [Vercel](https://vercel.com) → **Deploy** (zero-config, `vercel.json` sudah disediakan).
2. Isi environment variables di **Settings → Environment Variables** — lihat daftar lengkap di [`.env.example`](.env.example).
3. Redeploy setelah mengubah env var.

Push ke branch `main` akan otomatis deploy produksi via GitHub Actions (`.github/workflows/deploy.yml`).

## Environment variables

Semua variabel beserta penjelasannya ada di [`.env.example`](.env.example). Yang wajib diisi agar semua fitur jalan: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `FIRMS_MAP_KEY`, `VAPID_PUBLIC`/`VAPID_PRIVATE`.

## Memeriksa kualitas kode

Sebelum commit/deploy, jalankan pemeriksa bawaan:

```bash
node scripts/check-index.mjs      # validasi index.html (referensi file, sintaks inline)
node scripts/check-sos.mjs        # validasi modul SOS
node scripts/check-encoding.mjs   # deteksi masalah encoding
```

## Catatan kontribusi

- **Jangan upload file lewat web GitHub** — gunakan `git add/commit/push` agar tidak muncul duplikat `file (2).js` (pola ini sudah di-ignore di `.gitignore`).
- Skrip SQL manual diletakkan di `supabase/manual/`; migrasi resmi di `supabase/migrations/`.
- Catatan pengembangan lama tersimpan di `docs/` dan `history/`.
