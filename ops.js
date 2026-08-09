/* Operasi Pendakian: SOS aman, dashboard petugas, QR SIMAKSI, dan check-in offline. */
(function(){
  var POS=[['basecamp','Basecamp / Registrasi'],['pos-1','Pos 1'],['pos-2','Pos 2'],['pos-3','Pos 3'],['pos-4','Pos 4'],['pos-5','Pos 5'],['pos-6','Pos 6'],['pos-7','Pos 7'],['puncak','Puncak Bawakaraeng'],['turun','Mulai Turun']];
  var ACTIVE_KEY='bwkActiveSos', QUEUE_KEY='bwkCheckinQueue';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function toastx(m,t){try{if(window.toast)window.toast(m,t||'ok');}catch(e){}}
  function user(){try{return typeof bwkUser==='function'?bwkUser():null;}catch(e){return null;}}
  function token(){try{var c=(typeof _sbClient==='function')?_sbClient():null;if(!c)return Promise.resolve('');return c.auth.getSession().then(function(r){return (r&&r.data&&r.data.session&&r.data.session.access_token)||'';}).catch(function(){return '';});}catch(e){return Promise.resolve('');}}
  // Error kini membawa kode status + Retry-After supaya pemanggil bisa membedakan
  // "belum login" (401), "kuota penuh" (429), dan gangguan jaringan biasa.
  function apiErr(msg,status,extra){var e=new Error(msg);e.status=status||0;if(extra)Object.keys(extra).forEach(function(k){e[k]=extra[k];});return e;}
  function api(path,opt){opt=opt||{};return token().then(function(t){
    if(!t)throw apiErr('Login Google diperlukan',401);
    var h=Object.assign({'Content-Type':'application/json','Authorization':'Bearer '+t},opt.headers||{});
    return fetch(path,Object.assign({},opt,{headers:h})).then(function(r){
      var ra=Number(r.headers&&r.headers.get?r.headers.get('Retry-After'):0)||0;
      return r.json().catch(function(){return {};}).then(function(d){
        if(!r.ok)throw apiErr(d.error||'Permintaan gagal',r.status,{retryAfter:ra,data:d});
        return d;
      });
    },function(){throw apiErr('Jaringan tidak tersedia',0);});
  });}
  function getJson(k,df){try{return JSON.parse(localStorage.getItem(k)||JSON.stringify(df));}catch(e){return df;}}
  function setJson(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}

  // ===== Gelombang push berulang =====
  // Satu tembakan push hanya menjangkau perangkat yang online pada detik itu.
  // Selama SOS masih aktif, pengirim memicu gelombang ulang berkala sehingga HP yang
  // tadinya mati sinyal / layar mati tetap kebagian notifikasi saat kembali online.
  var WAVE_EVERY=150000, WAVE_MAX=10, _waveTimer=null, _waveCount=0;
  function _pushWave(id,tag){
    if(id==null)return Promise.resolve(null);
    return fetch('/api/sos-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(d){
        if(!r.ok&&d&&d.code==='NO_CONFIG')pushNote('⚠️ Notifikasi latar belum dikonfigurasi di server — alarm hanya berbunyi di aplikasi yang terbuka.');
        else if(r.ok&&tag==='first'&&d&&d.sent===0)pushNote('ℹ️ Belum ada perangkat lain terdaftar. Alarm tetap dicoba ulang otomatis.');
        return d;
      });}).catch(function(){return null;});
  }
  function pushNote(msg){var status=document.getElementById('sosStatus');if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:8px;font-size:11.5px;font-weight:700;opacity:.95">'+esc(msg)+'</div>');}
  function _stopWaves(){if(_waveTimer){clearInterval(_waveTimer);_waveTimer=null;}_waveCount=0;}
  function _startWaves(id){
    _stopWaves();_waveCount=0;
    _waveTimer=setInterval(function(){
      var act=getJson(ACTIVE_KEY,null);
      if(!act||!act.id||String(act.id)!==String(id)||_waveCount>=WAVE_MAX){_stopWaves();return;}
      _waveCount++;_pushWave(id,'ulang');
    },WAVE_EVERY);
  }
  window._sosStopWaves=_stopWaves;

  // SOS sekarang melewati server: identitas login, batas frekuensi, dan pencegahan SOS ganda.
  window._sosPublish=function(lat,lng,name){
    var u=user();if(!u||!u.google){toastx('Masuk dengan Google diperlukan untuk mengirim SOS','err');return;}
    var device='';try{device=localStorage.getItem('bwkDev')||'';}catch(e){}
    function adopt(id){
      setJson(ACTIVE_KEY,{id:id,created_at:Date.now()});showActiveSos();
      // Tandai SOS ini milik sendiri supaya HP pengirim tidak ikut berbunyi.
      try{if(window._sosMarkMine)window._sosMarkMine(id,lat,lng,name);}catch(e){}
      try{if(window._sosStart)window._sosStart();}catch(e){}
      // Segarkan koordinat langganan push pengirim: server memfilter penerima
      // memakai lokasi tersimpan, jadi data basi membuat alarm tidak terkirim.
      try{if(window._sosRefreshPush)window._sosRefreshPush(true);}catch(e){}
      _pushWave(id,'first');_startWaves(id);
      return id;
    }
    return api('/api/operations?action=sos-create',{method:'POST',body:JSON.stringify({lat:lat,lng:lng,device:device})}).then(function(d){
      if(!d.id)throw new Error('SOS gagal disimpan');
      adopt(d.id);
      var status=document.getElementById('sosStatus');if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">✅ SOS terverifikasi dan diteruskan ke petugas terdekat.</div>');
      return d;
    }).catch(function(e){
      // 409 = SOS aktif milik sendiri sudah ada. Itu bukan kegagalan: pakai ID yang ada
      // dan lanjutkan gelombang push, jangan biarkan pengguna mengira SOS tidak terkirim.
      if(e&&e.status===409&&e.data&&e.data.id){
        adopt(e.data.id);
        var st=document.getElementById('sosStatus');if(st)st.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">✅ SOS kamu masih aktif — sinyal dikirim ulang ke perangkat sekitar.</div>');
        return e.data;
      }
      // Pesan lama selalu berbunyi "periksa koneksi" untuk SEMUA kode selain 401/429,
      // termasuk 502 database. Sekarang kode + sebab dari server selalu ditampilkan.
      var st=(e&&e.status)||0, det=(e&&e.data&&e.data.detail)?String(e.data.detail):'';
      var why=st===401?'Kamu belum login Google.':st===429?'Terlalu banyak percobaan, tunggu beberapa menit.':st===403?'Domain ini belum diizinkan server. Isi ALLOWED_ORIGINS di Vercel.':st===400?'Koordinat atau nama perangkat tidak valid.':st===502?'Database menolak menyimpan SOS. Jalankan supabase-perbaikan-sos.sql.':st===503?'Kunci server belum lengkap di Vercel.':st===0?'Koneksi ke server terputus.':('Server menjawab kode '+st+'.');
      why+=' [kode '+st+(det?': '+det.slice(0,120):'')+']';
      toastx(e.message||'SOS gagal dikirim','err');
      var status=document.getElementById('sosStatus');
      if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;color:#ffd9d9;font-size:12px;font-weight:800">⚠️ SOS belum tersimpan. '+esc(why)+' Gunakan tombol WhatsApp/SMS di bawah sekarang.</div>');
      return null;
    });
  };
  window._sosResolveMy=function(){var a=getJson(ACTIVE_KEY,null);if(!a||!a.id){toastx('Tidak ada SOS aktif pada perangkat ini','err');return;}api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:a.id})}).then(function(){localStorage.removeItem(ACTIVE_KEY);_stopWaves();showActiveSos();toastx('SOS ditandai selesai. Tim diberi status aman.','ok');}).catch(function(e){toastx(e.message||'Gagal menyelesaikan SOS','err');});};
  function showActiveSos(){var old=document.getElementById('mySosActive');if(old)old.remove();var a=getJson(ACTIVE_KEY,null);if(!a||!a.id)return;var x=document.createElement('div');x.id='mySosActive';x.style.cssText='position:fixed;left:12px;right:12px;bottom:86px;z-index:99997;max-width:500px;margin:auto;background:#fff2f3;border:1px solid #f4b4ba;color:#8e1d2c;border-radius:14px;padding:11px 13px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:13px;font-weight:700;display:flex;gap:10px;align-items:center';x.innerHTML='<span style="font-size:21px">🆘</span><span style="flex:1">SOS kamu sedang aktif. Bila sudah aman, segera tutup sinyal.</span><button onclick="_sosResolveMy()" style="border:0;border-radius:9px;background:#c93647;color:#fff;padding:9px 10px;font-weight:800">Saya Aman</button>';document.body.appendChild(x);}

  // Gantikan polling SOS langsung Supabase dengan endpoint radius yang terproteksi.
  window._opsNearby=function(lat,lng){return api('/api/operations?action=sos-nearby',{method:'POST',body:JSON.stringify({lat:lat,lng:lng})}).then(function(x){return x.items||[];});};

  function ensureCheckin(){var host=document.getElementById('peta');if(!host||document.getElementById('trailCheckin'))return;var box=document.createElement('div');box.id='trailCheckin';box.style.cssText='margin:16px 0;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;padding:14px;box-shadow:var(--shadow,0 3px 14px rgba(0,0,0,.08))';box.innerHTML='<div style="display:flex;gap:10px;align-items:center"><span style="font-size:25px">📍</span><div><b>Check-in Pos</b><small style="display:block;color:var(--sub,#667);font-size:12px;margin-top:2px">Simpan posisi saat melewati pos. Tetap tersimpan bila offline dan dikirim saat internet kembali.</small></div></div><select id="ciPos" style="width:100%;margin:12px 0 8px;padding:11px;border:1px solid #dce2ea;border-radius:10px;background:var(--card,#fff)">'+POS.map(function(p){return '<option value="'+p[0]+'">'+p[1]+'</option>';}).join('')+'</select><button class="btn g-green" onclick="opsCheckin()">📍 Check-in dengan GPS</button><div id="ciStatus" style="font-size:12px;color:var(--sub,#667);margin-top:8px"></div>';host.appendChild(box);checkinStatus();}
  window.opsCheckin=function(){var u=user();if(!u||!u.google){toastx('Masuk dengan Google diperlukan untuk check-in','err');return;}var s=document.getElementById('ciPos'),pick=POS.filter(function(x){return x[0]===(s&&s.value);})[0]||POS[0];var out=document.getElementById('ciStatus');if(out)out.textContent='Mencari lokasi GPS…';if(!navigator.geolocation){if(out)out.textContent='GPS tidak tersedia pada perangkat ini.';return;}navigator.geolocation.getCurrentPosition(function(p){var rec={position_id:pick[0],position_name:pick[1],lat:p.coords.latitude,lng:p.coords.longitude,checked_at:new Date().toISOString()};var q=getJson(QUEUE_KEY,[]);q.push(rec);setJson(QUEUE_KEY,q);try{var n=+(localStorage.getItem('bwkTrailCheckins')||0);localStorage.setItem('bwkTrailCheckins',String(n+1));}catch(e){}checkinStatus();syncCheckins();toastx('Check-in '+pick[1]+' tersimpan','ok');},function(){if(out)out.textContent='GPS belum tersedia. Aktifkan izin lokasi lalu coba lagi.';},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});};
  function checkinStatus(){var el=document.getElementById('ciStatus'),q=getJson(QUEUE_KEY,[]);if(el)el.textContent=q.length?('⏳ '+q.length+' check-in menunggu sinkronisasi.'):'✅ Semua check-in sudah tersinkron.';}
  function syncCheckins(){if(!navigator.onLine)return;var q=getJson(QUEUE_KEY,[]);if(!q.length)return;var first=q[0];api('/api/operations?action=checkin',{method:'POST',body:JSON.stringify(first)}).then(function(){q.shift();setJson(QUEUE_KEY,q);checkinStatus();syncCheckins();}).catch(function(){checkinStatus();});}

  // Dashboard petugas: SOS aktif, riwayat, dan check-in paling baru.
  function isAdminClient(){var u=user();return !!(u&&u.role==='Admin');}
  function addOpsTab(){if(!isAdminClient())return;var tabs=document.querySelector('.admin-tabs');if(tabs&&!document.getElementById('opsSosTab')){var b=document.createElement('button');b.id='opsSosTab';b.className='admin-tab';b.textContent='🆘 Operasi';b.onclick=function(){adminTab('operasi',b);};tabs.insertBefore(b,tabs.firstChild);}}

  // BUG FIX #2: lat/lng dulu dimasukkan ke href tanpa sanitasi. Nilai seperti
  // `" onclick="alert(1)` yang disimpan di DB menghasilkan XSS di panel admin.
  // safeCoord() hanya mengizinkan karakter angka, titik, minus — cukup untuk koordinat.
  function safeCoord(v){return String(v==null?'':v).replace(/[^0-9.\-]/g,'').slice(0,20);}
  function safeMapUrl(lat,lng){return 'https://maps.google.com/?q='+safeCoord(lat)+','+safeCoord(lng);}

  window.opsDashboard=function(){var b=document.getElementById('adminBody');if(!b)return;b.innerHTML='<div class="aempty">Memuat dashboard operasi…</div>';api('/api/operations?action=admin',{method:'GET'}).then(function(d){
    var sos=d.sos||[],active=sos.filter(function(x){return x.status==='active';}),checks=d.checkins||[];
    // BUG FIX #2 (lanjutan): pakai safeMapUrl() + esc() untuk SEMUA URL peta di dashboard.
    var cards=active.length?active.map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      return '<div class="ops-card danger"><div><b>🆘 '+esc(x.name||'Pendaki')+'</b><small>'+new Date(x.created_at).toLocaleString('id-ID')+'</small><small>📍 '+esc(Number(x.lat).toFixed(5))+', '+esc(Number(x.lng).toFixed(5))+'</small></div><a href="'+esc(map)+'" target="_blank" rel="noopener">🗺️ Peta</a><button onclick="opsResolve(\''+esc(x.id)+'\')">✅ Tangani</button></div>';
    }).join(''):'<div class="aempty">✅ Tidak ada SOS aktif.</div>';
    var hist=sos.filter(function(x){return x.status!=='active';}).slice(0,8).map(function(x){return '<li>'+esc(x.name||'Pendaki')+' · '+esc(x.status||'resolved')+' · '+new Date(x.created_at).toLocaleString('id-ID')+'</li>';}).join('')||'<li>Belum ada riwayat.</li>';
    var check=checks.slice(0,12).map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      return '<li><b>'+esc(x.user_name||x.user_email||'Pendaki')+'</b> · '+esc(x.position_name)+' <a href="'+esc(map)+'" target="_blank" rel="noopener">peta</a><br/><small>'+new Date(x.checked_at).toLocaleString('id-ID')+'</small></li>';
    }).join('')||'<li>Belum ada check-in.</li>';
    b.innerHTML='<style>.ops-card{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--line,#e4e8ef);border-radius:13px;padding:12px;margin:9px 0;background:var(--card,#ffffff);color:var(--ink,#141a2c);box-shadow:var(--shadow)}.ops-card.danger{border-color:#eeadb4;background:#fff6f7;color:#991b1b}html.dark .ops-card.danger{border-color:#7f1d1d;background:#2c1517;color:#fca5a5}.ops-card div{flex:1}.ops-card b{color:var(--ink,#141a2c);display:block}.ops-card small{color:var(--sub,#69758a);font-size:11px;margin-top:3px;display:block}.ops-card a,.ops-card button{border:0;border-radius:9px;padding:9px;text-decoration:none;font-size:12px;font-weight:800;background:var(--brand,#26705a);color:#fff}.ops-card button{background:#198754;color:#fff}.ops-list{margin:6px 0;padding-left:18px;font-size:12px;line-height:1.55;color:var(--ink,#141a2c)}.ops-list li{color:var(--ink,#141a2c);margin:4px 0}.ops-list li b{color:var(--ink,#141a2c)}.ops-list li small{color:var(--sub,#565f78);font-size:11px}.ops-list li a{color:#2563eb;font-weight:700;text-decoration:underline}html.dark .ops-list li a{color:#60a5fa}.ops-head{background:linear-gradient(135deg,#17314d,#2a6173);color:#fff;border-radius:14px;padding:13px}.ops-head b{font-size:18px}</style><div class="ops-head"><b>🆘 Dashboard Operasi</b><br/><small>'+active.length+' SOS aktif · '+checks.length+' check-in terbaru</small></div><div class="sh"><span class="bar" style="background:#e5484d"></span><h3>SOS Aktif</h3></div>'+cards+'<div class="sh"><span class="bar" style="background:#2b6fff"></span><h3>Check-in Terbaru</h3></div><ul class="ops-list">'+check+'</ul><div class="sh"><span class="bar" style="background:#7b61ff"></span><h3>Riwayat SOS</h3></div><ul class="ops-list">'+hist+'</ul><div style="display:flex;gap:8px;margin-top:10px"><button class="btn g-indigo" style="flex:1" onclick="opsDashboard()">↻ Muat Ulang</button><button class="btn gh" style="flex:1" onclick="opsVerifyPermit()">🎫 Verifikasi QR SIMAKSI</button></div>';
  }).catch(function(e){b.innerHTML='<div class="aempty">Dashboard tidak dapat dibuka: '+esc(e.message||'Pastikan konfigurasi server dan SQL sudah dijalankan.')+'</div>';});};
  window.opsResolve=function(id){if(!confirm('Tandai SOS ini sudah ditangani?'))return;
    // BUG FIX #4: validasi UUID sebelum mengirim ke server untuk mencegah ID injection.
    var uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(!id||!uuidRe.test(id)){toastx('ID SOS tidak valid','err');return;}
    api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:id})}).then(function(){toastx('SOS ditandai sudah ditangani','ok');opsDashboard();}).catch(function(e){toastx(e.message||'Gagal memperbarui SOS','err');});};

  // QR SIMAKSI memakai payload baku sehingga kode tetap dapat diverifikasi manual oleh petugas.
  window.simaksiQrPayload=function(r){return JSON.stringify({type:'RC-SIMAKSI',version:1,code:r.code,valid_from:r.naik,valid_to:r.turun,route:r.jalur});};
  function addPermitVerify(){if(!isAdminClient())return;var p=document.getElementById('adminPanel');if(!p||document.getElementById('opsPermitVerifier'))return;var el=document.createElement('div');el.id='opsPermitVerifier';el.style.cssText='display:none';el.innerHTML='';p.appendChild(el);}
  window.opsVerifyPermit=function(code){if(!isAdminClient())return;var c=(code||prompt('Masukkan kode SIMAKSI dari QR / kartu:')||'').trim().toUpperCase();if(!c)return;api('/api/operations?action=permit-verify',{method:'POST',body:JSON.stringify({code:c})}).then(function(r){var x=r.permit||{},ok=!!r.valid;alert((ok?'✅ SIMAKSI SAH':'⚠️ BELUM SAH')+'\n\nKode: '+(x.code||c)+'\nKetua: '+(x.nama||'-')+'\nJalur: '+(x.jalur||'-')+'\nBerlaku: '+(x.naik||'-')+' s/d '+(x.turun||'-'));}).catch(function(e){toastx(e.message||'Gagal memeriksa SIMAKSI','err');});};

  function boot(){showActiveSos();ensureCheckin();addOpsTab();addPermitVerify();syncCheckins();}
  window.addEventListener('online',syncCheckins);window.addEventListener('load',function(){setTimeout(boot,1200);});document.addEventListener('visibilitychange',function(){if(!document.hidden){ensureCheckin();syncCheckins();}});
})();
