import webpush from 'web-push';
import { rateLimit, secureApi } from '../lib/security.js';

function dist(la1, lo1, la2, lo2) {
  const R = 6371000, tr = Math.PI / 180;
  const dLa = (la2 - la1) * tr, dLo = (lo2 - lo1) * tr;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * tr) * Math.cos(la2 * tr) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function headers(key, extra = {}) { return { apikey: key, Authorization: 'Bearer ' + key, ...extra }; }

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { prefix: 'sos-push', limit: 60, windowMs: 10 * 60_000 })) return;

  const vapidPublic = process.env.VAPID_PUBLIC, vapidPrivate = process.env.VAPID_PRIVATE;
  const subject = process.env.VAPID_SUBJECT || 'mailto:sos@bawakaraeng-hub.vercel.app';
  const SB_URL = process.env.SUPABASE_URL || 'https://ncoueeeskzslldppsbvx.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;
  const sosId = String((req.body || {}).id || '').slice(0, 80);
  if (!sosId) return res.status(400).json({ error: 'ID SOS diperlukan' });
  if (!vapidPublic || !vapidPrivate || !key) return res.status(503).json({ error: 'Push belum dikonfigurasi', code: 'NO_CONFIG' });

  // Data SOS selalu dibaca dari database; klien tidak dapat memalsukan nama/lokasi untuk push.
  // Kolom plus_code baru ada setelah supabase-sos-optimasi.sql dijalankan, jadi ada jalur mundur.
  let sos;
  async function loadSos(cols) {
    const u = new URL(SB_URL + '/rest/v1/sos_alerts');
    u.searchParams.set('select', cols);
    u.searchParams.set('id', 'eq.' + sosId);
    u.searchParams.set('limit', '1');
    return fetch(u, { headers: headers(key), signal: AbortSignal.timeout(8000) });
  }
  try {
    let r = await loadSos('id,lat,lng,name,device,active,created_at,plus_code');
    if (!r.ok) r = await loadSos('id,lat,lng,name,device,active,created_at');
    const rows = r.ok ? await r.json() : [];
    sos = Array.isArray(rows) ? rows[0] : null;
  } catch (e) {}
  if (!sos || sos.active === false || !Number.isFinite(Number(sos.lat)) || !Number.isFinite(Number(sos.lng))) {
    return res.status(404).json({ error: 'SOS aktif tidak ditemukan' });
  }

  // Gelombang push berulang. Satu tembakan saja hanya menjangkau perangkat yang online
  // pada detik SOS dibuat; HP yang layarnya mati atau kehilangan sinyal tidak akan pernah
  // diberi tahu. Selama SOS aktif, setiap jendela WAVE_MINUTES boleh mengirim satu gelombang
  // baru, dan penanda (sos_id, wave) tetap menjaga agar tidak dobel dalam jendela yang sama.
  const WAVE_MINUTES = 2.5, WAVE_MAX = 10;
  const createdAt = Date.parse(sos.created_at || '') || Date.now();
  const ageMin = Math.max(0, (Date.now() - createdAt) / 60_000);
  const wave = Math.min(WAVE_MAX, Math.floor(ageMin / WAVE_MINUTES) + 1);

  // TEMUAN S3: dulu, bila tabel sos_push_deliveries belum dibuat / tidak bisa ditulis,
  // seluruh pengiriman push DIBATALKAN dengan 503. Artinya mekanisme anti-dobel — yang
  // hanya bersifat kenyamanan — diizinkan mematikan penyelamatan nyawa. Sekarang sistem
  // GAGAL-TERBUKA: bila klaim tidak bisa dilakukan, push tetap dikirim dan risikonya
  // (kemungkinan notifikasi dobel) dilaporkan lewat duplicateRisk agar tetap terlihat.
  let duplicateRisk = false;
  try {
    const claim = await fetch(SB_URL + '/rest/v1/sos_push_deliveries', {
      method: 'POST', headers: headers(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ sos_id: String(sos.id), wave }), signal: AbortSignal.timeout(8000)
    });
    if (claim.status === 409) return res.status(200).json({ sent: 0, wave, duplicate: true });
    if (!claim.ok) {
      duplicateRisk = true;
      let why = '';
      try { why = String(await claim.text()).slice(0, 200); } catch (e) {}
      console.error('[sos-push] klaim anti-dobel gagal (' + claim.status + '), push tetap dilanjutkan:', why);
    }
  } catch (e) {
    duplicateRisk = true;
    console.error('[sos-push] klaim anti-dobel tidak dapat dihubungi, push tetap dilanjutkan:', (e && e.message) || e);
  }

  try { webpush.setVapidDetails(subject, vapidPublic, vapidPrivate); }
  catch (e) { return res.status(503).json({ error: 'Kunci VAPID tidak valid', code: 'BAD_VAPID' }); }

  // Satu sumber kebenaran radius, sama dengan api/operations.js dan window.BWK_SOS_RADIUS_M.
  const RADIUS = Number(process.env.SOS_RADIUS_M || 20000);
  const lat = Number(sos.lat), lng = Number(sos.lng);
  // Koordinat basi lebih berbahaya daripada koordinat kosong: perangkat yang mendaftar
  // di kota lalu naik gunung akan tersaring keluar radius dan alarmnya tidak berbunyi.
  const STALE_MS = 3 * 24 * 3600_000;
  // Filter awal memakai bounding box di database agar tidak memuat semua perangkat saat pengguna bertambah.
  const dLat = RADIUS / 111320;
  const dLng = RADIUS / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  let subs = [];
  try {
    const u = new URL(SB_URL + '/rest/v1/push_subscriptions');
    u.searchParams.set('select', 'endpoint,p256dh,auth,lat,lng,device,loc_updated_at');
    u.searchParams.set('active', 'eq.true');

    // PERBAIKAN BUG: sintaks PostgREST `or` yang benar menggunakan dua kondisi terpisah:
    //   or(and(box_filter), lat.is.null)
    // Versi lama memakai "(and(...),lat.is.null,...)" yang tidak valid — semua kondisi
    // diperlakukan setara di dalam `or`, bukan bersarang `and` + `or`. Akibatnya
    // perangkat tanpa koordinat tidak pernah lolos filter dan tidak menerima push SOS.
    //
    // Strategi: ambil perangkat di bounding box ± radius (filter kasar di DB),
    // lalu saring lagi per haversine di server (filter presisi). Perangkat tanpa lokasi
    // atau dengan koordinat basi selalu dimasukkan agar tidak ada yang terlewat.
    const staleISOStr = new Date(Date.now() - STALE_MS).toISOString();
    const latMin = (lat - dLat).toFixed(6);
    const latMax = (lat + dLat).toFixed(6);
    const lngMin = (lng - dLng).toFixed(6);
    const lngMax = (lng + dLng).toFixed(6);

    // Dua kondisi yang di-OR-kan:
    // 1. Perangkat dalam bounding box: and(lat.gte.X,lat.lte.X,lng.gte.X,lng.lte.X)
    // 2. Perangkat tanpa lokasi valid: lat.is.null
    // 3. Perangkat dengan koordinat basi: loc_updated_at.lt.TIMESTAMP
    // Gabungkan dengan or() sesuai spesifikasi PostgREST:
    //   or=(and(lat.gte.X,lat.lte.X,lng.gte.X,lng.lte.X),lat.is.null,loc_updated_at.lt.ISO)
    const orFilter = [
      'and(lat.gte.' + latMin + ',lat.lte.' + latMax + ',lng.gte.' + lngMin + ',lng.lte.' + lngMax + ')',
      'lat.is.null',
      'loc_updated_at.lt.' + staleISOStr
    ].join(',');
    u.searchParams.set('or', '(' + orFilter + ')');

    let r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      // Fallback: jika query filter 'or' kompleks gagal/400, ambil semua langganan aktif
      const fallbackUrl = new URL(SB_URL + '/rest/v1/push_subscriptions');
      fallbackUrl.searchParams.set('select', 'endpoint,p256dh,auth,lat,lng,device,loc_updated_at');
      fallbackUrl.searchParams.set('active', 'eq.true');
      fallbackUrl.searchParams.set('limit', '500');
      r = await fetch(fallbackUrl, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    }
    if (r.ok) subs = await r.json();
  } catch (e) {}
  if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ sent: 0, total: 0, duplicateRisk });

  const plus = sos.plus_code ? String(sos.plus_code).slice(0, 16) : '';
  const payload = JSON.stringify({
    title: '🚨 ' + String(sos.name || 'Pendaki').slice(0, 80) + ' butuh bantuan',
    body: 'ADA SOS DARURAT! ' + String(sos.name || 'Seorang pendaki') + ' membutuhkan bantuan segera di dekatmu. Ketuk untuk membuka.',
    id: String(sos.id), tag: 'sos-' + String(sos.id), url: '/?sos=' + encodeURIComponent(String(sos.id)), urgency: 'high'
  });
  // Payload tambahan untuk retry (dikirim setelah 5 detik jika app tidak merespon)
  const payloadRetry = JSON.stringify({
    title: '🚨 SOS TIDAK DIBACA! Buka sekarang!',
    body: 'Notifikasi SOS sebelumnya diabaikan. Ketuk untuk membuka aplikasi.',
    id: String(sos.id), tag: 'sos-' + String(sos.id) + '-retry', url: '/?sos=' + encodeURIComponent(String(sos.id)), urgency: 'high', retryCount: 1
  });
  const targets = subs.filter(s => {
    if (!s || !s.endpoint || !s.p256dh || !s.auth) return false;
    if (s.device && sos.device && s.device === sos.device) return false;
    const sLat = Number(s.lat), sLng = Number(s.lng);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return true; // lokasi belum diketahui
    const seg = s.loc_updated_at ? Date.parse(s.loc_updated_at) : 0;
    if (!seg || (Date.now() - seg) > STALE_MS) return true; // koordinat basi = anggap tidak diketahui
    return dist(lat, lng, sLat, sLng) <= RADIUS;
  }); // Tambah admin yang berlangganan push ke semua SOS (tanpa filter radius)
  const adminSubs = subs.filter(s => s.role === 'admin' && s.endpoint && s.p256dh && s.auth);
  if (adminSubs.length) {
    for (let i = 0; i < adminSubs.length; i += 12) {
    await Promise.all(adminSubs.slice(i, i + 12).map(async s => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 1800, urgency: 'high' });
          sent++;
        } catch (err) {
          failed++;
          lastError = String((err && err.message) || 'gagal');
        }
      }));
   }
  }
  
  const dead = []; let sent = 0, failed = 0, lastError = '';
  // Batas 12 koneksi bersamaan: cepat tanpa membebani server/push gateway.
  for (let i = 0; i < targets.length; i += 12) {
    await Promise.all(targets.slice(i, i + 12).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 1800, urgency: 'high' });
        sent++;
      } catch (err) {
        const sc = err && err.statusCode;
        if (sc === 404 || sc === 410) dead.push(s.endpoint);
        else { failed++; lastError = sc ? ('HTTP ' + sc) : String((err && err.message) || 'gagal'); }
      }
    }));
  }
  
  // RETRY: Kirim ulang setelah 5 detik jika app mungkin tidak merespon
  if (sent > 0 && ageMin < 10) {
    setTimeout(async () => {
      try {
        await Promise.all(targets.slice(0, 12).map(async s => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payloadRetry, { TTL: 1800, urgency: 'high' });
          } catch(err2) {}
        }));
      } catch(e) {}
    }, 5000);
  }
  if (dead.length) await Promise.all(dead.map(ep => {
    const u = new URL(SB_URL + '/rest/v1/push_subscriptions'); u.searchParams.set('endpoint', 'eq.' + ep);
    return fetch(u, { method: 'DELETE', headers: headers(key), signal: AbortSignal.timeout(6000) }).catch(() => {});
  }));
  // Balasan menyertakan jumlah gagal + penyebab terakhir supaya masalah VAPID / gateway
  // tidak lagi tak terlihat (dulu semua error selain 404/410 dibuang diam-diam).
  return res.status(200).json({ sent, failed, total: targets.length, wave, duplicateRisk, error: lastError || undefined });
}
