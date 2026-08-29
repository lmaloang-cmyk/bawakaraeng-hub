# 16 GitHub Issue siap tempel — fungsi SOS

Setiap blok di bawah = satu issue. Judul di baris `##`, sisanya badan issue.
Label yang perlu dibuat lebih dulu: `P0`, `P1`, `P2`, `sos`, `offline`, `keamanan`,
`aksesibilitas`, `server`, `pwa`.

---

## [P0][sos] Antrean SOS offline menggandakan diri dan tidak pernah dibersihkan

**Berkas:** `ops.js`
**Label:** `P0`, `sos`, `offline`

### Masalah
Tiga cacat menumpuk pada antrean `bwkSosQueue`:

1. `_sosQueueDequeue()` mengembalikan `q[q.length-1]` tanpa menghapusnya dari antrean.
2. Pada jalur sukses, `_syncSosQueue` hanya memanggil `toastx(...)` lalu `return`.
   `_sosQueueRemove()` tidak pernah dipanggil di mana pun dalam berkas.
3. Pada jalur gagal, `_sosQueueEnqueue(item.payload)` menambah salinan baru
   alih-alih mengembalikan item yang sama.

### Dampak
Satu SOS di area sinyal buruk dapat menjadi puluhan baris `sos_alerts` duplikat,
memicu puluhan gelombang push ke semua pendaki dalam radius 20 km, sekaligus
menghabiskan kuota rate limit korban sehingga SOS berikutnya ditolak 429.

### Perbaikan
Ganti seluruh antrean dengan `sos-outbox.js` (IndexedDB + Background Sync,
dedup `client_id`, backoff berjenjang, batas 30 percobaan / 5,8 jam).
Lihat `PATCH-ops.js.md`.

### Cara memverifikasi
1. Aktifkan mode pesawat, tekan SOS, tunggu 2 menit.
2. Matikan mode pesawat.
3. Harus muncul **tepat satu** baris di `sos_alerts`.
4. `await BWKSosOutbox.count()` harus `0`.

---

## [P0][sos] SOS tidak bisa dikirim sama sekali bila belum login Google

**Berkas:** `ops.js`
**Label:** `P0`, `sos`

### Masalah
```js
var u=user(); if(!u||!u.google){ toastx('Masuk dengan Google diperlukan...'); return; }
```
`return` terjadi sebelum apa pun disimpan, jadi SOS tidak terkirim **dan tidak
masuk antrean**.

### Dampak
Sesi kedaluwarsa, HP pinjaman, atau belum pernah login = SOS hilang total.
Di gunung, "sesi habis + tidak ada internet untuk login ulang" adalah kondisi
normal, bukan kasus tepi.

### Perbaikan
Aktifkan Anonymous Sign-ins di Supabase dan pakai `sos-auth.js`. Server tidak
perlu diubah: `verifySupabaseUser` tetap menerima UUID yang sah.

### Cara memverifikasi
Buka aplikasi di jendela penyamaran, jangan login, tekan SOS. Harus terkirim.

---

## [P0][server] Tabel anti-dobel yang bermasalah mematikan SELURUH push SOS

**Berkas:** `api/sos-push.js`
**Label:** `P0`, `sos`, `server`

### Masalah
```js
if (!claim.ok) return res.status(503).json({ error: 'Antidobel push belum siap', code: 'NO_CLAIM' });
```
Fitur kenyamanan (anti notifikasi ganda) diberi kuasa membatalkan pengiriman
notifikasi darurat.

### Perbaikan
Jadikan fail-open: catat error, lanjutkan pengiriman. Jalankan
`supabase-sos-optimasi.sql` untuk membuat tabelnya.

### Cara memverifikasi
Ubah sementara nama tabel di Supabase, kirim SOS uji — push harus tetap sampai,
dan respons memuat `duplicateRisk: true`.

---

## [P0][sos] Alarm SOS pendaki lain terbungkam karena nama kembar

**Berkas:** `sos.js`, fungsi `_isMine`
**Label:** `P0`, `sos`

### Masalah
SOS dianggap "milik sendiri" bila nama sama + jarak < 60 m + selisih waktu < 35
menit. Nama bawaan semua pengguna adalah `'Pendaki'`.

### Dampak
Dua pendaki tanpa nama di shelter yang sama saling membungkam alarm. Gagal senyap.

### Perbaikan
Cocokkan berdasarkan `id` / `client_id` saja. Hapus pencocokan berbasis nama.

---

## [P0][pwa] `sw.js` tersimpan sebagai UTF-16 — service worker tidak pernah terpasang

**Berkas:** `sw.js`
**Label:** `P0`, `pwa`, `sos`

### Masalah
```
$ file sw.js
sw.js: Little-endian UTF-16 Unicode text, with CRLF line terminators

$ node --check sw.js
SyntaxError: Invalid or unexpected token
```

Berkas 6.256 byte, isi sebenarnya 3.072 byte — tepat dua kali lipat karena setiap
karakter ASCII disimpan dua byte dengan satu byte NUL. Spesifikasi Service Worker
mewajibkan browser mendekode skrip sebagai UTF-8, jadi berkas ini selalu gagal
parse dan `navigator.serviceWorker.register()` selalu gagal.

### Dampak
Tidak ada notifikasi push latar, tidak ada cache offline, tidak ada peta offline,
tidak ada Background Sync — sejak berkas ini terakhir disimpan dengan editor yang
salah. Gagal sepenuhnya senyap: izin notifikasi tetap bisa diberikan dan tercatat
aktif, sehingga fitur push tampak berfungsi padahal tidak pernah berjalan.

