import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, isAdmin, requireUser, rest } from '../lib/ops.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!secureApi(req,res,['POST'])||!rateLimit(req,res,{prefix:'sos-resolve',limit:15,windowMs:10*60_000})||!bodyWithin(req,1024))return;
  const user=await requireUser(req,res);if(!user)return;const id=clean((req.body||{}).id,80);if(!id)return res.status(400).json({error:'ID SOS diperlukan'});
  try{const r=await rest('sos_alerts?select=id,user_id,active&id=eq.'+encodeURIComponent(id)+'&limit=1');const rows=r.ok?await r.json():[];const sos=rows&&rows[0];if(!sos)return res.status(404).json({error:'SOS tidak ditemukan'});if(sos.user_id!==user.id&&!isAdmin(user))return res.status(403).json({error:'Hanya pengirim atau petugas yang dapat menyelesaikan SOS'});const patch={active:false,status:'resolved',handled_at:new Date().toISOString(),handled_by:clean(user.email,254)};const u=await rest('sos_alerts?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(patch)});if(!u.ok)return res.status(502).json({error:'Status SOS gagal diperbarui'});return res.status(200).json({ok:true});}catch{return res.status(502).json({error:'Server SOS tidak dapat dihubungi'});}
}
