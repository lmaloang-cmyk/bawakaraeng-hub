const CACHE='bwk-v14';
const ASSETS=['/bg-fajar.svg','/bg-siang.svg','/bg-senja.svg','/','/index.html','/manifest.json','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/rc-logo.jpg','/species-macaca.jpg','/og.jpg'];
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
  if(req.method!=='GET'){return;}
  const url=new URL(req.url);
  // Jangan cache panggilan API (cuaca/hotspot) - selalu ambil dari jaringan
  if(url.pathname.indexOf('/api/')===0){return;}
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(function(res){
      const copy=res.clone();caches.open(CACHE).then(function(c){c.put('/index.html',copy);});return res;
    }).catch(function(){return caches.match('/index.html');}));
    return;
  }
  e.respondWith(caches.match(req).then(function(hit){return hit||fetch(req).then(function(res){
    if(res&&res.status===200&&url.origin===location.origin){const copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
    return res;
  }).catch(function(){return hit;});}));
});
