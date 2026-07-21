/* SOS proximity alarm + gaya sumber air. Alarm berbunyi di perangkat lain yang <=20km dari pengirim SOS (saat aplikasi terbuka). */
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
  `;var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);}catch(e){}

  var SOS_RADIUS=20000;    // meter (20 KM)
  var POLL_MS=25000;       // interval pantau
  var MAX_AGE_MIN=30;      // hanya alarm untuk SOS <=30 menit terakhir
  var _seen={};var _myAlerts={};var _started=false;var _audio=null;var _alarmTimer=null;var _myPos=null;

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
  function _isMine(a){try{
    if(a.device&&a.device===_devId())return true;
    if(a.id!=null&&_myIds().map(String).indexOf(String(a.id))>=0)return true;
    if(a.lat!=null&&a.lng!=null){var sigs=_mySigs();var t=a.created_at?Date.parse(a.created_at):Date.now();
      for(var i=0;i<sigs.length;i++){var s=sigs[i];
        if(s&&s.name&&a.name===s.name&&_dist(+a.lat,+a.lng,s.lat,s.lng)<=60&&Math.abs(t-s.t)<=35*60000)return true;}}
  }catch(e){}return false;}

  window._sosStop=function(){try{if(_alarmTimer){clearInterval(_alarmTimer);_alarmTimer=null;}var el=document.getElementById('sosAlarm');if(el)el.remove();if(navigator.vibrate)navigator.vibrate(0);}catch(e){}};

  function _alarm(a,dist){
    try{
      var name=(a.name||'Seorang pendaki');
      var maps=(a.lat!=null&&a.lng!=null)?('https://maps.google.com/?q='+a.lat+','+a.lng):'#';
      var wa='https://wa.me/'+((window._rcWA&&_rcWA())||'6282320124040')+'?text='+encodeURIComponent('DARURAT! Ada sinyal SOS dari '+name+' sekitar '+_fmtDist(dist)+' dari saya di jalur Bawakaraeng. Lokasi: '+maps);
      var old=document.getElementById('sosAlarm');if(old)old.remove();
      var d=document.createElement('div');d.className='sosal';d.id='sosAlarm';
      d.innerHTML=`<div class='sosal-card'><div class='sosal-ic'>🆘</div><div class='sosal-tt'>DARURAT DI DEKATMU</div><div class='sosal-nm'>${name} butuh bantuan</div><div class='sosal-ds'>± ${_fmtDist(dist)} dari lokasimu</div><div class='sosal-bs'><a class='sosal-b map' href='${maps}' target='_blank' rel='noopener'>🗺️ Lihat Lokasi</a><a class='sosal-b wa' href='${wa}' target='_blank' rel='noopener'>📞 Koordinasi Bantuan</a><button class='sosal-b off' onclick='_sosStop()'>🔇 Matikan Alarm</button></div></div>`;
      document.body.appendChild(d);
      _beep();_vibe();
      if(_alarmTimer)clearInterval(_alarmTimer);
      _alarmTimer=setInterval(function(){if(!document.getElementById('sosAlarm')){clearInterval(_alarmTimer);_alarmTimer=null;return;}_beep();_vibe();},3200);
    }catch(e){}
  }

  // Dipanggil dari sosShareUI ketika lokasi pengirim SOS didapat
  window._sosPublish=function(lat,lng,name){
    if(lat==null||lng==null)return;
    // Tandai SOS ini milik sendiri SEKARANG (lokal) — pengaman utama walau DB/RLS gagal mengembalikan id
    _addMySig({t:Date.now(),name:(name||'Pendaki'),lat:+lat,lng:+lng});
    var c=(typeof _sbClient==='function')?_sbClient():null;if(!c){_sosStart();return;}
    var row={lat:lat,lng:lng,name:name||'Pendaki',device:_devId(),active:true};
    try{c.from('sos_alerts').insert(row).select().then(function(res){if(res&&res.data&&res.data[0]){var id=res.data[0].id;_myAlerts[id]=1;_seen[id]=1;_addMyId(id);}}).catch(function(){});}catch(e){}
    _sosStart();
  };

  function _tick(){
    var c=(typeof _sbClient==='function')?_sbClient():null;if(!c||!navigator.geolocation)return;
    navigator.geolocation.getCurrentPosition(function(p){
      _myPos={la:p.coords.latitude,ln:p.coords.longitude};
      var since=new Date(Date.now()-MAX_AGE_MIN*60000).toISOString();
      c.from('sos_alerts').select('*').gte('created_at',since).order('created_at',{ascending:false}).limit(60).then(function(res){
        if(res.error||!res.data)return;
        res.data.forEach(function(a){
          if(!a||a.lat==null||a.lng==null)return;
          if(a.active===false)return;
          if(_isMine(a))return;
          if(_myAlerts[a.id]||_seen[a.id])return;
          var dd=_dist(_myPos.la,_myPos.ln,+a.lat,+a.lng);
          if(dd<=SOS_RADIUS){_seen[a.id]=1;_alarm(a,dd);}
        });
      }).catch(function(){});
    },function(){},{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }

  function _unlockAudio(){try{if(!_audio)_audio=new (window.AudioContext||window.webkitAudioContext)();if(_audio.state==='suspended')_audio.resume();}catch(e){}}
  ['pointerdown','touchend','click','keydown'].forEach(function(ev){document.addEventListener(ev,_unlockAudio,{passive:true});});

  window._sosStart=function(){if(_started)return;if(typeof _sbClient!=='function'||!_sbClient()){setTimeout(window._sosStart,2000);return;}_started=true;_tick();setInterval(_tick,POLL_MS);};
  window.addEventListener('load',function(){setTimeout(window._sosStart,3500);});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&_started){_tick();}});
})();
