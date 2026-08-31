import { verifySupabaseUser } from '../lib/security.js';
import { bodyWithin, rateLimit, secureApi } from '../lib/security.js';
import { clean, distance, isAdmin, requireUser, rest, validPoint } from '../lib/ops.js';

// Radius pencarian SOS — penyaringan sos-nearby yang sesungguhnya terjadi DI SINI.
// MODE TES: Infinity (tanpa batas) — semua SOS aktif dikirim ke semua perangkat.
// SEBELUM LAUNCHING: ganti Infinity menjadi 20000 (20 km), atau set env SOS_RADIUS_M
// di Vercel tanpa mengubah kode. Samakan dengan api/sos-push.js dan sos.js.
const RADIUS = process.env.SOS_RADIUS_M ? Number(process.env.SOS_RADIUS_M) : Infinity;

// Kolom client_id / plus_code / accuracy_m / altitude_m / battery_pct / profile
// baru ada SETELAH supabase-sos-optimasi.sql dijalankan. Supaya penempatan kode
// tidak wajib menunggu SQL selesai, setiap query yang menyentuh kolom baru punya
// jalur mundur ke kolom lama. Tanpa ini, urutan deploy yang salah akan mematikan
// SOS sepenuhnya ΓÇö risiko yang tidak boleh ada pada fitur darurat.
async function restWithFallback(pathNew, pathOld) {
  try {
    const r = await rest(pathNew);
    if (r.ok) return r;
  } catch (e) { /* jatuh ke jalur lama */ }
  return rest(pathOld);
}

// Endpoint gabungan untuk Vercel Hobby: SOS, dashboard operasi, check-in, dan QR SIMAKSI.
// Gunakan ?action=sos-create|sos-nearby|sos-resolve|sos-report|sos-instructions|admin|checkin|permit-verify
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  const action = String(req.query?.action || '').toLowerCase();
  const methods = action === 'admin' ? ['GET'] : ['POST'];
  if (!secureApi(req, res, methods)) return;
  // Naik dari 1024/2048 ke 4096: payload SOS kini membawa konteks darurat
  // (akurasi, ketinggian, baterai, Plus Code, profil medis singkat).
  if (!bodyWithin(req, 4096)) return res.status(413).json({ error: 'Permintaan terlalu besar' });
  // sos-nearby dipanggil berulang oleh pemantau alarm; kuota 200/10 menit
  // TEMUAN S8: 'sos-create' dulu hanya 6 per 10 menit. Panik menekan tombol berkali-kali
  // adalah perilaku manusia yang normal, dan pengiriman ulang otomatis dari antrian juga
  // memakai kuota yang sama. Orang yang benar-benar butuh tolong bisa diblokir 429.
  const limits = { 'sos-create':40, 'sos-nearby':200, 'sos-resolve':20, 'sos-report':10, 'sos-instructions':5, admin:60, checkin:30, 'permit-verify':60 };
  if (!limits[action]) return res.status(404).json({ error: 'Operasi tidak ditemukan' });
  // Penjaga kasar per IP hanya untuk menahan penyalahgunaan sebelum verifikasi token.
  if (!rateLimit(req, res, { prefix:'ops-ip', limit: 400, windowMs: 10*60_000 })) return;

  const isPublicAction = action === 'sos-nearby' || action === 'permit-verify' || action === 'sos-report';
  let user = null;
  if (!isPublicAction) {
    user = await requireUser(req, res, action === 'admin');
    if (!user) return;
  } else {
    try { user = await verifySupabaseUser(req); } catch (e) { user = null; }
  }

  const rateId = user ? user.id : (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'guest');
  if (!rateLimit(req, res, { prefix:'ops-'+action, id: rateId, limit:limits[action], windowMs: action === 'checkin' ? 60*60_000 : 10*60_000 })) return;
  try {
    if (action === 'sos-create') return sosCreate(req, res, user);
    if (action === 'sos-nearby') return sosNearby(req, res);
    if (action === 'sos-resolve') return sosResolve(req, res, user);
    if (action === 'sos-report') return sosReport(req, res, user);
    if (action === 'sos-instructions') return sosInstructions(req, res, user);
    if (action === 'admin') return adminDashboard(res);
    if (action === 'checkin') return checkin(req, res, user);
    return permitVerify(req, res);
  } catch { return res.status(502).json({ error:'Server operasi tidak dapat dihubungi' }); }
}

