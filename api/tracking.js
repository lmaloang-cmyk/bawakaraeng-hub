/**
 * Family Tracking API — Vercel Serverless
 *
 * Endpoints:
 *   POST /api/tracking?act=create          — Buat sesi baru (owner only)
 *   POST /api/tracking?act=stop            — Hentikan sesi (owner only)
 *   POST /api/tracking?act=positions       — Kirim posisi (owner only)
 *   GET  /api/tracking?act=status&id=UUID  — Status sesi (owner + token viewer)
 *   GET  /api/tracking?act=latest&id=UUID  — Posisi terakhir (owner + token viewer)
 *   GET  /api/tracking?act=history&id=UUID — Riwayat posisi (owner + token viewer)
 *   GET  /api/tracking?act=share&id=UUID   — Generate token shareable
 *
 * Viewer memakai header X-Session-Token: <token> atau query ?token=<token>
 * Aksi status/latest/history TIDAK memerlukan login — cukup share token sah.
 */

import {
  secureApi, rateLimit, bearerToken, verifySupabaseUser,
  cleanText, bodyWithin, clientIp
} from '../lib/security.js';
import { rest, isAdmin, requireUser, validPoint, clean } from '../lib/ops.js';

// Maximum position payload size
const MAX_PAYLOAD = 1024;
// Position update rate limit: 1 per 10 seconds per session
const RATE_UPDATE = 6;
// Session lifetime: 4 hours default (shorter for safety)
const DEFAULT_EXPIRY_HOURS = 4;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Surrogate-Key', 'family-tracking');

  const act = String(req.query?.act || '').toLowerCase();
  const methods = ['get', 'post'];
  if (!secureApi(req, res, methods)) return;
  if (!bodyWithin(req, MAX_PAYLOAD)) {
    return res.status(413).json({ error: 'Payload terlalu besar' });
  }

  // Aksi penonton: keluarga membuka link share TANPA login Google.
  // requireUser() langsung mengirim 401 begitu dipanggil, jadi ia tidak boleh
  // dijalankan untuk aksi ini — kalau tidak, respons sudah terkirim sebelum
  // pemeriksaan share token sempat berjalan.
  const VIEWER_ACTS = new Set(['status', 'latest', 'history']);

  let user = null;
  if (!VIEWER_ACTS.has(act)) {
    user = await requireUser(req, res, false);
    if (!user) return; // requireUser sudah membalas 401/403/503
  }

  // --- CREATE SESSION ---
  if (act === 'create') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-create', id: user.id, limit: 10, windowMs: 3600000 })) return;
    return createSession(req, res, user);
  }

  // --- STOP SESSION ---
  if (act === 'stop') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-stop', id: user.id, limit: 10, windowMs: 3600000 })) return;
    return stopSession(req, res, user);
  }

  // --- SEND POSITION ---
  if (act === 'positions') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-pos', id: user.id, limit: RATE_UPDATE, windowMs: 60000 })) return;
    return sendPosition(req, res, user);
  }

  // --- VIEW: STATUS ---
  if (act === 'status') {
    if (!rateLimit(req, res, { prefix: 'track-status', limit: 120, windowMs: 60000 })) return;
    return getSessionStatus(req, res);
  }

  // --- VIEW: LATEST POSITION ---
  if (act === 'latest') {
    if (!rateLimit(req, res, { prefix: 'track-latest', limit: 120, windowMs: 60000 })) return;
    return getLatestPosition(req, res);
  }

  // --- VIEW: HISTORY ---
  if (act === 'history') {
    if (!rateLimit(req, res, { prefix: 'track-history', limit: 30, windowMs: 60000 })) return;
    return getHistory(req, res);
  }

  // --- VIEW: SHARE TOKEN ---
  if (act === 'share') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-share', id: user.id, limit: 20, windowMs: 3600000 })) return;
    return generateShare(req, res, user);
  }

  // --- EXTEND SESSION (owner only) ---
  if (act === 'extend') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-extend', id: user.id, limit: 10, windowMs: 3600000 })) return;
    return extendSession(req, res, user);
  }

  // --- LIST MY SESSIONS ---
  if (act === 'list') {
    if (!user) return res.status(401).json({ error: 'Login diperlukan' });
    if (!rateLimit(req, res, { prefix: 'track-list', id: user.id, limit: 30, windowMs: 60000 })) return;
    return listMySessions(req, res, user);
  }

  return res.status(404).json({ error: 'Action tidak ditemukan' });
}

