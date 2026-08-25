# Audit Fungsi SOS — Bawakaraeng Hub / Pintu Angin

Repo: `lmaloang-cmyk/bawakaraeng-hub` · branch `main`
Berkas yang dibaca utuh: `sos.js` (22.090 B), `push.js` (10.744 B), `ops.js`,
`api/sos-push.js` (8.640 B), `api/operations.js` (8.861 B), `lib/security.js`.

---

## Ringkasan satu paragraf

Arsitektur SOS-nya sudah dipikirkan matang: ada gelombang push berulang, radius
geografis, anti-dobel, rate limit, dan antrean offline. Masalahnya bukan pada
rancangan, melainkan pada **titik-titik di mana kegagalan kecil dibiarkan
menjatuhkan seluruh rantai**. Ada empat bug yang masing-masing cukup untuk
membuat SOS tidak sampai sama sekali, dan ketiga di antaranya gagal secara
**senyap** — pengguna melihat tanda berhasil padahal tidak ada apa pun yang
terkirim. Untuk fitur biasa itu bug; untuk fitur darurat itu bahaya, karena
korban berhenti mencari cara lain setelah merasa SOS-nya sudah terkirim.

---

## Alur SOS saat ini

```
[Pendaki tekan SOS]
        |
        v
  ops.js _sosPublish()
        |  <-- S2: berhenti di sini bila belum login Google
        v
  POST /api/operations?action=sos-create
        |  <-- S8: ditolak 429 setelah 6 permintaan / 10 menit
        v
  Supabase: insert sos_alerts
        |
        v
  POST /api/sos-push
        |  <-- S3: berhenti total bila tabel sos_push_deliveries bermasalah
        v
  Cari push_subscriptions dalam radius 20 km
        |
        v
  Web Push -> service worker penerima
        |  <-- S5: TIDAK PERNAH SAMPAI. sw.js tersimpan UTF-16 -> gagal parse
        |         -> service worker tidak pernah terpasang sama sekali
        v
  sos.js: alarm berbunyi di HP penerima
           <-- S4: dibungkam bila nama pengirim sama dengan nama sendiri
```

Perhatikan: **setiap anak panah di atas adalah titik gagal tunggal, dan semuanya
membutuhkan internet.** Di jalur Bawakaraeng, itu justru asumsi yang paling
sering tidak terpenuhi.

---

## 🔴 Temuan kritis

### S1 · Antrean offline menggandakan diri dan tidak pernah dibersihkan

Tiga cacat menumpuk di `ops.js`:

- `_sosQueueDequeue()` mengembalikan `q[q.length-1]` **tanpa menghapusnya**.
- Pada jalur sukses, `_syncSosQueue` hanya memanggil `toastx(...)` lalu `return`.
  `_sosQueueRemove()` **tidak pernah dipanggil sekali pun di seluruh berkas**.
- Pada jalur gagal, `_sosQueueEnqueue(item.payload)` menambah **salinan baru**
  alih-alih mengembalikan item yang sama.

Akibat gabungannya: satu SOS di area sinyal buruk berubah menjadi puluhan baris
duplikat, memicu puluhan gelombang push ke semua pendaki dalam radius 20 km,
sekaligus menghabiskan kuota rate limit korban sendiri sehingga SOS berikutnya
justru ditolak. Fungsi bernama `retry()` di dalamnya sebenarnya IIFE yang jalan
satu kali — tidak ada mekanisme ulang-coba sama sekali.

### S2 · SOS diblokir layar login

```js
var u=user(); if(!u||!u.google){ toastx('Masuk dengan Google diperlukan...'); return; }
```

`return` terjadi **sebelum** apa pun disimpan. Sesi kedaluwarsa, HP pinjaman,
atau belum pernah login = SOS tidak terkirim **dan tidak masuk antrean**.
Hilang total. Ironisnya, kondisi "sesi habis + tidak ada internet untuk login
ulang" adalah kondisi normal di gunung, bukan kasus tepi.

### S3 · Satu tabel hilang mematikan seluruh push

```js
if (!claim.ok) return res.status(503).json({ error: 'Antidobel push belum siap', code: 'NO_CLAIM' });
```