async function sosCreate(req,res,user) {
  const b=req.body||{};
  // Number(null)===0 dan Number('')===0: SOS yang dikirim sebelum GPS terkunci
  // (atau uji dari laptop tanpa GPS) dulu tersimpan sebagai baris 0,0 ΓÇö titik
  // "Null Island" yang tidak pernah masuk radius alarm perangkat mana pun dan
  // memenuhi dashboard admin. Tolak nilai kosong SEBELUM konversi ke Number.
  if (b.lat==null||b.lng==null||b.lat===''||b.lng==='') return res.status(400).json({error:'Lokasi GPS belum terkunci'});
  const lat=Number(b.lat), lng=Number(b.lng);
  if (!validPoint(lat,lng)||(lat===0&&lng===0)) return res.status(400).json({error:'Lokasi tidak valid'});

  // client_id dibuat di perangkat SEBELUM SOS dikirim. Nilainya tetap sama pada
  // setiap percobaan ulang, jadi inilah kunci anti-dobel yang sesungguhnya.
  const clientId = clean(b.client_id, 64).replace(/[^a-zA-Z0-9_\-:.]/g, '').slice(0, 64);

  // Sanitasi device: buang semua karakter yang bisa merusak sintaks filter PostgREST.
  let safeDevice = clean(b.device, 80).replace(/[^a-zA-Z0-9_\-:.]/g, '').slice(0, 80);
  if (!safeDevice && clientId) safeDevice = clientId; // jangan tolak SOS hanya karena ID perangkat kosong
  if (!safeDevice) return res.status(400).json({error:'ID perangkat tidak valid'});

  // Validasi UUID agar tidak bisa dimanipulasi sebelum dimasukkan ke query PostgREST.
  if (!/^[0-9a-f-]{36}$/.test(String(user.id||'')))
    return res.status(400).json({error:'Identitas pengguna tidak valid'});

  // --- Anti-dobel 1: client_id (paling presisi) ---
  // Percobaan ulang dari antrian offline WAJIB menghasilkan satu baris saja.
  if (clientId) {
    try {
      const dupR = await rest('sos_alerts?select=id&client_id=eq.' + encodeURIComponent(clientId) + '&limit=1');
      if (dupR.ok) {
        const dup = await dupR.json();
        if (Array.isArray(dup) && dup[0])
          return res.status(200).json({ id: dup[0].id, deduped: true });
      }
    } catch (e) { /* kolom belum ada: lewati, jangan gagalkan SOS */ }
  }

  const q=new URLSearchParams({
    select: 'id',
    active: 'eq.true',
    created_at: 'gte.' + new Date(Date.now()-30*60_000).toISOString(),
    limit: '1'
  });
  // Gunakan dua query terpisah untuk menghindari masalah sintaks filter "or" PostgREST
  // saat user.id (UUID) atau device memuat karakter spesial.
  // Cek SOS aktif berdasarkan user_id lebih andal dan tidak bisa dipalsukan.
  q.set('user_id', 'eq.' + user.id);
  const existingByUser = await rest('sos_alerts?' + q);
  const rowsByUser = existingByUser.ok ? await existingByUser.json() : [];
  if (Array.isArray(rowsByUser) && rowsByUser[0])
    return res.status(409).json({error:'SOS aktif sudah ada',id:rowsByUser[0].id});

  // Cek juga berdasarkan device sebagai jaring pengaman (mis. sesi beda tapi HP sama).
  const q2 = new URLSearchParams({
    select: 'id', active: 'eq.true',
    created_at: 'gte.' + new Date(Date.now()-30*60_000).toISOString(),
    device: 'eq.' + safeDevice, limit: '1'
  });
  const existingByDevice = await rest('sos_alerts?' + q2);
  const rowsByDevice = existingByDevice.ok ? await existingByDevice.json() : [];
  if (Array.isArray(rowsByDevice) && rowsByDevice[0])
    return res.status(409).json({error:'SOS aktif sudah ada',id:rowsByDevice[0].id});

  const meta=user.user_metadata||{};
  const name=clean(b.name,80)||clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80)||'Pendaki';

  const base={lat,lng,name,device:safeDevice,user_id:user.id,user_email:clean(user.email,254),active:true,status:'active'};

  // Konteks darurat. Setiap nilai dibatasi supaya baris database tidak bisa
  // dipakai sebagai tempat penitipan data sembarangan.
  const extra={};
  if (clientId) extra.client_id = clientId;
  const acc = Number(b.accuracy_m);
  if (Number.isFinite(acc) && acc >= 0) extra.accuracy_m = Math.min(99999, Math.round(acc));
  const alt = Number(b.altitude_m);
  if (Number.isFinite(alt)) extra.altitude_m = Math.max(-500, Math.min(9000, Math.round(alt)));
  const bat = Number(b.battery_pct);
  if (Number.isFinite(bat)) extra.battery_pct = Math.max(0, Math.min(100, Math.round(bat)));
  const pc = clean(b.plus_code, 16);
  if (pc) extra.plus_code = pc;
  if (b.profile && typeof b.profile === 'object' && !Array.isArray(b.profile)) extra.profile = b.profile;

  const post = (body) => rest('sos_alerts',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(body)});

  let r = await post({ ...base, ...extra });
  let data = r.ok ? await r.json() : null;
  if ((!r.ok || !data || !data[0]) && Object.keys(extra).length) {
    // Kolom baru kemungkinan belum ada di tabel. Lebih baik SOS tersimpan tanpa
    // konteks tambahan daripada tidak tersimpan sama sekali.
    r = await post(base);
    data = r.ok ? await r.json() : null;
  }

  // Dulu kegagalan INSERT dibalas 502 tanpa keterangan sehingga penyebab sebenarnya
  // (mis. kolom status/user_email belum ada di tabel) tidak pernah terlihat.
  if (!r.ok||!data||!data[0]) {
    let detail='';
    try { detail=r.ok?'database membalas kosong':String(await r.text()).slice(0,300); } catch { detail='balasan tidak terbaca'; }
    return res.status(502).json({error:'SOS gagal disimpan',kode:r.status,detail});
  }
  return res.status(201).json({id:data[0].id,name:data[0].name,client_id:clientId||undefined});
}

