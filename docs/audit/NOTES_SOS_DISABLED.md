# Catatan: Menonaktifkan Fitur SOS

## Masalah
- HP baterai rendah (14% atau kurang)
- GPS sering gagal dikunci (error: "GPS belum terkunci")
- SOS kirim tidak masuk ke dashboard admin
- SOS dari perangkat lain tidak masuk/notifikasi tidak berbunyi
- Battery drain terlalu cepat karena polling GPS terus-menerus

## Solusi: Matikan Pemantauan SOS Sementara

### Opsi 1: Nonaktifkan via Code (Rekomendasi)

Edit file `index.html` baris ~2970, **hapus/komentari** baris ini:

```html
<!-- HAPUS BARIS INI -->
<script src="sos.js"></script>
```

Dan juga hapus modul-modul SOS di atasnya:
```html
<!-- HAPUS SEMUA BARIS INI -->
<link rel="stylesheet" href="sos-ui.css">
<script>window.BWK_SOS_RADIUS_M = 20000;</script>
<script src="sos-pluscode.js"></script>
<script src="sos-context.js"></script>
<script src="sos-auth.js"></script>
<script src="sos-outbox.js"></script>
<script src="sos-relay.js"></script>
```

**Hasil:** Aplikasi tetap berjalan normal, tapi tidak ada polling SOS dan tidak ada alarm.

### Opsi 2: Matikan Service Worker

Buka DevTools (F12) → Application → Service Workers → Unregister.

Atau buka HP dalam mode pesawat sebentar, lalu matikan lagi.

### Opsi 3: Clear App Data/Cache

Settings → Apps → Browser → Clear Cache.

Ini akan menghapus service worker dan memaksa reload fresh.

## Kapan Mengaktifkan Kembali?

Saat baterai sudah >30%, aktifkan kembali dengan:

1. Kembalikan baris script SOS di `index.html`
2. Hard refresh (Ctrl+Shift+R atau clear cache browser)
3. Biarkan aplikasi terbuka 2-3 menit agar GPS terkunci
4. Cek dashboard admin → harus muncul "Pemantauan SOS: OK"

## Troubleshooting Baterai Rendah

Jika HP baterai <20% dan butuh SOS:
- Gunakan tombol **WhatsApp darurat** saja (tanpa GPS)
- Tombol SOS di panel kiri atas masih bisa diakses
- Koordinat akan diisi manual atau kosong

## Catatan Teknis

| Fitur | Dampak Baterai | Keterangan |
|-------|---------------|------------|
| GPS polling tiap 30dtk | Tinggi | Penyebab utama drain |
| Service Worker push | Sedang | Tetap jalan walau tab tutup |
| Audio alarm | Rendah | Hanya bunyi jika ada SOS |
| IndexedDB queue | Minimal | Tidak pakai baterai |

## Checklist Sebelum Deploy Ulang

Setelah baterai cukup:
- [ ] Kembalikan script SOS di index.html
- [ ] Commit & push ke GitHub
- [ ] Vercel auto-deploy
- [ ] Hard refresh di HP
- [ ] Test kirim SOS → cek dashboard admin
- [ ] Test terima SOS dari HP lain → cek alarm berbunyi