// ===========================================================================
// HELPERS (shared)
// ===========================================================================
function appOrigin(req) {
  const configured = String(process.env.APP_ORIGIN || '').trim().replace(/\/$/, '');
  if (configured) return configured;

  // Tanpa APP_ORIGIN, pakai host permintaan ini — jangan pernah menebak domain
  // lain, karena link share bisa menunjuk deployment yang salah.
  const proto = String(req?.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  if (host) return `${proto}://${host}`;

  return 'https://www.pintuangin.my.id';
}

function shareUrlFor(req, sessionId, token) {
  return `${appOrigin(req)}/tracker.html?session=${sessionId}&token=${token}`;
}

// ===========================================================================
// CREATE SESSION
// ===========================================================================
async function createSession(req, res, user) {
  const b = req.body || {};
  const name = cleanText(b.name, 60);
  const note = cleanText(b.note, 200);
  const deviceName = cleanText(b.device_name, 60);
  const expiryHours = Math.max(1, Math.min(168, Number(b.expiry_hours) || DEFAULT_EXPIRY_HOURS));

  const payload = {
    created_by: user.id,
    name: name || 'Pelacakan Keluarga',
    note: note || '',
    device_name: deviceName || '',
    expires_at: new Date(Date.now() + expiryHours * 3600000).toISOString()
  };

  try {
    // Prefer: return=representation wajib, kalau tidak PostgREST balas body kosong
    const r = await rest('tracking_sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[tracking] create session failed:', r.status, detail);
      return res.status(502).json({ error: 'Gagal membuat sesi' });
    }

    const data = await r.json().catch(() => null);
    const session = Array.isArray(data) ? data[0] : data;

    if (!session || !session.id) {
      return res.status(502).json({ error: 'Gagal membuat sesi' });
    }

    // Generate share token (satu kali, tidak perlu roundtrip tambahan)
    const shareToken = generateToken();
    const tokenR = await rest('tracking_share_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=merge-duplicates'
      },
      body: JSON.stringify({
        session_id: session.id,
        token: shareToken,
        expires_at: session.expires_at
      })
    });

    if (!tokenR.ok) {
      const detail = await tokenR.text().catch(() => '');
      console.error('[tracking] share token failed:', tokenR.status, detail);
    }

    const tokenOk = tokenR.ok;

    return res.json({
      ok: true,
      session: {
        id: session.id,
        name: session.name || payload.name,
        note: session.note ?? payload.note,
        device_name: session.device_name ?? payload.device_name,
        expires_at: session.expires_at || payload.expires_at,
        active: session.active ?? true,
        last_lat: session.last_lat ?? null,
        last_lng: session.last_lng ?? null,
        last_seen: session.last_seen ?? null,
        position_count: session.position_count || 0
      },
      token: tokenOk ? shareToken : '',
      share_url: tokenOk ? shareUrlFor(req, session.id, shareToken) : ''
    });
  } catch (e) {
    console.error('[tracking] create error:', e?.message);
    return res.status(502).json({ error: 'Gagal menghubungi server', detail: e?.message });
  }
}

// ===========================================================================
// STOP SESSION
// ===========================================================================
async function stopSession(req, res, user) {
  const b = req.body || {};
  const sessionId = b.session_id;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const data = await r.json();

    if (!Array.isArray(data) || !data.length) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan atau bukan milikmu' });
    }

    const stopR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          active: false,
          cancelled_by: user.id,
          cancelled_at: new Date().toISOString()
        })
      }
    );

    if (!stopR.ok) throw new Error(`HTTP ${stopR.status}`);
    return res.json({ ok: true, message: 'Sesi dihentikan' });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menghentikan sesi' });
  }
}

