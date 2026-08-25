# Paket Optimalisasi SOS — Bawakaraeng Hub

Semua berkas siap tempel. Tidak ada yang perlu dikompilasi, tidak ada dependensi
baru, tidak ada langkah build. Cukup salin ke akar repo dan pasang enam baris
`<script>`.

---

## Isi paket

### Modul baru (salin ke akar repo)

| Berkas | Memperbaiki | Isi |
|---|---|---|
| `sos-outbox.js` | S1 | Antrean SOS IndexedDB + Background Sync. Dedup `client_id`, backoff berjenjang, 30 percobaan (5,8 jam), tidak mungkin menggandakan diri. |
| `sos-auth.js` | S2 | Sesi anonim Supabase otomatis. SOS tidak pernah lagi terhalang layar login. |
| `sos-pluscode.js` | S12 | Plus Code offline, aritmetika bilangan bulat penuh. 42 uji lulus, termasuk vektor resmi Google. |
| `sos-context.js` | S12, S13 | Akurasi, ketinggian, baterai, jaringan + Kartu Darurat medis offline. |
| `sos-relay.js` | S6, S14 | Jalur cadangan WA/SMS/telepon + eskalasi otomatis menit ke-5/15/30/60. |
| `sos-mesh.js` | S6 | *Opsional/eksperimental.* Jembatan LoRa Meshtastic lewat Web Bluetooth. |
| `sos-ui.css` | — | Gaya untuk semua komponen di atas; mengikuti variabel tema yang sudah ada. |
| `sw.js` | **S5** | **Pengganti langsung.** Versi UTF-8 yang benar + handler `sync`, `message`, `pushsubscriptionchange`, tombol aksi notifikasi, dan strategi cache baru. |

### Patch untuk berkas yang sudah ada

| Berkas | Isi |
|---|---|
| `PATCH-ops.js.md` | Cabut antrean rusak, buka blokir login, tampilkan status antrean. |
| `PATCH-sos.js.md` | `_isMine` nama kembar, `SOS_RADIUS`, `speechSynthesis.cancel()`, TTS Indonesia, tabrakan `_sosRefreshPush`. |
| `PATCH-api.md` | `sos-push.js` fail-open, radius dari env, rate limit SOS, dedup idempoten. |
| `PATCH-sw.js.md` | Penjelasan bug encoding UTF-16 dan seluruh perubahan di `sw.js` baru. |

### Basis data & dokumen

| Berkas | Isi |
|---|---|
| `supabase-sos-optimasi.sql` | Tabel anti-dobel, kolom konteks darurat, indeks unik `client_id`, `emergency_profiles` + RLS, indeks kinerja, Realtime. |
| `AUDIT-SOS.md` | Audit lengkap 16 temuan + arsitektur tiga lapis. |
| `ISSUES-SOS.md` | 16 issue siap tempel ke GitHub. |
| `scripts/test-sos.mjs` | 42 uji otomatis. |
| `scripts/check-sos.mjs` | Validator integrasi pasca-patch. |
| `scripts/check-encoding.mjs` | Pemindai encoding seluruh repo — mencegah bug UTF-16 terulang. |

---

## Urutan pemasangan

### Langkah 0 · Ganti `sw.js` lebih dulu (WAJIB, dan ini yang terpenting)

`sw.js` di repo tersimpan sebagai **UTF-16LE**, sehingga gagal parse dan service
worker **tidak pernah terpasang sama sekali**. Selama ini belum terpasang, semua
yang lain di paket ini tidak ada gunanya: tidak ada push latar, tidak ada
Background Sync, tidak ada peta offline.

```bash
# konfirmasi masalahnya di repo-mu
file sw.js          # "Little-endian UTF-16 Unicode text" = bermasalah
node --check sw.js  # SyntaxError = terkonfirmasi

# ganti dengan versi dari paket ini
cp /paket/sw.js ./sw.js
file sw.js          # harus "ASCII text"
node --check sw.js  # harus lulus tanpa keluaran
```

Lalu cegah terulang — buat `.gitattributes` di akar repo:

```
* text=auto eol=lf
*.js text eol=lf
*.css text eol=lf
*.html text eol=lf
*.json text eol=lf
```

Dan pindai sisa repo, karena berkas lain bisa kena masalah sama:

```bash
node scripts/check-encoding.mjs .
```

### Langkah 1 · Supabase

1. SQL Editor → jalankan `supabase-sos-optimasi.sql`.
2. Jalankan blok VERIFIKASI di bagian bawah berkas itu. Semua harus mengembalikan baris.
3. Authentication → Providers → **Anonymous Sign-ins** → Enable.
4. Authentication → Rate Limits → atur anonymous sign-in (saran: 30/jam/IP).

> Langkah 3 adalah satu-satunya prasyarat agar SOS tanpa login bekerja.
> Tanpa itu, `sos-auth.js` akan gagal dengan sopan dan SOS tetap butuh login.

### Langkah 2 · Salin berkas

```bash
cp sos-*.js sos-ui.css sw.js /path/ke/bawakaraeng-hub/
mkdir -p /path/ke/bawakaraeng-hub/scripts
cp scripts/*.mjs /path/ke/bawakaraeng-hub/scripts/
```

### Langkah 3 · Pasang di `index.html`

Di dalam `<head>`:

```html
<link rel="stylesheet" href="/sos-ui.css">
<script>window.BWK_SOS_RADIUS_M = 20000;</script>
```

