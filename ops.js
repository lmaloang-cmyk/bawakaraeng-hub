/* Operasi Pendakian: SOS aman, dashboard petugas, QR SIMAKSI, dan check-in offline. */

/* =====================================================================
   PEMUAT MODUL SOS
   ---------------------------------------------------------------------
   Blok ini sengaja diletakkan di ops.js supaya index.html (1 MB) TIDAK
   perlu diubah sama sekali. Saat ops.js sedang diurai oleh browser,
   document.write menyisipkan tag <script> tepat setelah tag ops.js,
   sehingga modul-modul di bawah dijamin selesai dieksekusi SEBELUM
   sos.js berjalan. Bila ops.js dimuat dengan defer/async (readyState
   bukan 'loading'), kita jatuh ke penambahan elemen dengan async=false
   yang tetap menjaga urutan eksekusi.

   Urutan wajib: pluscode -> context -> auth -> outbox -> relay
   sos-mesh.js sengaja TIDAK dimuat (masih eksperimental).
   ===================================================================== */
(function(){
  try{
    if(window.__bwkSosKitLoaded)return;
    window.__bwkSosKitLoaded=true;
    // Mode uji coba: radius unlimited (Infinity) untuk test jangkauan SOS
    // Setelah launching, ganti kembali ke 20000 (20 km)
    if(window.BWK_SOS_RADIUS_M==null)window.BWK_SOS_RADIUS_M=Infinity;

    var CSS='/sos-ui.css';
    if(!document.querySelector('link[data-bwk-sos-css]')){
      var l=document.createElement('link');
      l.rel='stylesheet';l.href=CSS;l.setAttribute('data-bwk-sos-css','1');
      (document.head||document.documentElement).appendChild(l);
    }

    var MODS=['/sos-pluscode.js','/sos-context.js','/sos-auth.js','/sos-outbox.js','/sos-relay.js'];
    var parsing=(document.readyState==='loading');
    for(var i=0;i<MODS.length;i++){
      var src=MODS[i];
      if(document.querySelector('script[src="'+src+'"]'))continue;
      if(parsing){
        document.write('<script src="'+src+'"><\/script>');
      }else{
        var s=document.createElement('script');
        s.src=src;s.async=false;
        (document.head||document.documentElement).appendChild(s);
      }
    }
  }catch(e){
    try{console.error('[BWK] pemuat modul SOS gagal:',e);}catch(_){}
  }
})();

