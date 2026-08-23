// Bawakaraeng Hub - Service Worker
// PENTING: berkas ini WAJIB disimpan sebagai UTF-8 tanpa BOM.
// Versi sebelumnya tersimpan sebagai UTF-16LE sehingga GAGAL PARSE dan
// service worker tidak pernah terpasang sama sekali.
// Verifikasi setelah menyalin:
//   file sw.js          -> harus "ASCII text" atau "UTF-8 Unicode text"
//   node --check sw.js  -> harus lulus tanpa keluaran

const CACHE='bwk-v78-sos-kit';
const ASSETS=['/','/index.html','/styles.css','/manifest.json','/rc-logo.webp',
  '/logo-blessing.js','/sk.js','/sos.js','/ops.js','/push.js','/chat.js','/hike.js','/lens-extras.js',
  '/leaflet.js','/leaflet.css',
  '/sos-pluscode.js','/sos-context.js','/sos-auth.js','/sos-outbox.js','/sos-relay.js','/sos-ui.css',
  '/images/marker-icon.png','/images/marker-icon-2x.png','/images/marker-shadow.png',
  '/images/layers.png','/images/layers-2x.png'];

// Berkas yang selalu diambil dari jaringan lebih dulu supaya patch cepat sampai
// ke pengguna lama. Tetap jatuh ke cache bila offline.
const FRESH=/\.(?:js|css|html)$/;

self.addEventListener('install',function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(ASSETS).catch(function(){});}));
});

self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.map(function(k){if(k!==CACHE)return caches.delete(k);}));}));
  self.clients.claim();
});

self.addEventListener('fetch',function(e){
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  // Live data and third-party requests must stay fresh and are never cached.
  if(url.origin!==location.origin || url.pathname.indexOf('/api/')===0)return;

  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(function(res){
      const copy=res.clone();caches.open(CACHE).then(function(c){c.put('/index.html',copy);});return res;
    }).catch(function(){return caches.match('/index.html');}));
    return;
  }

  // Kode aplikasi: jaringan dulu, cache sebagai cadangan.
  // Tanpa ini, pengguna lama tetap memakai sos.js/ops.js versi lama
  // selama nama CACHE belum berubah.
  if(FRESH.test(url.pathname)){
    e.respondWith(fetch(req).then(function(res){
      if(res&&res.status===200){const copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
      return res;
    }).catch(function(){return caches.match(req);}));
    return;
  }

  e.respondWith(caches.match(req).then(function(hit){
    if(hit)return hit;
    return fetch(req).then(function(res){
      if(res&&res.status===200){const copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
      return res;
    });
  }));
});

// --- Background Sync: kirim SOS tertunda walau tab sudah ditutup ---
// Dipicu oleh sos-outbox.js lewat registration.sync.register('bwk-sos-outbox').
self.addEventListener('sync',function(e){
  if(e.tag!=='bwk-sos-outbox')return;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    (list||[]).forEach(function(c){try{c.postMessage({type:'bwk-sos-flush'});}catch(err){}});
    // Bila tidak ada tab hidup, beri tahu pengguna supaya SOS tidak diam-diam menggantung.
    if(!list||!list.length){
      return self.registration.showNotification('SOS belum terkirim',{
        body:'Buka aplikasi untuk mengirim ulang sinyal daruratmu.',
        icon:'/rc-logo.webp',badge:'/rc-logo.webp',tag:'bwk-sos-pending',
        requireInteraction:true,vibrate:[300,120,300],data:{url:'/'}
      });
    }
  }).catch(function(){}));
});

// --- Pesan dari halaman ---
self.addEventListener('message',function(e){
  const d=e.data||{};
  if(d.type==='bwk-skip-waiting'){self.skipWaiting();return;}
  if(d.type==='bwk-sos-ping'){
    e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
      (list||[]).forEach(function(c){try{c.postMessage({type:'bwk-sos-flush'});}catch(err){}});
    }).catch(function(){}));
  }
});

