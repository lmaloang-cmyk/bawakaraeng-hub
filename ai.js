import { rateLimit, secureApi } from '../lib/security.js';

function validBbox(raw) {
  const values = String(raw || '').split(',').map(Number);
  if (values.length !== 4 || values.some(v => !Number.isFinite(v))) return null;
  const [w,s,e,n]=values;
  if(w < -180 || e > 180 || s < -90 || n > 90 || w >= e || s >= n) return null;
  if((e-w) > 2 || (n-s) > 2) return null;
  return values.map(v => v.toFixed(4)).join(',');
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  if (!secureApi(req, res, ['GET'])) return;
  if (!rateLimit(req, res, { prefix: 'hotspot', limit: 40, windowMs: 10 * 60_000 })) return;

  const key=process.env.FIRMS_MAP_KEY;
  const bbox=validBbox(req.query?.bbox || '119.80,-5.45,120.10,-5.15');
  const days=Math.max(1,Math.min(5,parseInt(req.query?.days || '3',10)||3));
  if(!bbox)return res.status(400).json({error:'bbox tidak valid',hotspots:[]});
  if(!key)return res.status(200).json({hotspots:[],note:'Layanan hotspot belum dikonfigurasi.'});
  try{
    const url='https://firms.modaps.eosdis.nasa.gov/api/area/csv/'+encodeURIComponent(key)+'/VIIRS_SNPP_NRT/'+bbox+'/'+days;
    const r=await fetch(url,{signal:AbortSignal.timeout(10_000)});
    if(!r.ok)return res.status(502).json({error:'Sumber hotspot tidak tersedia',hotspots:[]});
    const txt=await r.text(); if(txt.length>2_000_000)return res.status(502).json({error:'Respons hotspot terlalu besar',hotspots:[]});
    const lines=txt.trim().split('\n'); if(lines.length<2)return res.status(200).json({hotspots:[]});
    const header=lines.shift().split(','); const iLat=header.indexOf('latitude'),iLng=header.indexOf('longitude'),iDate=header.indexOf('acq_date'),iConf=header.indexOf('confidence');
    const hotspots=lines.slice(0,2000).filter(Boolean).map(l=>{const c=l.split(',');return{lat:parseFloat(c[iLat]),lng:parseFloat(c[iLng]),date:String(c[iDate]||'').slice(0,10),conf:String(c[iConf]||'').slice(0,20)}}).filter(h=>Number.isFinite(h.lat)&&Number.isFinite(h.lng));
    return res.status(200).json({hotspots});
  }catch{return res.status(502).json({error:'Layanan hotspot gagal dihubungi',hotspots:[]});}
}
