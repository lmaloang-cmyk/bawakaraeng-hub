OPTIMASI LIVE TRACKING RELIABLE

Push/timpa semua file dalam paket sesuai struktur. Tidak ada SQL baru.

Peningkatan utama:
- Heartbeat posisi+baterai foreground setiap 30 detik.
- Antrean lokal maksimal 100 titik saat offline/gagal server.
- Antrean dikirim ulang saat internet kembali, maksimal 10 titik per batch.
- Waktu asli rekaman GPS dipertahankan saat antrean dikirim.
- GPS watchdog me-restart pemantauan jika tidak ada fix >90 detik.
- Status kecil menunjukkan live, akurasi, baterai, offline, atau antrean.
- Sesi tetap pulih setelah refresh.
- Celah GPS tetap ditandai dan tidak disambung palsu.
- Sanitasi note/device pada tracker.

Setelah deploy: hard refresh atau tutup-buka PWA.
