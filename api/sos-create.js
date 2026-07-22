import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, requireUser, rest, validPoint } from '../lib/ops.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST']) || !rateLimit(req, res, { prefix:'sos-create', limit:4, windowMs:10*60_000 }) || !bodyWithin(req, 2048)) return;
  const user = await requireUser(req, res); if (!user) return;
  const b=req.body||{}, lat=Number(b.lat), lng=Number(b.lng), device=clean(b.device,80);
  if (!validPoint(lat,lng) || !device) return res.status(400).json({error:'Lokasi atau perangkat tidak valid'});
  try {
    const q=new URLSearchParams({select:'id',active:'eq.true',created_at:'gte.'+new Date(Date.now()-30*60_000).toISOString(),limit:'1'});
    q.set('or','(user_id.eq.'+user.id+',device.eq.'+device+')');
    const existing=await rest('sos_alerts?'+q,{headers:{Prefer:'return=representation'}});
    const rows=existing.ok?await existing.json():[];
    if (Array.isArray(rows)&&rows[0]) return res.status(409).json({error:'SOS aktif sudah ada',id:rows[0].id});
    const meta=user.user_metadata||{};
    const name=clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80)||'Pendaki';
    const r=await rest('sos_alerts',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({lat,lng,name,device,user_id:user.id,user_email:clean(user.email,254),active:true,status:'active'})});
    const data=r.ok?await r.json():null;
    if (!r.ok||!data||!data[0]) return res.status(502).json({error:'SOS gagal disimpan'});
    return res.status(201).json({id:data[0].id,name:data[0].name});
  } catch { return res.status(502).json({error:'Server SOS tidak dapat dihubungi'}); }
}
