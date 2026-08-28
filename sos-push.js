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
  if (!rateLimit(req, res, { prefix: 'sos-push', limit: 20, windowMs: 10 * 60_000 })) return;

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

  // Satu SOS hanya boleh menghasilkan satu gelombang push, meski browser retry/refresh.
  try {
    const claim = await fetch(SB_URL + '/rest/v1/sos_push_deliveries', {
      method: 'POST', headers: headers(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ sos_id: String(sos.id) }), signal: AbortSignal.timeout(8000)
    });
    if (claim.status === 409) return res.status(200).json({ sent: 0, duplicate: true });
    if (!claim.ok) return res.status(503).json({ error: 'Antidobel push belum siap', code: 'NO_CLAIM' });
  } catch (e) { return res.status(502).json({ error: 'Server push tidak dapat dihubungi' }); }

  try { webpush.setVapidDetails(subject, vapidPublic, vapidPrivate); }
  catch (e) { return res.status(503).json({ error: 'Kunci VAPID tidak valid', code: 'BAD_VAPID' }); }

  const RADIUS = 20000, lat = Number(sos.lat), lng = Number(sos.lng);
  // Filter awal memakai bounding box di database agar tidak memuat semua perangkat saat pengguna bertambah.
  const dLat = RADIUS / 111320;
  const dLng = RADIUS / (111320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
  let subs = [];
  try {
    const u = new URL(SB_URL + '/rest/v1/push_subscriptions');
    u.searchParams.set('select', 'endpoint,p256dh,auth,lat,lng,device');
    u.searchParams.set('active', 'eq.true');
    u.searchParams.set('and', '(lat.gte.' + (lat - dLat) + ',lat.lte.' + (lat + dLat) + ',lng.gte.' + (lng - dLng) + ',lng.lte.' + (lng + dLng) + ')');
    const r = await fetch(u, { headers: headers(key), signal: AbortSignal.timeout(8000) });
    if (r.ok) subs = await r.json();
  } catch (e) {}
  if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ sent: 0, total: 0 });

  const payload = JSON.stringify({
    title: '\uD83C\uDD98 ' + String(sos.name || 'Pendaki').slice(0, 80) + ' butuh bantuan',
    body: 'Ada sinyal SOS darurat di dekatmu. Ketuk untuk membuka peta & koordinasi bantuan.',
    id: String(sos.id), tag: 'sos-' + String(sos.id), url: '/'
  });
  const targets = subs.filter(s => s && s.endpoint && s.p256dh && s.auth && s.device !== sos.device && dist(lat, lng, Number(s.lat), Number(s.lng)) <= RADIUS);
  const dead = []; let sent = 0;
  // Batas 12 koneksi bersamaan: cepat tanpa membebani server/push gateway.
  for (let i = 0; i < targets.length; i += 12) {
    await Promise.all(targets.slice(i, i + 12).map(async s => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 1800, urgency: 'high' });
        sent++;
      } catch (err) { if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.endpoint); }
    }));
  }
  if (dead.length) await Promise.all(dead.map(ep => {
    const u = new URL(SB_URL + '/rest/v1/push_subscriptions'); u.searchParams.set('endpoint', 'eq.' + ep);
    return fetch(u, { method: 'DELETE', headers: headers(key), signal: AbortSignal.timeout(6000) }).catch(() => {});
  }));
  return res.status(200).json({ sent, total: targets.length });
}
