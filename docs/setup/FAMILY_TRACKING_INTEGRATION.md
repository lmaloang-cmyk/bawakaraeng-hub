# Family Tracking - Integrasi Pintu Angin

## Perubahan yang dilakukan:

### 1. API Serverless (api/tracking.js)
- Didaftarkan di `vercel.json` dengan maxDuration 15 detik
- Endpoint: `/api/tracking?act=create|stop|positions|status|latest|history|share|extend|list`
- Pemisah login Google (owner) vs token share (family viewer)

### 2. Halaman Tracker (tracker.html)
- Standalone HTML page untuk keluarga memantau lokasi pendaki
- Menggunakan Leaflet + OpenStreetMap
- Refresh otomatis tiap 20 detik
- Tampilan: peta, koordinat, akurasi, baterai, kecepatan, sisa waktu sesi

### 3. Integrasi Menu (index.html)
- Tombol "LACAK KELUARGA" ditambahkan di grid home actions
- Membuka `/tracker.html` di tab baru (`target="_blank"`)
- Tidak mengganggu namespace atau event listener SOS

### 4. Service Worker (sw.js)
- Menambahkan `/tracker.html` dan `/family-tracking.js` ke pre-cache
- Tracker tetap bisa diakses offline setelah pertama kali dibuka

## Cara Kerja:

1. **Pendaki** membuka Pintu Angin → klik "Lacak Keluarga" → klik "Buat Sesi"
2. Sistem membuat sesi tracking + generate share token
3. Link share dibagikan ke keluarga (WhatsApp/teks)
4. **Keluarga** buka link → tracker.html → lihat posisi pendaki real-time

## Setup Database (Supabase):

Jalankan SQL berikut di Supabase SQL Editor:
```sql
-- Copy dari file: supabase/migrations/001_family_tracking.sql
```

## Environment Variables (Vercel/Supabase):

Pastikan ter-set:
- `SUPABASE_URL`: `https://ncoueeeskzslldppsbvx.supabase.co`
- `SUPABASE_ANON_KEY`: [dari Project Settings > API]
- `SUPABASE_SERVICE_ROLE`: [dari Project Settings > API]
- `APP_ORIGIN`: `https://www.pintuangin.my.id`

## Status SOS: TETAP AMAN ✅

Family tracking berjalan **terpisah 100%**:
- Tidak ada JS injection ke index.html
- Tidak ada event listener baru
- Tidak ada overlap namespace dengan sos.js
- Tabel database terpisah: `tracking_*` vs `sos_alerts`

---
*Integrasi selesai 2026-08-28*
