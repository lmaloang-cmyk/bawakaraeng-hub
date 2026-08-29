# Catatan Review Bug & Perbaikan SOS
**Tanggal**: 2026-07-16  
**Reviewer**: Agnes-2.5-Flash (Sapiens AI)  
**Scope**: Perubahan SOS v4 - server, query, client, React, Next, Express, AUTH, Deploy

---

## ✅ BUG YANG SUDAH DIPERBAIKI

### 1. DOUBLE EVENT LISTENER 'push' DI SW.JS — FIXED
**File**: `sw.js:96` dan `sw.js:160` → **Dihapus**  
**Severity**: CRITICAL → **FIXED**

**Perbaikan**:  
- Menghapus listener push kedua (line 158-202) yang mencoba memainkan beep audio di SW
- AudioContext tidak tersedia di Service Worker context, kode tersebut akan selalu error
- Beep hanya bisa dimainkan di main thread (ketika app terbuka)

**Code after fix**:
```javascript
// Hanya satu listener push, tidak ada duplikasi
self.addEventListener('push',function(e){
  // ... notifikasi + message ke client ...
});
```

---

### 2. RETRY NOTIFICATION DI LUAR WAITUNTIL — FIXED
**File**: `sw.js:127-155` → **Diperbaiki**  
**Severity**: HIGH → **FIXED**

**Perbaikan**:  
- Memindahkan retry timeout ke dalam `e.waitUntil()` dengan `Promise.all()`
- Service Worker sekarang akan tetap hidup selama 5 detik untuk memastikan retry terkirim

**Code after fix**:
```javascript
e.waitUntil(Promise.all([
  // Notifikasi utama
  self.registration.showNotification(title,opts).then(...),
  // Retry setelah 5 detik (di dalam waitUntil)
  new Promise(function(resolve){
    setTimeout(function(){...}, 5000);
  })
]));
```

---

### 3. SILENT FAILURE DI _TTSTRYCOUNT — FIXED
**File**: `sos.js:119` → **Diperbaiki**  
**Severity**: WARNING → **FIXED**

**Perbaikan**:  
- Menambahkan `_ttsTryCount=0` di awal fungsi `_speakSOS()`
- Mencegah infinite loop retry jika AudioContext gagal di Safari/iOS

**Code after fix**:
```javascript
function _speakSOS(){
  try{
    if(!('speechSynthesis' in window))return false;
    _ttsTryCount=0; // RESET di awal untuk cegah infinite loop
    // ... sisa kode
```

---

## 📋 BUG YANG MASIH OPEN (LOW PRIORITY)

### 4. STATUS TEXT KOSONG — LOW PRIORITY
**File**: `sos.js:208-216`  
**Status**: Open, Low Priority

**Catatan**:  
- Entri `ok:''` dan `idle:''` di STATUS_TEXT memang disengaja (falsey check)
- Tidak mengganggu fungsionalitas, hanya membingungkan debugging
- Bisa ditinggalkan atau diberi komentar explicatif

### 5. ERROR HANDLING DI _SOSREPORT — MEDIUM PRIORITY
**File**: `sos.js:255-270`  
**Status**: Open, Medium Priority

**Catatan**:  
- Error handling saat ini mengembalikan Promise.resolve() pada setiap failure
- Untuk produksi, bisa ditambahkan logging atau throw error yang lebih informatif
- Tapi tidak blocking untuk fitur darurat

---

## ✅ PERBAIKAN YANG SUDAH DILAKUKAN SEBELUMNYA (BAGUS)

1. ✅ **GPS berlapis** - akurasi tinggi → rendah → cache
2. ✅ **Polling adaptif** - honors 429/Retry-After
3. ✅ **TTS retry dengan fallback beep** - iPhone/Safari support
4. ✅ **Anti-dobel identifikasi** - pakai device/client_id, bukan nama+jarak
5. ✅ **Wake lock** - cegah layar tidur saat SOS aktif
6. ✅ **Badge lonceng** - status aktif/selesai jelas
7. ✅ **Panel instruksi admin** - responsive communication

---

## 📊 RINGKASAN PERUBAHAN

| File | Changes | Lines |
|------|---------|-------|
| sw.js | Fixed retry logic, removed invalid beep | -51 lines |
| sos.js | Fixed TTS retry counter | +1 line |

**Total**: 2 files changed, 29 insertions(+), 80 deletions(-)

**Build status**: ✅ PASS (syntax check)

---

## ✅ CHECKLIST SEBELUM DEPLOY

- [x] Bug #1: Hapus duplicate push listener di sw.js ✅ FIXED
- [x] Bug #2: Fix retry notification dengan waitUntil ✅ FIXED
- [x] Bug #3: Reset _ttsTryCount di _speakSOS() ✅ FIXED
- [ ] Bug #5: Improve error handling di _sosReport (optional)
- [ ] Test SOS push notification di device tertutup
- [ ] Test TTS retry di iPhone/Safari
- [ ] Verifikasi radius tetap Infinity untuk testing
- [ ] Smoke test: sos-create, sos-nearby, sos-resolve, sos-report

---

## 🎯 CATATAN PENTING

### Radius Testing Masih Aktif
Radius masih diset ke `Infinity` untuk mode testing:
- `ops.js:23`: `window.BWK_SOS_RADIUS_M=Infinity;`
- `sos.js:72`: `var SOS_RADIUS=(window.BWK_SOS_RADIUS_M||Infinity);`

**Setelah launch, ubah ke 20000 (20 km)** untuk production safety.

### Perubahan Klien vs Server
- **Server-side** (`api/operations.js`, `api/sos-push.js`): Tidak ada perubahan bug
- **Client-side** (`ops.js`, `sos.js`, `sw.js`): 3 bug kritis diperbaiki

---

*Review selesai. 3 bug kritis diperbaiki. Siap deploy setelah checklist verification.*
