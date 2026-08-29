# Patch `ops.js` — cabut antrean rusak, buka blokir login

Dua perbaikan paling penting di seluruh paket ini ada di berkas ini.

---

## S2 · SOS diblokir layar login  🔴 KRITIS

**CARI** (baris pertama di dalam `window._sosPublish`):

```js
var u=user();if(!u||!u.google){toastx('Masuk dengan Google diperlukan untuk mengirim SOS','err');return;}
```

**Kenapa ini bug paling berbahaya di aplikasi:** `return` terjadi **sebelum**
apa pun disimpan. Jadi bila sesi kedaluwarsa, HP dipinjam, atau pengguna belum
pernah login, SOS **tidak terkirim dan juga tidak masuk antrean**. Hilang total.
Di jalur pendakian, kondisi "sesi kedaluwarsa + tidak ada internet untuk login
ulang" bukan kasus langka — itu justru kondisi normal.

**GANTI DENGAN:**

```js
// SOS tidak boleh pernah dihalangi layar login. BWKSosAuth membuat sesi anonim
// Supabase secara otomatis bila belum ada sesi, sehingga server tetap menerima
// UUID pengguna yang sah tanpa perlu Google.
var _sosName = (window.BWKSosAuth ? window.BWKSosAuth.displayName() : (name||'Pendaki'));
```

Lalu ubah badan `_sosPublish` menjadi pola berikut (antre dulu, kirim kemudian):

```js
window._sosPublish = function(lat,lng,name){
  // 1. SIMPAN DULU. Apa pun yang terjadi setelah ini, SOS sudah aman di perangkat.
  var ctxP = (window.BWKSosContext ? window.BWKSosContext.collect({lat:lat,lng:lng}) : Promise.resolve({}));
  return ctxP.then(function(ctx){
    var payload = {
      lat: lat, lng: lng,
      name: (window.BWKSosAuth ? window.BWKSosAuth.displayName() : (name||'Pendaki')),
      device: _devId(),
      accuracy_m: ctx.accuracy_m || null,
      altitude_m: ctx.altitude_m || null,
      battery_pct: ctx.battery_pct == null ? null : ctx.battery_pct,
      plus_code: ctx.plus_code || null,
      profile: ctx.profile || null
    };
    // 2. Masukkan ke outbox tahan-gagal. Pengiriman, ulang-coba, dan
    //    penghapusan setelah sukses ditangani seluruhnya oleh BWKSosOutbox.
    return window.BWKSosOutbox.enqueue(payload).then(function(rec){
      toastx('SOS tersimpan. Mengirim...','ok');
      // 3. Nyalakan jalur cadangan dan eskalasi otomatis segera, jangan tunggu server.
      try{ if(window.BWKSosRelay) window.BWKSosRelay.startEscalation(rec.client_id); }catch(e){}
      // 4. Baru coba kirim. Gagal pun tidak apa-apa - outbox yang mengurus.
      return window.BWKSosOutbox.flush();
    });
  });
};
```

Urutannya disengaja: **simpan, tampilkan jalur cadangan, baru kirim.** Versi lama
melakukan kebalikannya, sehingga kegagalan jaringan berarti kehilangan data.

---

## S1 · Antrean offline yang menggandakan diri dan tidak pernah bersih  🔴 KRITIS

**HAPUS SELURUHNYA** fungsi-fungsi berikut beserta konstanta `SOS_QUEUE_KEY`:

- `_sosQueueEnqueue`
- `_sosQueueDequeue`
- `_sosQueueRemove`
- `_syncSosQueue`
- `ensureSosQueueSync`

Tiga cacat di dalamnya:

1. `_sosQueueDequeue()` mengembalikan `q[q.length-1]` **tanpa menghapusnya** dari
   antrean. Namanya "dequeue" tetapi tidak pernah mengeluarkan apa pun.
2. Pada jalur sukses, `_syncSosQueue` hanya memanggil `toastx(...)` lalu `return`.
   `_sosQueueRemove()` **tidak pernah dipanggil di mana pun dalam berkas**.
   Akibatnya SOS yang sudah berhasil terkirim akan dikirim ulang setiap kali
   perangkat online — selamanya.
3. Pada jalur gagal, `_sosQueueEnqueue(item.payload)` menambahkan **salinan baru**
   alih-alih mengembalikan item yang sama. Antrean tumbuh setiap kegagalan.

Gabungan 1 + 3 berarti: satu SOS di area sinyal buruk bisa berubah menjadi
puluhan baris `sos_alerts` duplikat, memicu puluhan gelombang push ke semua
pendaki dalam radius 20 km, dan menghabiskan kuota rate limit korban sendiri
sehingga SOS berikutnya justru ditolak 429.

Fungsi `retry()` di dalamnya juga menyesatkan: ia adalah IIFE yang berjalan
satu kali, bukan mekanisme ulang-coba.

**GANTI DENGAN** — cukup satu baris di tempat `ensureSosQueueSync()` dipanggil:

```js
// Antrean SOS kini ditangani BWKSosOutbox (IndexedDB + Background Sync).
// Lihat sos-outbox.js. Tidak ada lagi antrean di localStorage.
try{ if(window.BWKSosOutbox) window.BWKSosOutbox.flush(); }catch(e){}
```

---

## Tampilkan status antrean ke pengguna

Pengguna berhak tahu apakah SOS-nya sudah benar-benar sampai. Tambahkan di
`ops.js`:

```js
window.addEventListener('bwk:sos-outbox', function(ev){
  var d = (ev && ev.detail) || {};
  var pill = document.getElementById('bwkSosOutboxPill');
  if(!pill){
    pill = document.createElement('div');
    pill.id = 'bwkSosOutboxPill';
    document.body.appendChild(pill);
  }
  if(d.type === 'sent'){
    pill.className = 'show';
    pill.textContent = 'SOS terkirim ke pusat';
    setTimeout(function(){ pill.className = ''; }, 6000);
    return;
  }
  if(d.type === 'dead'){
    pill.className = 'show bad';
    pill.textContent = 'SOS gagal terkirim - pakai jalur cadangan';
    return;
  }
  window.BWKSosOutbox.count().then(function(n){
    if(!n){ pill.className = ''; return; }
    pill.className = 'show';
    pill.textContent = n + ' SOS menunggu sinyal (percobaan ke-' + ((d.tries||0)+1) + ')';
  });
});
```

---

## Adopsi SOS yang tadinya di antrean

Saat outbox akhirnya berhasil mengirim, `sos.js` perlu tahu id aslinya supaya
`_isMine` bekerja dan alarm sendiri tidak berbunyi. Tambahkan:

```js
window._sosAdoptQueued = function(id, payload){
  try{
    if(typeof _sosMarkMine === 'function'){
      _sosMarkMine(id, payload.lat, payload.lng, payload.name);
    }
    var act = { id:id, lat:payload.lat, lng:payload.lng, created_at:Date.now() };
    localStorage.setItem('bwkActiveSos', JSON.stringify(act));
  }catch(e){}
};
```
