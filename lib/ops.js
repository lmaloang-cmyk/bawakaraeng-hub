import { verifySupabaseUser } from './security.js';

const DEFAULT_ADMINS = ['songkranveo@gmail.com', 'songkrangveo@gmail.com', 'upik.zulkiflie@gmail.com'];
export const supabaseUrl = () => String(process.env.SUPABASE_URL || 'https://ncoueeeskzslldppsbvx.supabase.co').replace(/\/$/, '');
export const serviceKey = () => String(process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || '');
export const serviceHeaders = (extra = {}) => ({ apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), ...extra });
export const adminEmails = () => String(process.env.ADMIN_EMAILS || DEFAULT_ADMINS.join(','))
  .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
export const isAdmin = user => !!(user && user.email && adminEmails().includes(String(user.email).toLowerCase()));
export async function requireUser(req, res, adminOnly = false) {
  const user = await verifySupabaseUser(req);
  if (!user) { res.status(401).json({ error: 'Login Google diperlukan' }); return null; }
  if (adminOnly && !isAdmin(user)) { res.status(403).json({ error: 'Akses petugas diperlukan' }); return null; }
  if (!serviceKey()) { res.status(503).json({ error: 'SUPABASE_SERVICE_ROLE belum dikonfigurasi' }); return null; }
  return user;
}
export function clean(value, max = 100) { return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max); }
export function validPoint(lat, lng) { return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180; }
export function distance(a, b, c, d) { const R=6371000,t=Math.PI/180,x=(c-a)*t,y=(d-b)*t;const h=Math.sin(x/2)**2+Math.cos(a*t)*Math.cos(c*t)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h))); }
export async function rest(path, options = {}) { return fetch(supabaseUrl() + '/rest/v1/' + path, { ...options, headers: serviceHeaders(options.headers || {}), signal: options.signal || AbortSignal.timeout(9000) }); }