async function sosNearby(req,res) {
  const b=req.body||{},lat=Number(b.lat),lng=Number(b.lng); if(!validPoint(lat,lng))return res.status(400).json({error:'Lokasi tidak valid'});
  const since=new Date(Date.now()-30*60_000).toISOString();

  // PRIVASI: daftar kolom SELALU disebut satu per satu, tidak pernah select=*.
  // Kolom `profile` memuat golongan darah, alergi, riwayat penyakit, dan kontak
  // keluarga. Endpoint ini publik, jadi data itu TIDAK BOLEH ikut terkirim.
  const COLS_NEW='id,lat,lng,name,device,active,created_at,client_id,plus_code,accuracy_m';
  const COLS_OLD='id,lat,lng,name,device,active,created_at';
  const mk=(cols)=>'sos_alerts?'+new URLSearchParams({select:cols,active:'eq.true',status:'eq.active',created_at:'gte.'+since,order:'created_at.desc',limit:'100'});

  const r=await restWithFallback(mk(COLS_NEW),mk(COLS_OLD));
  const rows=r.ok?await r.json():[];
  const items=(Array.isArray(rows)?rows:[]).filter(x=>validPoint(Number(x.lat),Number(x.lng))&&distance(lat,lng,Number(x.lat),Number(x.lng))<=RADIUS);
  return res.status(200).json({items});
}

