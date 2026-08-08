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
  let sos;
  try {
    const u = new URL(SB_URL + '/rest/v1/sos_alerts');
    u.searchParams.set('select', 'id,lat,lng,name,device,active,created_at');
    u.searchParams.set('id', 'eq.' + sosId);
    u.searchParams.set('limit', '1');
    const r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(8000) });
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
  try {
    const claim = await fetch(SB_URL + '/rest/v1/sos_push_deliveries', {
      method: 'POST', headers: headers(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ sos_id: String(sos.id), wave }), signal: AbortSignal.timeout(8000)
    });
    if (claim.status === 409) return res.status(200).json({ sent: 0, wave, duplicate: true });
    if (!claim.ok) return res.status(503).json({ error: 'Antidobel push belum siap', code: 'NO_CLAIM' });
  } catch (e) { return res.status(502).json({ error: 'Server push tidak dapat dihubungi' }); }

  try { webpush.setVapidDetails(subject, vapidPublic, vapidPrivate); }
  catch (e) { return res.status(503).json({ error: 'Kunci VAPID tidak valid', code: 'BAD_VAPID' }); }

  const RADIUS = 20000, lat = Number(sos.lat), lng = Number(sos.lng);
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
    // "or": perangkat di bounding box 20 km, ATAU perangkat yang belum punya koordinat.
    // Lebih baik satu notifikasi berlebih daripada pendaki di radius bahaya tidak diberi tahu.
    const box = '(lat.gte.' + (lat - dLat) + ',lat.lte.' + (lat + dLat) + ',lng.gte.' + (lng - dLng) + ',lng.lte.' + (lng + dLng) + ')';
    const staleISO = new Date(Date.now() - STALE_MS).toISOString();
    u.searchParams.set('or', '(and' + box + ',lat.is.null,lng.is.null,loc_updated_at.is.null,loc_updated_at.lt.' + staleISO + ')');
    const r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (r.ok) subs = await r.json();
  } catch (e) {}
  if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ sent: 0, total: 0 });

  const payload = JSON.stringify({
    title: '\uD83C\uDD98 ' + String(sos.name || 'Pendaki').slice(0, 80) + ' butuh bantuan',
    body: 'Ada sinyal SOS darurat di dekatmu. Ketuk untuk membuka peta & koordinasi bantuan.',
    id: String(sos.id), tag: 'sos-' + String(sos.id), url: '/'
  });
  const targets = subs.filter(s => {
    if (!s || !s.endpoint || !s.p256dh || !s.auth) return false;
    if (s.device && sos.device && s.device === sos.device) return false;
    const sLat = Number(s.lat), sLng = Number(s.lng);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return true; // lokasi belum diketahui
    const seg = s.loc_updated_at ? Date.parse(s.loc_updated_at) : 0;
    if (!seg || (Date.now() - seg) > STALE_MS) return true; // koordinat basi = anggap tidak diketahui
    return dist(lat, lng, sLat, sLng) <= RADIUS;
  });
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
  if (dead.length) await Promise.all(dead.map(ep => {
    const u = new URL(SB_URL + '/rest/v1/push_subscriptions'); u.searchParams.set('endpoint', 'eq.' + ep);
    return fetch(u, { method: 'DELETE', headers: headers(key), signal: AbortSignal.timeout(6000) }).catch(() => {});
  }));
  // Balasan menyertakan jumlah gagal + penyebab terakhir supaya masalah VAPID / gateway
  // tidak lagi tak terlihat (dulu semua error selain 404/410 dibuang diam-diam).
  return res.status(200).json({ sent, failed, total: targets.length, wave, error: lastError || undefined });
}
