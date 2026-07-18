# Perubahan v18 — Lensa Bawakaraeng AI (pengganti Google Lens)

- Lensa Bawakaraeng kini mengidentifikasi flora/fauna LANGSUNG di dalam aplikasi memakai AI (Gemini Vision), tidak lagi bergantung membuka Google Lens.
- Tombol berubah menjadi "Kenali Spesies (AI)". Hasil (nama umum, nama ilmiah, kategori, tingkat keyakinan, deskripsi, peringatan bahaya, tips) tampil sebagai kartu di dalam kartu Lensa.
- Tombol "Cari di Ensiklopedia" untuk membandingkan hasil dengan data lokal.
- Foto dikecilkan otomatis (maks 768px, JPEG 0.72) sebelum dikirim agar ringan & hemat kuota.
- Endpoint server baru: api/identify.js (aman, kunci Gemini tetap di server; butuh login + rate limit).
- Tautan "buka Google Lens" tetap tersedia sebagai cadangan manual bila AI tidak tersedia.
- Panduan (PANDUAN.html) diperbarui. Cache SW: bwk-v36-lensai.

## Catatan deploy
- Tidak ada env baru: memakai GEMINI_API_KEY, GEMINI_MODEL, SUPABASE_URL, SUPABASE_ANON_KEY yang sudah ada.
- Fitur perlu login (akun terverifikasi Supabase) & internet.
