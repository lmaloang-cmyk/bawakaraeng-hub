# Patch sisi server — `api/sos-push.js` & `api/operations.js`

---

## S3 · Satu tabel hilang → SELURUH push SOS mati  🔴 KRITIS

**Berkas:** `api/sos-push.js`

**CARI:**

```js
if (!claim.ok) return res.status(503).json({ error: 'Antidobel push belum siap', code: 'NO_CLAIM' });
```

**Kenapa ini bug paling rapuh di sistem:** `claim` adalah mekanisme anti-dobel
yang menulis ke tabel `sos_push_deliveries`. Bila tabel itu belum dibuat, kena
RLS, atau Supabase sedang lambat, `claim.ok` bernilai false dan fungsi
**berhenti sebelum satu pun notifikasi dikirim**.

Artinya: kegagalan pada fitur *pencegah notifikasi ganda* — masalah kenyamanan —
menjatuhkan *pengiriman notifikasi darurat* — masalah nyawa. Prioritasnya
terbalik. Notifikasi dobel itu mengganggu; notifikasi yang tidak pernah sampai
itu fatal.

**GANTI DENGAN:**

```js
// FAIL-OPEN. Anti-dobel adalah kenyamanan; pengiriman SOS adalah keselamatan.
// Bila mekanisme klaim bermasalah, tetap kirim. Lebih baik pendaki menerima
// dua notifikasi daripada nol notifikasi.
var duplicateRisk = false;
if (!claim.ok) {
  duplicateRisk = true;
  console.error('[sos-push] klaim gagal, lanjut tanpa anti-dobel:', claim.error || claim.code || 'unknown');
}
```

Lalu sertakan `duplicateRisk` di respons akhir agar terlihat di log Vercel:

```js
return res.status(200).json({ ok: true, sent: sent, failed: failed, duplicateRisk: duplicateRisk });
```

**Verifikasi:** jalankan `supabase-sos-optimasi.sql` (membuat tabelnya), lalu uji
sengaja dengan mengganti nama tabel sementara — push harus tetap terkirim.

---

## S7 (server) · Radius keras di dalam kode

**CARI:**

```js
const RADIUS = 20000;
```

**GANTI DENGAN:**

```js
// Satu sumber kebenaran dengan klien (window.BWK_SOS_RADIUS_M).
const RADIUS = Number(process.env.SOS_RADIUS_M || 20000);
```

Tambahkan `SOS_RADIUS_M=20000` ke `.env.example` dan ke Environment Variables
di Vercel.

---

## S8 · Panik menekan tombol → diblokir 429  🟠 PENTING

**Berkas:** `api/operations.js`

**CARI:**

```js
'sos-create':6
```

**Kenapa berbahaya:** batasnya 6 permintaan per 10 menit. Orang yang sedang panik
— tangan gemetar, layar basah, tidak yakin tombolnya tertekan — akan menekan
lebih dari 6 kali. Permintaan ke-7 ditolak `429`. Sistem menghukum korban tepat
pada saat paling genting.

Perhatikan juga: bug antrean di `ops.js` (S1) mengirim duplikat otomatis, jadi
kuota ini bisa habis **tanpa pengguna menekan apa pun**.

**GANTI DENGAN:**

```js
// SOS bukan operasi biasa. Batas dinaikkan, dan deduplikasi dilakukan lewat
// client_id (idempoten) alih-alih lewat penolakan permintaan.
'sos-create': 40,
```

### Deduplikasi idempoten (pengganti rate limit sebagai alat anti-dobel)

Klien sekarang mengirim `client_id` unik per SOS. Tambahkan di awal handler
`sos-create`, sebelum insert:

```js
const clientId = clean(body.client_id || '', 64);
if (clientId) {
  // Bila SOS dengan client_id ini sudah ada, kembalikan yang lama.
  // Ini membuat pengiriman ulang dari outbox benar-benar aman.
  const dup = await rest('sos_alerts?client_id=eq.' + encodeURIComponent(clientId) + '&select=id&limit=1');
  if (Array.isArray(dup) && dup.length) {
    return res.status(200).json({ id: dup[0].id, deduped: true });
  }
}
```

Dan sertakan `client_id: clientId || null` pada objek yang di-insert.

> Kolom `client_id` beserta indeks uniknya dibuat oleh `supabase-sos-optimasi.sql`.

---

## S9 · Rate limit hilang setiap cold start  🟠 PENTING

**Berkas:** `lib/security.js`

**CARI:**

```js
globalThis.__bwkRateStore
```

Penyimpanan rate limit adalah `Map` di memori per-instance. Di Vercel, setiap
instance serverless punya memorinya sendiri dan hilang saat cold start. Jadi
batasnya tidak benar-benar berlaku secara global — penyerang cukup memicu
instance baru.

Untuk SOS ini justru **menguntungkan** (batas jadi longgar saat darurat), tetapi
untuk endpoint admin ini celah nyata.

**Rekomendasi:** pindahkan penyimpanan rate limit ke Supabase atau Upstash Redis
untuk endpoint non-SOS. Jangan lakukan untuk `sos-create` — jalur SOS tidak boleh
bergantung pada layanan tambahan.

Tambahkan komentar jujur di kode agar tidak menyesatkan pembaca berikutnya:

```js
// CATATAN: penyimpanan ini per-instance dan hilang saat cold start.
// Untuk endpoint admin, ini BUKAN batas yang bisa diandalkan.
globalThis.__bwkRateStore
```

---

## S12/S13 · Terima konteks darurat yang baru

**Berkas:** `api/operations.js`, handler `sos-create`.

Klien kini mengirim medan tambahan. Terima dan simpan dengan pembersihan:

```js
const extra = {
  client_id:   clean(body.client_id || '', 64) || null,
  accuracy_m:  Number.isFinite(+body.accuracy_m) ? Math.min(99999, Math.round(+body.accuracy_m)) : null,
  altitude_m:  Number.isFinite(+body.altitude_m) ? Math.round(+body.altitude_m) : null,
  battery_pct: Number.isFinite(+body.battery_pct) ? Math.max(0, Math.min(100, Math.round(+body.battery_pct))) : null,
  plus_code:   clean(body.plus_code || '', 16) || null,
  profile:     body.profile && typeof body.profile === 'object' ? body.profile : null
};
```

**Penting soal privasi:** `profile` berisi data medis. Kolomnya dibuat dengan RLS
ketat di `supabase-sos-optimasi.sql` — hanya pemilik dan admin yang bisa membaca,
**tidak** ikut terkirim ke daftar `sos-nearby` publik. Pastikan `sosNearby`
memakai `select=` eksplisit dan tidak pernah `select=*`:

```js
// JANGAN select=* di sini. Endpoint ini publik.
const rows = await rest('sos_alerts?select=id,lat,lng,name,created_at,active,plus_code,accuracy_m&...');
```

Juga naikkan batas ukuran body karena payload sekarang lebih besar:

```js
bodyWithin(req, admin ? 1024 : 4096)
```
