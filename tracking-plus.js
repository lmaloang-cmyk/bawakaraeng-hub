/*
 * Tracking Plus — peningkatan UI khusus tracker.html.
 * Berdiri sendiri; tidak bergantung atau mengubah modul SOS aplikasi.
 */
(function (global) {
  'use strict';

  var map = null, routeLayer = null, stopLayer = null, previewMarker = null;
  var latest = null, positions = [], session = null, mounted = false;
  var routeVisible = false;
  var ROUTE = [
    {n:'Lembanna',lat:-5.25360,lng:119.90560,el:1514},
    {n:'Pos 0',lat:-5.26158,lng:119.91049,el:1680},
    {n:'Pos 1',lat:-5.26348,lng:119.91166,el:1719},
    {n:'Pos 2',lat:-5.26785,lng:119.91434,el:1810},
    {n:'Pintu Rimba',lat:-5.27184,lng:119.91679,el:1893},
    {n:'Pos 3',lat:-5.27457,lng:119.91846,el:1950},
    {n:'Pos 5',lat:-5.28519,lng:119.92499,el:2170},
    {n:'Memorial',lat:-5.28804,lng:119.92674,el:2230},
    {n:'Pos 8',lat:-5.29810,lng:119.93291,el:2440},
    {n:'Pos 9',lat:-5.30637,lng:119.93797,el:2610},
    {n:'Puncak',lat:-5.31694,lng:119.94444,el:2830}
  ];

  function h(tag, cls, text) { var e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }
  function num(v){v=Number(v);return isFinite(v)?v:null;}
  function time(p){return new Date((p&& (p.sent_at||p.at))||0).getTime();}
  function dist(a,b){if(!a||!b)return 0;var R=6371000,r=Math.PI/180,d1=(b.lat-a.lat)*r,d2=(b.lng-a.lng)*r,x=Math.sin(d1/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(d2/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(x)));}
  function bearing(a,b){if(!a||!b)return null;var r=Math.PI/180,p1=a.lat*r,p2=b.lat*r,dl=(b.lng-a.lng)*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return (Math.atan2(y,x)/r+360)%360;}
  function compass(v){return v==null?'':(['U','TL','T','TG','S','BD','B','BL'][Math.round(v/45)%8]+' '+Math.round(v)+'°');}
  function fmtDist(m){return m>=1000?(m/1000).toFixed(2)+' km':Math.round(m)+' m';}
  function pathDistance(list){var a=(list||[]).slice().reverse(),m=0;for(var i=1;i<a.length;i++){var d=dist(a[i-1],a[i]);if(d<250)m+=d;}return m;}
  function avgSpeed(list){if(!list||list.length<2)return null;var d=pathDistance(list),dt=(time(list[0])-time(list[list.length-1]))/3600000;return dt>0?d/1000/dt:null;}
  function nearestRoute(p){var best={d:Infinity,i:0};ROUTE.forEach(function(r,i){var d=dist(p,r);if(d<best.d)best={d:d,i:i};});return best;}
  function latestAltitude(p){var a=num(p&&p.altitude_m);return a!=null?a:null;}

  function injectStyle(){
    if(document.getElementById('tkPlusStyle'))return;
    var s=h('style');s.id='tkPlusStyle';s.textContent=`
      .tk-plus-card{background:#fff;border:1px solid #e8ebf1;border-radius:16px;padding:14px;margin:-2px 0 14px;box-shadow:0 4px 14px rgba(30,40,90,.07)}
      .tk-plus-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px}.tk-plus-head b{font-size:13px}.tk-plus-live{font-size:10px;font-weight:800;color:#087c52;background:#e5f5ed;padding:4px 7px;border-radius:999px}
      .tk-plus-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.tk-plus-metric{min-width:0;background:#f7f8fb;border-radius:11px;padding:9px 6px;text-align:center}.tk-plus-metric b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tk-plus-metric small{display:block;font-size:9.5px;color:#6b7280;margin-top:2px}
      .tk-plus-status{margin-top:10px;padding:10px 11px;border-radius:11px;font-size:12px;line-height:1.45;background:#edf8f3;color:#176448}.tk-plus-status.warn{background:#fff4df;color:#8b5b05}.tk-plus-status.bad{background:#fdebea;color:#a92c32}
      .tk-plus-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 14px}.tk-plus-tools button{min-height:44px;border:1px solid #dfe4ec;background:#fff;border-radius:12px;font-size:11px;font-weight:750;color:#344054;padding:7px}.tk-plus-tools button.on{background:#e6f4ef;border-color:#9fd0bd;color:#176448}
      .tk-timeline{margin-top:11px}.tk-timeline input{width:100%;accent-color:#26705a}.tk-timeline-label{display:flex;justify-content:space-between;font-size:10px;color:#697386;margin-top:2px}
      .tk-map-legend{display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;font-size:10px;color:#697386}.tk-map-legend i{display:inline-block;width:14px;height:4px;border-radius:4px;margin-right:4px;vertical-align:middle}
      .tk-preview-dot{width:14px;height:14px;border-radius:50%;background:#fff;border:4px solid #26705a;box-shadow:0 2px 8px rgba(0,0,0,.25)}
      @media(max-width:390px){.tk-plus-grid{grid-template-columns:repeat(2,1fr)}.tk-plus-tools{grid-template-columns:1fr 1fr}}
    `;document.head.appendChild(s);
  }

  function mount(){
    if(mounted)return;
    var wrap=document.querySelector('.map-wrap'); if(!wrap)return;
    injectStyle();
    var card=h('section','tk-plus-card');card.id='tkPlusCard';card.innerHTML='<div class="tk-plus-head"><b>Ringkasan perjalanan</b><span class="tk-plus-live">LIVE</span></div><div class="tk-plus-grid"><div class="tk-plus-metric"><b id="tkPlusDistance">—</b><small>Jarak</small></div><div class="tk-plus-metric"><b id="tkPlusAltitude">—</b><small>Elevasi</small></div><div class="tk-plus-metric"><b id="tkPlusSpeed">—</b><small>Rata-rata</small></div><div class="tk-plus-metric"><b id="tkPlusMove">—</b><small>Pergerakan</small></div></div><div id="tkPlusStatus" class="tk-plus-status">Menunggu data perjalanan…</div><div class="tk-timeline"><input id="tkTimeline" type="range" min="0" max="0" value="0" aria-label="Riwayat posisi"><div class="tk-timeline-label"><span id="tkTimelineStart">Awal</span><span id="tkTimelineNow">Sekarang</span></div></div><div class="tk-map-legend"><span><i style="background:#168a78"></i>Jejak</span><span><i style="background:#e6a23c"></i>GPS lemah</span><span><i style="background:#94a3b8"></i>Data lama</span><span><i style="height:2px;border-top:2px dashed #4976d1"></i>Jalur perkiraan</span></div>';
    wrap.insertAdjacentElement('afterend',card);
    var tools=h('div','tk-plus-tools');tools.innerHTML='<button id="tkFollowBtn" class="on">♥ Ikuti pendaki</button><button id="tkFitBtn">⌁ Semua jejak</button><button id="tkRouteBtn">◇ Jalur resmi</button><button id="tkShareUpdate">↗ Bagikan status</button><button id="tkGpxBtn">↓ Unduh GPX</button><button id="tkGeoBtn">↓ GeoJSON</button>';
    card.insertAdjacentElement('afterend',tools);
    document.getElementById('tkFollowBtn').onclick=function(){var api=global.BWKTrackingView;if(api&&api.follow)api.follow();this.classList.add('on');};
    document.getElementById('tkFitBtn').onclick=fitAll;
    document.getElementById('tkRouteBtn').onclick=toggleRoute;
    document.getElementById('tkShareUpdate').onclick=shareUpdate;
    document.getElementById('tkGpxBtn').onclick=function(){download('gpx');};
    document.getElementById('tkGeoBtn').onclick=function(){download('geojson');};
    document.getElementById('tkTimeline').oninput=scrub;
    mounted=true;
  }

  function render(){
    mount(); if(!mounted||!latest)return;
    var d=pathDistance(positions),av=avgSpeed(positions),alt=latestAltitude(latest);
    var age=Math.max(0,(Date.now()-time(latest))/60000),recent=positions[1],spd=recent?dist(recent,latest)/Math.max(1,(time(latest)-time(recent))/1000)*3.6:null;
    var moving=age>15?'Terputus':age>5?'Diam':spd!=null&&spd>.45?'Berjalan':'Berhenti';
    var br=recent?bearing(recent,latest):null;
    document.getElementById('tkPlusDistance').textContent=fmtDist(d);
    document.getElementById('tkPlusAltitude').textContent=alt!=null?Math.round(alt)+' m':'—';
    document.getElementById('tkPlusSpeed').textContent=av!=null?av.toFixed(1)+' km/j':'—';
    document.getElementById('tkPlusMove').textContent=moving+(br!=null?' · '+compass(br):'');
    var box=document.getElementById('tkPlusStatus'),bat=num(latest.battery_pct),nr=nearestRoute(latest),bits=[];box.className='tk-plus-status';
    if(age>15){bits.push('Belum ada pembaruan '+Math.round(age)+' menit. Posisi di peta bukan posisi terkini.');box.classList.add('bad');}
    else if(age>5){bits.push('Belum bergerak atau sinyal terputus selama '+Math.round(age)+' menit.');box.classList.add('warn');}
    else bits.push('Posisi terakhir '+new Date(time(latest)).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})+' WITA.');
    if(bat!=null&&bat<=10){bits.push('Baterai kritis '+bat+'%.');box.className='tk-plus-status bad';}
    else if(bat!=null&&bat<=20){bits.push('Baterai rendah '+bat+'%.');box.classList.add('warn');}
    if(nr.d>300 && num(latest.accuracy_m)<100){bits.push('Sekitar '+fmtDist(nr.d)+' dari jalur perkiraan—perlu konfirmasi peta resmi.');box.classList.add('warn');}
    else {var next=ROUTE[Math.min(nr.i+1,ROUTE.length-1)];if(next&&nr.i<ROUTE.length-1)bits.push('Terdekat '+ROUTE[nr.i].n+' · berikutnya '+next.n+'.');}
    box.textContent=bits.join(' ');
    updateTimeline(); updateStops();
  }

  function updateTimeline(){var r=document.getElementById('tkTimeline');if(!r||!positions.length)return;r.max=positions.length-1;if(!r.matches(':active'))r.value=0;var old=positions[positions.length-1],now=positions[0];document.getElementById('tkTimelineStart').textContent=new Date(time(old)).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});document.getElementById('tkTimelineNow').textContent=new Date(time(now)).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
  function scrub(e){if(!map||!positions.length)return;var p=positions[Math.min(positions.length-1,Number(e.target.value))];if(!previewMarker)previewMarker=L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="tk-preview-dot"></div>',iconSize:[14,14],iconAnchor:[7,7]}),zIndexOffset:1100}).addTo(map);else previewMarker.setLatLng([p.lat,p.lng]);previewMarker.bindTooltip(new Date(time(p)).toLocaleString('id-ID')+' · '+(p.altitude_m!=null?p.altitude_m+' mdpl':'')).openTooltip();}
  function toggleRoute(){if(!map)return;var b=document.getElementById('tkRouteBtn');if(routeVisible){if(routeLayer)map.removeLayer(routeLayer);routeVisible=false;b.classList.remove('on');return;}routeLayer=L.layerGroup();L.polyline(ROUTE.map(function(p){return[p.lat,p.lng];}),{color:'#4976d1',weight:3,opacity:.72,dashArray:'7 7'}).addTo(routeLayer);ROUTE.forEach(function(p){L.circleMarker([p.lat,p.lng],{radius:4,color:'#fff',weight:1,fillColor:'#4976d1',fillOpacity:1}).bindTooltip(p.n+' · '+p.el+' mdpl').addTo(routeLayer);});routeLayer.addTo(map);routeVisible=true;b.classList.add('on');}
  function fitAll(){if(!map||!positions.length)return;map.fitBounds(L.latLngBounds(positions.map(function(p){return[p.lat,p.lng];})),{padding:[35,35],maxZoom:16});}
  function updateStops(){if(!map||positions.length<3)return;if(stopLayer)map.removeLayer(stopLayer);stopLayer=L.layerGroup();var a=positions.slice().reverse(),start=null;for(var i=1;i<a.length;i++){if(dist(a[i-1],a[i])<15){if(start==null)start=i-1;}else if(start!=null){var mins=(time(a[i-1])-time(a[start]))/60000;if(mins>=5)L.circleMarker([a[start].lat,a[start].lng],{radius:5,color:'#fff',weight:2,fillColor:'#e6a23c',fillOpacity:1}).bindTooltip('Berhenti ±'+Math.round(mins)+' menit').addTo(stopLayer);start=null;}}stopLayer.addTo(map);}
  function shareUpdate(){if(!latest)return;var msg='📍 *Pembaruan Live Tracking*\n'+(session&&session.name?session.name+'\n':'')+'Posisi: '+latest.lat.toFixed(5)+', '+latest.lng.toFixed(5)+'\nWaktu: '+new Date(time(latest)).toLocaleString('id-ID')+' WITA\nBaterai: '+(latest.battery_pct!=null?latest.battery_pct+'%':'—')+'\nJejak: '+fmtDist(pathDistance(positions))+'\n'+global.location.href;if(navigator.share)navigator.share({title:'Pembaruan Live Tracking',text:msg}).catch(function(){});else global.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank');}
  function download(type){if(!positions.length)return;var asc=positions.slice().reverse(),body,name,mime;if(type==='gpx'){body='<?xml version="1.0"?><gpx version="1.1" creator="Pintu Angin"><trk><name>Live Tracking</name><trkseg>'+asc.map(function(p){return'<trkpt lat="'+p.lat+'" lon="'+p.lng+'">'+(p.altitude_m!=null?'<ele>'+p.altitude_m+'</ele>':'')+'<time>'+new Date(time(p)).toISOString()+'</time></trkpt>';}).join('')+'</trkseg></trk></gpx>';name='jejak-pintu-angin.gpx';mime='application/gpx+xml';}else{body=JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:session&&session.name||'Live Tracking'},geometry:{type:'LineString',coordinates:asc.map(function(p){return[p.lng,p.lat,p.altitude_m||0];})}}]},null,2);name='jejak-pintu-angin.geojson';mime='application/geo+json';}var u=URL.createObjectURL(new Blob([body],{type:mime})),a=h('a');a.href=u;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(u);},1000);}

  global.addEventListener('bwk:tracker-ready',function(e){map=e.detail.map;mount();});
  global.addEventListener('bwk:tracker-update',function(e){latest=e.detail.latest;positions=e.detail.positions||[];session=e.detail.session||null;map=e.detail.map||map;render();});
  setInterval(function(){if(global.BWKTrackingView){map=global.BWKTrackingView.getMap();latest=global.BWKTrackingView.getLatest();positions=global.BWKTrackingView.getPositions();session=global.BWKTrackingView.getSession();render();}},5000);
})(window);
