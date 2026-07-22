import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { distance, requireUser, rest, validPoint } from '../lib/ops.js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!secureApi(req,res,['POST'])||!rateLimit(req,res,{prefix:'sos-nearby',limit:26,windowMs:10*60_000})||!bodyWithin(req,512))return;
  const user=await requireUser(req,res);if(!user)return;
  const b=req.body||{},lat=Number(b.lat),lng=Number(b.lng);if(!validPoint(lat,lng))return res.status(400).json({error:'Lokasi tidak valid'});
  try{const since=new Date(Date.now()-30*60_000).toISOString();const q=new URLSearchParams({select:'id,lat,lng,name,device,active,created_at',active:'eq.true',status:'eq.active',created_at:'gte.'+since,order:'created_at.desc',limit:'100'});const r=await rest('sos_alerts?'+q);const rows=r.ok?await r.json():[];const items=(Array.isArray(rows)?rows:[]).filter(x=>validPoint(Number(x.lat),Number(x.lng))&&distance(lat,lng,Number(x.lat),Number(x.lng))<=20000);return res.status(200).json({items});}catch{return res.status(502).json({error:'SOS tidak dapat dimuat'});}
}
