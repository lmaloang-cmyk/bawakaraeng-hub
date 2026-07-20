const CACHE='bwk-v52-optimized';
const ASSETS=[
  '/','/index.html','/manifest.json','/styles.css',
  '/rc-logo.webp','/logo-blessing.js','/sk.js','/sos.js','/chat.js','/hike.js','/lens-extras.js',
  '/icon-192.png','/icon-512.png','/apple-touch-icon.png','/bg-fajar.svg','/bg-senja.svg','/bg-siang.svg'
];
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
  if(url.origin!==location.origin)return;
  if(url.pathname.indexOf('/api/')===0)return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).then(function(res){var copy=res.clone();caches.open(CACHE).then(function(c){c.put('/index.html',copy);});return res;}).catch(function(){return caches.match('/index.html');}));
    return;
  }
  e.respondWith(caches.match(req).then(function(hit){
    if(hit){
      fetch(req).then(function(res){if(res&&res.status===200){var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}}).catch(function(){});
      return hit;
    }
    return fetch(req).then(function(res){
      if(res&&res.status===200){var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});}
      return res;
    }).catch(function(){return hit;});
  }));
});
