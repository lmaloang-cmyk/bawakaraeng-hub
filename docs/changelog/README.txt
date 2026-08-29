Push/timpa file:
- index.html
- tracker.html
- sw.js
- tracking-live-recovery.js (baru)
- tracking-session-resume.js

Perubahan:
- GPS langsung meminta titik baru ketika layar/aplikasi aktif kembali.
- Heartbeat foreground tiap 30 detik mengirim posisi dan baterai terbaru.
- Jejak tidak disambungkan palsu melewati periode GPS hilang.
- Titik merah = lokasi terakhir sebelum GPS/sinyal hilang.
- Titik biru = lokasi pertama saat GPS tersambung lagi.
- Tooltip menunjukkan durasi jeda.

Setelah deploy lakukan hard refresh/tutup-buka PWA.