**Urutan ini penting.** Letakkan tepat SEBELUM `push.js`, `ops.js`, dan `sos.js`:

```html
<script src="/sos-pluscode.js"></script>
<script src="/sos-context.js"></script>
<script src="/sos-auth.js"></script>
<script src="/sos-outbox.js"></script>
<script src="/sos-relay.js"></script>
<!-- opsional, hanya bila memakai node LoRa -->
<script src="/sos-mesh.js"></script>

<!-- berkas yang sudah ada, tetap di bawah -->
<script src="/push.js"></script>
<script src="/ops.js"></script>
<script src="/sos.js"></script>
```

Alasan urutan: `sos-outbox.js` memanggil `BWKSosAuth`, `sos-relay.js` memanggil
`BWKSosContext`, dan `BWKSosContext` memanggil `BWKPlusCode`. `ops.js` memanggil
semuanya.

### Langkah 4 · Terapkan patch

Kerjakan sesuai urutan dampaknya:

1. `PATCH-ops.js.md` — dua bug paling kritis ada di sini.
2. `PATCH-sos.js.md`
3. `PATCH-api.md`
4. `PATCH-sw.js.md` — termasuk menaikkan versi cache, jika tidak pengguna lama
   tetap memakai kode lama.

### Langkah 5 · Verifikasi

```bash
node scripts/test-sos.mjs          # harus: 42 lulus, 0 gagal
node scripts/check-sos.mjs .       # dijalankan dari akar repo
node scripts/check-encoding.mjs .  # harus bersih
node --check sw.js                 # harus lulus
```

Lalu di browser: DevTools → Application → Service Workers → status harus
**activated and is running**. Kalau sebelum patch bagian ini kosong atau merah,
itu konfirmasi langsung bahwa bug encoding tadi memang mematikan semuanya.

---

## Uji lapangan wajib sebelum dipercaya

Perangkat lunak darurat tidak boleh dipercaya sebelum diuji dalam kondisi gagal.
Uji ini yang sebenarnya menentukan, bukan uji otomatis.

| # | Skenario | Hasil yang benar |
|---|---|---|
| 1 | Mode pesawat → tekan SOS | Muncul "SOS tersimpan", panel jalur cadangan langsung tampil |
| 2 | Matikan mode pesawat | SOS terkirim otomatis, **tepat satu** baris di `sos_alerts` |
| 3 | Mode pesawat → SOS → tutup tab → nyalakan sinyal | Background Sync mengirim, atau muncul notifikasi "SOS belum terkirim" |
| 4 | Jendela penyamaran, tanpa login → SOS | Terkirim lewat sesi anonim |
| 5 | Tekan SOS 10 kali cepat | Tidak ada 429; hanya satu SOS tercatat |
| 6 | Dua HP, keduanya bernama "Pendaki", jarak < 60 m | Kedua alarm **berbunyi** |
| 7 | Alarm berbunyi 5 menit | Suara tidak menumpuk, berbahasa Indonesia, berhenti saat ditutup |
| 8 | SOS didiamkan 5 menit | Panel eskalasi muncul dengan getaran |
| 9 | Cocokkan Plus Code di aplikasi dengan Google Maps | Titiknya sama |
| 10 | Ganti nama tabel `sos_push_deliveries` | Push **tetap** terkirim (fail-open) |

---

## Yang sengaja TIDAK dilakukan

Agar tidak ada yang mengira sudah aman padahal belum:

- **`sos-mesh.js` belum mengirim paket Meshtastic sungguhan.** Ia mendeteksi
  perangkat dan menyediakan jembatan, tetapi menyusun paket Protobuf sendiri akan
  rapuh dan mudah rusak saat firmware naik versi. Ia melapor gagal secara jujur
  alih-alih berpura-pura terkirim. Untuk mengaktifkannya penuh, muat bundel
  `@meshtastic/js` lalu sediakan `window.bwkMeshSendText(text)`.
  UUID BLE di dalamnya **harus diverifikasi** terhadap firmware yang dipakai.
- **Tidak ada SMS otomatis.** Browser memang tidak mengizinkannya, dan itu benar:
  pengguna harus menekan kirim. Yang disediakan adalah pesan yang sudah terisi
  lengkap sehingga hanya perlu satu ketukan.
- **`sw.js` kini ditulis ulang penuh** karena kamu mengirim berkas aslinya, jadi
  saya bisa membacanya. Sebelum itu saya hanya bisa menduga. Perlu dicatat:
  dugaan awal saya bahwa berkasnya adalah symlink rusak **keliru** — penyebabnya
  encoding UTF-16. Beberapa hal yang saya kira kurang (`requireInteraction`,
  `vibrate`, bypass `/api/`) ternyata sudah ada dan ditulis dengan baik.
- **Patch ditulis sebagai cari-dan-ganti, bukan diff `git apply`.** Potongan
  "CARI" disalin dari isi repo saat ini, tetapi baris di sekitarnya bisa berbeda
  bila repo sudah berubah. Validator akan menangkap bila ada yang terlewat.

---

## Catatan privasi

`sos-context.js` mengumpulkan data medis. Semuanya disimpan **di perangkat**
(`localStorage.bwkEmergencyProfile`) dan hanya ikut terkirim saat pengguna
benar-benar menekan SOS. Di sisi server, kolom `profile` dan tabel
`emergency_profiles` dilindungi RLS: hanya pemilik dan service role yang bisa
membaca. Endpoint publik `sos-nearby` **wajib** memakai `select=` eksplisit —
jangan pernah `select=*`.