### Perbaikan
Pakai `sw.js` UTF-8 dari paket (sudah lulus `node --check`), atau:
```bash
iconv -f UTF-16LE -t UTF-8 sw.js | tr -d '\r' > sw.tmp && mv sw.tmp sw.js
```
Tambahkan `.gitattributes` dengan `* text=auto eol=lf` agar tidak terulang.

### Cara memverifikasi
```bash
file sw.js                          # harus "ASCII text" / "UTF-8 Unicode text"
node --check sw.js                  # harus lulus tanpa keluaran
node scripts/check-encoding.mjs .   # memindai seluruh repo
```
Lalu DevTools → Application → Service Workers → harus **activated and is running**.

---

## [P0][sos] Tidak ada jalur bantuan selain internet

**Label:** `P0`, `sos`, `offline`

### Masalah
Seluruh rantai SOS memerlukan HTTP. Di lapangan, data seluler mati lebih dulu,
SMS masih lewat, panggilan suara paling akhir.

### Perbaikan
Pasang `sos-relay.js`: tombol WA / SMS / telepon darurat dengan pesan terisi
lengkap (koordinat, Plus Code, baterai, data medis), plus salin-ke-papan-klip
untuk dibacakan lewat HT.

---

## [P1][sos] `SOS_RADIUS=Infinity` di klien vs `RADIUS=20000` di server

**Berkas:** `sos.js`, `api/sos-push.js`
**Label:** `P1`, `sos`

Dua sumber kebenaran: yang tampil di layar berbeda dari yang membangunkan HP.
Satukan lewat `window.BWK_SOS_RADIUS_M` dan `process.env.SOS_RADIUS_M`.

---

## [P1][server] Rate limit `sos-create` menghukum orang yang panik

**Berkas:** `api/operations.js`
**Label:** `P1`, `sos`, `server`

`'sos-create':6` per 10 menit. Tangan gemetar menekan lebih dari 6 kali → 429.
Naikkan ke 40 dan lakukan deduplikasi lewat `client_id` yang idempoten.

---

## [P1][keamanan] Rate limit hilang setiap cold start

**Berkas:** `lib/security.js`
**Label:** `P1`, `keamanan`, `server`

`globalThis.__bwkRateStore` adalah `Map` per-instance. Di Vercel batas ini tidak
berlaku global. Pindahkan ke penyimpanan bersama untuk endpoint admin — tetapi
**jangan** untuk jalur SOS.

---

## [P1][aksesibilitas] Antrean suara alarm menumpuk tanpa `speechSynthesis.cancel()`

**Berkas:** `sos.js`, `_speakSOS()`
**Label:** `P1`, `sos`, `aksesibilitas`

Dipanggil tiap 8 detik; `speechSynthesis` mengantre, tidak mengganti. Setelah 5
menit ada ~37 ucapan menumpuk dan suara terus berbunyi setelah SOS ditutup.

---

## [P1][aksesibilitas] Alarm SOS berbahasa Inggris untuk pengguna Indonesia

**Berkas:** `sos.js`
**Label:** `P1`, `sos`, `aksesibilitas`

`'SOS! SOS! Help! Help!'` → `'Darurat! Ada pendaki minta tolong di dekat kamu.'`
dengan `lang='id-ID'` dan `rate=0.95`.

---

## [P1][sos] Payload SOS tidak memuat akurasi, ketinggian, dan baterai

**Label:** `P1`, `sos`

Tim SAR tidak bisa membedakan titik dengan akurasi 8 m dan 800 m — padahal itu
menentukan luas area pencarian. Ketinggian mempersempit pencarian secara drastis
di medan bertingkat. Sisa baterai menentukan apakah korban masih bisa dihubungi.
Lihat `sos-context.js`.

---

## [P1][sos] Tidak ada data medis dan kontak keluarga

**Label:** `P1`, `sos`

Penolong tiba tanpa tahu golongan darah, alergi obat, atau siapa yang harus
dihubungi. Tambahkan Kartu Darurat offline (`sos-context.js`) dan tabel
`emergency_profiles` dengan RLS ketat.

---

## [P1][sos] SOS yang didiamkan tidak pernah dieskalasi

**Label:** `P1`, `sos`

Bila tidak ada yang menangani, SOS hanya diam di layar. Tambahkan eskalasi
bertingkat pada menit ke-5, 15, 30, dan 60 (`sos-relay.js`): tampilkan jalur
cadangan, getarkan, dan dorong gelombang push tambahan.

---

## [P2][sos] Dashboard operator hanya refresh manual

**Berkas:** `ops.js`, `opsDashboard()`
**Label:** `P2`, `sos`

Operator harus menekan tombol untuk tahu ada yang minta tolong. Supabase Realtime
sudah tersedia; `supabase-sos-optimasi.sql` sudah mendaftarkan `sos_alerts` ke
publikasi realtime.

---

## [P2][sos] Nomor WhatsApp cadangan ditulis langsung di kode

**Label:** `P2`, `sos`

`6282320124040` ada di dalam kode. Ganti penanggung jawab = ubah kode + deploy
ulang. Pindahkan ke konfigurasi (env atau tabel Supabase) dan izinkan daftar
lebih dari satu nomor lewat `localStorage.bwkSarNumbers`.
