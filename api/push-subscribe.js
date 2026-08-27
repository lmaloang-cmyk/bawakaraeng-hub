import { rateLimit, secureApi } from '../lib/security.js';
import crypto from 'crypto';

// Simpan atau perbarui langganan Web Push lewat server.
// Service Role digunakan hanya di server sehingga endpoint/push key tidak bisa dibaca klien publik.
export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, private');
    if (!secureApi(req, res, ['GET', 'POST'])) return;

    // GET = kunci publik VAPID + diagnostik. Tidak pernah mengembalikan nilai rahasia.
    if (req.method === 'GET') {
      if (!rateLimit(req, res, { prefix: 'push-key', limit: 120, windowMs: 10 * 60_000 })) return;
      return await handleGet(req, res);
    }
    if (!rateLimit(req, res, { prefix: 'push-sub', limit: 60, windowMs: 10 * 60_000 })) return;

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
      endpoint,
      p256dh: p256dh.slice(0, 512),
      auth: auth.slice(0, 512),
      device: String(b.device || '').slice(0, 80),
      name: String(b.name || 'Pendaki').slice(0, 80),
      active: true,
      updated_at: new Date().toISOString(),
      role: String(b.role || '').slice(0, 20),
      user_email: String(b.user_email || '').slice(0, 254)
    };
    // Jejak kapan koordinat terakhir diperbarui, untuk audit radius push.
    if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) row.loc_updated_at = new Date().toISOString();
    // Tanpa lokasi, perangkat tidak masuk radius push; aplikasi tetap meminta GPS saat SOS.
    if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
      row.lat = lat; row.lng = lng;
    }

    // Fetch ke Supabase tanpa try/catch dulu jatuh ke catch terluar sebagai 500
    // tanpa keterangan (di DevTools hanya terlihat "500 Internal Server Error").
    // Laporkan sebagai 502 dengan detail supaya penyebabnya bisa didiagnosis.
    let r;
    try {
      r = await fetch(SB_URL + '/rest/v1/push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        headers: {
          apikey: key, Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(row), signal: AbortSignal.timeout(8000)
      });
    } catch (e) {
      return res.status(502).json({ error: 'Supabase tidak dapat dihubungi', detail: String((e && e.message) || e) });
    }
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Gagal menyimpan langganan push', detail });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[push-subscribe] Error:', e);
    return res.status(500).json({ error: 'Server push error', detail: (e && e.message) || String(e) });
  }
}

