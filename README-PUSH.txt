PATCH LIVE TRACKING + PESAN DI PETA

1. WAJIB jalankan SQL ini satu kali di Supabase SQL Editor:
   supabase/migrations/002_tracking_message.sql

2. Setelah SQL sukses, push/timpa file:
   - index.html
   - tracker.html
   - tracking-plus.js
   - tracking-sos.js
   - tracking-message-owner.js
   - tracking-message-viewer.js
   - api/tracking.js

3. Jangan ubah/hapus file SOS lama aplikasi.
4. Deploy lalu hard refresh browser.

Pesan maksimal 120 karakter. Hanya pemilik sesi aktif yang bisa memperbarui pesan.
