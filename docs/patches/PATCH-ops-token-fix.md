# Perbaikan Bug: Deteksi Status Online & Pengiriman SOS Offline

## Problem
1. SOS tidak terkirim walau online → Pesan tersimpan sebagai "offline"
2. Tombol "Saya Aman" tidak bisa diklik
3. Sinyal buruk = dianggap "belum login"

## Root Cause
- `token()` tidak membedakan "timeout" vs "belum login" → selalu throw 401
- `flush()` di `_bootOutbox()` tidak di-await → antrean terputus
- Backoff penalty (429) tidak di-reset saat online kembali

---

## PATCH 1: Perbaiki `token()` untuk fallback anonim

**File:** `ops.js` (line 58)

**CARI:**
```javascript
   // Sesi Google yang mati (refresh token gagal di sinyal buruk) tidak boleh
   // mematikan tombol "Saya Aman" maupun pemantauan alarm: jatuh ke sesi anonim.
   function token(){try{var c=(typeof _sbClient==='function')?_sbClient():null;if(!c)return Promise.resolve('');return c.auth.getSession().then(function(r){var t=(r&&r.data&&r.data.session&&r.data.[...]
```

**GANTI DENGAN:**
```javascript
   // Sesi Google yang mati (refresh token gagal di sinyal buruk) tidak boleh
   // mematikan tombol "Saya Aman" maupun pemantauan alarm: jatuh ke sesi anonim.
   function token(){
     try{
       var c=(typeof _sbClient==='function')?_sbClient():null;
       if(!c)return Promise.resolve('');
       return c.auth.getSession().then(function(r){
         var t=(r&&r.data&&r.data.session&&r.data.session.access_token)||null;
         if(t)return t;
         // Coba sesi anonim sebagai fallback
         if(typeof window.BWKSosAuth==='object'&&window.BWKSosAuth.token){
           return window.BWKSosAuth.token().catch(function(){return '';});
         }
         return '';
       }).catch(function(e){
         // Timeout atau error koneksi → fallback ke anonim, jangan throw
         if(typeof window.BWKSosAuth==='object'&&window.BWKSosAuth.token){
           return window.BWKSosAuth.token().catch(function(){return '';});
         }
         return '';
       });
     }catch(e){return Promise.resolve('');}
   }
```

---

## PATCH 2: Perbaiki `_bootOutbox()` untuk await flush()

**File:** `ops.js` (line 245-261)

**CARI:**
```javascript
   function _bootOutbox(){
     try{
       if(!window.BWKSosOutbox)return;
       if(window.BWKSosOutbox.setTokenProvider&&!window.__bwkOutboxTokenSet){
         window.__bwkOutboxTokenSet=true;
         window.BWKSosOutbox.setTokenProvider(function(){
           return token().then(function(t){
             if(t)return t;
             if(window.BWKSosAuth&&window.BWKSosAuth.token)return window.BWKSosAuth.token();
             return '';
           }).catch(function(){return '';});
         });
       }
       _migrateOldQueue();
       if(navigator.onLine)Promise.resolve(window.BWKSosOutbox.flush()).catch(function(){});
     }catch(e){}
   }
```

**GANTI DENGAN:**
```javascript
   function _bootOutbox(){
     try{
       if(!window.BWKSosOutbox)return;
       if(window.BWKSosOutbox.setTokenProvider&&!window.__bwkOutboxTokenSet){
         window.__bwkOutboxTokenSet=true;
         window.BWKSosOutbox.setTokenProvider(function(){
           return token().then(function(t){
             if(t)return t;
             if(window.BWKSosAuth&&window.BWKSosAuth.token)return window.BWKSosAuth.token();
             return '';
           }).catch(function(){return '';});
         });
       }
       _migrateOldQueue();
       // PENTING: Harus di-await supaya SOS benar-benar dikirim sebelum halaman tutup
       if(navigator.onLine){
         Promise.resolve(window.BWKSosOutbox.flush())
           .catch(function(){}) // Tetap lanjut meski error
           .then(function(){
             // Tambahkan delay kecil untuk memastikan request tersampaikan
             try{if(window._pushWave&&_sosActive){window._pushWave(_sosActive.id,'retry');}}catch(e){}
           });
       }
     }catch(e){}
   }
```

---

## PATCH 3: Reset backoff penalty saat online kembali

**File:** `sos.js` (line 374)

**CARI:**
```javascript
   window.addEventListener('online',function(){_recover();if(_started)_tick(true);});
```

**GANTI DENGAN:**
```javascript
   window.addEventListener('online',function(){
     try{console.log('[BWK] Status online terdeteksi, reset backoff + percobaan ulang');}catch(e){}
     _recover();  // Reset backoff penalty ke 0
     _fails=0;    // Reset counter gagal
     if(_started){
       _setStatus('ok','mencoba koneksi ulang...');
       _tick(true); // Langsung coba, jangan tunggu interval
     }
   });
```

---

## Cara Apply

1. Buka `ops.js` → cari 3 bagian di atas → ganti dengan versi baru
2. Buka `sos.js` → cari event listener 'online' → ganti
3. Deploy + hard refresh browser (Ctrl+Shift+R)
4. Test: buka DevTools → Network → throttle ke "Slow 3G"
5. Tekan SOS → harusnya masuk ke outbox lokal
6. Offline → kembali online → harus langsung terkirim

---

## Expected Result
- ✅ Tombol SOS responsif bahkan di sinyal buruk
- ✅ SOS masuk outbox, jangan "tersimpan" selamanya
- ✅ Saat online kembali, langsung retry (tidak menunggu 5 menit)
- ✅ Bisa gunakan sesi anonim sebagai fallback
