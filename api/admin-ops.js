import { rateLimit, secureApi } from '../lib/security.js';
import { requireUser, rest } from '../lib/ops.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!secureApi(req,res,['GET'])||!rateLimit(req,res,{prefix:'admin-ops',limit:40,windowMs:10*60_000}))return;
  const user=await requireUser(req,res,true);if(!user)return;
  try{const [a,b]=await Promise.all([rest('sos_alerts?select=id,name,lat,lng,device,created_at,status,user_email,handled_at,handled_by&order=created_at.desc&limit=80'),rest('trail_checkins?select=id,position_id,position_name,lat,lng,checked_at,user_email,user_name,sync_state&order=checked_at.desc&limit=80')]);const sos=a.ok?await a.json():[];const checkins=b.ok?await b.json():[];return res.status(200).json({sos:Array.isArray(sos)?sos:[],checkins:Array.isArray(checkins)?checkins:[]});}catch{return res.status(502).json({error:'Data operasional tidak dapat dimuat'});}
}
