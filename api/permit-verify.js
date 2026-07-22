import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, requireUser, rest } from '../lib/ops.js';

// Verifikasi kode dari QR SIMAKSI. Hanya petugas yang login dapat melihat data izin.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, private');
  if(!secureApi(req,res,['POST'])||!rateLimit(req,res,{prefix:'permit-verify',limit:60,windowMs:10*60_000})||!bodyWithin(req,512))return;
  const user=await requireUser(req,res,true);if(!user)return;
  const code=clean((req.body||{}).code,60).toUpperCase();if(!/^SMK-[A-Z0-9-]+$/.test(code))return res.status(400).json({error:'Format kode SIMAKSI tidak valid'});
  try{const q=new URLSearchParams({select:'code,nama,jalur,naik,turun,jml,stage,astatus',code:'eq.'+code,limit:'1'});const r=await rest('simaksi?'+q);const rows=r.ok?await r.json():[];const permit=rows&&rows[0];if(!permit)return res.status(404).json({error:'SIMAKSI tidak ditemukan'});const valid=permit.stage==='terbit'&&permit.astatus==='disetujui';return res.status(200).json({valid,permit});}catch{return res.status(502).json({error:'Verifikasi SIMAKSI gagal'});}
}
