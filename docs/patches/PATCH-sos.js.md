# Patch `sos.js` — 5 perbaikan

Semua perubahan di bawah adalah cari-dan-ganti pada berkas `sos.js` yang sudah ada.
Setiap potongan "CARI" disalin apa adanya dari isi repo saat ini.
Setelah semua patch ditempel, jalankan `node scripts/check-sos.mjs .` dari akar repo.

---

## S4 · Alarm orang lain terbungkam karena nama kembar  🔴 KRITIS

Fungsi `_isMine()` memutuskan sebuah SOS adalah "milik sendiri" bila **namanya sama,
jaraknya < 60 m, dan waktunya beda < 35 menit**.

**CARI** (di dalam `_isMine`):

```js
if(s&&s.name&&a.name===s.name&&_dist(a.lat,a.lng,s.lat,s.lng)<=60&&Math.abs(t-s.t)<=35*60000)return true;
```

**Kenapa berbahaya:** nama bawaan setiap pengguna adalah `'Pendaki'`. Dua orang
yang sama-sama belum mengisi nama, berada di shelter yang sama, dan menekan SOS
dalam rentang setengah jam akan saling dianggap "diri sendiri". Alarm tidak
berbunyi. Ini kegagalan senyap — tidak ada pesan error, korban mengira sudah
terkirim, penerima tidak pernah tahu.

**GANTI DENGAN:**

```js
// Identitas SOS milik sendiri HARUS berdasarkan id/client_id, bukan tebakan
// nama + jarak. Nama bawaan 'Pendaki' membuat pencocokan lama membungkam
// alarm pendaki lain yang kebetulan berdekatan.
if(s&&s.id&&a.id&&String(a.id)===String(s.id))return true;
if(s&&s.client_id&&a.client_id&&String(a.client_id)===String(s.client_id))return true;
```

Hapus seluruh cabang pencocokan berbasis nama. Bila `id` belum tersedia
(SOS masih di antrean), `BWKSosOutbox` sudah membawa `client_id` yang unik per
perangkat, jadi pencocokan tetap bekerja saat offline.

---

## S7 · Dua sumber kebenaran untuk radius  🟠 PENTING

**CARI:**

```js
SOS_RADIUS=Infinity
```

**Kenapa berbahaya:** klien menampilkan SOS dari jarak berapa pun, sedangkan
`api/sos-push.js` hanya mengirim push dalam radius `20000` m. Akibatnya perilaku
aplikasi berbeda antara "yang terlihat di layar" dan "yang membangunkan HP",
dan tidak ada satu tempat pun yang bisa diubah untuk mengatur keduanya.

**GANTI DENGAN:**

```js
// Satu sumber kebenaran. Server memakai SOS_RADIUS_M yang sama lewat env.
// Infinity hanya untuk mode uji, jangan dibawa ke produksi.
SOS_RADIUS=(window.BWK_SOS_RADIUS_M||20000)
```

Lalu di `index.html`, sebelum `sos.js` dimuat:

```html
<script>window.BWK_SOS_RADIUS_M = 20000;</script>
```

---

## S10 · Antrean suara alarm menumpuk  🟠 PENTING

`_speakSOS()` dipanggil setiap 8 detik selama alarm aktif, tetapi
`speechSynthesis` **mengantre** setiap permintaan, tidak menggantinya.

**CARI** (baris pertama di dalam `_speakSOS`):

```js
function _speakSOS(){
```

**GANTI DENGAN:**

```js
function _speakSOS(){
  // Tanpa cancel(), tiap panggilan menumpuk di antrean. Setelah 5 menit alarm,
  // ada ~37 ucapan mengantre dan suara terus berbunyi lama setelah SOS
  // ditutup - persis saat pengguna butuh menelepon.
  try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){}
```

---

## S11 · Alarm berbahasa Inggris  🟠 PENTING

**CARI:**

```js
'SOS! SOS! Help! Help!'
```

**Kenapa berbahaya:** pengguna aplikasi ini adalah pendaki lokal. Kalimat bahasa
Inggris yang diucapkan mesin dengan suara Indonesia sering tidak terdengar
sebagai kata sama sekali, dan tidak menyampaikan informasi apa pun.

**GANTI DENGAN:**

```js
'Darurat! Ada pendaki minta tolong di dekat kamu. Buka aplikasi sekarang.'
```

Sekaligus, pada objek `SpeechSynthesisUtterance` yang dibuat, pastikan:

```js
u.lang='id-ID';
u.rate=0.95;   // sedikit lebih lambat, lebih jelas di angin kencang
u.volume=1;
```

Dan pada `_getFemaleVoice()`, prioritaskan suara `id-ID` lebih dulu sebelum
mencari suara perempuan berbahasa Inggris.

---

## Tabrakan definisi · `window._sosRefreshPush` didefinisikan dua kali  🔴 KRITIS

`window._sosRefreshPush` didefinisikan di **`sos.js` dan `push.js` sekaligus**.
Berkas yang dimuat belakangan menimpa yang lebih dulu tanpa peringatan apa pun.
Artinya salah satu dari dua implementasi itu **tidak pernah dijalankan**, dan
mana yang menang bergantung pada urutan tag `<script>` di `index.html`.

**Tindakan:** pilih satu rumah. Rekomendasi: simpan di `push.js` (tempatnya
memang urusan push), lalu di `sos.js` hapus definisinya dan panggil saja:

```js
// Definisi tunggal ada di push.js. Jangan definisikan ulang di sini.
if(typeof window._sosRefreshPush==='function') window._sosRefreshPush(false);
```

Untuk mencegah kejadian ini terulang, tambahkan di awal `push.js`:

```js
if(window._sosRefreshPush){
  console.warn('[BWK] _sosRefreshPush sudah terdefinisi di berkas lain - periksa urutan skrip.');
}
```

`scripts/check-sos.mjs` akan menggagalkan build bila definisi ganda muncul lagi.

---

## Tambahan · sambungkan modul baru ke alur SOS

Setelah SOS berhasil dibuat, hidupkan eskalasi otomatis. Cari tempat di mana
`bwkActiveSos` disimpan, lalu tambahkan setelahnya:

```js
try{ if(window.BWKSosRelay) window.BWKSosRelay.startEscalation(id); }catch(e){}
```

Dan pada jalur `_sosResolveMy` / saat SOS ditutup:

```js
try{ if(window.BWKSosRelay) window.BWKSosRelay.stopEscalation(); }catch(e){}
```