Mekanisme *anti-notifikasi-ganda* — murni soal kenyamanan — diberi kuasa untuk
membatalkan *pengiriman notifikasi darurat*. Prioritasnya terbalik. Notifikasi
dobel itu mengganggu; notifikasi yang tidak pernah sampai itu fatal. Sistem
darurat harus **fail-open**.

### S4 · Alarm orang lain terbungkam karena nama kembar

```js
if(s&&s.name&&a.name===s.name&&_dist(...)<=60&&Math.abs(t-s.t)<=35*60000)return true;
```

Nama bawaan setiap pengguna adalah `'Pendaki'`. Dua orang yang belum mengisi
nama, berada di shelter yang sama, dan menekan SOS dalam rentang 35 menit akan
saling dianggap "diri sendiri". Alarm tidak berbunyi, tanpa pesan error apa pun.

### S5 · `sw.js` tersimpan sebagai UTF-16 — service worker TIDAK PERNAH terpasang

**Terkonfirmasi setelah berkasnya diperiksa langsung.** Ini temuan terbesar dari
seluruh audit, dan satu-satunya yang membatalkan sebagian temuan lain.

```
$ file sw.js
sw.js: Little-endian UTF-16 Unicode text, with CRLF line terminators

$ node --check sw.js
SyntaxError: Invalid or unexpected token
```

Ukuran berkas 6.256 byte, isi sebenarnya hanya 3.072 byte — tepat dua kali lipat,
karena setiap karakter ASCII disimpan dua byte dengan satu byte NUL di belakangnya.
Itu juga sebabnya GitHub API menolak blob-nya sebagai *"not a valid internal
symbolic link target"*: dugaan symlink rusak saya keliru, penyebabnya encoding.

Spesifikasi Service Worker mewajibkan browser mendekode skrip sebagai UTF-8.
Berkas UTF-16 yang didekode sebagai UTF-8 menghasilkan NUL di antara setiap huruf,
sehingga `navigator.serviceWorker.register()` **selalu gagal**.

**Konsekuensinya menyeluruh:** tidak ada notifikasi push latar, tidak ada cache
offline, tidak ada peta offline, tidak ada Background Sync. Tidak pernah, sejak
berkas ini terakhir disimpan dengan editor yang salah.

Dan gagalnya senyap. Halaman tetap terbuka normal, tombol SOS tetap bisa ditekan,
izin notifikasi tetap bisa diberikan dan tercatat "aktif". Tidak ada satu pun
tanda di layar. Ini menjelaskan kenapa push terasa "kadang jalan kadang tidak":
sebenarnya tidak pernah jalan: yang selama ini bekerja hanya alarm polling
selagi tab terbuka.

**Koreksi terhadap temuan lain.** Setelah dikonversi, isi `sw.js` ternyata ditulis
dengan baik: `requireInteraction:true` sudah ada, `vibrate` sudah ada, handler
`push` lengkap dengan `renotify` dan tag `sos-<id>`, dan `/api/` sudah di-bypass
dari cache dengan benar. Semua itu hanya tidak pernah dieksekusi. Yang benar-benar
kurang hanya handler `sync`, `message`, dan `pushsubscriptionchange`.

Berkas pengganti UTF-8 yang sudah lulus `node --check` disertakan dalam paket ini.

### S6 · Tidak ada jalur cadangan non-internet sama sekali

Seluruh rantai memerlukan HTTP. Padahal di lapangan urutan hilangnya konektivitas
hampir selalu: data seluler mati lebih dulu, SMS masih lewat, panggilan suara
paling akhir. Aplikasi ini menyerah pada tahap pertama.

---

## 🟠 Temuan penting