// ===========================================================================
// SEND POSITION
// ===========================================================================
async function sendPosition(req, res, user) {
  const b = req.body || {};
  const sessionId = b.session_id;
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  const accuracy = Number(b.accuracy);
  const altitude = Number(b.altitude);
  const batteryPct = Number(b.battery_pct);
  const clientId = clean(String(b.client_id || ''), 64);

  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }
  if (!validPoint(lat, lng)) {
    return res.status(400).json({ error: 'Koordinat tidak valid' });
  }

  // Verify ownership
  try {
    const ownerR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}&active=eq.true`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const ownerData = await ownerR.json();
    if (!Array.isArray(ownerData) || !ownerData.length) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan atau sudah berakhir' });
    }

    // Save position
    const posPayload = {
      session_id: sessionId,
      lat,
      lng,
      // Kolom accuracy_m & altitude_m bertipe int di Postgres. PostgREST TIDAK
      // membulatkan: nilai pecahan dari GPS ponsel (93.7 / 60.4) ditolak dengan
      // galat sintaks integer, sehingga seluruh penyisipan gagal dan API balas 502.
      accuracy_m: isFinite(accuracy) ? Math.max(0, Math.min(100000, Math.round(accuracy))) : null,
      altitude_m: isFinite(altitude) ? Math.max(-500, Math.min(12000, Math.round(altitude))) : null,
      battery_pct: isFinite(batteryPct) ? Math.max(0, Math.min(100, Math.round(batteryPct))) : null,
      sent_at: new Date().toISOString(),
      client_id: clientId || null
    };

    const posR = await rest('tracking_positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify(posPayload)
    });

    // Jangan balas ok:true kalau posisi tidak tersimpan (klien perlu antre ulang)
    if (!posR.ok) {
      const detail = await posR.text().catch(() => '');
      console.error('[tracking] pos save failed:', posR.status, detail);
      return res.status(502).json({ error: 'Gagal menyimpan posisi' });
    }

    // Update session last position (fallback kalau trigger DB belum terpasang)
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          last_lat: lat,
          last_lng: lng,
          last_seen: new Date().toISOString()
        })
      }
    ).catch(() => {});

    return res.json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menyimpan posisi' });
  }
}

// ===========================================================================
// GET SESSION STATUS (viewer or owner)
// ===========================================================================
async function getSessionStatus(req, res) {
  const sessionId = req.query?.id;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  const sessionToken = req.headers?.['x-session-token'] || req.query?.token || '';
  const user = await verifySupabaseUser(req);

  try {
    // Check if requester is owner
    let isOwner = false;
    if (user) {
      const ownerR = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}`,
        {
          headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
          }
        }
      );
      const ownerData = await ownerR.json();
      isOwner = Array.isArray(ownerData) && ownerData.length > 0;
    }

    // Check token validity
    let isTokenValid = false;
    if (sessionToken) {
      const tokenR = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/tracking_share_tokens?session_id=eq.${sessionId}&token=eq.${encodeURIComponent(sessionToken)}&expires_at=gt.${new Date().toISOString()}`,
        {
          headers: {
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
          }
        }
      );
      const tokenData = await tokenR.json();
      isTokenValid = Array.isArray(tokenData) && tokenData.length > 0;
    }

    // Login saja tidak cukup: harus owner atau punya share token yang valid
    if (!isOwner && !isTokenValid) {
      return res.status(403).json({ error: 'Akses ditolak' });
    }

    // Get session data
    const sessionR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const sessionData = await sessionR.json();
    const session = Array.isArray(sessionData) ? sessionData[0] : null;

    if (!session) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan' });
    }

    const minsAgo = session.last_seen
      ? Math.round((Date.now() - new Date(session.last_seen).getTime()) / 60000)
      : null;

    return res.json({
      ok: true,
      session: {
        id: session.id,
        name: session.name,
        note: session.note,
        device_name: session.device_name,
        active: session.active,
        expires_at: session.expires_at,
        last_lat: session.last_lat,
        last_lng: session.last_lng,
        last_seen: session.last_seen,
        mins_ago: minsAgo,
        position_count: session.position_count || 0
      }
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil data sesi' });
  }
}

// ===========================================================================
// GET LATEST POSITION
// ===========================================================================
async function getLatestPosition(req, res) {
  const sessionId = req.query?.id;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  const sessionToken = req.headers?.['x-session-token'] || req.query?.token || '';
  const user = await verifySupabaseUser(req);

  // Authorization check
  let authorized = false;
  if (user) {
    const ownerR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}&active=eq.true`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const ownerData = await ownerR.json();
    authorized = Array.isArray(ownerData) && ownerData.length > 0;
  }
  if (!authorized && sessionToken) {
    const tokenR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_share_tokens?session_id=eq.${sessionId}&token=eq.${encodeURIComponent(sessionToken)}&expires_at=gt.${new Date().toISOString()}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const tokenData = await tokenR.json();
    authorized = Array.isArray(tokenData) && tokenData.length > 0;
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    const posR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_positions?session_id=eq.${sessionId}&order=sent_at.desc&limit=1`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const posData = await posR.json();
    const pos = Array.isArray(posData) ? posData[0] : null;

    return res.json({
      ok: true,
      position: pos ? {
        lat: pos.lat,
        lng: pos.lng,
        accuracy_m: pos.accuracy_m,
        altitude_m: pos.altitude_m,
        battery_pct: pos.battery_pct,
        sent_at: pos.sent_at
      } : null
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil posisi' });
  }
}

// ===========================================================================
// GET HISTORY
// ===========================================================================
async function getHistory(req, res) {
  const sessionId = req.query?.id;
  const limit = Math.min(500, Math.max(1, parseInt(req.query?.limit) || 100));
  const hours = Math.min(168, Math.max(1, parseInt(req.query?.hours) || 24));

  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  const sessionToken = req.headers?.['x-session-token'] || req.query?.token || '';
  const user = await verifySupabaseUser(req);

  // Authorization check
  let authorized = false;
  if (user) {
    const ownerR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}&active=eq.true`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const ownerData = await ownerR.json();
    authorized = Array.isArray(ownerData) && ownerData.length > 0;
  }
  if (!authorized && sessionToken) {
    const tokenR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_share_tokens?session_id=eq.${sessionId}&token=eq.${encodeURIComponent(sessionToken)}&expires_at=gt.${new Date().toISOString()}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const tokenData = await tokenR.json();
    authorized = Array.isArray(tokenData) && tokenData.length > 0;
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  try {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const posR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_positions?session_id=eq.${sessionId}&sent_at=gte.${encodeURIComponent(since)}&order=sent_at.desc&limit=${limit}`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const posData = await posR.json();

    return res.json({
      ok: true,
      positions: Array.isArray(posData) ? posData.map(p => ({
        lat: p.lat,
        lng: p.lng,
        accuracy_m: p.accuracy_m,
        altitude_m: p.altitude_m,
        battery_pct: p.battery_pct,
        sent_at: p.sent_at
      })) : []
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal mengambil riwayat' });
  }
}

// ===========================================================================
// EXTEND SESSION
// ===========================================================================
async function extendSession(req, res, user) {
  const b = req.body || {};
  const sessionId = b.session_id;
  const extraHours = Math.max(1, Math.min(168, Number(b.extra_hours) || DEFAULT_EXPIRY_HOURS));

  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  try {
    // Verify ownership and active status
    const ownerR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}&active=eq.true`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const ownerData = await ownerR.json();

    if (!Array.isArray(ownerData) || !ownerData.length) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan atau sudah berakhir' });
    }

    // Calculate new expiry
    const currentExpiresAt = ownerData[0].expires_at;
    const newExpiresAt = new Date(Math.max(
      new Date(currentExpiresAt).getTime(),
      Date.now()
    ) + extraHours * 3600000).toISOString();

    // Update session
    const updateR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ expires_at: newExpiresAt })
      }
    );

    if (!updateR.ok) throw new Error(`HTTP ${updateR.status}`);

    // Update token expiry too
    await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_share_tokens?session_id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ expires_at: newExpiresAt })
      }
    );

    return res.json({
      ok: true,
      message: 'Sesi diperpanjang',
      session: {
        ...ownerData[0],
        expires_at: newExpiresAt
      }
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal memperpanjang sesi' });
  }
}