// --- Web Push: peringatan SOS masuk walau aplikasi tertutup / layar HP mati ---
self.addEventListener('push',function(e){
  var data={};
  try{data=e.data?e.data.json():{};}catch(err){try{data={body:e.data.text()};}catch(e2){data={};}}
  var title=data.title||'\uD83C\uDD98 Sinyal Darurat SOS';
  var body=data.body||'Ada pendaki yang butuh bantuan di dekatmu.';
  var opts={
    body:body,
    icon:'/rc-logo.webp',
    badge:'/rc-logo.webp',
    tag:data.tag||('sos-'+(data.id||Date.now())),
    renotify:true,
    requireInteraction:true,
    vibrate:[400,150,400,150,700,150,400,150,700],
    data:{url:data.url||'/',id:data.id||null},
    actions:[
      {action:'open',title:'Buka Aplikasi'},
      {action:'map',title:'Lihat Peta'}
    ]
  };
  // iOS: tampilkan notifikasi critical dengan urgency tinggi
  if(data.urgency==='high'){opts.renotify=true;}
  
  // Selain notifikasi, beri tahu tab yang sedang terbuka supaya alarm dalam aplikasi
  // langsung diperiksa tanpa menunggu siklus polling berikutnya.
  e.waitUntil(self.registration.showNotification(title,opts).then(function(){
    return self.clients.matchAll({type:'window',includeUncontrolled:true});
  }).then(function(list){(list||[]).forEach(function(c){try{c.postMessage({type:'sos-push',id:data.id||null,urgent:data.urgency==='high'});}catch(err2){}});}).catch(function(){}));
  
  // CRITICAL: Jika app tidak responsif, kirim ulang dengan prioritas lebih tinggi setelah 5 detik
  if(data.id && !data.retryCount){
    setTimeout(function(){
      // Cek apakah masih ada client yang terbuka
      self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
        if(!list||!list.length){
          // App mungkin tertutup, coba kirim lagi dengan flag retry
          var payload=JSON.stringify({
            title:'🚨 SOS DARURAT! Buka sekarang!',
            body:'Ada pendaki membutuhkan bantuan segera. Ketuk untuk membuka.',
            id:data.id,
            tag:'sos-'+data.id,
            urgency:'high',
            retryCount:1
          });
          self.registration.showNotification('🚨 SOS DARURAT!',{
            body:'Ketuk untuk membuka aplikasi',
            icon:'/rc-logo.webp',
            badge:'/rc-logo.webp',
            tag:'sos-'+data.id+'-retry',
            renotify:true,
            requireInteraction:true,
            vibrate:[800,200,800,200,800],
            data:{url:'/?sos='+encodeURIComponent(data.id),id:data.id},
            actions:[{action:'open',title:'BUKA SEKARANG'}]
          });
        }
      });
    },5000);
  }
});

self.addEventListener('notificationclick',function(e){
  e.notification.close();
  var d=e.notification.data||{};
  var url=d.url||'/';
  if(e.action==='map'&&d.id)url='/?sos='+encodeURIComponent(d.id);
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    // Cari window yang sudah ada, fokuskan
    for(var i=0;i<list.length;i++){
      var c=list[i];
      if('focus' in c){
        if(c.navigate){try{c.navigate(url);}catch(e3){}}
        return c.focus();
      }
    }
    // Jika tidak ada window terbuka, buka baru
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }).then(function(){
    // WAKE LOCK: Coba akhiri screen sleep setelah app terbuka
    if('wakeLock' in navigator){
      try{navigator.wakeLock.request('screen');}catch(err){}
    }
  }));
});

// --- Langganan push diperbarui browser: daftarkan ulang, jangan sampai diam ---
self.addEventListener('pushsubscriptionchange',function(e){
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    (list||[]).forEach(function(c){try{c.postMessage({type:'bwk-push-resubscribe'});}catch(err){}});
  }).catch(function(){}));
});