| Kode | Temuan | Dampak |
|---|---|---|
| S7 | `SOS_RADIUS=Infinity` di klien vs `RADIUS=20000` di server | Dua sumber kebenaran; yang terlihat di layar berbeda dari yang membangunkan HP |
| S8 | `'sos-create':6` per 10 menit | Tangan panik menekan >6 kali → ditolak 429 tepat saat genting |
| S9 | Rate limit di `globalThis.__bwkRateStore` (Map memori) | Hilang tiap cold start; batasnya ilusi |
| S10 | `_speakSOS()` tiap 8 detik tanpa `speechSynthesis.cancel()` | Setelah 5 menit ada ~37 ucapan mengantre; suara terus berbunyi saat pengguna perlu menelepon |
| S11 | TTS berbahasa Inggris `'SOS! SOS! Help! Help!'` | Pengguna lokal; suara mesin Indonesia melafalkan Inggris sering tak terdengar sebagai kata |
| S12 | Payload tanpa akurasi/ketinggian/baterai | Tim SAR tak tahu radius pencarian 8 m atau 800 m |
| S13 | Tidak ada data medis / kontak keluarga | Penolong tiba tanpa tahu alergi obat atau siapa yang harus dihubungi |
| S14 | Tidak ada eskalasi bila SOS didiamkan | SOS tak terjawab hanya diam di layar |
| S15 | `opsDashboard()` refresh manual | Operator harus menekan tombol untuk tahu ada yang minta tolong |
| S16 | Nomor WA cadangan ditulis di kode (`6282320124040`) | Ganti penanggung jawab = ganti kode = deploy ulang |

---

## Arsitektur usulan — tiga lapis, satu pesan

```
              [ SOS ditekan ]
                     |
     +---------------+---------------+
     |               |               |
  LAPIS 1         LAPIS 2         LAPIS 3
  INTERNET        GSM             LORA MESH
  Web Push        SMS / WA        Meshtastic
  + outbox        + telepon       + node relay
  IndexedDB       darurat         basecamp
     |               |               |
     +---------------+---------------+
                     |
         payload identik, sos_id sama
         server deduplikasi lewat client_id
```

Prinsipnya: **jangan pilih satu jalur, kirim ke semuanya sekaligus** dan biarkan
basis data yang membuang duplikat. Jalur yang paling murah dan paling sering
berhasil (internet) tetap utama, tetapi kegagalannya tidak lagi berarti diam.

Urutan hilangnya konektivitas di lapangan — dan lapis yang menanganinya:

| Kondisi | Data seluler | SMS | Suara | LoRa |
|---|---|---|---|---|
| Sinyal penuh | ✅ Lapis 1 | ✅ | ✅ | ✅ |
| Sinyal 1 bar | ❌ | ✅ Lapis 2 | ✅ | ✅ |
| Tanpa sinyal, ada node | ❌ | ❌ | ❌ | ✅ Lapis 3 |
| Tanpa apa pun | Outbox menyimpan, terkirim otomatis saat sinyal kembali | | | |

---

## Referensi integrasi yang diverifikasi

| Repo | Bintang | Kegunaan |
|---|---|---|
| [meshtastic/web](https://github.com/meshtastic/web) | 838 | Klien Meshtastic berbasis web/TypeScript; rujukan untuk jembatan LoRa |
| [google/open-location-code](https://github.com/google/open-location-code) | 4.346 | Spesifikasi Plus Code; algoritmanya diimplementasikan ulang di `sos-pluscode.js` tanpa dependensi |
| [kn6plv/Raven](https://github.com/kn6plv/Raven) | — | Rujukan arsitektur jembatan pesan lintas jaringan (AREDN/Meshtastic/Winlink) |

Disebut sebagai opsi tanpa klaim angka: ntfy, Traccar, Turf.js, Workbox
`BackgroundSyncPlugin`, Supabase Realtime, Twilio/Vonage, WhatsApp Cloud API,
Telegram Bot API.

---

## Prinsip yang dipakai di seluruh paket ini

1. **Simpan dulu, kirim kemudian.** Data tidak boleh hilang karena jaringan.
2. **Fail-open untuk keselamatan, fail-closed untuk keamanan.** Kegagalan fitur
   kenyamanan tidak boleh menjatuhkan pengiriman darurat.
3. **Jangan pernah gagal diam-diam.** Bila SOS belum terkirim, katakan, dan
   tawarkan jalur lain.
4. **Idempoten di level basis data.** Duplikat dicegah oleh indeks unik, bukan
   oleh harapan.
5. **Yang paling penting harus paling sederhana.** Tombol SOS tidak boleh
   bergantung pada login, izin notifikasi, atau modul opsional apa pun.
