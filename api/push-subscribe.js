import { rateLimit, secureApi } from '../lib/security.js';
import { createECDH } from 'node:crypto';

// Simpan atau perbarui langganan Web Push lewat server.
// Service Role digunakan hanya di server sehingga endpoint/push key tidak bisa dibaca klien publik.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['GET', 'POST'])) return;
  // GET = kunci publik VAPID + diagnostik. Tidak pernah mengembalikan nilai rahasia.
  if (req.method === 'GET') {
    if (!rateLimit(req, res, { prefix: 'push-key', limit: 120, windowMs: 10 * 60_000 })) return;
    return handleGet(req, res);
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
    endpoint, p256dh: p256dh.slice(0, 512), auth: auth.slice(0, 512),
    device: String(b.device || '').slice(0, 80),
    name: String(b.name || 'Pendaki').slice(0, 80),
    active: true, updated_at: new Date().toISOString()
  };
  // Jejak kapan koordinat terakhir diperbarui, untuk audit radius push.
  if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng))) row.loc_updated_at = new Date().toISOString();
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

// ==========================================================================
// Rute GET: menyajikan kunci VAPID publik ke klien, plus diagnostik ?diag=1.
//
// Kenapa perlu: kunci publik dulu ditanam keras di push.js. Kalau nilai env
// VAPID_PUBLIC di server berbeda satu karakter saja, SETIAP pengiriman push
// ditolak 403 dan alarm SOS tidak pernah sampai ke perangkat lain. Karena env
// di Vercel ditandai Sensitive dan tidak bisa dilihat lagi setelah disimpan,
// mismatch itu mustahil diperiksa manual. Sekarang klien mengambil kuncinya
// dari server, jadi keduanya tidak mungkin berbeda.
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

  // 1. Apakah VAPID_PUBLIC benar-benar pasangan matematis dari VAPID_PRIVATE?
  //    Kunci publik P-256 bisa diturunkan dari privatnya, jadi ini bisa diuji
  //    tanpa pernah membocorkan nilai apa pun.
  let pair = 'tidak dapat diperiksa';
  if (pub && priv) {
    try {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(priv.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      pair = b64url(ecdh.getPublicKey()) === pub ? 'COCOK' : 'TIDAK COCOK';
    } catch (e) { pair = 'VAPID_PRIVATE tidak dapat dibaca'; }
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

  // 2. Apakah migrasi supabase-sos-optimasi.sql sudah dijalankan?
  let migrasi = 'tidak dapat diperiksa';
  if (h) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/sos_push_deliveries?select=wave&limit=1',
        { headers: h, signal: AbortSignal.timeout(7000) });
      migrasi = r.ok ? 'sudah dijalankan' : 'BELUM dijalankan (kolom wave tidak ada)';
    } catch (e) { migrasi = 'Supabase tidak dapat dihubungi'; }
  }

  // 3. Berapa perangkat yang benar-benar siap menerima alarm?
  let perangkat = { total: 0, ada_lokasi: 0, tanpa_lokasi: 0, lokasi_segar_24j: 0, lokasi_basi: 0 };
  if (h) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/push_subscriptions?select=lat,lng,loc_updated_at&active=eq.true&limit=1000',
        { headers: h, signal: AbortSignal.timeout(7000) });
      if (r.ok) {
        const rows = await r.json();
        const batas = Date.now() - 24 * 3600_000;
        for (const s of (Array.isArray(rows) ? rows : [])) {
          perangkat.total++;
          const ok = Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng));
          if (ok) perangkat.ada_lokasi++; else perangkat.tanpa_lokasi++;
          if (s.loc_updated_at && Date.parse(s.loc_updated_at) > batas) perangkat.lokasi_segar_24j++;
          else if (ok) perangkat.lokasi_basi++;
        }
      }
    } catch (e) { /* biarkan nol */ }
  }

  // 4. Kesimpulan yang bisa langsung dibaca manusia.
  // WAJIB = alarm mustahil bekerja tanpa ini. OPSIONAL = saran, tidak memblokir.
  // Dulu keduanya dicampur sehingga "siap" ikut false hanya karena saran kosmetik.
  const wajib = [], opsional = [];
  if (pair === 'TIDAK COCOK') wajib.push('VAPID_PUBLIC dan VAPID_PRIVATE bukan sepasang. Buat pasangan baru: npx web-push generate-vapid-keys, lalu simpan KEDUANYA di Vercel dan redeploy.');
  if (pair === 'VAPID_PRIVATE tidak dapat dibaca') wajib.push('Nilai VAPID_PRIVATE rusak atau salah format. Simpan ulang kunci privat base64url apa adanya, tanpa tanda kutip atau spasi.');
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) wajib.push('Isi VAPID_PUBLIC dan VAPID_PRIVATE di Vercel, lalu redeploy.');
  if (!env.VAPID_SUBJECT) wajib.push('Isi VAPID_SUBJECT dengan mailto:emailmu@domain.com.');
  if (!env.SUPABASE_ANON_KEY) wajib.push('Isi SUPABASE_ANON_KEY, kalau tidak verifikasi login gagal dan semua SOS dibalas 401.');
  if (!env.SUPABASE_SERVICE_ROLE) wajib.push('Isi SUPABASE_SERVICE_ROLE, kalau tidak SOS tidak tersimpan sama sekali.');
  if (migrasi.startsWith('BELUM')) wajib.push('Jalankan supabase-sos-optimasi.sql di Supabase SQL Editor, kalau tidak gelombang push ulang selalu ditolak.');
  if (perangkat.total === 0) wajib.push('Belum ada perangkat yang mengizinkan notifikasi. Buka aplikasi di HP lain, tekan Izinkan pada banner notifikasi.');
  else if (perangkat.total === 1) wajib.push('Baru 1 perangkat terdaftar. Alarm butuh minimal 2 agar bisa diuji silang.');

  if (!env.ALLOWED_ORIGINS) opsional.push('ALLOWED_ORIGINS kosong. Tidak masalah: host sendiri sudah otomatis diizinkan. Isi hanya bila memakai domain kustom tambahan.');
  if (!env.SUPABASE_URL) opsional.push('SUPABASE_URL kosong. Kode memakai nilai bawaan, tetapi sebaiknya diisi eksplisit.');
  if (perangkat.lokasi_basi > 0) opsional.push(perangkat.lokasi_basi + ' perangkat punya koordinat yang belum disegarkan. Mereka tetap dikirimi alarm (tidak disaring radius), dan koordinatnya otomatis diperbarui saat pemiliknya membuka aplikasi versi baru.');

  const siap = wajib.length === 0;
  const ringkasan = siap
    ? 'Semua syarat wajib terpenuhi. Uji kirim SOS dari satu HP dan pastikan HP lain berbunyi.'
    : 'Ada ' + wajib.length + ' hal wajib yang belum beres.';

  return res.status(200).json({ siap, ringkasan, env, vapidPair: pair, migrasi, perangkat, wajib, opsional });
}
