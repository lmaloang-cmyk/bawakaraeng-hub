import { rateLimit, secureApi } from '../lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=120');
  if (!secureApi(req, res, ['GET'])) return;
  if (!rateLimit(req, res, { prefix: 'bmkg', limit: 60, windowMs: 10 * 60_000 })) return;

  const out = {};
  const debug = process.env.NODE_ENV !== 'production' ? { tried: [] } : null;
  try {
    const rg = await fetch('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json', { signal: AbortSignal.timeout(8000) });
    if (debug) debug.gempaStatus = rg.status;
    if (rg.ok) {
      const jg = await rg.json();
      const g = jg?.Infogempa?.gempa;
      if (g) out.gempa = { mag:g.Magnitude, wilayah:g.Wilayah, waktu:(g.Tanggal||'')+' '+(g.Jam||''), kedalaman:g.Kedalaman, koordinat:g.Coordinates };
    }
  } catch { if (debug) debug.gempaError = 'upstream_failed'; }

  const candidates = [];
  const q = String(req.query?.adm4 || '').trim();
  if (q && /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(q)) candidates.push(q);
  const envCode = String(process.env.BMKG_ADM4 || '').trim();
  if (envCode && /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(envCode)) candidates.push(envCode);
  candidates.push('73.06.04.1001','73.06.04.1010','73.06.04.2003');

  for (const code of [...new Set(candidates)].slice(0, 5)) {
    const info = { adm4: code };
    try {
      const rc = await fetch('https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4='+encodeURIComponent(code), { signal: AbortSignal.timeout(8000) });
      info.status = rc.status;
      if (rc.ok) {
        const jc = await rc.json(); const d0=jc?.data?.[0]; const lok=jc?.lokasi||d0?.lokasi||{};
        let first=null; try{first=d0.cuaca[0][0];}catch{} if(!first){try{first=d0.cuaca[0];}catch{}}
        if(first&&(first.t!=null||first.weather_desc)){
          out.cuaca={desc:first.weather_desc,image:first.image,temp:first.t,humidity:first.hu,wind:first.ws,area:lok.desa||lok.kecamatan||lok.kotkab||'Kawasan Bawakaraeng',waktu:first.local_datetime,adm4:code};
          info.ok=true; if(debug)debug.tried.push(info); break;
        }
      }
    } catch { info.error='upstream_failed'; }
    if(debug)debug.tried.push(info);
  }
  if(debug)out.debug=debug;
  return res.status(200).json(out);
}
