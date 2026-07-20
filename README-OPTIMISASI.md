# Pintu Angin — Versi Optimasi untuk HP & Server Gratisan

File ini menjelaskan perubahan yang dilakukan dari versi asli (`Pintu-Angin-v18.8.5-TOMBOL-KAPITAL.zip`) agar lebih ringan dan hemat saat diakses dari ponsel entry-level serta di-deploy di server gratis (Vercel free tier).

## Ringkasan perubahan

| Aspek | Sebelum | Sesudah | Manfaat |
|---|---|---|---|
| Ukuran ZIP | 6.3 MB | 4.1 MB | ~35% lebih kecil, unduh & deploy lebih cepat |
| CSS | 118 KB inline di `index.html` | file terpisah `styles.css` (bisa di-cache browser) | HTML lebih kecil, CSS tidak diunduh ulang setiap kali HTML berubah |
| Gambar logo | `rc-logo.png` 848 KB | `rc-logo.webp` 104 KB | ~88% lebih kecil, muat beranda jauh lebih cepat |
| Gambar lain | PNG/JPG besar | dikompresi (lihat tabel di bawah) | mengurangi data dan waktu muat |
| Service Worker | cache minimalis | cache lebih lengkap + stale-while-revalidate | PWA lebih responsif, hemat kuota |
| Gambar HTML | tidak lazy | non-kritis pakai `loading="lazy"` | mengurangi jumlah request awal |
| Resource hints | tidak ada | `preconnect` & `dns-prefetch` ke CDN Supabase | koneksi lebih cepat |
| Animasi | banyak glow/pulse/neon | dihapus untuk mode `perf-lite` dan `prefers-reduced-motion` | lebih halus di HP murah & hemat baterai |
| API AI Pendamping | 1 model, timeout 12 s, no retry | multi-model fallback, timeout 10 s, retry | jarang gagal total, jadi tetap ada jawaban |
| API Lensa Bawakaraeng | 1 model, timeout 20 s, no retry | multi-model fallback, timeout 12 s, retry | identifikasi lebih stabil |
| Client chat AI | timeout 14 s, langsung fallback | retry 1× + timeout 11 s, baru fallback | user tidak merasa putus |

## Gambar yang sudah dikompresi

| File | Ukuran lama | Ukuran baru | Format |
|---|---|---|---|
| `rc-logo.png` | 848 KB | 104 KB | WebP |
| `rc-logo.jpg` | 227 KB | 116 KB | JPG (ditinggal, tidak dipakai HTML) |
| `og.jpg` | 106 KB | 64 KB | JPG |
| `icon-512.png` | 261 KB | 88 KB | PNG 8-bit |
| `icon-192.png` | 45 KB | 16 KB | PNG 8-bit |
| `apple-touch-icon.png` | 40 KB | 16 KB | PNG 8-bit |
| `qris-gopay.png` | 57 KB | 52 KB | PNG 8-bit |
| `screenshots/home-mobile.png` | 147 KB | 52 KB | PNG 8-bit |
| `screenshots/home-wide.png` | 180 KB | 92 KB | PNG 8-bit |
| `guide-assets/01-login.png` | 137 KB | 40 KB | PNG 8-bit |
| `guide-assets/02-guest-home.png` | 152 KB | 52 KB | PNG 8-bit |
| `guide-assets/03-login-gate.png` | 111 KB | 40 KB | PNG 8-bit |
| `guide-assets/04-ai-pendamping.png` | 62 KB | 24 KB | PNG 8-bit |

## Catatan penting

- **JavaScript tetap inline** di `index.html` untuk menghindari risiko merusak fungsi yang kompleks (chat, SIMAKSI, SOS, lensa, dll). Jika ingin memisahkan JS juga, disarankan memakai bundler (Vite/webpack) agar urutan dan escape string tetap benar.
- **Semua fungsi asli dipertahankan**: laporan, SIMAKSI, adopsi, donasi, SOS, kompas, peta, leaderboard, AI pendamping, admin, dll.
- **Service worker** sekarang meng-cache CSS, ikon, SVG, dan JS eksternal (`sk.js`, `sos.js`, `chat.js`, `hike.js`, `lens-extras.js`) dengan strategi stale-while-revalidate untuk asset statis.
- **Mode `perf-lite`** otomatis aktif saat deteksi `saveData`, RAM ≤ 4 GB, atau CPU core ≤ 4. Mode ini menonaktifkan animasi berat untuk mengurangi jank di HP entry-level.
- **Lazy loading** diterapkan pada gambar non-kritis; gambar logo/hero/ik tetap di-prioritaskan.

## Cara deploy

1. Unzip `Pintu-Angin-optimized.zip`.
2. Import ke GitHub atau drag-and-drop ke Vercel.
3. Pastikan environment variables (Supabase URL/key, Gemini API key, FIRMS key, dsb.) sudah diisi.
4. Redeploy.

Selamat mencoba.
