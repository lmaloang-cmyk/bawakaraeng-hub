# Pintu Angin — Deploy Operasi Keselamatan

Pembaruan ini mencakup:
- SOS aman: pengguna harus login Google; server membatasi SOS ganda dan hanya membagikan lokasi kepada pendaki dalam radius 20 km.
- Dashboard Petugas: SOS aktif, penanganan, riwayat, dan check-in terakhir.
- QR SIMAKSI: payload izin baku dan pemeriksaan kode oleh petugas.
- Check-in Pos: tersimpan lokal saat offline, dikirim otomatis ketika internet kembali.

## 1. SQL Supabase
Di **Supabase → SQL Editor**, jalankan berurutan:
1. `supabase-push.sql` (bila belum pernah)
2. `supabase-sos.sql`
3. `supabase-operations.sql`

Jangan gunakan lagi SQL SOS versi lama yang memberi policy `sos_select_all`, `sos_insert_all`, atau `sos_update_all`.

## 2. Environment Variables Vercel
Masukkan pada Vercel → Project → Settings → Environment Variables:

| Nama | Keterangan |
|---|---|
| `SUPABASE_URL` | URL proyek Supabase, misalnya `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Publishable/anon key Supabase |
| `SUPABASE_SERVICE_ROLE` | service_role key Supabase — rahasia, hanya di Vercel |
| `ADMIN_EMAILS` | Email petugas dipisahkan koma, misalnya `admin1@gmail.com,admin2@gmail.com` |
| `VAPID_PUBLIC` | Kunci push publik yang sudah dibuat |
| `VAPID_PRIVATE` | Kunci push privat — rahasia |
| `VAPID_SUBJECT` | Misalnya `mailto:sos@domain-anda` |

## 3. Deploy dan pengujian
1. Deploy isi zip ke Vercel/GitHub.
2. Login Google pada dua HP.
3. Aktifkan notifikasi SOS pada HP penerima.
4. Buat SOS dari HP pertama. HP pertama melihat tombol **Saya Aman**; HP kedua menerima alarm/push bila dalam radius.
5. Login memakai email di `ADMIN_EMAILS`, buka Panel Admin → **🆘 Operasi**.
6. Tekan **Tangani** untuk menyelesaikan SOS; uji check-in dari halaman Peta Jalur saat offline lalu sambungkan internet.

## Catatan operasional
- Pastikan daftar pos dan SOP evakuasi diverifikasi pengelola sebelum operasi lapangan.
- QR SIMAKSI dipakai bersama kode pengajuan dan pemeriksaan pada dashboard petugas; QR bukan pengganti verifikasi identitas petugas.