// ==========================================================================
// Rute GET: menyajikan kunci VAPID publik ke klien, plus diagnostik ?diag=1.
// ==========================================================================
function normKey(s) {
  return String(s || '').trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function handleGet(req, res) {
  const pub = normKey(process.env.VAPID_PUBLIC);
  const priv = String(process.env.VAPID_PRIVATE || '');
  const diag = String((req.query && req.query.diag) || '') === '1';

  if (!diag) {
    return res.status(200).json({ key: pub || null, ok: !!pub });
  }

  let pair = 'tidak dapat diperiksa';
  if (pub && priv) {
    try {
      if (crypto && crypto.createECDH) {
        const ecdh = crypto.createECDH('prime256v1');
        ecdh.setPrivateKey(Buffer.from(priv.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
        pair = b64url(ecdh.getPublicKey()) === pub ? 'COCOK' : 'TIDAK COCOK';
      }
    } catch (e) { pair = 'VAPID_PRIVATE tidak dapat dibaca: ' + ((e && e.message) || e); }
  }

  const env = {
    VAPID_PUBLIC: !!pub,
    VAPID_PRIVATE: !!priv,
    VAPID_SUBJECT: !!process.env.VAPID_SUBJECT,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE: !!(process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY),
    ALLOWED_ORIGINS: !!(process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN)
  };

  const SB_URL = process.env.SUPABASE_URL || 'https://ncoueeeskzslldppsbvx.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY;
  const h = key ? { apikey: key, Authorization: 'Bearer ' + key } : null;

  let migrasi = 'tidak dapat diperiksa';
  if (h) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/sos_push_deliveries?select=wave&limit=1',
        { headers: h, signal: AbortSignal.timeout(7000) });
      migrasi = r.ok ? 'sudah dijalankan' : 'BELUM dijalankan (kolom wave tidak ada)';
    } catch (e) { migrasi = 'Supabase tidak dapat dihubungi'; }
  }

  let perangkat = { total: 0, ada_lokasi: 0, tanpa_lokasi: 0, lokasi_segar_24j: 0, lokasi_basi: 0 };
  if (h) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/push_subscriptions?select=lat,lng,loc_updated_at&active=eq.true&limit=1000',
        { headers: h, signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const rows = await r.json();
        const batas = Date.now() - 24 * 3600_000, basi = Date.now() - 3 * 24 * 3600_000;
        for (const s of (Array.isArray(rows) ? rows : [])) {
          perangkat.total++;
          const ok = Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng));
          if (ok) perangkat.ada_lokasi++; else perangkat.tanpa_lokasi++;
          if (s.loc_updated_at && Date.parse(s.loc_updated_at) > batas) perangkat.lokasi_segar_24j++;
          if (ok && !(s.loc_updated_at && Date.parse(s.loc_updated_at) > basi)) perangkat.lokasi_basi++;
        }
      }
    } catch (e) {}
  }

  const KOLOM_SOS = ['id', 'lat', 'lng', 'name', 'device', 'user_id', 'user_email', 'active', 'status', 'created_at'];
  let tabelSos = 'tidak diperiksa';
  const kolomHilang = [];
  if (h) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/sos_alerts?select=' + KOLOM_SOS.join(',') + '&limit=1',
        { headers: h, signal: AbortSignal.timeout(7000) });
      if (r.ok) tabelSos = 'lengkap';
      else {
        for (const c of KOLOM_SOS) {
          try {
            const one = await fetch(SB_URL + '/rest/v1/sos_alerts?select=' + c + '&limit=1',
              { headers: h, signal: AbortSignal.timeout(5000) });
            if (!one.ok) kolomHilang.push(c);
          } catch (e) {}
        }
        tabelSos = kolomHilang.length ? ('kekurangan ' + kolomHilang.length + ' kolom') : 'ditolak tanpa kolom hilang';
      }
    } catch (e) { tabelSos = 'Supabase tidak dapat dihubungi'; }
  }

  const wajib = [], opsional = [];
  if (pair === 'TIDAK COCOK') wajib.push('VAPID_PUBLIC dan VAPID_PRIVATE bukan sepasang.');
  if (pair.startsWith('VAPID_PRIVATE tidak dapat dibaca')) wajib.push('Nilai VAPID_PRIVATE rusak atau salah format.');
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) wajib.push('Isi VAPID_PUBLIC dan VAPID_PRIVATE di Vercel.');
  if (!env.VAPID_SUBJECT) wajib.push('Isi VAPID_SUBJECT dengan mailto:emailmu@domain.com.');
  if (!env.SUPABASE_ANON_KEY) wajib.push('Isi SUPABASE_ANON_KEY di Vercel.');
  if (!env.SUPABASE_SERVICE_ROLE) wajib.push('Isi SUPABASE_SERVICE_ROLE di Vercel.');
  if (migrasi.startsWith('BELUM')) wajib.push('Jalankan supabase-sos-optimasi.sql di Supabase SQL Editor.');
  if (kolomHilang.length) wajib.push('Tabel sos_alerts kekurangan kolom: ' + kolomHilang.join(', '));
  if (perangkat.total === 0) wajib.push('Belum ada perangkat yang mengizinkan notifikasi.');
  const siap = wajib.length === 0;
  const ringkasan = siap
    ? 'Semua syarat wajib terpenuhi.'
    : (wajib.length + ' hal wajib diperbaiki sebelum alarm bisa diandalkan.');

  return res.status(200).json({ siap, ringkasan, env, vapidPair: pair, migrasi, tabelSos, kolomHilang, perangkat, wajib, opsional });
}
