const CACHE='bwk-v80-tracking-gap';
// Only the minimum app shell is pre-cached. This keeps first install quick on mountain/mobile networks.
const ASSETS=['/','/index.html','/styles.css','/manifest.json','/rc-logo.webp',
  '/logo-blessing.js','/sk.js','/sos.js','/sos-auth.js','/sos-context.js','/sos-outbox.js','/sos-relay.js','/sos-pluscode.js','/sos-ui.css','/ops.js','/push.js','/chat.js','/hike.js','/lens-extras.js','/tracker.html','/family-tracking.js','/tracking-session-resume.js','/tracking-live-recovery.js','/tracking-message-owner.js','/tracking-message-viewer.js','/tracking-plus.js','/tracking-sos.js'];
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
  // v17.6: file aplikasi (JS/CSS/HTML) NETWORK-FIRST — dulu cache-first, sehingga HP
  // terus memakai salinan lama (mis. ops.js/hike.js) dan perbaikan baru tidak pernah
  // tampil. Offline tetap aman: bila jaringan gagal, jatuh ke cache. Aset gambar
  // (logo/ikon, jarang berubah) tetap cache-first supaya hemat kuota.
  var isAppFile=/\.(js|css|html?)$/i.test(url.pathname);
  if(isAppFile){
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
// --- Web Push: peringatan SOS masuk walau aplikasi tertutup / layar HP mati ---
self.addEventListener('push',function(e){
  var data={};
  try{data=e.data?e.data.json():{};}catch(err){try{data={body:e.data.text()};}catch(e2){data={};}}
  var title=data.title||'\uD83C\uDD98 Sinyal Darurat SOS';
  var body=data.body||'Ada pendaki yang butuh bantuan di dekatmu.';
  var opts={body:body,icon:'/rc-logo.webp',badge:'/rc-logo.webp',tag:data.tag||('sos-'+(data.id||Date.now())),renotify:true,requireInteraction:true,vibrate:[400,150,400,150,700],data:{url:data.url||'/'}};
  // Selain notifikasi, beri tahu tab yang sedang terbuka supaya alarm dalam aplikasi
  // langsung diperiksa tanpa menunggu siklus polling berikutnya.
  e.waitUntil(self.registration.showNotification(title,opts).then(function(){
    return self.clients.matchAll({type:'window',includeUncontrolled:true});
  }).then(function(list){(list||[]).forEach(function(c){try{c.postMessage({type:'sos-push',id:data.id||null});}catch(err2){}});}).catch(function(){}));
});
self.addEventListener('notificationclick',function(e){
  e.notification.close();
  var url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){var c=list[i];if('focus' in c){if(c.navigate){try{c.navigate(url);}catch(e3){}}return c.focus();}}
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }));
});

// --- Background Sync: kirim SOS antrean saat koneksi pulih, walau aplikasi
// sedang di latar belakang. Token sesi tidak ada di SW, jadi SW meminta
// halaman yang terbuka melakukan flush; bila tidak ada halaman, browser akan
// mengirim event sync lagi saat aplikasi dibuka berikutnya.
self.addEventListener('sync',function(e){
  if(!e||e.tag!=='bwk-sos-outbox')return;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){
    (list||[]).forEach(function(c){try{c.postMessage({type:'bwk-sos-flush'});}catch(err){}});
  }));
});