// ===========================================================================
// GENERATE SHARE LINK
// ===========================================================================
async function generateShare(req, res, user) {
  const sessionId = req.query?.id;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return res.status(400).json({ error: 'ID sesi tidak valid' });
  }

  try {
    // Verify ownership
    const ownerR = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?id=eq.${sessionId}&created_by=eq.${user.id}&active=eq.true`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );
    const ownerData = await ownerR.json();
    if (!Array.isArray(ownerData) || !ownerData.length) {
      return res.status(404).json({ error: 'Sesi tidak ditemukan' });
    }

    // Generate new token
    const token = generateToken();

    // Upsert token
    const upsertR = await rest('tracking_share_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=merge-duplicates'
      },
      body: JSON.stringify({
        session_id: sessionId,
        token,
        expires_at: ownerData[0].expires_at
      })
    });

    if (!upsertR.ok) {
      const detail = await upsertR.text().catch(() => '');
      console.error('[tracking] share upsert failed:', upsertR.status, detail);
      return res.status(502).json({ error: 'Gagal membuat token share' });
    }

    return res.json({
      ok: true,
      token,
      share_url: shareUrlFor(req, sessionId, token),
      short_url: `${appOrigin(req)}/t/${sessionId}`
    });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal membuat token share' });
  }
}

// ===========================================================================
// LIST MY SESSIONS
// ===========================================================================
async function listMySessions(req, res, user) {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/tracking_sessions?select=id,name,note,device_name,expires_at,last_lat,last_lng,last_seen,position_count,active&created_by=eq.${user.id}&order=expires_at.desc&limit=5`,
      {
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE}`
        }
      }
    );

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const sessions = await r.json();

    return res.json({ ok: true, sessions: Array.isArray(sessions) ? sessions : [] });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal memuat sesi' });
  }
}

// ===========================================================================
// HELPERS
// ===========================================================================
function generateToken() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch (e) {}
  // Fallback
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}
