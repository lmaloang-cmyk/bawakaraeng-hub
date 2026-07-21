import webpush from 'web-push';
import { rateLimit, secureApi } from '../lib/security.js';

// Kirim Web Push ke perangkat pendaki lain di dekat lokasi SOS (radius 20 km),
// supaya peringatan tetap masuk walau aplikasi tertutup / layar HP mati.
function dist(la1, lo1, la2, lo2) {
  const R = 6371000, tr = Math.PI / 180;
  const dLa = (la2 - la1) * tr, dLo = (lo2 - lo1) * tr;
  const a = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(la1 * tr) * Math.cos(la2 * tr) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { prefix: 'sos-push', limit: 30, windowMs: 10 * 60_000 })) return;

  const pub = process.env.VAPID_PUBLIC;
  const priv = process.env.VAPID_PRIVATE;
  const subject = process.env.VAPID_SUBJECT || 'mailto:sos@bawakaraeng-hub.vercel.app';
  const SB_URL = process.env.SUPABASE_URL || 'https://ncoueeeskzslldppsbvx.supabase.co';
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;
  if (!pub || !priv) return res.status(503).json({ error: 'Push belum dikonfigurasi (VAPID)', code: 'NO_VAPID' });
  if (!SB_SERVICE) return res.status(503).json({ error: 'Push belum dikonfigurasi (Supabase service role)', code: 'NO_SB' });

  const body = req.body || {};
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const name = String(body.name || 'Pendaki').slice(0, 80);
  const senderDevice = String(body.device || '').slice(0, 80);
  const sosId = body.id != null ? String(body.id).slice(0, 60) : '';
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: 'Lokasi tidak valid' });

  try { webpush.setVapidDetails(subject, pub, priv); }
  catch (e) { return res.status(503).json({ error: 'Kunci VAPID tidak valid', code: 'BAD_VAPID' }); }

  const RADIUS = 20000;

  // Ambil semua langganan push aktif (service role melewati RLS).
  let subs = [];
  try {
    const r = await fetch(SB_URL + '/rest/v1/push_subscriptions?select=endpoint,p256dh,auth,lat,lng,device&active=eq.true', {
      headers: { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) subs = await r.json();
  } catch (e) {}
  if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ sent: 0, total: 0 });

  const payload = JSON.stringify({
    title: '\uD83C\uDD98 ' + name + ' butuh bantuan',
    body: 'Ada sinyal SOS darurat di dekatmu. Ketuk untuk membuka peta & koordinasi bantuan.',
    id: sosId,
    tag: 'sos-' + (sosId || Date.now()),
    url: '/'
  });

  const dead = [];
  let sent = 0;
  await Promise.all(subs.map(async function (s) {
    try {
      if (!s || !s.endpoint || !s.p256dh || !s.auth) return;
      if (senderDevice && s.device === senderDevice) return; // jangan kirim ke pengirim SOS
      if (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))) {
        if (dist(lat, lng, Number(s.lat), Number(s.lng)) > RADIUS) return;
      }
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 1800, urgency: 'high' });
      sent++;
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }));

  // Bersihkan langganan mati (endpoint kedaluwarsa).
  if (dead.length) {
    await Promise.all(dead.map(function (ep) {
      return fetch(SB_URL + '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(ep), {
        method: 'DELETE',
        headers: { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE },
        signal: AbortSignal.timeout(6000)
      }).catch(function () {});
    }));
  }

  return res.status(200).json({ sent, total: subs.length });
}
