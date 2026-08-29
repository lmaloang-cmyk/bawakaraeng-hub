# Pintu Angin v13 — AI Pendamping

- Menambahkan AI Pendamping sebagai tab utama pada fitur percakapan.
- Mode lokal gratis menjawab keselamatan, cuaca, SIMAKSI, jalur, perlengkapan, pelaporan, dan konservasi.
- Menambahkan endpoint `/api/ai.js` untuk Gemini melalui environment variable `GEMINI_API_KEY`.
- Jika Gemini belum dikonfigurasi, kuota habis, atau jaringan gagal, jawaban otomatis memakai panduan lokal.
- Riwayat AI disimpan lokal di perangkat, maksimal 40 pesan.
- Pertanyaan dibatasi 600 karakter dan jawaban Gemini dibatasi 420 token.
- Instruksi keselamatan mencegah AI mengarang status jalur, cuaca, izin, atau informasi darurat.
- Versi dan cache PWA diperbarui ke v13.
