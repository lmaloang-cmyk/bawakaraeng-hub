/* map-offline.js — UI kontrol untuk tile cache & file upload
 *
 * - Tombol "Simpan area untuk offline" — fetch tile di viewport + zoom berdekatan,
 *   simpan di service worker cache (cache-first).
 * - Tombol "Upload file peta" — terima .gpx/.kml/.geojson, parse via bwkMapFiles,
 *   render sebagai layer Leaflet, simpan di localStorage untuk offline reuse.
 * - Tombol "Export trek ke GPX" — export posisi GPS tracker saat ini.
 *
 * Dependensi eksternal: TIDAK ADA. Hanya Leaflet (sudah ada di global L).
 * Dipakai dari tracker.html & index.html (pantauMap).
 */
(function(){
  'use strict';
  if(window.bwkMapOffline)return;

  var TILE_AVG_KB=22;
  var CONCURRENT_FETCH=6;

  function _esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function _toast(msg,type){if(window.toast)window.toast(msg,type||'ok');}
  function _fmtBytes(b){
    if(b<1024)return b+' B';
    if(b<1024*1024)return Math.round(b/1024)+' KB';
    return (b/(1024*1024)).toFixed(1)+' MB';
  }
  function _tileBBox(bounds,zoom){
    var nw=bounds.getNorthWest(),se=bounds.getSouthEast();
    function lng2tile(lng,z){return Math.floor(((lng+180)/360)*Math.pow(2,z));}
    function lat2tile(lat,z){
      var pi=Math.PI;
      return Math.floor((1-Math.log(Math.tan(lat*pi/180)+1/Math.cos(lat*pi/180))/pi)/2*Math.pow(2,z));
    }
    return{
      xMin:lng2tile(nw.lng,zoom),xMax:lng2tile(se.lng,zoom),
      yMin:lat2tile(se.lat,zoom),yMax:lat2tile(nw.lat,zoom),
      zoom:zoom
    };
  }
  function _buildTileUrls(bounds,zoomLevels,baseUrl){
    var urls=[];
    zoomLevels.forEach(function(z){
      var bb=_tileBBox(bounds,z);
      for(var x=bb.xMin;x<=bb.xMax;x++){
        for(var y=bb.yMin;y<=bb.yMax;y++){
          // Beberapa tile server pakai {s} subdomain, beberapa pakai fixed domain
          if(baseUrl.indexOf('{s}')!==-1){
            var s=['a','b','c'][x%3];
            urls.push(baseUrl.replace('{s}',s).replace('{z}',z).replace('{x}',x).replace('{y}',y));
          }else{
            // Esri style: /tile/{z}/{y}/{x}
            urls.push(baseUrl.replace('{z}',z).replace('{x}',x).replace('{y}',y));
          }
        }
      }
    });
    return urls;
  }
  async function _fetchParallel(urls,concurrency,onProgress){
    var done=0,fail=0,totalBytes=0;
    var results=[];
    var queue=urls.slice();
    async function worker(){
      while(queue.length>0){
        var url=queue.shift();
        if(!url)break;
        try{
          var res=await fetch(url,{mode:'cors',credentials:'omit'});
          if(res.ok){
            var blob=await res.clone().blob();
            totalBytes+=blob.size;
            results.push({ok:true,size:blob.size});
          }else{
            results.push({ok:false,status:res.status});
            fail++;
          }
        }catch(e){
          results.push({ok:false,err:e.message});
          fail++;
        }
        done++;
        if(onProgress)onProgress(done,urls.length,totalBytes,fail);
      }
    }
    var workers=[];
    for(var i=0;i<concurrency;i++)workers.push(worker());
    await Promise.all(workers);
    return{ok:results.filter(function(r){return r.ok;}).length,fail:fail,totalBytes:totalBytes,total:urls.length};
  }

  function _detectActiveLayer(map){
    // Deteksi tile layer yang sedang aktif
    var layers=[];
    map.eachLayer(function(l){
      if(l instanceof L.TileLayer){
        var url=l.getTileUrl({x:0,y:0,z:0});
        layers.push({layer:l,url:url});
      }
    });
    return layers;
  }

  // ====== Tombol: Simpan area untuk offline ======
  function buildSaveAreaButton(map,options){
    options=options||{};
    var btn=L.control({position:options.position||'topright'});
    btn.onAdd=function(){
      var div=L.DomUtil.create('div','bwk-offline-ctrl');
      div.innerHTML='<button id="bwkSaveArea" class="bwk-ctrl-btn" title="Simpan area ini untuk offline">'+
        '<span class="bwk-ctrl-ic">📥</span><span class="bwk-ctrl-tx">Simpan area</span></button>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div,'click',function(e){
        L.DomEvent.stop(e);
        saveAreaFlow(map,div);
      });
      return div;
    };
    return btn;
  }
  function _setBtnState(div,state,text,detail){
    var btn=div.querySelector('#bwkSaveArea');
    if(!btn)return;
    btn.className='bwk-ctrl-btn bwk-ctrl-'+state;
    btn.innerHTML='<span class="bwk-ctrl-ic">'+({idle:'📥',downloading:'⏳',ready:'✅',stale:'⚠️',error:'⚠️'}[state]||'📥')+'</span>'+
      '<span class="bwk-ctrl-tx">'+_esc(text)+'</span>';
    if(detail)btn.title=detail;
  }
  async function saveAreaFlow(map,div){
    var activeLayers=_detectActiveLayer(map);
    if(activeLayers.length===0){
      _toast('Tidak ada tile layer aktif','err');
      return;
    }
    var zoom=map.getZoom();
    var zoomLevels=[zoom-1,zoom,zoom+1].filter(function(z){return z>=10&&z<=17;});
    var bounds=map.getBounds();
    var urls=[];
    activeLayers.forEach(function(t){
      urls=urls.concat(_buildTileUrls(bounds,zoomLevels,t.url));
    });
    var estBytes=urls.length*TILE_AVG_KB*1024;
    if(!confirm('Simpan '+urls.length+' tile (~'+_fmtBytes(estBytes)+') untuk offline?\n\nTile akan otomatis ter-cache di perangkat ini.')){
      return;
    }
    _setBtnState(div,'downloading','Menyimpan… 0%');
    var result=await _fetchParallel(urls,CONCURRENT_FETCH,function(done,total,bytes,fail){
      var pct=Math.round(done/total*100);
      _setBtnState(div,'downloading','Menyimpan… '+pct+'% ('+_fmtBytes(bytes)+')');
    });
    if(result.fail>urls.length*0.3){
      _setBtnState(div,'error','Sebagian gagal','Berhasil: '+result.ok+' / '+result.total);
      _toast('Sebagian tile gagal: '+result.fail,'err');
    }else{
      _setBtnState(div,'ready','Tersimpan offline ('+_fmtBytes(result.totalBytes)+')');
      _toast('Tile area tersimpan: '+result.ok+' tile, '+_fmtBytes(result.totalBytes),'ok');
    }
  }

  // ====== Tombol: Upload file peta ======
  function buildUploadButton(map,options){
    options=options||{};
    var btn=L.control({position:options.position||'topright'});
    btn.onAdd=function(){
      var div=L.DomUtil.create('div','bwk-upload-ctrl');
      div.innerHTML='<input type="file" id="bwkFileInput" accept=".gpx,.kml,.geojson,.json" style="display:none"/>'+
        '<button id="bwkUploadBtn" class="bwk-ctrl-btn" title="Upload file GPX / KML / GeoJSON">'+
        '<span class="bwk-ctrl-ic">📂</span><span class="bwk-ctrl-tx">Upload</span></button>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div.querySelector('#bwkUploadBtn'),'click',function(e){
        L.DomEvent.stop(e);
        div.querySelector('#bwkFileInput').click();
      });
      L.DomEvent.on(div.querySelector('#bwkFileInput'),'change',function(e){
        var file=e.target.files&&e.target.files[0];
        if(!file)return;
        uploadFlow(map,file,div);
        e.target.value='';
      });
      return div;
    };
    return btn;
  }
  async function uploadFlow(map,file,div){
    if(!window.bwkMapFiles){
      _toast('Module map-files belum dimuat','err');
      return;
    }
    var parsed,rendered;
    try{
      var content=await file.text();
      parsed=window.bwkMapFiles.parse(file.name,content);
    }catch(e){
      _toast('Gagal parse: '+e.message,'err');
      console.error('bwkMapFiles parse error:',e);
      return;
    }
    try{
      rendered=window.bwkMapFiles.render(map,parsed,file.name);
      if(!rendered){
        _toast('File tidak punya data yang bisa ditampilkan','err');
        return;
      }
      // Simpan ke storage
      var ok=window.bwkMapFiles.add(file.name,parsed);
      if(ok)_toast('File "'+file.name+'" dimuat ('+parsed.features.length+' points)','ok');
      // Tambah ke layer control
      _addToLayerControl(map,rendered);
    }catch(e){
      _toast('Gagal memproses file: '+e.message,'err');
      console.error('bwkMapFiles render error:',e);
    }
  }
  function _addToLayerControl(map,rendered){
    // Kontrol layer distash saat peta dibuat (map._bwkLayersCtrl) —
    // Leaflet Map tidak punya map.eachControl()
    try{
      var layersControl=map._bwkLayersCtrl;
      if(layersControl&&typeof layersControl.addOverlay==='function'){
        layersControl.addOverlay(rendered.layer,'📂 '+rendered.name);
      }
    }catch(e){}
  }

  // ====== Tombol: Export trek ke GPX ======
  function buildExportButton(map,getTrackData,options){
    options=options||{};
    var btn=L.control({position:options.position||'topright'});
    btn.onAdd=function(){
      var div=L.DomUtil.create('div','bwk-export-ctrl');
      div.innerHTML='<button id="bwkExportBtn" class="bwk-ctrl-btn" title="Export trek saya ke GPX">'+
        '<span class="bwk-ctrl-ic">📤</span><span class="bwk-ctrl-tx">Export GPX</span></button>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div,'click',function(e){
        L.DomEvent.stop(e);
        exportFlow(map,getTrackData);
      });
      return div;
    };
    return btn;
  }
  function exportFlow(map,getTrackData){
    var data=getTrackData?getTrackData():null;
    if(!data||!data.points||data.points.length===0){
      _toast('Belum ada trek untuk di-export','err');
      return;
    }
    var gpx='<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pintu Angin" xmlns="http://www.topografix.com/GPX/1/1">\n'+
      '<metadata><name>'+_esc(data.name||'Trek Pintu Angin')+'</name><time>'+new Date().toISOString()+'</time></metadata>\n'+
      '<trk><name>'+_esc(data.name||'Trek')+'</name><trkseg>\n';
    data.points.forEach(function(p){
      gpx+='<trkpt lat="'+p.lat+'" lon="'+p.lng+'">'+(p.ele!=null?'<ele>'+p.ele+'</ele>':'')+(p.time?'<time>'+p.time+'</time>':'')+'</trkpt>\n';
    });
    gpx+='</trkseg></trk></gpx>';
    var blob=new Blob([gpx],{type:'application/gpx+xml'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a');
    a.href=url;
    a.download='trek-bawakaraeng-'+new Date().toISOString().slice(0,10)+'.gpx';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(url);},1500);
    _toast('Trek di-export: '+data.points.length+' points','ok');
  }

  // ====== CSS injeksi ======
  function injectCSS(){
    if(document.getElementById('bwkMapOfflineCSS'))return;
    var s=document.createElement('style');
    s.id='bwkMapOfflineCSS';
    s.textContent='.bwk-ctrl-btn{display:flex;align-items:center;gap:6px;background:#fff;border:1px solid #dfe7ec;border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:12px;font-weight:800;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.08);color:#172235;font-family:inherit;transition:transform .12s ease}.bwk-ctrl-btn:hover{background:#f7f9fb}.bwk-ctrl-btn:active{transform:scale(.97)}.bwk-ctrl-btn.bwk-ctrl-downloading{background:#2b6fff;color:#fff;border-color:#2b6fff}.bwk-ctrl-btn.bwk-ctrl-ready{background:#08b96f;color:#fff;border-color:#08b96f}.bwk-ctrl-btn.bwk-ctrl-error{background:#e53935;color:#fff;border-color:#e53935}.bwk-ctrl-btn.bwk-ctrl-stale{background:#ff9838;color:#fff;border-color:#ff9838}.bwk-ctrl-ic{font-size:14px}.bwk-ctrl-tx{font-size:12px}';
    document.head.appendChild(s);
  }

  // ====== Public API ======
  window.bwkMapOffline={
    addSaveAreaControl:buildSaveAreaButton,
    addUploadControl:buildUploadButton,
    addExportControl:buildExportButton,
    addToLayerControl:_addToLayerControl,
    injectCSS:injectCSS,
    _saveAreaFlow:saveAreaFlow,
    _uploadFlow:uploadFlow
  };

  // Auto-inject CSS when script loads
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',injectCSS);
  }else{
    injectCSS();
  }
})();
