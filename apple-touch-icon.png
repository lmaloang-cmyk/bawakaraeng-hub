const store = globalThis.__bwkRateStore || (globalThis.__bwkRateStore = new Map());

function header(req, name) {
  const h = req && req.headers ? req.headers : {};
  return h[name] || h[name.toLowerCase()] || '';
}

export function clientIp(req) {
  const forwarded = String(header(req, 'x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || String(header(req, 'x-real-ip') || req.socket?.remoteAddress || 'unknown');
}

function allowedOrigins(req) {
  const host = String(header(req, 'x-forwarded-host') || header(req, 'host') || '');
  const proto = String(header(req, 'x-forwarded-proto') || 'https').split(',')[0];
  const own = host ? `${proto}://${host}` : '';
  const configured = String(process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  return new Set([own, ...configured].filter(Boolean));
}

export function secureApi(req, res, methods = ['GET']) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  const origin = String(header(req, 'origin') || '');
  const allowed = allowedOrigins(req);
  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (origin && !allowed.has(origin)) {
      res.status(403).json({ error: 'Origin tidak diizinkan' });
      return false;
    }
    res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
    return false;
  }
  if (origin && !allowed.has(origin)) {
    res.status(403).json({ error: 'Origin tidak diizinkan' });
    return false;
  }
  if (!methods.includes(req.method)) {
    res.setHeader('Allow', methods.join(', '));
    res.status(405).json({ error: 'Method not allowed' });
    return false;
  }
  return true;
}

export function rateLimit(req, res, options = {}) {
  const now = Date.now();
  const windowMs = options.windowMs || 60_000;
  const limit = options.limit || 30;
  const prefix = options.prefix || 'api';
  const id = options.id || clientIp(req);
  const key = `${prefix}:${id}`;
  let item = store.get(key);
  if (!item || item.reset <= now) item = { count: 0, reset: now + windowMs };
  item.count += 1;
  store.set(key, item);
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - item.count)));
  res.setHeader('RateLimit-Reset', String(Math.ceil(item.reset / 1000)));
  if (item.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((item.reset - now) / 1000))));
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
    return false;
  }
  if (store.size > 2500 && Math.random() < 0.05) {
    for (const [k, v] of store) if (v.reset <= now) store.delete(k);
  }
  return true;
}

export function cleanText(value, max = 600) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function bodyWithin(req, maxBytes = 8192) {
  try { return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') <= maxBytes; }
  catch { return false; }
}

export function bearerToken(req) {
  const value = String(header(req, 'authorization') || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export async function verifySupabaseUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const url = String(process.env.SUPABASE_URL || '').trim();
  const anon = String(process.env.SUPABASE_ANON_KEY || '').trim();
  // Deployment configuration must be explicit; source-code fallbacks prevent safe rotation.
  if (!url || !anon) return null;
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anon },
      signal: AbortSignal.timeout(7000)
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user && user.id ? user : null;
  } catch { return null; }
}
