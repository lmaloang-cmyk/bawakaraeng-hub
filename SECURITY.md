# Keamanan Bawakaraeng Hub v16

## Sudah aktif di kode
- Security headers Vercel: CSP, HSTS, anti-frame, nosniff, referrer, permissions policy.
- API hanya menerima origin resmi/sama-origin; atur `APP_ORIGIN` atau `ALLOWED_ORIGINS` di Vercel.
- Rate limit dasar pada AI, BMKG, dan hotspot.
- AI cloud hanya menerima token pengguna Supabase yang valid.
- Batas payload, timeout upstream, respons error tanpa membocorkan detail internal.
- Validasi kode wilayah BMKG, bbox hotspot, jumlah hari, dan ukuran respons.
- Validasi foto laporan: JPEG/PNG/WebP, maksimum 5 MB, lalu dikompresi.
- Pembersihan dan pembatasan panjang input pengguna.
- Chat membutuhkan akun terautentikasi dan memiliki jeda anti-spam pada klien.
- Mode tamu dan SOS tetap bekerja.

## Wajib dilakukan saat deploy
1. Buka Supabase → SQL Editor.
2. Jalankan seluruh isi `supabase-security.sql`.
3. Pastikan tabel `reports`, `simaksi`, `jurnal`, dan `messages` memiliki kolom `user_id uuid`.
4. Tambahkan environment variables Vercel:
   - `APP_ORIGIN=https://domain-resmi-anda`
   - `SUPABASE_URL=https://ncoueeeskzslldppsbvx.supabase.co`
   - `SUPABASE_ANON_KEY=publishable-key`
   - `GEMINI_API_KEY=...`
   - `FIRMS_MAP_KEY=...` (opsional)
5. Deploy ulang dan uji akun biasa, akun admin, serta mode tamu.

## Catatan
Rate limit memori serverless adalah lapisan dasar. Untuk trafik besar, gunakan penyimpanan terdistribusi seperti Vercel KV/Upstash. Publishable/anon key Supabase boleh berada di frontend; service-role key tidak boleh berada di ZIP atau browser.
