/* Mode Pendakian offline + progres jalur */
(function(){
var KEY='bwkHikeProgress',QKEY='bwkOfflineCheckins';
var _syncing=false,_lastCheckin=0;
function get(k,d){try{return JSON.parse(localStorage.getItem(k)||'null')||d}catch(e){return d}}
function put(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function route(){return window.jalurPos||[]}
function state(){return get(KEY,null)}
function mins(a,b){return Math.max(0,Math.round((b-a)/60000))}
function render(){var el=document.getElementById('hikeTracker');if(!el)return;var r=route(),s=state();if(!s){el.innerHTML='<div class="hike-card"><div><b>🥾 Mode Pendakian Offline</b><small>Simpan pos jalur, nomor SOS, checklist, dan panduan tersesat di perangkat.</small></div><button onclick="hikeStart()">Mulai Pendakian</button></div>';return}var i=Math.min(s.i||0,r.length-1),cur=r[i],next=r[i+1],done=Math.round(i/(r.length-1)*100),ago=mins(s.last||s.started,Date.now()),eta=next?Math.max(15,Math.round((next.el-cur.el)/6+35)):0;el.innerHTML='<div class="hike-card active"><div class="hike-head"><div><span>🥾 Pendakian Aktif · Offline siap</span><b>'+cur.n+'</b><small>'+cur.el+' mdpl · check-in '+ago+' menit lalu</small></div><strong>'+done+'%</strong></div><div class="hike-bar"><i style="width:'+done+'%"></i></div><div class="hike-next">'+(next?'Berikutnya: <b>'+next.n+'</b> · sekitar '+eta+' menit · '+next.el+' mdpl':'🎉 Anda di puncak. Tetap prioritaskan keselamatan untuk turun.')+'</div><div class="hike-actions"><button onclick="hikeCheckin()"'+(_lastCheckin>0&&Date.now()-_lastCheckin<5000?' disabled style="opacity:0.5"':'')+'>✓ Check-in '+cur.n+'</button><button class="alt" onclick="hikeOfflineGuide()">📴 Panduan Offline</button></div><small class="hike-note">Antrean: '+get(QKEY,[]).length+' check-in akan dikirim saat internet kembali.</small></div>'}
window.hikeStart=function(){var r=route();if(!r.length){toast('Data jalur belum siap','err');return}put(KEY,{i:0,started:Date.now(),last:Date.now()});render();toast('Mode pendakian dimulai · data tersimpan offline','ok')}
window.hikeCheckin=function(){var now=Date.now();if(now-_lastCheckin<5000){toast('Tunggu beberapa detik sebelum check-in lagi','warn');return;}_lastCheckin=now;var s=state(),r=route();if(!s)return;var row={pos:r[s.i].n,alt:r[s.i].el,at:new Date().toISOString()};s.last=now;if(s.i<r.length-1)s.i++;put(KEY,s);var q=get(QKEY,[]);q.push(row);put(QKEY,q);try{localStorage.setItem('bwkTrailCheckins',String((+localStorage.getItem('bwkTrailCheckins')||0)+1))}catch(e){};render();if(!_syncing)sync();toast('Check-in tersimpan '+(navigator.onLine?'dan disinkronkan':'offline'),'ok')}
function sync(){
  if(_syncing)return;
  _syncing=true;
  if(!navigator.onLine){_syncing=false;return;}
  var q=get(QKEY,[]);
  if(!q.length){_syncing=false;return;}
  // Clone queue sebelum clear agar bisa rollback jika gagal
  var snapshot=JSON.parse(JSON.stringify(q));
  // Clear queue SEKARANG juga agar tidak double-sync
  put(QKEY,[]);
  render();
  var c=null;
  try{if(typeof _sbClient==='function')c=_sbClient();}catch(e){}
  if(!c){put(QKEY,snapshot);_syncing=false;return;}
  c.auth.getUser().then(function(u){
    if(!(u&&u.data&&u.data.user))throw new Error('Not authenticated');
    var rows=snapshot.map(function(x){return {position:x.pos,altitude:x.alt,checked_in_at:x.at,user_id:u.data.user.id}});
    return c.from('hike_checkins').insert(rows);
  }).then(function(data,error){
    if(error){
      // Rollback jika gagal
      put(QKEY,snapshot);
      throw error;
    }
  }).catch(function(err){
    console.warn('[HIKE] Sync failed, queue restored:',err?err.message:'unknown error');
  }).finally(function(){_syncing=false;})
}
window.hikeOfflineGuide=function(){var html='<h2>📴 Mode Offline Pendakian</h2><p>Data berikut tetap tersedia di perangkat: peta jalur, nomor SOS, checklist, dan panduan tersesat di perangkat.</p><div class="sknotice warn"><b>Jika tersesat:</b><br>Berhenti, hemat baterai, tetap di jalur terakhir yang dikenal, aktifkan SOS saat ada sinyal, dan jangan berpindah sendiri tanpa arah.</div><div class="sknotice ok"><b>Nomor SOS</b><br>Gunakan tombol SOS aplikasi untuk mengirim koordinat GPS saat sinyal tersedia.</div>';document.getElementById('sheetBody').innerHTML=html;openSheet()}
window.addEventListener('online',sync);window.addEventListener('load',function(){setTimeout(render,200)});window.renderHikeTracker=render;
var css='.hike-card{margin:12px 0;padding:14px;border-radius:17px;background:linear-gradient(135deg,#e8f5ee,#e5f0ff);border:1px solid #cbded5;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:space-between;gap:12px}.hike-card b,.hike-card small{display:block}.hike-card b{font-size:14px;color:#173d30}.hike-card small{font-size:11px;color:#526b61;margin-top:3px}.hike-card button{border:0;border-radius:11px;background:#26705a;color:#fff;padding:10px 12px;font-weight:800;white-space:nowrap}.hike-card.active{display:block;background:linear-gradient(135deg,#173d30,#1d5362);color:#fff;border:0}.hike-head{display:flex;justify-content:space-between;gap:10px}.hike-head span,.hike-head small{color:#d4eee0;font-size:11px}.hike-head b{color:#fff;font-size:17px;margin-top:3px}.hike-head strong{font-size:22px}.hike-bar{height:7px;border-radius:8px;background:rgba(255,255,255,.24);margin:12px 0 9px;overflow:hidden}.hike-bar i{display:block;height:100%;background:#78e1ad;border-radius:8px}.hike-next{font-size:12px;color:#e8f4ee}.hike-actions{display:flex;gap:8px;margin-top:12px}.hike-actions button{flex:1}.hike-actions .alt{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25)}.hike-note{color:#c9ded3!important;margin-top:9px}';var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
})();