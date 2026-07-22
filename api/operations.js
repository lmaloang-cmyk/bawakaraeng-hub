import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, distance, isAdmin, requireUser, rest, validPoint } from '../lib/ops.js';

// Endpoint gabungan untuk Vercel Hobby: SOS, dashboard operasi, check-in, dan QR SIMAKSI.
// Gunakan ?action=sos-create|sos-nearby|sos-resolve|admin|checkin|permit-verify
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  const action = String(req.query?.action || '').toLowerCase();
  const methods = action === 'admin' ? ['GET'] : ['POST'];
  if (!secureApi(req, res, methods)) return;
  if (!bodyWithin(req, action === 'admin' ? 1024 : 2048)) return res.status(413).json({ error: 'Permintaan terlalu besar' });
  const limits = { 'sos-create':4, 'sos-nearby':26, 'sos-resolve':15, admin:40, checkin:30, 'permit-verify':60 };
  if (!limits[action]) return res.status(404).json({ error: 'Operasi tidak ditemukan' });
  if (!rateLimit(req, res, { prefix:'ops-'+action, limit:limits[action], windowMs: action === 'checkin' ? 60*60_000 : 10*60_000 })) return;
  const user = await requireUser(req, res, action === 'admin' || action === 'permit-verify');
  if (!user) return;
  try {
    if (action === 'sos-create') return sosCreate(req, res, user);
    if (action === 'sos-nearby') return sosNearby(req, res);
    if (action === 'sos-resolve') return sosResolve(req, res, user);
    if (action === 'admin') return adminDashboard(res);
    if (action === 'checkin') return checkin(req, res, user);
    return permitVerify(req, res);
  } catch { return res.status(502).json({ error:'Server operasi tidak dapat dihubungi' }); }
}

async function sosCreate(req,res,user) {
  const b=req.body||{}, lat=Number(b.lat), lng=Number(b.lng), device=clean(b.device,80);
  if (!validPoint(lat,lng) || !device) return res.status(400).json({error:'Lokasi atau perangkat tidak valid'});
  const q=new URLSearchParams({select:'id',active:'eq.true',created_at:'gte.'+new Date(Date.now()-30*60_000).toISOString(),limit:'1'});
  q.set('or','(user_id.eq.'+user.id+',device.eq.'+device+')');
  const existing=await rest('sos_alerts?'+q); const rows=existing.ok?await existing.json():[];
  if (Array.isArray(rows)&&rows[0]) return res.status(409).json({error:'SOS aktif sudah ada',id:rows[0].id});
  const meta=user.user_metadata||{}, name=clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80)||'Pendaki';
  const r=await rest('sos_alerts',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({lat,lng,name,device,user_id:user.id,user_email:clean(user.email,254),active:true,status:'active'})});
  const data=r.ok?await r.json():null;
  if (!r.ok||!data||!data[0]) return res.status(502).json({error:'SOS gagal disimpan'});
  return res.status(201).json({id:data[0].id,name:data[0].name});
}

async function sosNearby(req,res) {
  const b=req.body||{},lat=Number(b.lat),lng=Number(b.lng); if(!validPoint(lat,lng))return res.status(400).json({error:'Lokasi tidak valid'});
  const since=new Date(Date.now()-30*60_000).toISOString();
  const q=new URLSearchParams({select:'id,lat,lng,name,device,active,created_at',active:'eq.true',status:'eq.active',created_at:'gte.'+since,order:'created_at.desc',limit:'100'});
  const r=await rest('sos_alerts?'+q);const rows=r.ok?await r.json():[];
  const items=(Array.isArray(rows)?rows:[]).filter(x=>validPoint(Number(x.lat),Number(x.lng))&&distance(lat,lng,Number(x.lat),Number(x.lng))<=20000);
  return res.status(200).json({items});
}

async function sosResolve(req,res,user) {
  const id=clean((req.body||{}).id,80);if(!id)return res.status(400).json({error:'ID SOS diperlukan'});
  const r=await rest('sos_alerts?select=id,user_id,active&id=eq.'+encodeURIComponent(id)+'&limit=1');const rows=r.ok?await r.json():[];const sos=rows&&rows[0];
  if(!sos)return res.status(404).json({error:'SOS tidak ditemukan'});
  if(sos.user_id!==user.id&&!isAdmin(user))return res.status(403).json({error:'Hanya pengirim atau petugas yang dapat menyelesaikan SOS'});
  const u=await rest('sos_alerts?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({active:false,status:'resolved',handled_at:new Date().toISOString(),handled_by:clean(user.email,254)})});
  if(!u.ok)return res.status(502).json({error:'Status SOS gagal diperbarui'});return res.status(200).json({ok:true});
}

async function adminDashboard(res) {
  const [a,b]=await Promise.all([
    rest('sos_alerts?select=id,name,lat,lng,device,created_at,status,user_email,handled_at,handled_by&order=created_at.desc&limit=80'),
    rest('trail_checkins?select=id,position_id,position_name,lat,lng,checked_at,user_email,user_name,sync_state&order=checked_at.desc&limit=80')
  ]);
  const sos=a.ok?await a.json():[], checkins=b.ok?await b.json():[];
  return res.status(200).json({sos:Array.isArray(sos)?sos:[],checkins:Array.isArray(checkins)?checkins:[]});
}

async function checkin(req,res,user) {
  const b=req.body||{},lat=Number(b.lat),lng=Number(b.lng),positionId=clean(b.position_id,40),positionName=clean(b.position_name,80);
  if(!validPoint(lat,lng)||!positionId||!positionName)return res.status(400).json({error:'Data check-in tidak valid'});
  const meta=user.user_metadata||{},name=clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80);
  const r=await rest('trail_checkins',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({position_id:positionId,position_name:positionName,lat,lng,checked_at:clean(b.checked_at,40)||new Date().toISOString(),user_id:user.id,user_email:clean(user.email,254),user_name:name,sync_state:'synced'})});
  if(!r.ok)return res.status(502).json({error:'Check-in gagal disimpan'});const d=await r.json();return res.status(201).json({id:d&&d[0]&&d[0].id});
}

async function permitVerify(req,res) {
  const code=clean((req.body||{}).code,60).toUpperCase();if(!/^SMK-[A-Z0-9-]+$/.test(code))return res.status(400).json({error:'Format kode SIMAKSI tidak valid'});
  const q=new URLSearchParams({select:'code,nama,jalur,naik,turun,jml,stage,astatus',code:'eq.'+code,limit:'1'});const r=await rest('simaksi?'+q);const rows=r.ok?await r.json():[];const permit=rows&&rows[0];
  if(!permit)return res.status(404).json({error:'SIMAKSI tidak ditemukan'});return res.status(200).json({valid:permit.stage==='terbit'&&permit.astatus==='disetujui',permit});
}
