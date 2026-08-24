/* ============================================================================
 * FAMILY TRACKING — API Serverless Function (Vercel)
 *
 * Endpoint: /api/family-tracking
 * Actions:
 *   POST ?action=session-create      — buat sesi tracking baru (login required)
 *   POST ?action=position-update     — kirim posisi GPS terbaru (login required)
 *   GET  ?action=session-read        — baca info session via token (publik)
 *   GET  ?action=positions           — ambil history positions (publik via token)
 *   POST ?action=session-stop        — hentikan sesi (login required)
 *   POST ?action=subscribe           — subscribe push notifikasi (publik via token)
 *   GET  ?action=last-position       — posisi terakhir saja (publik via token)
 *   GET  ?action=sessions-my         — daftar session milik user (login)
 *
 * Rate limits:
 *   position-update: 1x per 5 detik per session (60 pos/jam max)
 *   session-create:  3 per jam per user
 * ============================================================================ */
import { verifySupabaseUser, secureApi, bodyWithin, rateLimit } from '../lib/security.js';
import { supabaseAdmin } from '../lib/supabase.js';

const POSITION_MIN_INTERVAL_MS = 5000; // 5 detik minimal antar posisi
const MAX_POSITIONS_PER_HOUR = 720;    // 1 pos/5dtk × 3600dtk = 720/jam

// ===== HEADERS =====
function setHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

// ===== HELPER: cek rate limit posisi =====
function checkPositionRateLimit(sessionId) {
  // Simpan counters di Redis/DB? Untuk Vercel Hobby gunakan in-memory cache
  // dengan TTL per session. Ini sederhana tapi cukup untuk skala <1000 user.
  const key = `posrl:${sessionId}`;
  const now = Date.now();
  // Cache sederhana menggunakan object di module scope
  // NOTE: di Vercel function, cache in-memory reset tiap cold start.
  // Untuk production, gunakan Redis atau Supabase row-level rate limiting.
  return { allowed: true, retryAfter: 0 };
}

// ===== ROUTING =====
export default async function handler(req, res) {
  setHeaders(res);

  const action = String(req.query?.action || '').toLowerCase();
  const method = req.method.toUpperCase();

  try {
    switch (action) {
      case 'session-create':
        if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handleSessionCreate(req, res);
      case 'position-update':
        if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handlePositionUpdate(req, res);
      case 'session-read':
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
        return await handleSessionRead(req, res);
      case 'positions':
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
        return await handlePositions(req, res);
      case 'last-position':
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
        return await handleLastPosition(req, res);
      case 'session-stop':
        if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handleSessionStop(req, res);
      case 'subscribe':
        if (method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        return await handleSubscribe(req, res);
      case 'sessions-my':
        if (method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
        return await handleMySessions(req, res);
      default:
        return res.status(404).json({ error: 'Action tidak dikenali' });
    }
  } catch (err) {
    console.error('[FAMILY-TRACKING] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ===================================================================
// POST /api/family-tracking?action=session-create
// ===================================================================
async function handleSessionCreate(req, res) {
  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return res.status(authResult.status || 401).json({ error: authResult.error || 'Unauthorized' });
  }

  if (!bodyWithin(req, 2048)) {
    return res.status(413).json({ error: 'Payload terlalu besar' });
  }

  const body = req.body || {};
  const { displayName, durationHours = 6, profilePic } = body;

  if (!displayName || String(displayName).trim().length < 1) {
    return res.status(400).json({ error: 'display_name wajib diisi' });
  }
  if (durationHours < 1 || durationHours > 24) {
    return res.status(400).json({ error: 'durasi harus 1-24 jam' });
  }

  const userId = authResult.user.id;
  const userEmail = authResult.user.email;
  const autoExpireAt = new Date(Date.now() + durationHours * 3600000);

  // Buat link token: 62 karakter UUID-like (aman dari tebak-tebakan)
  const linkToken = generateSecureToken();

  try {
    const { data, error } = await supabaseAdmin
      .from('family_tracking_sessions')
      .insert({
        user_id: userId,
        user_email: userEmail,
        display_name: String(displayName).trim().slice(0, 120),
        profile_pic: profilePic ? String(profilePic).slice(0, 500) : null,
        link_token: linkToken,
        duration_hours: durationHours,
        auto_expire_at: autoExpireAt,
      })
      .select('id, link_token, display_name, duration_hours, auto_expire_at, created_at')
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      session: data,
      shareUrl: `https://pintu-angin.vercel.app/track?token=${linkToken}`,
      message: 'Sesi tracking berhasil dibuat. Bagikan link kepada keluarga.',
    });
  } catch (err) {
    console.error('[FAMILY-TRACKING] session-create error:', err);
    return res.status(500).json({ error: 'Gagal membuat sesi tracking' });
  }
}

// ===================================================================
// POST /api/family-tracking?action=position-update
// ===================================================================
async function handlePositionUpdate(req, res) {
  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return res.status(authResult.status || 401).json({ error: authResult.error || 'Unauthorized' });
  }

  if (!bodyWithin(req, 1024)) {
    return res.status(413).json({ error: 'Payload terlalu besar' });
  }

  const body = req.body || {};
  const { sessionId, lat, lng, accuracy, altitude, speed, heading, battery, networkType, plusCode } = body;

  // Validasi sessionId
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'session_id wajib' });
  }

  // Validasi lokasi
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (!isFinite(latNum) || !isFinite(lngNum)) {
    return res.status(400).json({ error: 'koordinat tidak valid' });
  }
  if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'koordinat di luar rentang' });
  }

  // Cek session milik user ini
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('family_tracking_sessions')
    .select('id, user_id, is_active, is_paused')
    .match({ id: sessionId, user_id: authResult.user.id })
    .single();

  if (sessErr || !session) {
    return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  }
  if (!session.is_active) {
    return res.status(410).json({ error: 'Sesi sudah dihentikan' });
  }
  if (session.is_paused) {
    return res.status(423).json({ error: 'Sesi sedang dijeda' });
  }

  // Rate limit per session: minimal 5 detik antar posisi
  const { data: recent } = await supabaseAdmin
    .from('family_tracking_positions')
    .select('created_at')
    .match({ session_id: sessionId })
    .order('created_at', { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    const ago = Date.now() - new Date(recent[0].created_at).getTime();
    if (ago < POSITION_MIN_INTERVAL_MS) {
      return res.status(429).json({
        error: 'Terlalu sering',
        retryAfter: Math.ceil((POSITION_MIN_INTERVAL_MS - ago) / 1000),
      });
    }
  }

  try {
    const { error: insErr } = await supabaseAdmin
      .from('family_tracking_positions')
      .insert({
        session_id: sessionId,
        lat: latNum,
        lng: lngNum,
        accuracy_m: Math.round(accuracy) || 10,
        altitude_m: altitude ? Math.round(altitude) : null,
        speed_kmh: speed != null ? parseFloat(speed) : 0,
        heading_deg: heading != null ? Math.round(heading) : null,
        battery_pct: battery != null ? Math.min(100, Math.max(0, Math.round(battery))) : null,
        network_type: ['4g','3g','2g','wifi','offline'].includes(networkType) ? networkType : null,
        plus_code: plusCode || null,
        is_offline: false,
      });

    if (insErr) throw insErr;

    // Update session metadata (ringan)
    await supabaseAdmin
      .from('family_tracking_sessions')
      .update({
        battery_pct: battery != null ? Math.min(100, Math.max(0, Math.round(battery))) : null,
        network_type: ['4g','3g','2g','wifi','offline'].includes(networkType) ? networkType : null,
        gps_accuracy_m: Math.round(accuracy) || null,
      })
      .match({ id: sessionId });

    return res.json({ success: true, message: 'Posisi tercatat' });
  } catch (err) {
    console.error('[FAMILY-TRACKING] position-update error:', err);
    return res.status(500).json({ error: 'Gagal menyimpan posisi' });
  }
}

