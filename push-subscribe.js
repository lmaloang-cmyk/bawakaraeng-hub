import { rateLimit, secureApi } from '../lib/security.js';

// Simpan atau perbarui langganan Web Push lewat server.
// Service Role digunakan hanya di server sehingga endpoint/push key tidak bisa dibaca klien publik.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { prefix: 'push-sub', limit: 12, windowMs: 10 * 60_000 })) return;

  const SB_URL = process.env.SUPABASE_URL || 'https://ncoueeeskzslldppsbvx.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(503).json({ error: 'Push belum dikonfigurasi', code: 'NO_SB' });

  const b = req.body || {};
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const p256dh = typeof b.p256dh === 'string' ? b.p256dh : '';
  const auth = typeof b.auth === 'string' ? b.auth : '';
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 4096 || !p256dh || !auth) {
    return res.status(400).json({ error: 'Langganan notifikasi tidak valid' });
  }

  const row = {
    endpoint, p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 512),
    device: String(b.device || '').slice(0, 80),
    name: String(b.name || 'Pendaki').slice(0, 80),
    active: true, updated_at: new Date().toISOString()
  };
  // Tanpa lokasi, perangkat tidak masuk radius push; aplikasi tetap meminta GPS saat SOS.
  if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    row.lat = lat; row.lng = lng;
  }

  try {
    const r = await fetch(SB_URL + '/rest/v1/push_subscriptions?on_conflict=endpoint', {
      method: 'POST',
      headers: {
        apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(row), signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return res.status(502).json({ error: 'Gagal menyimpan langganan push' });
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(502).json({ error: 'Server push tidak dapat dihubungi' }); }
}