async function sosResolve(req,res,user) {
  const id=clean((req.body||{}).id,80);if(!id)return res.status(400).json({error:'ID SOS diperlukan'});
  // device + client_id ikut dibaca sebagai bukti kepemilikan perangkat pengirim.
  const r=await restWithFallback('sos_alerts?select=id,user_id,active,device,client_id&id=eq.'+encodeURIComponent(id)+'&limit=1','sos_alerts?select=id,user_id,active,device&id=eq.'+encodeURIComponent(id)+'&limit=1');const rows=r.ok?await r.json():[];const sos=rows&&rows[0];
  if(!sos)return res.status(404).json({error:'SOS tidak ditemukan'});
  // Sesi anonim bisa terganti setelah refresh token gagal di sinyal buruk, sehingga
  // user.id baru tidak lagi cocok dengan pembuat SOS. Perangkat yang sama tetap
  // boleh menutup sinyalnya sendiri.
  const cid=clean((req.body||{}).client_id,80), dev=clean((req.body||{}).device,80);
  const sameDevice=(dev&&sos.device&&sos.device===dev)||(cid&&sos.client_id&&sos.client_id===cid);
  if(sos.user_id!==user.id&&!isAdmin(user)&&!sameDevice)return res.status(403).json({error:'Hanya pengirim atau petugas yang dapat menyelesaikan SOS'});
  const u=await rest('sos_alerts?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({active:false,status:'resolved',handled_at:new Date().toISOString(),handled_by:clean(user.email,254)})});
  if(!u.ok)return res.status(502).json({error:'Status SOS gagal diperbarui'});return res.status(200).json({ok:true});
}

// Responder (bukan admin, bukan pengirim) melaporkan posisi mereka saat menekan "Sudah ditangani".
// Petugas bisa melihat daftar responder + jarak dari pengirim SOS + instruksi yang dikirim balik.
async function sosReport(req,res,user) {
  const b=req.body||{};
  const sosId=clean(b.sos_id,80);if(!sosId)return res.status(400).json({error:'ID SOS diperlukan'});
  const lat=Number(b.lat),lng=Number(b.lng);
  if(!validPoint(lat,lng))return res.status(400).json({error:'Lokasi tidak valid'});

  // Verifikasi SOS masih aktif
  const sr=await rest('sos_alerts?select=id,active,lat,lng&limit=1&id=eq.'+encodeURIComponent(sosId));
  const sosRow=sr.ok?await sr.json():[];
  const sos=sosRow&&sosRow[0];
  if(!sos)return res.status(404).json({error:'SOS tidak ditemukan'});
  if(!sos.active)return res.status(409).json({error:'SOS sudah tidak aktif'});

  // Hitung jarak dari pengirim SOS
  const distM=Math.round(distance(lat,lng,Number(sos.lat),Number(sos.lng)));
  const meta=user.user_metadata||{};
  const name=clean(meta.full_name||meta.name||String(user.email||'Pendaki').split('@')[0],80);

  // Cek duplikat: satu user satu kali per SOS (max 1 laporan dalam 5 menit)
  const cutTime=new Date(Date.now()-5*60_000).toISOString();
  const dupR=await rest('sos_responders?'+new URLSearchParams({
    select:'id',sos_alert_id:'eq.'+sosId,responder_id:'eq.'+user.id,created_at:'gte.'+cutTime
  }));
  if(dupR.ok){const dup=await dupR.json();if(Array.isArray(dup)&&dup.length)return res.status(200).json({ok:true,reason:'already_reported',distance_m:distM});}

  // Simpan laporan
  const postR=await rest('sos_responders',{
    method:'POST',
    headers:{'Content-Type':'application/json',Prefer:'return=representation'},
    body:JSON.stringify({
      sos_alert_id:sosId,
      responder_id:user.id,
      responder_email:clean(user.email,254),
      responder_name:name,
      lat,lng,distance_m:distM,
      status:'reported',
      responded_at:new Date().toISOString()
    })
  });
  if(!postR.ok)return res.status(502).json({error:'Gagal menyimpan laporan'});
  const postD=await postR.json();
  return res.status(201).json({ok:true,distance_m:distM,id:postD&&postD[0]&&postD[0].id});
}

// Admin mengirim instruksi ke semua responder aktif untuk sebuah SOS.
// Instruksi bisa dikirim sebelum ada responder yang lapor (misal untuk menyiagakan area).
async function sosInstructions(req,res,user) {
  if(!isAdmin(user))return res.status(403).json({error:'Hanya petugas yang dapat mengirim instruksi'});
  const b=req.body||{};
  const sosId=clean(b.sos_id,80);if(!sosId)return res.status(400).json({error:'ID SOS diperlukan'});
  const msg=clean(b.message,500);if(!msg)return res.status(400).json({error:'Instruksi tidak boleh kosong'});

  // Update semua responder dengan status 'reported' untuk SOS ini
  const u=await rest('sos_responders?'+new URLSearchParams({
    sos_alert_id:'eq.'+sosId,status:'eq.reported'
  }),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({message_sent:msg,status:'acknowledged',responded_at:new Date().toISOString()})});
  if(!u.ok)return res.status(502).json({error:'Gagal mengirim instruksi'});
  // Tidak masalah jika 0 baris diupdate (belum ada responder)
  return res.status(200).json({ok:true,sent:true});
}

