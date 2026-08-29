# PATCH · `sw.js`

> **Status berubah.** Sebelumnya berkas ini tidak bisa dibaca lewat GitHub API dan
> saya menandainya sebagai "belum terverifikasi". Setelah kamu mengirim berkasnya
> langsung, penyebabnya ketemu — dan jauh lebih serius dari dugaan awal.

---

## 🔴 Akar masalah: berkasnya tersimpan sebagai UTF-16LE

Hasil pemeriksaan berkas yang kamu kirim:

```
$ file sw.js
sw.js: Little-endian UTF-16 Unicode text, with CRLF line terminators

$ node --check sw.js
SyntaxError: Invalid or unexpected token
```

Berkasnya 6.256 byte, padahal isi sebenarnya hanya 3.072 byte — tepat dua kali
lipat, karena setiap karakter ASCII disimpan sebagai dua byte dengan satu byte
NUL di belakangnya. Itulah juga sebabnya GitHub API menolak blob-nya.

**Dampaknya total.** Spesifikasi Service Worker mewajibkan browser mendekode
skrip sebagai UTF-8. Berkas UTF-16 yang didekode sebagai UTF-8 menghasilkan
karakter NUL di antara setiap huruf, jadi:

```
const CACHE = ...   -->   c\0o\0n\0s\0t\0 \0C\0A\0C\0H\0E\0...
```

Skrip gagal parse → `navigator.serviceWorker.register()` **selalu gagal** →
**tidak ada** notifikasi push, **tidak ada** cache offline, **tidak ada** peta
offline, **tidak ada** Background Sync. Semuanya. Sejak berkas ini terakhir
disimpan dengan editor yang salah.

Dan gagalnya senyap: halaman tetap terbuka normal, tombol SOS tetap bisa ditekan,
izin notifikasi tetap bisa diberikan. Tidak ada satu pun tanda di layar bahwa
seluruh lapisan latar tidak pernah hidup. Ini menjelaskan kenapa fitur push
terasa "kadang jalan kadang tidak" — sebenarnya tidak pernah jalan sama sekali;
yang jalan hanya alarm polling selagi tab terbuka.

### Perbaikan

Pakai `sw.js` yang sudah saya sertakan di paket ini (sudah UTF-8, LF, dan lulus
`node --check`). Atau perbaiki milikmu sendiri:

```bash
iconv -f UTF-16LE -t UTF-8 sw.js | tr -d '\r' > sw.tmp && mv sw.tmp sw.js
node --check sw.js   # harus lulus tanpa keluaran
file sw.js           # harus "ASCII text" atau "UTF-8 Unicode text"
```

### Cegah terulang

```bash
node scripts/check-encoding.mjs .
```

Dan tambahkan `.gitattributes` di akar repo:

```
* text=auto eol=lf
*.js text eol=lf
*.css text eol=lf
*.html text eol=lf
*.json text eol=lf
```

---

## Yang ternyata SUDAH benar

Setelah dikonversi, kodenya terbaca dan beberapa dugaan saya sebelumnya keliru.
Saya koreksi:

| Yang saya duga | Kenyataan |
|---|---|
| `requireInteraction` mungkin belum ada | **Sudah ada** dan bernilai `true` |
| Notifikasi mungkin tanpa getaran | **Sudah ada** `vibrate:[400,150,400,150,700]` |
| `push` handler mungkin belum ada | **Sudah ada**, lengkap dengan `renotify` dan tag `sos-<id>` |
| `/api/` mungkin ikut ter-cache | **Sudah di-bypass** dengan benar |

Handler yang ada: `install`, `activate`, `fetch`, `push`, `notificationclick`.
Penanganan push-nya sebenarnya ditulis dengan baik — ia bahkan mem-`postMessage`
ke tab terbuka supaya alarm tidak menunggu siklus polling. Semua itu hanya tidak
pernah berjalan karena berkasnya tidak pernah berhasil di-parse.

---

## Yang ditambahkan di `sw.js` baru

### 1. Handler `sync` — prasyarat `sos-outbox.js`

```js
self.addEventListener('sync',function(e){
  if(e.tag!=='bwk-sos-outbox')return;
  ...postMessage({type:'bwk-sos-flush'})...
});
```

Tanpa ini, SOS tertunda hanya terkirim jika tab masih terbuka. Bila tidak ada
tab hidup saat sinyal kembali, service worker memunculkan notifikasi
**"SOS belum terkirim"** — lebih baik pengguna tahu daripada sinyalnya menggantung diam-diam.

### 2. Strategi `fetch` untuk kode aplikasi diubah

Versi lama memakai cache-first untuk **semua** berkas same-origin, termasuk
`sos.js` dan `ops.js`. Artinya patch apa pun tidak akan sampai ke pengguna lama
sampai nama `CACHE` diganti. Versi baru memakai jaringan-dulu untuk `.js`/`.css`/`.html`
dengan cache sebagai cadangan offline. Aset lain (gambar, Leaflet) tetap cache-first.

### 3. Nama cache dinaikkan

`bwk-v77-leaflet-offline` → `bwk-v78-sos-kit`. **Wajib.** Tanpa ini pengguna lama
tetap dilayani berkas lama.

### 4. Berkas SOS baru masuk daftar prasingga

`sos-pluscode.js`, `sos-context.js`, `sos-auth.js`, `sos-outbox.js`,
`sos-relay.js`, `sos-ui.css` ditambahkan ke `ASSETS`.

### 5. Handler `message`

Menerima `bwk-skip-waiting` dan `bwk-sos-ping` dari halaman.

### 6. Tombol aksi di notifikasi

`actions:[{action:'open'...},{action:'map'...}]`. Menekan **Lihat peta** membuka
`/?sos=<id>` langsung.

### 7. Handler `pushsubscriptionchange`

Browser bisa memperbarui langganan push kapan saja. Tanpa handler ini, langganan
lama mati diam-diam dan HP itu berhenti menerima SOS — tanpa ada yang sadar.

---

## Verifikasi setelah dipasang

1. DevTools → Application → Service Workers → status **activated and is running**.
   Bila sebelumnya kosong atau error, itu konfirmasi bug encoding tadi.
2. Application → Cache Storage → hanya ada `bwk-v78-sos-kit`.
3. Console:
   ```js
   navigator.serviceWorker.ready.then(r => r.sync.register('bwk-sos-outbox'))
   ```
   Harus resolve tanpa error.
4. Mode pesawat → tekan SOS → **tutup tab** → nyalakan sinyal. SOS terkirim,
   atau muncul notifikasi "SOS belum terkirim".
5. DevTools → Application → Push → kirim payload uji:
   ```json
   {"title":"Uji SOS","body":"Uji notifikasi","id":"test-1","url":"/"}
   ```
   Notifikasi harus muncul dengan dua tombol aksi dan tidak hilang sendiri.