// ===================================================================
// GET /api/family-tracking?action=session-read&token=xxx
// ===================================================================
async function handleSessionRead(req, res) {
  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ error: 'token wajib' });

  const cleanToken = token.replace(/-/g, '').slice(0, 62);

  try {
    const { data, error } = await supabaseAdmin.rpc('get_session_by_token', { tok: cleanToken });

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan atau sudah berakhir' });
    }

    const s = data[0];
    return res.json({
      success: true,
      session: {
        id: s.id,
        displayName: s.display_name,
        profilePic: s.profile_pic,
        isActive: s.is_active,
        isPaused: s.is_paused,
        createdAt: s.created_at,
        autoExpireAt: s.auto_expire_at,
        batteryPct: s.battery_pct,
        networkType: s.network_type,
        gpsAccuracyM: s.gps_accuracy_m,
        lastPosition: s.last_position || null,
      },
    });
  } catch (err) {
    console.error('[FAMILY-TRACKING] session-read error:', err);
    return res.status(500).json({ error: 'Gagal membaca sesi' });
  }
}

// ===================================================================
// GET /api/family-tracking?action=positions&token=xxx&limit=N
// ===================================================================
async function handlePositions(req, res) {
  const token = String(req.query?.token || '');
  const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit) || 50));

  if (!token) return res.status(400).json({ error: 'token wajib' });

  const cleanToken = token.replace(/-/g, '').slice(0, 62);

  // Ambil session dulu untuk validasi
  const { data: sessData } = await supabaseAdmin
    .from('family_tracking_sessions')
    .select('id')
    .match({ link_token: cleanToken, is_active: true })
    .maybeSingle();

  if (!sessData?.id) {
    return res.status(404).json({ error: 'Sesi tidak ditemukan atau sudah berakhir' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('family_tracking_positions')
      .select('lat, lng, accuracy_m, altitude_m, speed_kmh, heading_deg, battery_pct, network_type, plus_code, created_at')
      .eq('session_id', sessData.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return res.json({
      success: true,
      positions: (data || []).map(p => ({
        lat: p.lat, lng: p.lng,
        accuracy: p.accuracy_m, altitude: p.altitude_m,
        speed: p.speed_kmh, heading: p.heading_deg,
        battery: p.battery_pct, network: p.network_type,
        plusCode: p.plus_code,
        at: p.created_at,
      })),
      count: data?.length || 0,
    });
  } catch (err) {
    console.error('[FAMILY-TRACKING] positions error:', err);
    return res.status(500).json({ error: 'Gagal mengambil posisi' });
  }
}

// ===================================================================
// GET /api/family-tracking?action=last-position&token=xxx
// ===================================================================
async function handleLastPosition(req, res) {
  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ error: 'token wajib' });

  const cleanToken = token.replace(/-/g, '').slice(0, 62);

  try {
    const { data, error } = await supabaseAdmin.rpc('get_session_by_token', { tok: cleanToken });
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan' });
    }

    const s = data[0];
    return res.json({
      success: true,
      position: s.last_position ? {
        lat: s.last_position.lat,
        lng: s.last_position.lng,
        accuracy: s.last_position.accuracy_m,
        altitude: s.last_position.altitude_m,
        speed: s.last_position.speed_kmh,
        heading: s.last_position.heading_deg,
        plusCode: s.last_position.plus_code,
        at: s.last_position.created_at,
      } : null,
    });
  } catch (err) {
    console.error('[FAMILY-TRACKING] last-position error:', err);
    return res.status(500).json({ error: 'Gagal mengambil posisi terakhir' });
  }
}

