# Perubahan v19 — Alarm TTS + Leaderboard Fix

## 1. Alarm SOS (Text-to-Speech Wanita)
- Suara alarm berubah dari beep elektronik ke TTS: **"SOS! SOS! Help! Help!"**
- Suara wanita dengan pitch 1.3 (lebih tinggi) dan rate 0.85 (lebih lambat/jelas)
- Retry mechanism untuk Android WebView (voices dimuat asinkron)
- Cache service worker update: v75 → v76-tts-sos-fix
**File:** `sos.js`, `sw.js`

## 2. Leaderboard Global
- Perbaiki query Supabase: hapus chaining `.order()` ganda (tidak valid)
- Tambah client-side `.sort()` untuk sorting yang benar
- Auto-refresh tiap 30 detik agar skor terbaru selalu muncul
- Select `updated_at` untuk tie-breaker sorting
**File:** `dont-panic.html`

## 3. Bug Fix SOS (perbaikan sebelumnya)
- Logout sekarang membersihkan semua data SOS (`bwkDev`, `bwkSosQueue`, dll)
- Load-time check: hapus antrian SOS offline kalau user belum login Google
- `_seen` flag tidak di-set过早 — tunggu user benar-benar melihat alarm
- Tambah `_markAllSeen()` untuk marking setelah user interaksi
**File:** `index.html`, `sos.js`

## Catatan Deploy
- Clear cache di Android: Settings → Apps → Bawakaraeng → Storage → Clear Data
- Atau uninstall & install ulang untuk memastikan cache baru terbaca
- Leaderboard butuh koneksi internet untuk auto-refresh

---
*Update: 12 Agustus 2026*
