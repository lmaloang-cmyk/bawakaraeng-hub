import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, requireUser, rest, validPoint } from '../lib/ops.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store, private');
 if(!secureApi(req,res,['POST'])||!rateLimit(req,res,{prefix:'trail-checkin',limit:30,windowMs:60*60_000})||!bodyWithin(req,2048))return;
 const user=await requireUser(req,res);if(!user)return;const b=req.body||{},lat=Number(b.lat),lng=Number(b.lng),positionId=clean(b.position_id,40),positionName=clean(b.position_name,80);if(!validPoint(lat,lng)||!positionId||!positionName)return res.status(400).json({error:'Data check-in tidak valid'});
 const meta=user.user_metadata||{};const name=clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80);try{const r=await rest('trail_checkins',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({position_id:positionId,position_name:positionName,lat,lng,checked_at:clean(b.checked_at,40)||new Date().toISOString(),user_id:user.id,user_email:clean(user.email,254),user_name:name,sync_state:'synced'})});if(!r.ok)return res.status(502).json({error:'Check-in gagal disimpan'});const d=await r.json();return res.status(201).json({id:d&&d[0]&&d[0].id});}catch{return res.status(502).json({error:'Server check-in tidak dapat dihubungi'});}
}
