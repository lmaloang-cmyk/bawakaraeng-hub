# Family Tracking - Setup Instructions

## Langkah 1: Buat Tabel di Supabase

1. Buka [https://supabase.com/dashboard/project/ncoueeeskzslldppsbvx](https://supabase.com/dashboard/project/ncoueeeskzslldppsbvx)
2. Klik **SQL Editor** di sidebar kiri
3. Copy paste isi file `supabase/migrations/001_family_tracking.sql` di atas
4. Klik **Run**

## Langkah 2: Verifikasi Tabel

Setelah menjalankan SQL, pastikan tabel berikut ada:
- `tracking_sessions`
- `tracking_positions`
- `tracking_share_tokens`

## Langkah 3: Testing

Coba buat sesi tracking baru dari aplikasi. Jika berhasil, Anda akan melihat:
```json
{
  "ok": true,
  "session": { "id": "...", "name": "...", ... },
  "token": "..."
}
```

## Troubleshooting

### Error: "Gagal membuat sesi" / 502 Bad Gateway
- Pastikan tabel sudah dibuat (lihat Langkah 1)
- Pastikan env var berikut ter-set di Supabase Dashboard > Settings > Environment Variables:
  - `SUPABASE_URL`: `https://ncoueeeskzslldppsbvx.supabase.co`
  - `SUPABASE_ANON_KEY`: [ambil dari Project Settings > API]
  - `SUPABASE_SERVICE_ROLE`: [ambil dari Project Settings > API]
  - `APP_ORIGIN`: `https://www.pintuangin.my.id`

### Error: "Login diperlukan"
- User belum login dengan Google
- Token expired? Coba logout dan login ulang

### Error: "Origin tidak diizinkan"
- Tambahkan origin ke env var `ALLOWED_ORIGINS`:
  - `https://www.pintuangin.my.id,https://pintu-angin.vercel.app`