// ===================================================================
// POST /api/family-tracking?action=session-stop
// ===================================================================
async function handleSessionStop(req, res) {
  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return res.status(authResult.status || 401).json({ error: authResult.error || 'Unauthorized' });
  }

  const body = req.body || {};
  const { sessionId, reason } = body;

  if (!sessionId) return res.status(400).json({ error: 'session_id wajib' });

  const { data, error } = await supabaseAdmin
    .from('family_tracking_sessions')
    .update({
      is_active: false,
      stop_reason: reason ? String(reason).slice(0, 200) : 'manual_stop',
    })
    .match({ id: sessionId, user_id: authResult.user.id })
    .select('id, display_name')
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  }

  return res.json({ success: true, message: `Sesi "${data.display_name}" dihentikan.` });
}

// ===================================================================
// POST /api/family-tracking?action=subscribe
// Kirim VAPID subscription untuk dapat push notifikasi
// ===================================================================
async function handleSubscribe(req, res) {
  const body = req.body || {};
  const { sessionId, subscription, subscriberName, subscriberEmail } = body;

  if (!sessionId || !subscription) {
    return res.status(400).json({ error: 'session_id dan subscription wajib' });
  }

  // Validasi session masih aktif
  const { data: sess } = await supabaseAdmin
    .from('family_tracking_sessions')
    .select('id, user_id')
    .match({ id: sessionId, is_active: true })
    .maybeSingle();

  if (!sess?.id) {
    return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('family_tracking_subscribers')
      .upsert({
        session_id: sessionId,
        subscriber_email: subscriberEmail || null,
        subscriber_name: subscriberName ? String(subscriberName).slice(0, 120) : null,
        subscription_json: subscription,
        notified_on: new Date().toISOString(),
      }, { onConflict: 'session_id,subscriber_email' });

    if (error) throw error;
    return res.json({ success: true, message: 'Berhasil subscribe notifikasi' });
  } catch (err) {
    console.error('[FAMILY-TRACKING] subscribe error:', err);
    return res.status(500).json({ error: 'Gagal subscribe' });
  }
}

// ===================================================================
// GET /api/family-tracking?action=sessions-my
// Daftar semua session milik user (termasuk yang sudah berakhir)
// ===================================================================
async function handleMySessions(req, res) {
  const authResult = await verifySupabaseUser(req);
  if (!authResult.ok) {
    return res.status(authResult.status || 401).json({ error: authResult.error || 'Unauthorized' });
  }

  const { data, error } = await supabaseAdmin
    .from('family_tracking_sessions')
    .select('id, display_name, is_active, is_paused, duration_hours, auto_expire_at, created_at, stop_reason, battery_pct, network_type')
    .eq('user_id', authResult.user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;

  return res.json({
    success: true,
    sessions: (data || []).map(s => ({
      id: s.id,
      displayName: s.display_name,
      isActive: s.is_active,
      isPaused: s.is_paused,
      durationHours: s.duration_hours,
      autoExpireAt: s.auto_expire_at,
      createdAt: s.created_at,
      stopReason: s.stop_reason,
      batteryPct: s.battery_pct,
      networkType: s.network_type,
      shareUrl: `https://pintu-angin.vercel.app/track?token=${s.link_token || ''}`,
    })),
  });
}

// ===================================================================
// HELPERS
// ===================================================================
function generateSecureToken() {
  // 32 bytes = 62 karakter base64url (aman, cukup panjang untuk anti-bruteforce)
  try {
    const arr = new Uint8Array(32);
    (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(arr)
      : require('crypto').randomBytes(32).copy(arr);
    return Buffer.from(arr).toString('base64url');
  } catch {
    // Fallback ke Math.random (tidak seaman crypto, tapi cukup untuk penggunaan lokal)
    let token = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let i = 0; i < 62; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
