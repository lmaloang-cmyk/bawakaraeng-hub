/* Web Push SOS: peringatan darurat tetap masuk walau aplikasi tertutup / layar HP mati.
   Butuh: kunci VAPID publik (di bawah) + env VAPID_PRIVATE di server, tabel push_subscriptions
   di Supabase (jalankan supabase-push.sql), dan endpoint /api/sos-push. */
(function(){
  var VAPID_PUBLIC='BNqs6g7alS1MYpCgK4wgLHadQXtcAF6hGfOKm6x3hVT2cUhI1P4GuZwDKI2KbFaS-tGuyP1u7305B3nY_yI8qoM';
  var SUPPORTED=('serviceWorker' in navigator)&&('PushManager' in window)&&('Notification' in window);

  function _dev(){try{var d=localStorage.getItem('bwkDev');if(!d){d='d'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('bwkDev',d);}return d;}catch(e){return 'd0';}}
  function _name(){try{var u=JSON.parse(localStorage.getItem('bwkUser')||'{}');return (u&&u.name)||'Pendaki';}catch(e){return 'Pendaki';}}
  function _b64(base64){var pad='='.repeat((4-base64.length%4)%4);var b=(base64+pad).replace(/-/g,'+').replace(/_/g,'/');var raw=atob(b);var arr=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr;}
  function _pos(){return new Promise(function(res){if(!navigator.geolocation){res(null);return;}navigator.geolocation.getCurrentPosition(function(p){res({lat:p.coords.latitude,lng:p.coords.longitude});},function(){res(null);},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});});}

  function _store(sub){
    try{
      var c=(typeof _sbClient==='function')?_sbClient():null;if(!c)return;
      var j=sub.toJSON();if(!j||!j.endpoint||!j.keys)return;
      _pos().then(function(pos){
        var row={endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,device:_dev(),name:_name(),active:true,updated_at:new Date().toISOString()};
        if(pos){row.lat=pos.lat;row.lng=pos.lng;}
        try{c.from('push_subscriptions').upsert(row,{onConflict:'endpoint'}).then(function(){}).catch(function(){});}catch(e){}
      });
    }catch(e){}
  }

  function _subscribe(){
    return navigator.serviceWorker.ready.then(function(reg){
      return reg.pushManager.getSubscription().then(function(existing){
        if(existing)return existing;
        return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:_b64(VAPID_PUBLIC)});
      });
    }).then(function(sub){if(sub)_store(sub);return sub;});
  }

  // Dipanggil dari tombol "Aktifkan" (butuh gesture pengguna untuk minta izin notifikasi).
  window._sosEnablePush=function(){
    if(!SUPPORTED){if(window.toast)toast('HP/browser ini belum mendukung notifikasi latar','err');return;}
    try{
      Notification.requestPermission().then(function(perm){
        if(perm!=='granted'){if(window.toast)toast('Izin notifikasi belum diberikan','err');return;}
        _subscribe().then(function(sub){if(sub){if(window.toast)toast('Notifikasi SOS aktif \uD83D\uDD14','ok');_hideBanner();}}).catch(function(){if(window.toast)toast('Gagal mengaktifkan notifikasi','err');});
      });
    }catch(e){if(window.toast)toast('Gagal mengaktifkan notifikasi','err');}
  };

  function _hideBanner(){var b=document.getElementById('pushBanner');if(b)b.remove();try{localStorage.setItem('bwkPushBn','1');}catch(e){}}
  function _showBanner(){
    if(!SUPPORTED)return;
    if(Notification.permission==='granted'){_subscribe();return;}
    if(Notification.permission==='denied')return;
    var skip=false;try{skip=localStorage.getItem('bwkPushBn')==='1';}catch(e){}if(skip)return;
    try{
      var css='#pushBanner{position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:99998;background:#fff;border:1px solid #e6e9ef;border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:14px;display:flex;gap:12px;align-items:flex-start;max-width:520px;margin:0 auto}#pushBanner .pb-ic{font-size:24px}#pushBanner .pb-tx{flex:1}#pushBanner .pb-tx b{display:block;font-size:14px;color:#20263a}#pushBanner .pb-tx small{color:#66748a;font-size:12px;line-height:1.4;display:block;margin-top:2px}#pushBanner .pb-bs{display:flex;gap:8px;margin-top:10px}#pushBanner button{border:none;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:800;cursor:pointer}#pushBanner .pb-on{background:#e0154a;color:#fff}#pushBanner .pb-no{background:#eef1f6;color:#42506b}';
      var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
      var el=document.createElement('div');el.id='pushBanner';
      el.innerHTML="<div class='pb-ic'>\uD83D\uDD14</div><div class='pb-tx'><b>Aktifkan Notifikasi SOS</b><small>Agar peringatan darurat tetap masuk walau aplikasi tertutup atau layar HP mati.</small><div class='pb-bs'><button class='pb-on' id='pbOn'>Aktifkan</button><button class='pb-no' id='pbNo'>Nanti</button></div></div>";
      document.body.appendChild(el);
      var on=document.getElementById('pbOn');if(on)on.addEventListener('click',window._sosEnablePush);
      var no=document.getElementById('pbNo');if(no)no.addEventListener('click',_hideBanner);
    }catch(e){}
  }
  window.addEventListener('load',function(){setTimeout(_showBanner,4500);});
})();
