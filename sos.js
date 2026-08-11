/* SOS proximity alarm + gaya sumber air.
   Alarm berbunyi di perangkat lain yang <=20 km dari pengirim SOS.

   v2 (optimasi keandalan):
   - GPS berlapis: akurasi tinggi -> akurasi rendah -> posisi cache (tidak lagi gagal senyap).
   - Polling adaptif + backoff yang menghormati 429/Retry-After, jadi kuota server tidak jebol.
   - Tetap memantau (lebih lambat) saat aplikasi di latar belakang, bukan berhenti total.
   - Penanda "sudah dilihat" hanya dipasang SETELAH alarm benar-benar tampil di layar.
   - Status pemantauan ditampilkan, sehingga kegagalan tidak lagi tanpa jejak.
   - _sosPublish TIDAK didefinisikan di sini; pengiriman SOS dimiliki ops.js (lewat server). */
(function(){
  try{var css=`
  .sosal{position:fixed;inset:0;z-index:99999;background:rgba(120,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;animation:sosalflash 1s infinite}
  @keyframes sosalflash{0%,100%{background:rgba(150,0,0,.55)}50%{background:rgba(220,20,40,.72)}}
  .sosal-card{width:100%;max-width:360px;background:#fff;border-radius:20px;padding:22px 18px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.45)}
  .sosal-ic{font-size:52px;animation:sosalpulse .8s infinite}
  @keyframes sosalpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
  .sosal-tt{font-size:18px;font-weight:900;color:#e0154a;letter-spacing:.5px;margin-top:6px}
  .sosal-nm{font-size:15px;font-weight:700;color:#20263a;margin-top:8px}
  .sosal-ds{font-size:14px;color:#c0333c;font-weight:800;margin-top:2px}
  .sosal-bs{display:flex;flex-direction:column;gap:8px;margin-top:16px}
  .sosal-b{border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;text-decoration:none;display:block}
  .sosal-b.map{background:#2b6fff;color:#fff}
  .sosal-b.wa{background:#25D366;color:#fff}
  .sosal-b.off{background:#eef1f6;color:#42506b}
  .wdrop-wrap{background:transparent;border:none}
  .wdrop{width:28px;height:28px;display:flex;align-items:center;justify-content:center;background:#2b6fff;border:2px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:14px}
  .wrow{width:100%;display:flex;align-items:center;gap:10px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:12px;padding:10px 12px;margin:6px 0;cursor:pointer;text-align:left}
  .wrow .wro-ic{font-size:18px}
  .wrow .wro-tx{flex:1;display:flex;flex-direction:column}
  .wrow .wro-tx b{font-size:13px}
  .wrow .wro-tx small{color:#8b98ad;font-size:11px}
  .wrow .wro-go{color:#2b6fff;font-size:18px}
  .sosal-card{max-height:88vh;display:flex;flex-direction:column}
  .sosal-list{overflow-y:auto;-webkit-overflow-scrolling:touch}
  .sosal-item{border-top:1px solid #f1e3e6;margin-top:12px;padding-top:12px}
  .sosal-item:first-child{border-top:none;margin-top:4px;padding-top:0}
  .sosal-b.done{background:#eef1f6;color:#42506b}
  #sosMon{position:fixed;left:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:99996;max-width:82vw;display:flex;align-items:center;gap:7px;background:#fff8e6;border:1px solid #f3d79a;color:#8a5a08;border-radius:999px;padding:7px 12px;font-size:11.5px;font-weight:800;line-height:1.25;box-shadow:0 6px 18px rgba(0,0,0,.14);cursor:pointer}
  #sosMon.bad{background:#fff2f3;border-color:#f4b4ba;color:#8e1d2c}
  #sosMon .sm-dot{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none;animation:sosalpulse 1.4s infinite}
  html.dark #sosMon{background:#3a2f12;border-color:#7a5f1c;color:#ffdf9b}
  html.dark #sosMon.bad{background:#3d1a20;border-color:#8c3340;color:#ffc9d0}
  `;var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);}catch(e){}

  var SOS_RADIUS=Infinity; // Mode Percobaan: no limit / tanpa batas radius (sebelumnya 20000 meter / 20 KM)
  var MAX_AGE_MIN=30;      // hanya alarm untuk SOS <=30 menit terakhir
  var POLL_ALARM=15000;    // alarm sedang tampil: cepat, supaya status "selesai" cepat terdeteksi
  var POLL_ACTIVE=25000;   // aplikasi terlihat & baru disentuh
  var POLL_IDLE=60000;     // aplikasi terlihat tapi diam
  var POLL_HIDDEN=180000;  // layar mati / latar belakang (Web Push jadi jalur utama)
  var IDLE_AFTER=120000;   // dianggap diam setelah 2 menit tanpa interaksi
  var GPS_CACHE_MS=300000; // posisi cache masih dipakai sampai 5 menit
  var BACKOFF_MIN=20000, BACKOFF_MAX=300000;
  var SNOOZE_MS=600000;    // "Matikan Alarm" hanya membisukan 10 menit, bukan selamanya

  var _seen={};var _myAlerts={};var _started=false;var _audio=null;var _alarmTimer=null;var _myPos=null;var _queue=[];
  var _lastResolved=null; // info SOS terakhir yang ditangani
  window._sosLastResolved=function(){return _lastResolved;};
  function _sosCount(){try{return parseInt(localStorage.getItem('bwkSosCount')||'0',10)||0;}catch(e){return 0;}}
  function _incSosCount(){try{var c=_sosCount()+1;localStorage.setItem('bwkSosCount',String(c));return c;}catch(e){return _sosCount();}}
  var _timer=null,_busy=false,_backoffUntil=0,_backoff=0,_lastTouch=Date.now(),_lastOk=0,_fails=0;
  var _status={mode:'idle',detail:''};

  function _devId(){try{var d=localStorage.getItem('bwkDev');if(!d){d='d'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('bwkDev',d);}return d;}catch(e){return 'd0';}}
  function _dist(la1,lo1,la2,lo2){var R=6371000,tr=Math.PI/180;var dLa=(la2-la1)*tr,dLo=(lo2-lo1)*tr;var a=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(la1*tr)*Math.cos(la2*tr)*Math.sin(dLo/2)*Math.sin(dLo/2);return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));}
  function _beep(){try{if(!_audio)_audio=new (window.AudioContext||window.webkitAudioContext)();if(_audio.state==='suspended')_audio.resume();var t=_audio.currentTime;for(var i=0;i<5;i++){var o=_audio.createOscillator();var g=_audio.createGain();o.type='square';o.frequency.value=(i%2?1320:880);o.connect(g);g.connect(_audio.destination);var st=t+i*0.4;g.gain.setValueAtTime(0.0001,st);g.gain.exponentialRampToValueAtTime(0.3,st+0.02);g.gain.exponentialRampToValueAtTime(0.0001,st+0.35);o.start(st);o.stop(st+0.37);}}catch(e){}}
  function _vibe(){try{if(navigator.vibrate)navigator.vibrate([400,150,400,150,700]);}catch(e){}}
  function _fmtDist(m){m=Math.round(m);return m>=1000?((m/1000).toFixed(m>=10000?0:1)+' km'):(m+' m');}

  // --- Penanda SOS milik sendiri (persisten) supaya HP pengirim tidak bunyi sendiri ---
  function _myIds(){try{return JSON.parse(localStorage.getItem('bwkMyAlertIds')||'[]');}catch(e){return [];}}
  function _addMyId(id){try{if(id==null)return;var a=_myIds();if(a.map(String).indexOf(String(id))<0){a.push(id);localStorage.setItem('bwkMyAlertIds',JSON.stringify(a.slice(-50)));}}catch(e){}}
  function _mySigs(){try{return JSON.parse(localStorage.getItem('bwkMySos')||'[]');}catch(e){return [];}}
  function _addMySig(s){try{var a=_mySigs();a.push(s);localStorage.setItem('bwkMySos',JSON.stringify(a.slice(-20)));}catch(e){}}
  window._sosMarkMine=function(id,lat,lng,name){_addMyId(id);if(lat!=null&&lng!=null)_addMySig({t:Date.now(),name:(name||'Pendaki'),lat:+lat,lng:+lng});if(id!=null){_myAlerts[id]=1;_seen[id]=1;}};
  function _isMine(a){try{
    if(a.device&&a.device===_devId())return true;
    if(a.id!=null&&_myIds().map(String).indexOf(String(a.id))>=0)return true;
    if(a.lat!=null&&a.lng!=null){var sigs=_mySigs();var t=a.created_at?Date.parse(a.created_at):Date.now();
      for(var i=0;i<sigs.length;i++){var s=sigs[i];
        if(s&&s.name&&a.name===s.name&&_dist(+a.lat,+a.lng,s.lat,s.lng)<=60&&Math.abs(t-s.t)<=35*60000)return true;}}
  }catch(e){}return false;}

  // --- SOS yang sudah ditangani (permanen 3 jam) vs sekadar dibisukan (10 menit) ---
  function _map(k){try{return JSON.parse(localStorage.getItem(k)||'{}');}catch(e){return {};}}
  function _put(k,id,ttl){try{if(id==null)return;var o=_map(k);o[String(id)]=Date.now();var cut=Date.now()-ttl;Object.keys(o).forEach(function(x){if(o[x]<cut)delete o[x];});localStorage.setItem(k,JSON.stringify(o));}catch(e){}}
  function _markDone(id){_put('bwkSosDone',id,3*60*60000);}
  function _markSnooze(id){_put('bwkSosSnooze',id,SNOOZE_MS);}
  function _isDone(id){if(id==null)return false;var o=_map('bwkSosDone');var t=o[String(id)];if(t&&Date.now()-t<=3*60*60000)return true;
    var s=_map('bwkSosSnooze');var st=s[String(id)];return !!(st&&Date.now()-st<=SNOOZE_MS);}
  function _esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}

  // ================= Status pemantauan (tidak lagi gagal senyap) =================
  var STATUS_TEXT={
    ok:'', idle:'',
    gps:['Pemantauan SOS: GPS belum terkunci',false],
    net:['Pemantauan SOS terputus — periksa koneksi',false],
    auth:['Masuk dengan Google agar alarm SOS sekitar aktif',true],
    limit:['Pemantauan SOS dijeda sementara, mencoba lagi otomatis',false],
    unsupported:['Perangkat ini tidak mendukung pemantauan lokasi',true]
  };
  function _setStatus(mode,detail){
    _status={mode:mode,detail:detail||'',at:Date.now()};
    try{window._sosMonitor=_status;}catch(e){}
    _renderStatus();
  }
  function _renderStatus(){
    try{
      var el=document.getElementById('sosMon');
      var info=STATUS_TEXT[_status.mode];
      var stale=_lastOk&&(Date.now()-_lastOk>6*60000);
      if(!info||!info[0]){ if(!stale){ if(el)el.remove(); return; } info=['Pemantauan SOS belum menerima data baru',false]; }
      if(document.getElementById('sosAlarm')){if(el)el.remove();return;}
      if(!el){el=document.createElement('div');el.id='sosMon';el.setAttribute('role','status');
        el.addEventListener('click',function(){_backoffUntil=0;_backoff=0;_tick(true);});
        document.body.appendChild(el);}
      el.className=info[1]?'bad':'';
      el.innerHTML="<span class='sm-dot'></span><span>"+_esc(info[0])+(_status.detail?(' — '+_esc(_status.detail)):'')+"</span>";
    }catch(e){}
  }

  window._sosStop=function(){try{_queue.forEach(function(q){_markSnooze(q.id);_seen[String(q.id)]=1;});_queue=[];_lastResolved=null;if(_alarmTimer){clearInterval(_alarmTimer);_alarmTimer=null;}var el=document.getElementById('sosAlarm');if(el)el.remove();if(navigator.vibrate)navigator.vibrate(0);_schedule();_renderStatus();_refreshBellBadge();}catch(e){}};
  // Simpan SOS yang baru muncul tapi belum dilihat user (untuk polling berikutnya)
  var _pendingAlerts={};

  // --- Badge lonceng: aktif=merah+angka, selesai=tunjuk info terakhir ---
  window._refreshBellBadge=function(){try{var b=document.getElementById('bellDot');if(!b)return;var btn=document.getElementById('bellBtn');var n=_queue.length;var total=_sosCount();if(n>0){b.textContent=n>99?'99+':String(n);b.className='dot num sos';b.style.display='inline-flex';b.setAttribute('data-sos','1');b.setAttribute('data-state','active');if(btn)btn.title='SOS Aktif: '+n+' · Total: '+total+' panggilan';}
    else if(_lastResolved){var nm=_esc(_lastResolved.name||'Pendaki');var ds=_fmtDist(_lastResolved.dist||0);b.textContent='✓';b.className='dot sos';b.style.display='inline-flex';b.setAttribute('data-sos','1');b.setAttribute('data-state','done');if(btn)btn.title='SOS selesai: '+nm+' · '+ds+' · Total: '+total+' panggilan';}
    else if(total>0){b.textContent=total>99?'99+':String(total);b.className='dot num sos';b.style.display='inline-flex';b.setAttribute('data-sos','1');b.setAttribute('data-state','done');if(btn)btn.title='Total SOS hari ini: '+total+' panggilan';}
    else{b.style.display='none';b.className='dot';b.removeAttribute('data-sos');b.removeAttribute('data-state');if(btn)btn.title='Notifikasi';}}catch(e){}};
  window._sosRefreshPush=function(force){_refreshBellBadge();};

  function _dismiss(id){try{_markDone(id);_seen[String(id)]=1;var idx=_queue.findIndex(function(q){return String(q.id)===String(id);});if(idx>=0){var r=_queue[idx];_lastResolved={id:r.id,name:r.name,dist:r.dist};}_queue=_queue.filter(function(q){return String(q.id)!==String(id);});if(!_queue.length){window._sosStop();}else{_renderAlarm(false);_refreshBellBadge();}}catch(e){}}
  // Tandai semua alarm di queue sebagai sudah dilihat (untuk polling berikutnya)
  function _markAllSeen(){try{_queue.forEach(function(q){_seen[String(q.id)]=1;});}catch(e){}}

  function _renderAlarm(play){
    try{
      if(!_queue.length){window._sosStop();return;}
      var multi=_queue.length>1;var wnum=(window._rcWA&&_rcWA())||'6282320124040';
      var items=_queue.map(function(a){
        var nm=(a.name||'Seorang pendaki');
        var maps=(a.lat!=null&&a.lng!=null)?('https://maps.google.com/?q='+a.lat+','+a.lng):'#';
        var wa='https://wa.me/'+wnum+'?text='+encodeURIComponent('DARURAT! Ada sinyal SOS dari '+nm+' sekitar '+_fmtDist(a.dist)+' dari saya di jalur Bawakaraeng. Lokasi: '+maps);
        return "<div class='sosal-item'><div class='sosal-nm'>"+_esc(nm)+" butuh bantuan</div><div class='sosal-ds'>± "+_fmtDist(a.dist)+" dari lokasimu</div><div class='sosal-bs'><a class='sosal-b map' href='"+maps+"' target='_blank' rel='noopener'>🗺️ Lihat Lokasi</a><a class='sosal-b wa' href='"+wa+"' target='_blank' rel='noopener'>📞 Koordinasi Bantuan</a><button class='sosal-b done' data-sos-done='"+_esc(String(a.id))+"'>✅ Sudah ditangani</button></div></div>";
      }).join('');
      var title=multi?(_queue.length+' SINYAL DARURAT DI DEKATMU'):'DARURAT DI DEKATMU';
      var foot="<button class='sosal-b off' data-sos-stop='1'>🔇 "+(multi?'Matikan Semua Alarm':'Matikan Alarm')+"</button>";
      var el=document.getElementById('sosAlarm');
      if(!el){el=document.createElement('div');el.className='sosal';el.id='sosAlarm';document.body.appendChild(el);
        el.addEventListener('click',function(ev){var t=ev.target;if(!t||!t.getAttribute)return;var did=t.getAttribute('data-sos-done');if(did!=null&&did!==''){_dismiss(did);_markAllSeen();return;}if(t.getAttribute('data-sos-stop')){window._sosStop();_markAllSeen();}});
      }
      el.innerHTML="<div class='sosal-card'><div class='sosal-ic'>🆘</div><div class='sosal-tt'>"+title+"</div><div class='sosal-list'>"+items+"</div>"+foot+"</div>";
      // JANGAN set _seen di sini — tunggu user benar-benar melihat/merespons alarm
      var mon=document.getElementById('sosMon');if(mon)mon.remove();
      if(play){_beep();_vibe();}
      if(!_alarmTimer)_alarmTimer=setInterval(function(){if(!document.getElementById('sosAlarm')||!_queue.length){window._sosStop();return;}_beep();_vibe();},3200);
      return true;
    }catch(e){return false;}
  }

  // ================= GPS berlapis =================
  function _pos(){
    return new Promise(function(resolve,reject){
      if(!navigator.geolocation){reject(new Error('nogeo'));return;}
      var done=false;
      function ok(p){if(done)return;done=true;_myPos={la:p.coords.latitude,ln:p.coords.longitude,t:Date.now()};resolve(_myPos);}
      function low(){
        if(done)return;
        navigator.geolocation.getCurrentPosition(ok,function(){
          if(done)return;
          // Lapis terakhir: pakai posisi terakhir yang masih segar daripada melewatkan alarm.
          if(_myPos&&_myPos.t&&Date.now()-_myPos.t<=GPS_CACHE_MS){done=true;resolve(_myPos);return;}
          done=true;reject(new Error('gps'));
        },{enableHighAccuracy:false,timeout:20000,maximumAge:120000});
      }
      navigator.geolocation.getCurrentPosition(ok,low,{enableHighAccuracy:true,timeout:9000,maximumAge:30000});
    });
  }

  // ================= Penjadwalan adaptif =================
  function _interval(){
    if(_queue.length)return POLL_ALARM;
    if(document.hidden)return POLL_HIDDEN;
    return (Date.now()-_lastTouch<=IDLE_AFTER)?POLL_ACTIVE:POLL_IDLE;
  }
  function _schedule(ms){
    if(_timer){clearTimeout(_timer);_timer=null;}
    var wait=(ms!=null)?ms:_interval();
    var hold=_backoffUntil-Date.now();
    if(hold>0&&hold>wait)wait=hold;
    _timer=setTimeout(function(){_tick();},wait);
  }
  function _penalize(ms){_backoff=Math.min(BACKOFF_MAX,Math.max(BACKOFF_MIN,ms||(_backoff?_backoff*2:BACKOFF_MIN)));_backoffUntil=Date.now()+_backoff;}
  function _recover(){_backoff=0;_backoffUntil=0;_fails=0;}

  function _tick(force){
    if(_busy){return;}
    if(!force&&_backoffUntil>Date.now()){_schedule();return;}
    if(typeof window._opsNearby!=='function'){_setStatus('net','modul operasi belum siap');_schedule(8000);return;}
    if(!navigator.geolocation){_setStatus('unsupported');return;}
    _busy=true;

    // BUG FIX: versi lama memakai .catch().then() — bila handler .catch() sendiri melempar
    // exception (misalnya _setStatus atau _penalize crash karena DOM tidak siap), blok .then()
    // akhir tidak pernah jalan, _busy tetap true selamanya, dan polling SOS berhenti total.
    // Solusi: gunakan .finally() — dijamin jalan meski .catch() throw — dan lindungi seluruh
    // rantai dengan try/catch agar _busy PASTI di-reset dalam kondisi apa pun.
    _pos().then(function(p){
      return window._opsNearby(p.la,p.ln).then(function(rows){
        _recover();_lastOk=Date.now();
        _consume(rows||[],p);
        if(!_queue.length)_setStatus('ok');
      });
    }).catch(function(err){
      try{
        var msg=String((err&&err.message)||'');
        var code=(err&&err.status)||0;
        if(msg==='gps'||msg==='nogeo'){_fails++;_setStatus('gps');_penalize(BACKOFF_MIN);}
        else if(code===429){_setStatus('limit');_penalize(Math.max(BACKOFF_MIN,(err.retryAfter||120)*1000));}
        else if(code===401||code===403||/Login/i.test(msg)){_setStatus('auth');_penalize(120000);}
        else{_fails++;_setStatus('net');_penalize();}
      }catch(e2){/* jangan biarkan error di handler ini menghentikan .finally() */}
    }).finally(function(){
      // Dijamin jalan bahkan bila .catch() melempar, sehingga _busy tidak pernah
      // "terkunci" dan polling tidak berhenti tanpa jejak.
      _busy=false;
      _schedule();
    });
  }

  function _consume(rows,p){
    var cut=Date.now()-MAX_AGE_MIN*60000;
    // Buang alarm yang sebelumnya tampil tetapi sudah diselesaikan / tidak lagi aktif di server.
    var activeIds={};rows.forEach(function(a){if(a&&a.id!=null&&a.active!==false)activeIds[String(a.id)]=1;});
    var before=_queue.length;_queue=_queue.filter(function(q){return !!activeIds[String(q.id)];});
    var removed=before!==_queue.length;
    var fresh=[];
    rows.forEach(function(a){
      if(!a||a.lat==null||a.lng==null)return;
      if(a.active===false)return;
      if(a.created_at&&Date.parse(a.created_at)<cut)return;
      if(_isMine(a))return;
      if(_myAlerts[a.id]||_seen[a.id]||_isDone(a.id))return;
      if(_queue.some(function(q){return String(q.id)===String(a.id);}))return;
      var dd=_dist(p.la,p.ln,+a.lat,+a.lng);
      if(dd<=SOS_RADIUS)fresh.push({id:a.id,name:a.name,lat:+a.lat,lng:+a.lng,dist:dd});
    });
    if(fresh.length){fresh.forEach(function(f){_queue.push(f);_incSosCount();});_renderAlarm(true);_refreshBellBadge();}
    else if(removed&&_queue.length){_renderAlarm(false);_refreshBellBadge();}
    else if(!_queue.length&&document.getElementById('sosAlarm')){window._sosStop();}
  }

  function _unlockAudio(){try{if(!_audio)_audio=new (window.AudioContext||window.webkitAudioContext)();if(_audio.state==='suspended')_audio.resume();}catch(e){}}
  ['pointerdown','touchend','click','keydown'].forEach(function(ev){document.addEventListener(ev,function(){_lastTouch=Date.now();_unlockAudio();},{passive:true});});

  window._sosStart=function(){if(_started)return;_started=true;localStorage.setItem('bwkSosCount','0');_tick(true);};
  window._sosPing=function(){_backoffUntil=0;_backoff=0;_tick(true);};
  window.addEventListener('load',function(){setTimeout(window._sosStart,2500);});
  window.addEventListener('online',function(){_recover();if(_started)_tick(true);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden){_lastTouch=Date.now();if(_started){_recover();_tick(true);}}else{_schedule();}});
  // Service worker memberi tahu saat push SOS masuk: langsung periksa, jangan tunggu siklus berikutnya.
  try{if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',function(ev){var d=ev&&ev.data;if(d&&d.type==='sos-push'){_recover();_tick(true);}});}catch(e){}
})();
