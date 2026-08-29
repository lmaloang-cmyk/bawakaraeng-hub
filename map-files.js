/* map-files.js — Parser & renderer untuk file geospasial user-uploaded
 * Format didukung: GPX, KML, GeoJSON
 * Storage: localStorage key 'bwkMapFiles' (max ~5MB)
 * Render: tambah sebagai layer Leaflet, user bisa toggle on/off
 *
 * Dependensi eksternal: TIDAK ADA. Pakai native DOMParser & JSON.
 * Lisensi: internal Pintu Angin, RCS.CBS.
 */
(function(){
  'use strict';
  if(window.bwkMapFiles)return;
  var STORAGE_KEY='bwkMapFiles';
  var MAX_FILES=10;
  var MAX_POINTS_PER_FILE=2000;
  var FILE_COLORS=['#ff2d55','#08b96f','#2b6fff','#ff9838','#8b3dff','#12b6c9','#ff9a44','#43e8d8'];
  var _colorIdx=0;

  function _esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function _nextColor(){var c=FILE_COLORS[_colorIdx%FILE_COLORS.length];_colorIdx++;return c;}

  // ====== Parser: GPX ======
  function parseGPX(xmlText){
    var xml=new DOMParser().parseFromString(xmlText,'application/xml');
    var parseErr=xml.querySelector('parsererror');
    if(parseErr)throw new Error('File GPX tidak valid');
    var features=[];
    var name=xml.querySelector('trk > name, metadata > name');
    var docName=name?name.textContent:'Trek GPX';
    // Track points (polyline)
    var trkpts=xml.querySelectorAll('trkpt');
    if(trkpts.length>0){
      var coords=[];
      var pts=Array.prototype.slice.call(trkpts);
      pts.forEach(function(p){
        var lat=parseFloat(p.getAttribute('lat'));
        var lon=parseFloat(p.getAttribute('lon'));
        if(!isNaN(lat)&&!isNaN(lon)){
          var eleEl=p.querySelector('ele');
          var timeEl=p.querySelector('time');
          coords.push([lat,lon]);
          if(features.length<MAX_POINTS_PER_FILE){
            features.push({lat:lat,lng:lon,name:p.querySelector('name')?p.querySelector('name').textContent:'',ele:eleEl?parseFloat(eleEl.textContent):null,time:timeEl?timeEl.textContent:null});
          }
        }
      });
      features._polyline=coords;
      features._name=docName;
    }
    // Waypoints (markers)
    var wpts=xml.querySelectorAll('wpt');
    wpts.forEach(function(w){
      var lat=parseFloat(w.getAttribute('lat'));
      var lon=parseFloat(w.getAttribute('lon'));
      if(!isNaN(lat)&&!isNaN(lon)){
        features.push({lat:lat,lng:lon,name:w.querySelector('name')?w.querySelector('name').textContent:'Waypoint',isWaypoint:true});
      }
    });
    return {type:'gpx',name:docName,features:features};
  }

  // ====== Parser: KML ======
  function parseKML(xmlText){
    var xml=new DOMParser().parseFromString(xmlText,'application/xml');
    var parseErr=xml.querySelector('parsererror');
    if(parseErr)throw new Error('File KML tidak valid');
    var features=[];
    var docName=xml.querySelector('Document > name, kml > name');
    docName=docName?docName.textContent:'Trek KML';
    // Placemarks
    var pms=xml.querySelectorAll('Placemark');
    pms.forEach(function(pm){
      var name=pm.querySelector('name');
      var nameTxt=name?name.textContent:'Placemark';
      var lineEl=pm.querySelector('LineString coordinates, MultiGeometry LineString coordinates');
      if(lineEl){
        var raw=lineEl.textContent.trim();
        var tuples=raw.split(/\s+/);
        var coords=[];
        tuples.forEach(function(t){
          var parts=t.split(',');
          if(parts.length>=2){
            var lon=parseFloat(parts[0]),lat=parseFloat(parts[1]);
            if(!isNaN(lat)&&!isNaN(lon))coords.push([lat,lon]);
          }
        });
        if(coords.length>0){
          features._polyline=coords;
          features._name=docName+': '+nameTxt;
        }
      }
      var pointEl=pm.querySelector('Point coordinates');
      if(pointEl){
        var raw2=pointEl.textContent.trim();
        var parts2=raw2.split(',');
        if(parts2.length>=2){
          var lon2=parseFloat(parts2[0]),lat2=parseFloat(parts2[1]);
          if(!isNaN(lat2)&&!isNaN(lon2)){
            features.push({lat:lat2,lng:lon2,name:nameTxt,isWaypoint:true});
          }
        }
      }
    });
    return {type:'kml',name:docName,features:features};
  }

  // ====== Parser: GeoJSON ======
  function parseGeoJSON(jsonText){
    var data=JSON.parse(jsonText);
    if(!data||data.type!=='FeatureCollection'&&data.type!=='Feature'){
      throw new Error('File GeoJSON harus FeatureCollection atau Feature');
    }
    var features=data.features||[data];
    var collected=[];
    var polyline=null;
    var name=(data.name)||'GeoJSON';
    features.forEach(function(f){
      if(!f.geometry)return;
      var coords=f.geometry.coordinates;
      if(f.geometry.type==='LineString'){
        var lineCoords=coords.map(function(c){return[c[1],c[0]];});
        if(!polyline)polyline=lineCoords;
        if(f.properties&&f.properties.name){
          name=f.properties.name;
        }
      }else if(f.geometry.type==='Point'){
        collected.push({lat:coords[1],lng:coords[0],name:(f.properties&&f.properties.name)||'Point',isWaypoint:true});
      }else if(f.geometry.type==='MultiLineString'){
        coords.forEach(function(line){
          var lc=line.map(function(c){return[c[1],c[0]];});
          if(!polyline)polyline=lc;
        });
      }else if(f.geometry.type==='Polygon'){
        var ring=coords[0].map(function(c){return[c[1],c[0]];});
        if(!polyline)polyline=ring;
      }
    });
    collected._polyline=polyline;
    collected._name=name;
    return {type:'geojson',name:name,features:collected};
  }

  // ====== Format detection & dispatch ======
  function parseFile(filename,content){
    var ext=(filename.split('.').pop()||'').toLowerCase();
    var text=(content instanceof ArrayBuffer)?new TextDecoder().decode(content):String(content);
    if(ext==='gpx')return parseGPX(text);
    if(ext==='kml')return parseKML(text);
    if(ext==='geojson'||ext==='json')return parseGeoJSON(text);
    throw new Error('Format tidak didukung: .'+ext+'. Yang didukung: .gpx .kml .geojson .json');
  }

  // ====== Renderer: tambah layer ke Leaflet ======
  function renderOnMap(map,parsed,filename){
    if(!map||!parsed)return null;
    var color=_nextColor();
    var layerGroup=L.layerGroup();
    // Polyline (track)
    if(parsed.features._polyline&&parsed.features._polyline.length>1){
      var poly=L.polyline(parsed.features._polyline,{color:color,weight:4,opacity:.85}).addTo(layerGroup);
      try{map.fitBounds(poly.getBounds(),{padding:[30,30],maxZoom:16});}catch(e){}
    }
    // Markers (waypoints/points)
    parsed.features.forEach(function(f){
      if(f.isWaypoint){
        var icon=L.divIcon({className:'bwk-mf-waypoint',html:'<div style="background:'+color+';color:#fff;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">📍</div>',iconSize:[22,22],iconAnchor:[11,11]});
        L.marker([f.lat,f.lng],{icon:icon}).addTo(layerGroup).bindPopup('<b>'+_esc(f.name||'Waypoint')+'</b>');
      }
    });
    return {layer:layerGroup,name:parsed.name||filename,color:color};
  }

  // ====== Storage ======
  function list(){
    try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}
    catch(e){return [];}
  }
  function save(files){
    try{
      var json=JSON.stringify(files);
      if(json.length>5*1024*1024)throw new Error('File terlalu besar (max 5MB total)');
      localStorage.setItem(STORAGE_KEY,json);
      return true;
    }catch(e){
      if(window.toast)window.toast('Gagal simpan: '+e.message,'err');
      return false;
    }
  }
  function add(filename,parsed){
    var files=list();
    if(files.length>=MAX_FILES){
      if(window.toast)window.toast('Maksimal '+MAX_FILES+' file. Hapus yang lama dulu.','err');
      return false;
    }
    files.push({filename:filename,format:parsed.type,name:parsed.name,features:parsed.features,addedAt:Date.now()});
    return save(files);
  }
  function remove(idx){
    var files=list();
    files.splice(idx,1);
    return save(files);
  }
  function clear(){localStorage.removeItem(STORAGE_KEY);}

  // ====== Public API ======
  window.bwkMapFiles={
    parse:parseFile,
    render:renderOnMap,
    list:list,
    add:add,
    remove:remove,
    clear:clear,
    escape:_esc
  };
})();
