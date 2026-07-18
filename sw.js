const CACHE='bwk-v43-reichas-floating';
// Only the minimum app shell is pre-cached. This keeps first install quick on mountain/mobile networks.
const ASSETS=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/og.jpg','/screenshots/home-mobile.png','/screenshots/home-wide.png','/rc-logo.png','/sk.js','/sos.js','/chat.js','/hike.js','/lens-extras.js'];
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
  e.respondWith(caches.match(req).then(function(hit){
    if(hit)return hit;
    return fetch(req).then(function(res){
      if(res&&res.status===200){const copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
      return res;
    });
  }));
});
