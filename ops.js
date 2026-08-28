/* Operasi Pendakian: SOS aman, dashboard petugas, QR SIMAKSI, dan check-in offline. */

/* =====================================================================
   PEMUAT MODUL SOS
   ===================================================================== */
(function(){
  try{
    if(window.__bwkSosKitLoaded)return;
    window.__bwkSosKitLoaded=true;
    if(window.BWK_SOS_RADIUS_M==null)window.BWK_SOS_RADIUS_M=20000;
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
  var POS=[['basecamp','Basecamp / Registrasi'],['pos-1','Pos 1'],['pos-2','Pos 2'],['pos-3','Pos 3'],['pos-4','Pos 4'],['pos-5','Pos 5'],['pos-6','Pos 6'],['pos-7','Pos 7'],['puncak','Puncak Bawakaraeng']];
  var ACTIVE_KEY='bwkActiveSos', QUEUE_KEY='bwkCheckinQueue', SOS_QUEUE_KEY='bwkSosQueue';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function toastx(m,t){try{if(window.toast)window.toast(m,t||'ok');}catch(e){}}
  function user(){try{return typeof bwkUser==='function'?bwkUser():null;}catch(e){return null;}}
  function token(){
    try{
      var c=(typeof _sbClient==='function')?_sbClient():null;
      if(!c)return Promise.resolve('');
      // PERBAIKAN: getSession() bisa return {data:{session:null}} tanpa throw.
      // Dalam kasus itu, token kosong TETAP HARUS fallback ke anonim.
      return c.auth.getSession().then(function(r){
        var t=(r&&r.data&&r.data.session&&r.data.session.access_token)||null;
        if(t)return t;
        // Sesi Google kosong/kedaluwarsa → WAJIB coba anonim
        if(typeof window.BWKSosAuth==='object'&&window.BWKSosAuth&&window.BWKSosAuth.token){
          return window.BWKSosAuth.token().catch(function(){return '';});
        }
        return '';
      }).catch(function(e){
        // Timeout atau error koneksi → fallback ke anonim, jangan throw
        try{console.warn('[BWK] token() gagal ('+String(e.message||e)+'), coba anonim...');}catch(_){}
        if(typeof window.BWKSosAuth==='object'&&window.BWKSosAuth&&window.BWKSosAuth.token){
          return window.BWKSosAuth.token().catch(function(){return '';});
        }
        return '';
      });
    }catch(e){return Promise.resolve('');}
  }
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

  function adopt(id,lat,lng,name){
    setJson(ACTIVE_KEY,{id:id,created_at:Date.now()});showActiveSos();
    try{if(window._sosMarkMine)window._sosMarkMine(id,lat,lng,name);}catch(e){}
    try{if(window._sosStart)window._sosStart();}catch(e){}
    try{if(window._sosRefreshPush)window._sosRefreshPush(true);}catch(e){}
    _pushWave(id,'first');_startWaves(id);
    return id;
  }
  window._sosAdoptQueued=function(id,payload){
    try{payload=payload||{};adopt(id,payload.lat,payload.lng,payload.name);}catch(e){}
  };

  function _sosPublishLegacy(lat,lng,name){
    var device='';try{device=localStorage.getItem('bwkDev')||'';}catch(e){}
    return api('/api/operations?action=sos-create',{method:'POST',body:JSON.stringify({lat:lat,lng:lng,device:device})}).then(function(d){
      if(!d.id)throw new Error('SOS gagal disimpan');
      adopt(d.id,lat,lng,name);
      var status=document.getElementById('sosStatus');if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\u2705 SOS terverifikasi dan diteruskan ke pusat.</div>');
      return d;
    }).catch(function(e){
      if(e&&e.status===409&&e.data&&e.data.id){
        adopt(e.data.id,lat,lng,name);
        var st=document.getElementById('sosStatus');if(st)st.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\u2705 SOS kamu masih aktif \u2014 sinyal di-teruskan lagi.</div>');
        return e.data;
      }
      var st2=(e&&e.status)||0, det=(e&&e.data&&e.data.detail)?String(e.data.detail):'';
      var why=st2===401?'Kamu belum login.':st2===429?'Terlalu banyak percobaan, tunggu beberapa menit.':st2===403?'Domain ini belum diizinkan server. Isi ALLOWED_ORIGINS di Vercel.':st2===400?'Koordinat tidak valid.':'Jaringan atau server bermasalah.';
      why+=' [kode '+st2+(det?': '+det.slice(0,120):'')+']';
      toastx(e.message||'SOS gagal dikirim','err');
      _legacyQueueEnqueue({lat:lat,lng:lng,device:device,name:name||_sosName()});
      var status=document.getElementById('sosStatus');
      if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;color:#ffd9d9;font-size:12px;font-weight:800">\u26a0\ufe0f '+esc(why)+'<br>SOS disimpan offline \u2014 akan otomatis dikirim saat sinyal kembali.</div>');
      return null;
    });
  }

  function _badCoord(la,ln){var a=Number(la),b=Number(ln);return !isFinite(a)||!isFinite(b)||(a===0&&b===0);}
  function _freshFix(){
    return new Promise(function(res){
      if(!navigator.geolocation){res(null);return;}
      try{navigator.geolocation.getCurrentPosition(function(p){res({lat:p.coords.latitude,lng:p.coords.longitude});},function(){res(null);},{enableHighAccuracy:true,timeout:12000,maximumAge:0});}catch(e){res(null);}
    });
  }

  window._sosPublish=function(lat,lng,name){
    if(!_badCoord(lat,lng))return _sosPublishSend(Number(lat),Number(lng),name);
    toastx('Mengunci GPS dulu\u2026','ok');
    return _freshFix().then(function(f){
      if(f&&!_badCoord(f.lat,f.lng))return _sosPublishSend(f.lat,f.lng,name);
      toastx('Lokasi GPS belum terkunci. Tunggu sampai muncul "Lokasi terkunci", lalu tahan lagi tombol SOS. Bila benar-benar darurat, pakai tombol WhatsApp/SMS di layar ini.','err');
      return null;
    });
  };

  function _sosPublishSend(lat,lng,name){
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
        if(status)status.insertAdjacentHTML('beforeend','<div style="margin-top:10px;font-size:12px;font-weight:800">\uD83C\uDD98 SOS tersimpan di perangkat dan akan terus dicoba sampai terkirim.</div>');
        try{if(rec&&rec.client_id&&window._sosMarkMineClient)window._sosMarkMineClient(rec.client_id);}catch(e){}
        try{if(window.BWKSosRelay&&rec&&rec.client_id)window.BWKSosRelay.startEscalation(rec.client_id);}catch(e){}
        return Promise.resolve(window.BWKSosOutbox.flush()).catch(function(){return null;});
      });
    }).catch(function(e){
      try{console.error('[BWK] jalur SOS baru gagal, beralih ke jalur lama:',e);}catch(_){}
      return _sosPublishLegacy(lat,lng,name);
    });
  }

  window._sosResolveMy=function(){
    var a=getJson(ACTIVE_KEY,null);
    if(!a||!a.id){toastx('Tidak ada SOS aktif pada perangkat ini','err');return;}
    toastx('Menutup sinyal SOS\u2026','ok');
    var dev='';try{dev=localStorage.getItem('bwkDev')||'';}catch(e){}
    var cid='';try{var ids=JSON.parse(localStorage.getItem('bwkMyClientIds')||'[]');cid=ids[ids.length-1]||'';}catch(e){}
    api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:a.id,device:dev,client_id:cid})}).then(function(){
      localStorage.removeItem(ACTIVE_KEY);_stopWaves();
      try{if(window.BWKSosRelay&&window.BWKSosRelay.stopEscalation)window.BWKSosRelay.stopEscalation();}catch(e){}
      showActiveSos();toastx('SOS ditandai selesai. Tim diberi status aman.','ok');
    }).catch(function(e){toastx(e.message||'Gagal menyelesaikan SOS','err');});
  };

  function _legacyQueueEnqueue(payload){
    try{
      var q=getJson(SOS_QUEUE_KEY,[]);
      q.unshift({ts:Date.now(),payload:payload});
      setJson(SOS_QUEUE_KEY,q.slice(0,10));
    }catch(e){}
  }

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
        if(item.ts&&(now-item.ts)>86400000)return;
        if(_badCoord(item.payload.lat,item.payload.lng))return;
        try{window.BWKSosOutbox.enqueue(item.payload);moved++;}catch(e){}
      });
      localStorage.removeItem(SOS_QUEUE_KEY);
      if(moved)toastx('\uD83D\uDCE1 '+moved+' SOS lama dipindahkan ke antrian baru','ok');
    }catch(e){}
  }

  function _bootOutbox(){
    try{
      if(!window.BWKSosOutbox)return;
      // PERBAIKAN: Jangan kunci __bwkOutboxTokenSet. Setel ulang setiap kali
      // _bootOutbox dipanggil (load, online, visibility) supaya token provider
      // selalu fresh — terutama bila sesi Google baru saja berhasil di-recovery.
      window.BWKSosOutbox.setTokenProvider(function(){
        return token().then(function(t){
          if(t)return t;
          // Fallback eksplisit ke anonim jika token() kosong
          if(window.BWKSosAuth&&window.BWKSosAuth.token)return window.BWKSosAuth.token();
          return '';
        }).catch(function(){return '';});
      });
      _migrateOldQueue();
      // PENTING: Harus di-await supaya SOS benar-benar dikirim sebelum halaman tutup
      if(navigator.onLine){
        Promise.resolve(window.BWKSosOutbox.flush())
          .catch(function(){}) // Tetap lanjut meski error
          .then(function(){
            // Tambahkan delay kecil untuk memastikan request tersampaikan
            try{if(window._pushWave&&_sosActive){window._pushWave(_sosActive.id,'retry');}}catch(e){}
          });
      }
    }catch(e){}
  }

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
      if(d.type==='sent'){
        _outboxPill('SOS terkirim ke pusat',false);
        setTimeout(function(){_outboxPill('');},6000);
        return;
      }
      if(d.type==='dead'){
        _outboxPill('SOS gagal terkirim — pakai jalur cadangan',true);
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

  window.addEventListener('online',function(){
    try{console.log('[BWK] Status online terdeteksi, flush outbox...');}catch(e){}
    _bootOutbox();
    syncCheckins();
  });

  window.addEventListener('load',function(){setTimeout(_bootOutbox,3000);});

  // FIX: showActiveSos() harus buat tombol "Saya Aman", bukan hanya display
  function showActiveSos(){
    var old=document.getElementById('mySosActive');
    if(old)old.remove();
    var a=getJson(ACTIVE_KEY,null);
    if(!a||!a.id)return;
    var x=document.createElement('div');
    x.id='mySosActive';
    x.style.cssText='position:fixed;top:10px;right:10px;background:#e0154a;color:#fff;padding:12px;border-radius:8px;font-size:12px;font-weight:800;z-index:99997;display:flex;flex-direction:column;gap:8px;align-items:center;max-width:180px';
    x.innerHTML='<div>\uD83D\uDE98 SOS AKTIF</div><div style="font-size:10px;opacity:0.9">'+new Date(a.created_at).toLocaleTimeString('id-ID')+'</div><button onclick="window._sosResolveMy()" style="background:#fff;color:#e0154a;border:0;padding:8px 12px;border-radius:6px;font-weight:800;font-size:11px;cursor:pointer;width:100%">\u2713 Saya Aman</button>';
    document.body.appendChild(x);
  }

  window._opsNearby=function(lat,lng){return api('/api/operations?action=sos-nearby',{method:'POST',body:JSON.stringify({lat:lat,lng:lng})}).then(function(x){return x.items||[];});};

  function ensureCheckin(){var host=document.getElementById('peta');if(!host||document.getElementById('trailCheckin'))return;var box=document.createElement('div');box.id='trailCheckin';box.style.cssText='margin-top:20px;padding:12px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:12px';box.innerHTML='<div style="font-size:13px;font-weight:700;margin-bottom:10px">\u270D\ufe0f Check-in Pos</div><div style="display:flex;gap:8px;margin-bottom:8px"><select id="ciPos" style="flex:1;padding:8px;border:1px solid var(--line,#e6e9ef);border-radius:6px;font-size:12px"></select><button onclick="window.opsCheckin()" style="padding:8px 12px;background:#2b6fff;color:#fff;border:0;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer">\u2705 Check-in</button></div><div id="ciStatus" style="font-size:11px;color:var(--sub,#69758a)"></div>';host.parentNode.insertBefore(box,host.nextSibling);var sel=document.getElementById('ciPos');POS.forEach(function(p){var opt=document.createElement('option');opt.value=p[0];opt.textContent=p[1];sel.appendChild(opt);});checkinStatus();}
  window.opsCheckin=function(){var u=user();if(!u||!u.google){toastx('Masuk dengan Google diperlukan untuk check-in','err');return;}var s=document.getElementById('ciPos'),pick=POS.filter(function(p){return p[0]===s.value;})[0];if(!pick){toastx('Pilih pos terlebih dahulu','err');return;}navigator.geolocation.getCurrentPosition(function(p){var q=getJson(QUEUE_KEY,[]);q.push({user_email:u.email,user_name:u.name||'',position_name:pick[1],position_id:pick[0],lat:p.coords.latitude,lng:p.coords.longitude,timestamp:new Date().toISOString()});setJson(QUEUE_KEY,q);checkinStatus();toastx('\u2705 Check-in tercatat (akan sinkron saat online)','ok');syncCheckins();},function(){toastx('GPS tidak dapat diakses','err');});}
  function checkinStatus(){var el=document.getElementById('ciStatus'),q=getJson(QUEUE_KEY,[]);if(el)el.textContent=q.length?('\u23f3 '+q.length+' check-in menunggu sinkronisasi.'):'\u2705 Semua check-in tersampaikan.'}
  function syncCheckins(){if(!navigator.onLine)return;var q=getJson(QUEUE_KEY,[]);if(!q.length)return;var first=q[0];api('/api/operations?action=checkin',{method:'POST',body:JSON.stringify(first)}).then(function(){q.shift();setJson(QUEUE_KEY,q);checkinStatus();if(q.length)setTimeout(syncCheckins,500);}).catch(function(e){if(e&&e.status===429)setTimeout(syncCheckins,Math.max(5000,(e.retryAfter||10)*1000));});}

  function isAdminClient(){var u=user();return !!(u&&u.role==='Admin');}
  function addOpsTab(){if(!isAdminClient())return;var tabs=document.querySelector('.admin-tabs');if(tabs&&!document.getElementById('opsSosTab')){var b=document.createElement('button');b.id='opsSosTab';b.onclick=window.opsDashboard;b.style.cssText='padding:8px 14px;margin:4px;background:0;border:1px solid var(--line,#e6e9ef);border-radius:6px;cursor:pointer;font-weight:700;font-size:12px';b.textContent='\uD83D\uDCCB Dashboard SOS';tabs.appendChild(b);}}

  function safeCoord(v){return String(v==null?'':v).replace(/[^0-9.\-]/g,'').slice(0,20);}
  function safeMapUrl(lat,lng){return 'https://maps.google.com/?q='+safeCoord(lat)+','+safeCoord(lng);}

  window.opsDashboard=function(){var b=document.getElementById('adminBody');if(!b)return;b.innerHTML='<div class="aempty">Memuat dashboard operasi\u2026</div>';api('/api/operations?action=admin',[]).then(function(d){
    var sos=d.sos||[],active=sos.filter(function(x){return x.status==='active';}),checks=d.checkins||[],responders=d.responders||{};
    try{window._opsResponders=responders;}catch(e){}
    var allResp=[];Object.keys(responders).forEach(function(sosId){(responders[sosId]||[]).forEach(function(r){allResp.push(Object.assign({sos_id:sosId},r));});});
    var respList=allResp.slice(0,10).map(function(r){return '<li><b>'+esc(r.name)+'</b> <small>(±'+esc(r.distance_m)+'m)</small> '+(r.message_sent?('<span style="color:#2563eb">\uD83D\uDCE3 '+esc(String(r.message_sent).slice(0,60))+'</span>'):'')+'</li>';}).join('')||'<li>Belum ada responder aktif.</li>';
    var cards=active.length?active.map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      var pc=x.plus_code?('<small>\uD83D\uDD22 '+esc(x.plus_code)+'</small>'):'';
      var ac=(x.accuracy_m!=null)?('<small>\uD83C\uDFAF akurasi \u00b1'+esc(Math.round(Number(x.accuracy_m)))+' m</small>'):'';
      var bt=(x.battery_pct!=null)?('<small>\uD83D\uDD0B baterai '+esc(Math.round(Number(x.battery_pct)))+'%</small>'):'';
      return '<div class="ops-card danger"><div><b>\uD83C\uDD98 '+esc(x.name||'Pendaki')+'</b><small>'+new Date(x.created_at).toLocaleString('id-ID')+'</small><small>\uD83D\uDCCD '+esc(Number(x.lat).toFixed(4))+', '+esc(Number(x.lng).toFixed(4))+'</small>'+pc+ac+bt+'</div><div><a href="'+esc(map)+'" target="_blank" rel="noopener" style="color:#2b6fff;text-decoration:none;font-weight:700">\uD83D\uDDFA\ufe0f Lihat Peta</a> | <button onclick="window.opsSendInstr(\''+esc(x.id)+'\', \''+esc(x.name||'Pendaki')+'\')" style="border:0;background:0;color:#2b6fff;text-decoration:none;font-weight:700;cursor:pointer">\uD83D\uDCE3 Instruksi</button> | <button onclick="window.opsResolve(\''+esc(x.id)+'\')" style="border:0;background:0;color:#e0154a;text-decoration:none;font-weight:700;cursor:pointer">\u2705 Ditangani</button></div></div>';
    }).join(''):'<div class="aempty">\u2705 Tidak ada SOS aktif.</div>';
    var hist=sos.filter(function(x){return x.status!=='active';}).slice(0,8).map(function(x){return '<li>'+esc(x.name||'Pendaki')+' \u00b7 '+esc(x.status||'resolved')+' \u00b7 '+new Date(x.created_at).toLocaleString('id-ID')+'</li>';}).join('')||'<li>Belum ada riwayat.</li>';
    var check=checks.slice(0,12).map(function(x){
      var map=safeMapUrl(x.lat,x.lng);
      return '<li><b>'+esc(x.user_name||x.user_email||'Pendaki')+'</b> \u00b7 '+esc(x.position_name)+' <a href="'+esc(map)+'" target="_blank" rel="noopener">peta</a><br/><small>'+new Date(x.check_in_time).toLocaleString('id-ID')+'</small></li>';
    }).join('')||'<li>Belum ada check-in.</li>';
    b.innerHTML='<style>.ops-card{display:flex;gap:8px;align-items:center;justify-content:space-between;border:1px solid var(--line,#e4e8ef);border-radius:13px;padding:12px;margin:9px 0;background:var(--card,#fff)}.ops-card.danger{border-color:#e0154a;background:#fff5f7}.aempty{text-align:center;padding:20px;color:var(--sub,#69758a);font-size:14px}</style><h2>\uD83C\uDD98 SOS Aktif ('+active.length+')</h2>'+cards+'<h3>\uD83D\uDCE3 Responder Aktif</h3><ul>'+respList+'</ul><h3>\uD83D\uDCC4 Riwayat SOS</h3><ul style="max-height:150px;overflow-y:auto">'+hist+'</ul><h3>\u2705 Check-in Terakhir</h3><ul style="max-height:150px;overflow-y:auto">'+check+'</ul>';
  }).catch(function(e){b.innerHTML='<div class="aempty">Dashboard tidak dapat dibuka: '+esc(e.message||'Pastikan konfigurasi server dan SQL sudah dijalankan.')+'</div>';});};
  window.opsResolve=function(id){if(!confirm('Tandai SOS ini sudah ditangani?'))return;api('/api/operations?action=sos-resolve',{method:'POST',body:JSON.stringify({id:id})}).then(function(){toastx('\u2705 SOS ditandai selesai','ok');window.opsDashboard();}).catch(function(e){toastx(e.message||'Gagal','err');});};

  window.opsSendInstr=function(sosId, sosName){
    var rMap=window._opsResponders||{};
    var count=(rMap[sosId]||[]).length||0;
    var msg=prompt('Kirim instruksi ke '+count+' responder untuk SOS '+esc(sosName)+':');
    if(!msg||!msg.trim())return;
    api('/api/operations?action=sos-instructions',{method:'POST',body:JSON.stringify({sos_id:sosId,message:msg.trim()})}).then(function(){
      toastx('Instruksi terkirim ke '+count+' responder','ok');
      window.opsDashboard();
    }).catch(function(e){toastx(e.message||'Gagal mengirim instruksi','err');});
  };

  window.simaksiQrPayload=function(r){return JSON.stringify({type:'RC-SIMAKSI',version:1,code:r.code,valid_from:r.naik,valid_to:r.turun,route:r.jalur});};
  function addPermitVerify(){if(!isAdminClient())return;var p=document.getElementById('adminPanel');if(!p||document.getElementById('opsPermitVerifier'))return;var el=document.createElement('div');el.id='opsPermitVerifier';el.style.cssText='margin-top:20px;padding:12px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:12px';el.innerHTML='<div style="font-size:13px;font-weight:700;margin-bottom:10px">\uD83D\uDD10 Verifikasi SIMAKSI (QR)</div><div style="display:flex;gap:8px"><input type="text" id="qrCode" placeholder="Scan atau paste kode QR..." style="flex:1;padding:8px;border:1px solid var(--line,#e6e9ef);border-radius:6px;font-size:12px" /><button onclick="window.opsVerifyPermit()" style="padding:8px 12px;background:#2b6fff;color:#fff;border:0;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer">Cek</button></div><div id="qrStatus" style="margin-top:8px;font-size:11px;color:var(--sub,#69758a)"></div>';p.appendChild(el);}
  window.opsVerifyPermit=function(code){if(!isAdminClient())return;var c=(code||document.getElementById('qrCode')||{}).value||prompt('Masukkan kode SIMAKSI dari QR / kartu:');if(!c||typeof c!=='string')c=String(code||'');c=c.trim().toUpperCase();if(!c)return;var qrSt=document.getElementById('qrStatus');if(qrSt)qrSt.textContent='Mengecek...';api('/api/operations?action=permit-verify',{method:'POST',body:JSON.stringify({code:c})}).then(function(d){if(qrSt)qrSt.innerHTML='<span style="color:#20c997">\u2705 '+esc(d.name||'Izin Sah')+' ('+esc(d.route||'rute')+', '+esc(d.naik||'?')+' - '+esc(d.turun||'?')+')</span>';if(document.getElementById('qrCode'))document.getElementById('qrCode').value='';}).catch(function(e){if(qrSt)qrSt.innerHTML='<span style="color:#e0154a">\u274c '+esc(e.message||'Izin tidak valid')+'</span>';});};

  function boot(){showActiveSos();ensureCheckin();addOpsTab();addPermitVerify();syncCheckins();_bootOutbox();}
  window.addEventListener('load',function(){setTimeout(boot,1200);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden){ensureCheckin();}});
})();