(function(){
  var POS=[['basecamp','Basecamp / Registrasi'],['pos-1','Pos 1'],['pos-2','Pos 2'],['pos-3','Pos 3'],['pos-4','Pos 4'],['pos-5','Pos 5'],['pos-6','Pos 6'],['pos-7','Pos 7'],['puncak','Puncak Bawakaraeng'],['turun','Mulai Turun']];
  var ACTIVE_KEY='bwkActiveSos', QUEUE_KEY='bwkCheckinQueue', SOS_QUEUE_KEY='bwkSosQueue';
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
  function _sosName(){try{var raw=localStorage.getItem('bwkUser');if(raw){var o=JSON.parse(raw);if(o&&o.name)return o.name;}var n=localStorage.getItem('bwkSosName');if(n)return n;return 'Pendaki';}catch(e){return 'Pendaki';}}

  // ===== Gelombang push berulang =====
  // Satu tembakan push hanya menjangkau perangkat yang online pada detik itu.
  // Selama SOS masih aktif, pengirim memicu gelombang ulang berkala sehingga HP yang
  // tadinya mati sinyal / layar mati tetap kebagian notifikasi saat kembali online.
  var WAVE_EVERY=150000, WAVE_MAX=10, _waveTimer=null, _waveCount=0;
  function _pushWave(id,tag){
    if(id==null)return Promise.resolve(null);
    return fetch('/api/sos-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
      .then(function(r){return r.json().catch(function(){return {};}).then(function(d){
        if(!r.ok&&d&&d.code==='NO_CONFIG')pushNote('\u26a0\ufe0f Notifikasi latar belum dikonfigurasi di server \u2014 alarm hanya berbunyi di aplikasi yang terbuka.');
        else if(r.ok&&tag==='first'&&d&&d.sent===0)pushNote('\u2139\ufe0f Belum ada perangkat lain terdaftar. Alarm tetap dicoba ulang otomatis.');
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

  // ===================================================================
  // ADOPSI SOS: dipanggil setelah server memberi ID, baik lewat jalur
  // langsung maupun lewat Outbox (offline-first).
  // ===================================================================
  function adopt(id,lat,lng,name){
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
  // Dipanggil oleh sos-outbox.js saat sebuah SOS antrian akhirnya terkirim.
  window._sosAdoptQueued=function(id,payload){
    try{
      payload=payload||{};
      adopt(id,payload.lat,payload.lng,payload.name);
      // Simpan client_id juga agar relay eskalasi bisa melacak sumber.
      try{localStorage.setItem('bwkActiveSos',JSON.stringify({id:id,lat:payload.lat,lng:payload.lng,client_id:payload.client_id,created_at:Date.now()}));}catch(e){}
    }catch(e){}
  };

  // ===================================================================
  // JALUR LAMA (cadangan). Dipakai HANYA bila modul BWKSosOutbox gagal
  // dimuat. Tanpa ini, kegagalan memuat satu berkas akan mematikan tombol
  // SOS sepenuhnya \u2014 risiko yang tidak boleh diambil untuk fitur darurat.
  // Catatan: gerbang "wajib login Google" DIHAPUS (temuan S2). SOS tidak
  // boleh pernah ditolak karena pengguna belum login.
  // ===================================================================
  function _sosPublishLegacy(lat,lng,name){
    var device='';try{device=localStorage.getItem('bwkDev')||'';}catch(e){}
    return api('/api/operations?action=sos-create',{method:'POST',body:JSON.stringify({lat:lat,lng:lng,device:device})}).then(function(d){
      if(!d.id)throw new Error('SOS gagal disimpan');
      adopt(d.id,lat,lng,name);
      var status=document.getElementById('sosStatus');if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\u2705 SOS terverifikasi dan diteruskan ke petugas terdekat.</div>');
      return d;
    }).catch(function(e){
      // 409 = SOS aktif milik sendiri sudah ada. Itu bukan kegagalan: pakai ID yang ada
      // dan lanjutkan gelombang push, jangan biarkan pengguna mengira SOS tidak terkirim.
      if(e&&e.status===409&&e.data&&e.data.id){
        adopt(e.data.id,lat,lng,name);
        var st=document.getElementById('sosStatus');if(st)st.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\u2705 SOS kamu masih aktif \u2014 sinyal dikirim ulang ke perangkat sekitar.</div>');
        return e.data;
      }
      var st2=(e&&e.status)||0, det=(e&&e.data&&e.data.detail)?String(e.data.detail):'';
      var why=st2===401?'Kamu belum login.':st2===429?'Terlalu banyak percobaan, tunggu beberapa menit.':st2===403?'Domain ini belum diizinkan server. Isi ALLOWED_ORIGINS di Vercel.':st2===400?'Koordinat atau nama perangkat tidak valid.':st2===502?'Database menolak menyimpan SOS. Jalankan supabase-perbaikan-sos.sql.':st2===503?'Kunci server belum lengkap di Vercel.':st2===0?'Koneksi ke server terputus.':('Server menjawab kode '+st2+'.');
      why+=' [kode '+st2+(det?': '+det.slice(0,120):'')+']';
      toastx(e.message||'SOS gagal dikirim','err');
      // Simpan ke antrian lama; nanti dipindahkan otomatis ke Outbox oleh _migrateOldQueue().
      _legacyQueueEnqueue({lat:lat,lng:lng,device:device,name:name||_sosName()});
      var status=document.getElementById('sosStatus');
      if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;color:#ffd9d9;font-size:12px;font-weight:800">\u26a0\ufe0f '+esc(why)+'<br>SOS disimpan offline \u2014 akan otomatis terkirim saat internet pulih.</div>');
      return null;
    });
  }

  // ===================================================================
  // JALUR BARU: simpan dulu \u2192 pasang jalur cadangan \u2192 baru kirim.
  // Urutan ini disengaja. SOS harus sudah aman tersimpan di perangkat
  // sebelum satu pun paket jaringan dicoba.
  // ===================================================================
  window._sosPublish=function(lat,lng,name){
    if(!window.BWKSosOutbox||typeof window.BWKSosOutbox.enqueue!=='function'){
      try{console.warn('[BWK] BWKSosOutbox tidak tersedia \u2014 memakai jalur lama.');}catch(e){}
      return _sosPublishLegacy(lat,lng,name);
    }
    var device='';try{device=localStorage.getItem('bwkDev')||'';}catch(e){}
    var nm=name||_sosName();

    var ctxP;
    try{
      ctxP=(window.BWKSosContext&&window.BWKSosContext.collect)
        ? Promise.resolve(window.BWKSosContext.collect({lat:lat,lng:lng})).catch(function(){return {};})
        : Promise.resolve({});
    }catch(e){ctxP=Promise.resolve({});}

    return ctxP.then(function(ctx){
      ctx=ctx||{};
      var payload={
        lat:lat, lng:lng, name:nm, device:device,
        accuracy_m:ctx.accuracy_m, altitude_m:ctx.altitude_m,
        battery_pct:ctx.battery_pct, plus_code:ctx.plus_code, profile:ctx.profile
      };
      return Promise.resolve(window.BWKSosOutbox.enqueue(payload)).then(function(rec){
        toastx('SOS tersimpan. Mengirim\u2026','ok');
        var status=document.getElementById('sosStatus');
        if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\uD83C\uDD98 SOS tersimpan di perangkat dan akan terus dicoba sampai terkirim.'+(ctx.plus_code?('<br>Kode lokasi: '+esc(ctx.plus_code)):'')+'</div>');
        // Catat client_id sebagai milik sendiri supaya HP pengirim tidak ikut beralarm.
        try{if(rec&&rec.client_id&&window._sosMarkMineClient)window._sosMarkMineClient(rec.client_id);}catch(e){}
        // Jalur cadangan (WA / SMS / telepon) dipasang SEBELUM pengiriman dicoba.
        try{if(window.BWKSosRelay&&rec&&rec.client_id)window.BWKSosRelay.startEscalation(rec.client_id);}catch(e){}
        return Promise.resolve(window.BWKSosOutbox.flush()).catch(function(){return null;});
      });
    }).catch(function(e){
      try{console.error('[BWK] jalur SOS baru gagal, beralih ke jalur lama:',e);}catch(_){}
      return _sosPublishLegacy(lat,lng,name);
    });
  };

  window._sosResolveMy=function(){
    var a=getJson(ACTIVE_KEY,null);
    if(!a||!a.id){toastx('Tidak ada SOS aktif pada perangkat ini','err');return;}
    api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:a.id})}).then(function(){
      localStorage.removeItem(ACTIVE_KEY);_stopWaves();
      try{if(window.BWKSosRelay&&window.BWKSosRelay.stopEscalation)window.BWKSosRelay.stopEscalation();}catch(e){}
      // Remove the active SOS banner immediately
      var activeEl=document.getElementById('mySosActive');if(activeEl)activeEl.remove();
      toastx('SOS ditandai selesai. Tim diberi status aman.','ok');
      // Refresh admin panel if open
      try{if(typeof opsDashboard==='function')opsDashboard();}catch(e){}
    }).catch(function(e){toastx(e.message||'Gagal menyelesaikan SOS','err');});
  };

  // ===== Antrian lama (hanya untuk jalur cadangan) =====
  // Fungsi _sosQueueDequeue / _sosQueueRemove / _syncSosQueue yang lama DIHAPUS:
  // dequeue mengembalikan item tanpa menghapusnya dan jalur gagal menambah salinan
  // baru, sehingga satu SOS bisa berlipat ganda tanpa batas (temuan S1).
  // Yang tersisa hanya penyimpan darurat; pengiriman ulang kini milik BWKSosOutbox.
  function _legacyQueueEnqueue(payload){
    try{
      var q=getJson(SOS_QUEUE_KEY,[]);
      q.unshift({ts:Date.now(),payload:payload});
      setJson(SOS_QUEUE_KEY,q.slice(0,10));
    }catch(e){}
  }

  // Migrasi satu kali: pindahkan sisa antrian lama ke Outbox baru supaya SOS
  // milik pengguna lama yang belum terkirim tidak menjadi yatim.
  function _migrateOldQueue(){
    try{
      if(!window.BWKSosOutbox||typeof window.BWKSosOutbox.enqueue!=='function')return;
      var raw=localStorage.getItem(SOS_QUEUE_KEY);
      if(!raw)return;
      var q=[];try{q=JSON.parse(raw)||[];}catch(e){q=[];}
      if(!q.length){localStorage.removeItem(SOS_QUEUE_KEY);return;}
      var now=Date.now(),moved=0;
      q.forEach(function(item){
        if(!item||!item.payload)return;
        if(item.ts&&(now-item.ts)>86400000)return; // lewat 24 jam, jangan bangkitkan lagi
        try{window.BWKSosOutbox.enqueue(item.payload);moved++;}catch(e){}
      });
      localStorage.removeItem(SOS_QUEUE_KEY);
      if(moved)toastx('\uD83D\uDCE1 '+moved+' SOS lama dipindahkan ke antrian baru','ok');
    }catch(e){}
  }

  function _bootOutbox(){
    try{
      if(!window.BWKSosOutbox)return;
      if(window.BWKSosOutbox.setTokenProvider&&!window.__bwkOutboxTokenSet){
        window.__bwkOutboxTokenSet=true;
        window.BWKSosOutbox.setTokenProvider(function(){
          return token().then(function(t){
            if(t)return t;
            // Belum login Google? Pakai sesi anonim supaya SOS tetap terkirim.
            if(window.BWKSosAuth&&window.BWKSosAuth.token)return window.BWKSosAuth.token();
            return '';
          }).catch(function(){return '';});
        });
      }
      _migrateOldQueue();
      if(navigator.onLine)Promise.resolve(window.BWKSosOutbox.flush()).catch(function(){});
    }catch(e){}
  }

  // ===== Penanda antrian di layar =====
  function _outboxPill(text,bad){
    try{
      var el=document.getElementById('bwkSosOutboxPill');
      if(!text){if(el)el.remove();return;}
      if(!el){el=document.createElement('div');el.id='bwkSosOutboxPill';el.setAttribute('role','status');document.body.appendChild(el);}
      el.className='show'+(bad?' bad':'');
      el.textContent=text;
    }catch(e){}
  }
  window.addEventListener('bwk:sos-outbox',function(ev){
    var d=(ev&&ev.detail)||{};
    try{
      if(d.status==='sent'){
        if(d.id)window._sosAdoptQueued(d.id,d.payload||{});
        _outboxPill('SOS terkirim ke pusat',false);
        setTimeout(function(){_outboxPill('');},6000);
        return;
      }
      if(d.status==='dead'){
        _outboxPill('SOS gagal terkirim \u2014 pakai jalur cadangan',true);
        return;
      }
      var n=d.pending;
      if(n==null){try{n=window.BWKSosOutbox&&window.BWKSosOutbox.count?window.BWKSosOutbox.count():0;}catch(e){n=0;}}
      Promise.resolve(n).then(function(c){
        c=Number(c)||0;
        if(c)_outboxPill(c+' SOS menunggu sinyal (percobaan ke-'+(((d.tries)||0)+1)+')',false);
        else _outboxPill('');
      }).catch(function(){});
    }catch(e){}
  });

  window.addEventListener('online',function(){_bootOutbox();});
  window.addEventListener('load',function(){setTimeout(_bootOutbox,3000);});

  function showActiveSos(){var old=document.getElementById('mySosActive');if(old)old.remove();var a=getJson(ACTIVE_KEY,null);if(!a||!a.id)return;var x=document.createElement('div');x.id='mySosActive';x.style.cssText='position:fixed;left:12px;right:12px;bottom:86px;z-index:99997;max-width:500px;margin:auto;background:#fff2f3;border:1px solid #f4b4ba;color:#8e1d2c;border-radius:14px;padding:11px 13px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:13px;font-weight:700;display:flex;gap:10px;align-items:center';x.innerHTML='<span style="font-size:21px">\uD83C\uDD98</span><span style="flex:1">SOS kamu sedang aktif. Bila sudah aman, segera tutup sinyal.</span><button onclick="_sosResolveMy()" style="border:0;border-radius:9px;background:#c93647;color:#fff;padding:9px 10px;font-weight:800">Saya Aman</button>';document.body.appendChild(x);}

  // Gantikan polling SOS langsung Supabase dengan endpoint radius yang terproteksi.
  window._opsNearby=function(lat,lng){return api('/api/operations?action=sos-nearby',{method:'POST',body:JSON.stringify({lat:lat,lng:lng})}).then(function(x){return x.items||[];});};

  function ensureCheckin(){var host=document.getElementById('peta');if(!host||document.getElementById('trailCheckin'))return;var box=document.createElement('div');box.id='trailCheckin';box.style.cssText='margin:16px 0;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;padding:14px;box-shadow:var(--shadow,0 3px 14px rgba(0,0,0,.08))';box.innerHTML='<div style="display:flex;gap:10px;align-items:center"><span style="font-size:25px">\uD83D\uDCCD</span><div><b>Check-in Pos</b><small style="display:block;color:var(--sub,#667);font-size:12px;margin-top:2px">Simpan posisi saat melewati pos. Tetap tersimpan bila offline dan dikirim saat internet kembali.</small></div></div><select id="ciPos" style="width:100%;margin:12px 0 8px;padding:11px;border:1px solid #dce2ea;border-radius:10px;background:var(--card,#fff)">'+POS.map(function(p){return '<option value="'+p[0]+'">'+p[1]+'</option>';}).join('')+'</select><button class="btn g-green" onclick="opsCheckin()">\uD83D\uDCCD Check-in dengan GPS</button><div id="ciStatus" style="font-size:12px;color:var(--sub,#667);margin-top:8px"></div>';host.appendChild(box);checkinStatus();}
  window.opsCheckin=function(){var u=user();if(!u||!u.google){toastx('Masuk dengan Google diperlukan untuk check-in','err');return;}var s=document.getElementById('ciPos'),pick=POS.filter(function(x){return x[0]===(s&&s.value);})[0]||POS[0];var out=document.getElementById('ciStatus');if(out)out.textContent='Mencari lokasi GPS\u2026';if(!navigator.geolocation){if(out)out.textContent='GPS tidak tersedia pada perangkat ini.';return;}navigator.geolocation.getCurrentPosition(function(p){var rec={position_id:pick[0],position_name:pick[1],lat:p.coords.latitude,lng:p.coords.longitude,checked_at:new Date().toISOString()};var q=getJson(QUEUE_KEY,[]);q.push(rec);setJson(QUEUE_KEY,q);try{var n=+(localStorage.getItem('bwkTrailCheckins')||0);localStorage.setItem('bwkTrailCheckins',String(n+1));}catch(e){}checkinStatus();syncCheckins();toastx('Check-in '+pick[1]+' tersimpan','ok');},function(){if(out)out.textContent='GPS belum tersedia. Aktifkan izin lokasi lalu coba lagi.';},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});};
  function checkinStatus(){var el=document.getElementById('ciStatus'),q=getJson(QUEUE_KEY,[]);if(el)el.textContent=q.length?('\u23f3 '+q.length+' check-in menunggu sinkronisasi.'):'\u2705 Semua check-in sudah tersinkron.';}
  function syncCheckins(){if(!navigator.onLine)return;var q=getJson(QUEUE_KEY,[]);if(!q.length)return;var first=q[0];api('/api/operations?action=checkin',{method:'POST',body:JSON.stringify(first)}).then(function(){q.shift();setJson(QUEUE_KEY,q);checkinStatus();syncCheckins();}).catch(function(){checkinStatus();});}

  // Dashboard petugas: SOS aktif, riwayat, dan check-in paling baru.
  function isAdminClient(){var u=user();return !!(u&&u.role==='Admin');}
  function addOpsTab(){if(!isAdminClient())return;var tabs=document.querySelector('.admin-tabs');if(tabs&&!document.getElementById('opsSosTab')){var b=document.createElement('button');b.id='opsSosTab';b.className='admin-tab';b.textContent='\uD83C\uDD98 Operasi';b.onclick=function(){adminTab('operasi',b);};tabs.insertBefore(b,tabs.firstChild);}}

  // BUG FIX #2: lat/lng dulu dimasukkan ke href tanpa sanitasi. Nilai seperti
  // `" onclick="alert(1)` yang disimpan di DB menghasilkan XSS di panel admin.
  // safeCoord() hanya mengizinkan karakter angka, titik, minus \u2014 cukup untuk koordinat.
  function safeCoord(v){return String(v==null?'':v).replace(/[^0-9.\-]/g,'').slice(0,20);}
  function safeMapUrl(lat,lng){return 'https://maps.google.com/?q='+safeCoord(lat)+','+safeCoord(lng);}

  window.opsDashboard=function(){var b=document.getElementById('adminBody');if(!b)return;b.innerHTML='<div class="aempty">Memuat dashboard operasi\u2026</div>';api('/api/operations?action=admin',{method:'GET'}).then(function(d){
    var sos=d.sos||[],active=sos.filter(function(x){return x.status==='active';}),checks=d.checkins||[],responders=d.responders||{};
    // Simpan responders ke global agar opsSendInstr bisa mengaksesnya
    try{window._opsResponders=responders;}catch(e){}
    // Kelompokkan responder berdasarkan sos_alert_id
    var allResp=[];Object.keys(responders).forEach(function(sosId){(responders[sosId]||[]).forEach(function(r){allResp.push(Object.assign({sos_id:sosId},r));});});
    var respList=allResp.slice(0,10).map(function(r){return '<li><b>'+esc(r.name)+'</b> <small>(±'+esc(r.distance_m)+'m)</small> '+(r.message_sent?('<span style="color:#2563eb">\uD83D\uDCE3 '+esc(r.message_sent).slice(0,40)+'</span>'):('<span style="color:#16a34a">\u2705</span>'))+'</li>';}).join('')||'<li>Belum ada responder.</li>';
    // BUG FIX #2 (lanjutan): pakai safeMapUrl() + esc() untuk SEMUA URL peta di dashboard.
    var cards=active.length?active.map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      var pc=x.plus_code?('<small>\uD83D\uDD22 '+esc(x.plus_code)+'</small>'):'';
      var ac=(x.accuracy_m!=null)?('<small>\uD83C\uDFAF akurasi \u00b1'+esc(Math.round(Number(x.accuracy_m)))+' m</small>'):'';
      var bt=(x.battery_pct!=null)?('<small>\uD83D\uDD0B baterai '+esc(Math.round(Number(x.battery_pct)))+'%</small>'):'';
      // Sanitasi ID untuk data-id: hanya alphanumeric + dash/underscore
      var safeId=String(x.id||'').replace(/[^a-zA-Z0-9_\-]/g,'');
      return '<div class="ops-card danger"><div><b>'+esc(x.name||'Pendaki')+'</b><small>'+new Date(x.created_at).toLocaleString('id-ID')+'</small><small>'+esc(Number(x.lat).toFixed(5))+', '+esc(Number(x.lng).toFixed(5))+'</small>'+pc+ac+bt+'</div><a href="'+esc(map)+'" target="_blank" rel="noopener">🗺️ Peta</a><div style="display:flex;gap:6px;margin-left:8px"><button onclick="opsResolve(\''+safeId+'\')">✅ Tangani</button><button onclick="opsDelete(\''+safeId+'\')">🗑️</button></div></div>';
    }).join(''):'<div class="aempty">\u2705 Tidak ada SOS aktif.</div>';
    var hist=sos.filter(function(x){return x.status!=='active';}).slice(0,8).map(function(x){return '<li>'+esc(x.name||'Pendaki')+' \u00b7 '+esc(x.status||'resolved')+' \u00b7 '+new Date(x.created_at).toLocaleString('id-ID')+'</li>';}).join('')||'<li>Belum ada riwayat.</li>';
    var check=checks.slice(0,12).map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      return '<li><b>'+esc(x.user_name||x.user_email||'Pendaki')+'</b> \u00b7 '+esc(x.position_name)+' <a href="'+esc(map)+'" target="_blank" rel="noopener">peta</a><br/><small>'+new Date(x.checked_at).toLocaleString('id-ID')+'</small></li>';
    }).join('')||'<li>Belum ada check-in.</li>';
    b.innerHTML='<style>.ops-card{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--line,#e4e8ef);border-radius:13px;padding:12px;margin:9px 0;background:var(--card,#ffffff);color:var(--ink,#141a2c);box-shadow:var(--shadow)}.ops-card.danger{border-color:#eeadb4;background:#fff6f7;color:#991b1b}html.dark .ops-card.danger{border-color:#7f1d1d;background:#2c1517;color:#fca5a5}.ops-card div{flex:1}.ops-card b{color:var(--ink,#141a2c);display:block}.ops-card small{color:var(--sub,#69758a);font-size:11px;margin-top:3px;display:block}.ops-card a,.ops-card button{border:0;border-radius:9px;padding:9px;text-decoration:none;font-size:12px;font-weight:800;background:var(--brand,#26705a);color:#fff}.ops-card button{background:#198754;color:#fff}.ops-resp-item{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;margin-top:6px}.ops-resp-list{margin-top:8px;padding:8px;background:#f8fafc;border-radius:8px;font-size:12px}html.dark .ops-resp-item{background:#14532d;border-color:#22c55e;color:#86efac}.ops-list{margin:6px 0;padding-left:18px;font-size:12px;line-height:1.55;color:var(--ink,#141a2c)}.ops-list li{color:var(--ink,#141a2c);margin:4px 0}.ops-list li b{color:var(--ink,#141a2c)}.ops-list li small{color:var(--sub,#565f78);font-size:11px}.ops-list li a{color:#2563eb;font-weight:700;text-decoration:underline}html.dark .ops-list li a{color:#60a5fa}.ops-head{background:linear-gradient(135deg,#17314d,#2a6173);color:#fff;border-radius:14px;padding:13px}.ops-head b{font-size:18px}</style><div class="ops-head"><b>\uD83C\uDD98 Dashboard Operasi</b><br/><small>'+active.length+' SOS aktif · '+allResp.length+' responder · '+checks.length+' check-in terbaru</small></div><div class="sh"><span class="bar" style="background:#e5484d"></span><h3>SOS Aktif</h3></div>'+cards+'<div class="sh"><span class="bar" style="background:#7c3aed"></span><h3>Responder Aktif ('+allResp.length+')</h3></div><ul class="ops-list">'+respList+'</ul><div class="sh"><span class="bar" style="background:#2b6fff"></span><h3>Check-in Terbaru</h3></div><ul class="ops-list">'+check+'</ul><div class="sh"><span class="bar" style="background:#7b61ff"></span><h3>Riwayat SOS</h3></div><ul class="ops-list">'+hist+'</ul><div style="display:flex;gap:8px;margin-top:10px"><button class="btn g-indigo" style="flex:1" onclick="opsDashboard()">\u21bb Muat Ulang</button><button class="btn gh" style="flex:1" onclick="opsVerifyPermit()">\uD83C\uDFAB Verifikasi QR SIMAKSI</button></div>';
  }).catch(function(e){b.innerHTML='<div class="aempty">Dashboard tidak dapat dibuka: '+esc(e.message||'Pastikan konfigurasi server dan SQL sudah dijalankan.')+'</div>';});};
  window.opsResolve=function(id){if(!confirm('Tandai SOS ini sudah ditangani?'))return;console.log('[ops] Resolve SOS:', id);api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:id})}).then(function(r){console.log('[ops] Resolve response:', r);toastx('SOS ditandai sudah ditangani','ok');opsDashboard();}).catch(function(e){console.error('[ops] Resolve error:', e);toastx(e.message||'Gagal memperbarui SOS','err');});};
  window.opsDelete=function(id){if(!confirm('Hapus SOS ini sepenuhnya?'))return;console.log('[ops] Delete SOS:', id);api('/api/operations?action=sos-delete',{method:'POST',body:JSON.stringify({id:id})}).then(function(r){console.log('[ops] Delete response:', r);toastx('SOS berhasil dihapus','ok');opsDashboard();}).catch(function(e){console.error('[ops] Delete error:', e);toastx(e.message||'Gagal menghapus SOS','err');});};

  // Kirim instruksi ke semua responder aktif untuk SOS tertentu
  window.opsSendInstr=function(sosId, sosName){
    var rMap=window._opsResponders||{};
    var count=(rMap[sosId]||[]).length||0;
    var msg=prompt('Kirim instruksi ke '+count+' responder untuk SOS '+esc(sosName)+':');
    if(!msg||!msg.trim())return;
    api('/api/operations?action=sos-instructions',{method:'POST',body:JSON.stringify({sos_id:sosId,message:msg.trim()})}).then(function(){
      toastx('Instruksi terkirim ke '+count+' responder','ok');
      opsDashboard();
    }).catch(function(e){toastx(e.message||'Gagal mengirim instruksi','err');});
  };

  // QR SIMAKSI memakai payload baku sehingga kode tetap dapat diverifikasi manual oleh petugas.
  window.simaksiQrPayload=function(r){return JSON.stringify({type:'RC-SIMAKSI',version:1,code:r.code,valid_from:r.naik,valid_to:r.turun,route:r.jalur});};
  function addPermitVerify(){if(!isAdminClient())return;var p=document.getElementById('adminPanel');if(!p||document.getElementById('opsPermitVerifier'))return;var el=document.createElement('div');el.id='opsPermitVerifier';el.style.cssText='display:none';el.innerHTML='';p.appendChild(el);}
  window.opsVerifyPermit=function(code){if(!isAdminClient())return;var c=(code||prompt('Masukkan kode SIMAKSI dari QR / kartu:')||'').trim().toUpperCase();if(!c)return;api('/api/operations?action=permit-verify',{method:'POST',body:JSON.stringify({code:c})}).then(function(r){var x=r.permit||{},ok=!!r.valid;alert((ok?'\u2705 SIMAKSI SAH':'\u26a0\ufe0f BELUM SAH')+'\n\nKode: '+(x.code||c)+'\nKetua: '+(x.nama||'-')+'\nJalur: '+(x.jalur||'-')+'\nBerlaku: '+(x.naik||'-')+' s/d '+(x.turun||'-'));}).catch(function(e){toastx(e.message||'Gagal memeriksa SIMAKSI','err');});};

  function boot(){showActiveSos();ensureCheckin();addOpsTab();addPermitVerify();syncCheckins();_bootOutbox();}
  window.addEventListener('online',syncCheckins);window.addEventListener('load',function(){setTimeout(boot,1200);});document.addEventListener('visibilitychange',function(){if(!document.hidden){ensureCheckin();syncCheckins();}});
})();