async function adminDashboard(res) {
  // Petugas BOLEH melihat konteks darurat (termasuk profil medis) karena merekalah
  // yang menolong. Endpoint ini sudah dijaga requireUser(..., admin=true).
  const SOS_NEW='sos_alerts?select=id,name,lat,lng,device,created_at,status,user_email,handled_at,handled_by,plus_code,accuracy_m,altitude_m,battery_pct,profile&order=created_at.desc&limit=80';
  const SOS_OLD='sos_alerts?select=id,name,lat,lng,device,created_at,status,user_email,handled_at,handled_by&order=created_at.desc&limit=80';
  // Responder aktif: orang di sekitar yang baru saja melaporkan posisi mereka
  const RESPONDERS='sos_responders?select=id,sos_alert_id,responder_name,responder_email,lat,lng,distance_m,message_sent,status,responded_at&order=created_at.desc&limit=200';
  const [a,b,c]=await Promise.all([
    restWithFallback(SOS_NEW,SOS_OLD),
    rest('trail_checkins?select=id,position_id,position_name,lat,lng,checked_at,user_email,user_name,sync_state&order=checked_at.desc&limit=80'),
    rest(RESPONDERS)
  ]);
  const sos=a.ok?await a.json():[], checkins=b.ok?await b.json():[];
  const responderRows=c.ok?await c.json():[];
  // Kelompokkan responder berdasarkan sos_alert_id
  const respondersBySos={};
  if(Array.isArray(responderRows)){
    responderRows.forEach(r=>{
      const key=r.sos_alert_id;if(!key)return;
      if(!respondersBySos[key])respondersBySos[key]=[];
      respondersBySos[key].push({
        id:r.id,name:r.responder_name||r.responder_email||'Responder',
        email:r.responder_email,
        lat:Number(r.lat),lng:Number(r.lng),
        distance_m:Number(r.distance_m),
        message_sent:r.message_sent||'',
        status:r.status||'reported',
        responded_at:r.responded_at
      });
    });
  }
  return res.status(200).json({sos:Array.isArray(sos)?sos:[],checkins:Array.isArray(checkins)?checkins:[],responders:respondersBySos});
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
