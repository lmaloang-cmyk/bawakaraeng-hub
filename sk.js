/* SIMAKSI Online (standalone) - adaptasi alur e-SIMAKSI + notifikasi WhatsApp + kode PNBP */
(function(){
  var css=`
  .skbanner{width:100%;display:flex;align-items:center;gap:12px;background:linear-gradient(120deg,#3a37d4,#6b5cff);color:#fff;border:none;border-radius:16px;padding:14px 16px;margin:2px 0 14px;cursor:pointer;box-shadow:0 6px 18px rgba(80,70,220,.28);text-align:left}
  .skbanner .skb-ic{font-size:26px}
  .skbanner .skb-tx{flex:1;display:flex;flex-direction:column}
  .skbanner .skb-tx b{font-size:15px}
  .skbanner .skb-tx small{font-size:11px;opacity:.92;line-height:1.3;margin-top:2px}
  .skbanner .skb-go{font-size:22px;opacity:.85}
  .sktabs{display:flex;gap:8px;margin-bottom:12px}
  .sktab{flex:1;border:1px solid var(--line,#e6e9ef);background:var(--card,#fff);border-radius:12px;padding:9px 6px;font-weight:700;font-size:12px;color:var(--sub,#667);cursor:pointer}
  .sktab.on{background:var(--g-indigo,#4b47e6);color:#fff;border-color:transparent}
  .skprog{display:flex;gap:6px;margin-bottom:12px}
  .skprog span{flex:1;text-align:center;font-size:11px;font-weight:700;color:#98a2b3;padding:6px 2px;border-radius:8px;background:#f1f3f8}
  .skprog .on{background:var(--g-indigo,#4b47e6);color:#fff}
  .skprog .done{background:#d8f5e6;color:#0a8a52}
  .skroute{display:flex;align-items:center;gap:10px;border:1.5px solid #e6e9ef;border-radius:14px;padding:10px 12px;margin:6px 0;cursor:pointer}
  .skroute.on{border-color:var(--g-indigo,#4b47e6);background:#f2f1ff}
  .skroute .skr-ic{font-size:22px}
  .skroute .skr-tx{flex:1;display:flex;flex-direction:column}
  .skroute .skr-tx small{color:#8b98ad;font-size:11px}
  .skroute .skr-rd{font-size:18px;color:var(--g-indigo,#4b47e6)}
  .skdrop{display:flex;align-items:center;justify-content:center;text-align:center;min-height:120px;border:1.5px dashed #c3cad6;border-radius:14px;color:#8b98ad;font-size:13px;cursor:pointer;padding:10px;overflow:hidden}
  .skdrop img{max-width:100%;max-height:220px;border-radius:10px}
  .skbtns{display:flex;gap:8px;margin-top:6px}
  .skbtns .btn{flex:1}
  .btn.gh{background:#eef1f6;color:#42506b}
  .fhint{display:block;color:#8b98ad;font-size:11px;margin-top:4px}
  .skreq{margin:8px 0 12px;padding-left:18px}
  .skreq li{font-size:12.5px;color:#54617a;margin:4px 0}
  .skchk{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#42506b;margin:6px 0}
  .skchk input{margin-top:2px}
  .sktl{display:flex;justify-content:space-between;margin:12px 0}
  .sktl-i{flex:1;text-align:center}
  .sktl-i .sktl-d{display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;border-radius:50%;background:#eef1f6;font-size:14px}
  .sktl-i .sktl-l{display:block;font-size:10px;color:#98a2b3;margin-top:4px;font-weight:600}
  .sktl-i.done .sktl-d{background:#d8f5e6}
  .sktl-i.on .sktl-d{background:var(--g-indigo,#4b47e6);color:#fff}
  .sktl-i.on .sktl-l{color:var(--g-indigo,#4b47e6)}
  .skbox{background:#f4f7fb;border-radius:12px;padding:12px;font-size:12.5px;color:#42506b;margin-top:4px}
  .skbox b{font-size:13px}
  .skbox small{display:block;color:#8b98ad;margin-top:6px;font-size:11px}
  .skbox .pdet{display:flex;justify-content:space-between;font-size:12.5px;margin:5px 0}
  .skbox.pay{background:#fff7e8;border:1px solid #ffe2ad}
  .skbox.err{background:#ffeef0;color:#c0333c}
  .skstat{background:var(--card,#fff);border:1px solid #eef1f5;border-radius:16px;padding:14px;margin:10px 0}
  .skstat-h{display:flex;justify-content:space-between;align-items:baseline}
  .skstat-h small{color:#8b98ad;font-size:11px}
  .skmy-hero{background:linear-gradient(135deg,#3935cd,#6b5cff);color:#fff;border-radius:16px;padding:15px;margin:2px 0 12px;box-shadow:0 8px 20px rgba(75,71,230,.2)}
  .skmy-hero h3{font-size:16px;margin:0 0 4px}.skmy-hero p{font-size:12px;line-height:1.45;margin:0;opacity:.92}
  .skstat-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.skstat-meta div{background:#f4f7fb;border-radius:10px;padding:8px 9px}.skstat-meta small{display:block;color:#8b98ad;font-size:10px;margin-bottom:2px}.skstat-meta b{font-size:12px;color:#26334b;word-break:break-word}
  .skstat-badge{font-size:11px;font-weight:800;padding:4px 8px;border-radius:20px;background:#eef1f6;color:#54617a}.skstat-badge.ok{background:#d8f5e6;color:#087e4b}.skstat-badge.wait{background:#fff0c9;color:#916300}.skstat-badge.no{background:#ffe0e3;color:#c0333c}
  .sknotice{border-radius:12px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:1.45}.sknotice.ok{background:#e8f8ef;color:#087e4b}.sknotice.warn{background:#fff7e8;color:#7c5800}.sknotice.err{background:#ffeef0;color:#b4232c}
  .skproof{margin-top:10px;padding:12px;border:1px dashed #bac4d5;border-radius:12px;background:#f8faff}.skproof b{font-size:13px}.skproof p{font-size:11.5px;line-height:1.4;color:#65728a;margin:5px 0 9px}.skproof-preview{width:100%;max-height:220px;object-fit:contain;background:#fff;border-radius:9px;border:1px solid #e4e9f0;margin:8px 0}.skproof input{display:none}.skproof-label{display:flex;min-height:42px;align-items:center;justify-content:center;border-radius:10px;background:#e9edff;color:#3733c8;font-size:12px;font-weight:800;cursor:pointer;padding:0 12px;text-align:center}.skproof .btn{margin-top:8px}.skproof-admin{margin:10px 0 0}.skproof-admin img{width:100%;max-width:210px;max-height:240px;object-fit:contain;border-radius:10px;border:1px solid #e0e6ef;background:#fff;cursor:zoom-in}
  .skflow{margin-top:8px}
  .skflow-i{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f6}
  .skflow-n{flex:none;width:24px;height:24px;border-radius:50%;background:var(--g-indigo,#4b47e6);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:700}
  .skflow-i small{display:block;color:#8b98ad;font-size:11.5px;margin-top:1px}
  .abadge{font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;background:#eef1f6;color:#54617a}
  .abadge.ok{background:#d8f5e6;color:#0a8a52}
  .abadge.no{background:#ffe0e3;color:#c0333c}
  `;
  try{var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);}catch(e){}
})();

var SK_TARIF={lembanna:{label:'Via Lembanna',price:75000,dur:'2 hari 1 malam'},lembang:{label:'Via Lembang Bu ne',price:95000,dur:'3 hari 2 malam'}};
var _skTab='ajukan';
function _skEsc(v){return (typeof window.escapeHtml==='function'?window.escapeHtml(v):String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;'));}
function _skAsset(v){return (typeof window.safeReportPhoto==='function'?window.safeReportPhoto(v):'');}

var _skStep=1;
var _skForm={};
var _skKtp='';var _skKtpReady=false;var _skKtpFile=null;
var _skDoc='';var _skDocReady=false;var _skDocFile=null;
var _skRows=[];
var _skPaymentDraft={};
var _skStatusSyncing=false;

function _waNorm(n){n=(''+(n||'')).replace(/[^0-9]/g,'');if(n.indexOf('62')===0)return n;if(n.indexOf('0')===0)return '62'+n.slice(1);if(n.indexOf('8')===0)return '62'+n;return n;}

function skGo(tab){_skTab=tab;['ajukan','status','info'].forEach(function(x){var b=document.getElementById('sktab-'+x);if(b)b.classList.toggle('on',x===tab);});renderSimaksi();}

function _skLastCode(){try{return localStorage.getItem('bwkLastSimaksiCode')||'';}catch(e){return '';}}

function renderSimaksi(){var a=document.getElementById('skApp');if(!a)return;if(_skTab==='status'){a.innerHTML=_skStatusHtml();_skSyncMyStatus();}else if(_skTab==='info'){a.innerHTML=_skInfoHtml();}else{a.innerHTML=_skStepHtml();}}
function _skMergeServerRows(serverRows){
  try{var local=_lsGet('bwkSimaksi',[]),map={};local.forEach(function(r){if(r&&r.code)map[r.code]=r;});(serverRows||[]).forEach(function(r){if(r&&r.code)map[r.code]=Object.assign({},map[r.code]||{},r);});var merged=Object.keys(map).map(function(k){return map[k];});merged.sort(function(a,b){return String(b.created_at||b.ts||'').localeCompare(String(a.created_at||a.ts||''));});_lsSet('bwkSimaksi',merged);return merged;}catch(e){return serverRows||[];}
}
function _skSyncMyStatus(){
  if(_skStatusSyncing)return;var c=(typeof _sbClient==='function')?_sbClient():null;if(!c)return;_skStatusSyncing=true;
  c.auth.getUser().then(function(ur){var u=ur&&ur.data&&ur.data.user;if(!u)throw new Error('Belum login');return c.from('simaksi').select('*').order('created_at',{ascending:false});}).then(function(res){if(res&&res.error)throw res.error;_skMergeServerRows((res&&res.data)||[]);if(_skTab==='status'){var a=document.getElementById('skApp');if(a)a.innerHTML=_skStatusHtml();}}).catch(function(){}).finally(function(){_skStatusSyncing=false;});
}

function _skSave(){['nama','wa','jml','org','naik','turun'].forEach(function(id){var el=document.getElementById('sk-'+id);if(el)_skForm[id]=el.value;});}

function skSetRoute(k){_skSave();_skForm.jalur=k;renderSimaksi();}

function skNext(){_skSave();var f=_skForm;if(_skStep===1){if(!f.nama){toast('Isi nama ketua rombongan','err');return;}if(!f.wa||_waNorm(f.wa).length<10){toast('Isi nomor WhatsApp yang valid','err');return;}if(!f.jalur){toast('Pilih jalur pendakian','err');return;}if(!f.naik||!f.turun){toast('Isi tanggal naik dan turun','err');return;}if(f.turun<=f.naik){toast('Tanggal turun harus setelah naik','err');return;}}if(_skStep===2){if(!_skKtp){toast('Unggah foto KTP/identitas dulu','err');return;}}if(_skStep<3)_skStep++;renderSimaksi();}

function skPrev(){_skSave();if(_skStep>1)_skStep--;renderSimaksi();}

function skUpload(inp,which){if(!(inp.files&&inp.files[0]))return;var f=inp.files[0];_skSave();if(which==='ktp'){_skKtpFile=f;_skKtpReady=false;}else{_skDocFile=f;_skDocReady=false;}if(window.toast)toast('Memproses gambar...','ok');_compressImg(f,function(d){if(!d){try{var fr=new FileReader();fr.onload=function(){_skSet(which,fr.result||'');};fr.onerror=function(){_skSet(which,'');};fr.readAsDataURL(f);return;}catch(e){}}_skSet(which,d);});}

function _skSet(which,d){if(which==='ktp'){_skKtp=d;_skKtpReady=true;}else{_skDoc=d;_skDocReady=true;}renderSimaksi();}

function _skStepHtml(){
  var f=_skForm;var s=_skStep;
  var head=`<div class='skprog'>`+[1,2,3].map(function(n){var lbl=['Data','Berkas','Pernyataan'][n-1];return `<span class='skp${n===s?' on':''}${n<s?' done':''}'>${n}. ${lbl}</span>`;}).join('')+`</div>`;
  if(s===1){
    var opt=function(k){var t=SK_TARIF[k];var on=f.jalur===k;return `<div class='skroute${on?' on':''}' onclick='skSetRoute(&#39;${k}&#39;)'><div class='skr-ic'>${k==='lembanna'?'🥾':'⛰️'}</div><div class='skr-tx'><b>${t.label}</b><small>${t.dur} · PNBP ${_rupiah(t.price)}/org</small></div><div class='skr-rd'>${on?'●':'○'}</div></div>`;};
    return head+`<div class='form-card'><div class='fld'><label>Nama Ketua Rombongan</label><input id='sk-nama' value='${f.nama||''}' placeholder='Nama sesuai KTP'/></div><div class='fld'><label>No. WhatsApp Aktif</label><input id='sk-wa' value='${f.wa||''}' placeholder='08xxxxxxxxxx' inputmode='numeric'/><small class='fhint'>Notifikasi status, kode pembayaran, dan dokumen dikirim ke nomor ini.</small></div><div class='frow'><div class='fld'><label>Jumlah Anggota</label><input id='sk-jml' type='number' min='1' value='${f.jml||'1'}'/></div><div class='fld'><label>Asal / Organisasi</label><input id='sk-org' value='${f.org||''}' placeholder='Komunitas / kampus'/></div></div><label class='fld'>Pilih Jalur</label>${opt('lembanna')}${opt('lembang')}<div class='frow'><div class='fld'><label>Tanggal Naik</label><input id='sk-naik' type='date' value='${f.naik||''}'/></div><div class='fld'><label>Tanggal Turun</label><input id='sk-turun' type='date' value='${f.turun||''}'/></div></div><button class='btn g-indigo' onclick='skNext()'>Lanjut ke Berkas ›</button></div>`;
  }
  if(s===2){
    var kp=_skKtp?`<img src='${_skKtp}' style='cursor:zoom-in' onclick='openImg(this.src)'/>`:`📷 Ketuk untuk pilih foto KTP / identitas`;
    var dp=_skDoc?`<img src='${_skDoc}' style='cursor:zoom-in' onclick='openImg(this.src)'/>`:`📄 Ketuk untuk unggah surat / proposal (opsional)`;
    return head+`<div class='form-card'><div class='fld'><label>Foto KTP / Identitas Ketua <span style='color:#e5484d'>*</span></label><label class='skdrop' for='sk-ktp-inp'>${kp}</label><input id='sk-ktp-inp' type='file' accept='image/*' style='display:none' onchange='skUpload(this,&#39;ktp&#39;)'/></div><div class='fld'><label>Surat Pengantar / Proposal (opsional)</label><label class='skdrop' for='sk-doc-inp'>${dp}</label><input id='sk-doc-inp' type='file' accept='image/*' style='display:none' onchange='skUpload(this,&#39;doc&#39;)'/><small class='fhint'>Foto/scan surat permohonan atau proposal kegiatan yang jelas dan terbaca.</small></div><div class='skbtns'><button class='btn gh' onclick='skPrev()'>‹ Kembali</button><button class='btn g-indigo' onclick='skNext()'>Lanjut ›</button></div></div>`;
  }
  var req=['KTP / identitas ketua rombongan','Nomor WhatsApp aktif untuk notifikasi','Kesediaan membayar PNBP sesuai jalur','Mematuhi kuota, jalur resmi dan tata tertib kawasan','Membawa turun kembali seluruh sampah','Melapor kondisi darurat melalui tombol SOS'];
  return head+`<div class='form-card'><b style='font-size:13px'>Surat Pernyataan Pemohon</b><ul class='skreq'>${req.map(function(x){return `<li>${x}</li>`;}).join('')}</ul><label class='skchk'><input type='checkbox' id='sk-setuju'/> <span>Saya menyatakan data dan berkas yang saya isi benar, serta menyanggupi seluruh ketentuan di atas.</span></label><div class='skbtns'><button class='btn gh' onclick='skPrev()'>‹ Kembali</button><button class='btn g-indigo' id='skSubmitBtn' onclick='skSubmit()'>🎫 Kirim Pengajuan</button></div><p class='note'>Setelah dikirim, pengajuan diverifikasi Tim Reichas Chelebes. Kode pembayaran PNBP dikirim via WhatsApp sebelum dokumen resmi terbit.</p></div>`;
}

function skSubmit(){
  _skSave();var f=_skForm;
  if(!f.nama){toast('Isi nama ketua','err');_skStep=1;renderSimaksi();return;}
  if(!f.wa||_waNorm(f.wa).length<10){toast('Isi nomor WhatsApp yang valid','err');_skStep=1;renderSimaksi();return;}
  if(!f.jalur){toast('Pilih jalur pendakian','err');_skStep=1;renderSimaksi();return;}
  if(!f.naik||!f.turun){toast('Isi tanggal naik dan turun','err');_skStep=1;renderSimaksi();return;}
  if(f.turun<=f.naik){toast('Tanggal turun harus setelah naik','err');_skStep=1;renderSimaksi();return;}
  if(!_skKtp){toast('Unggah foto KTP/identitas dulu','err');_skStep=2;renderSimaksi();return;}
  var cb=document.getElementById('sk-setuju');if(!cb||!cb.checked){toast('Centang persetujuan pernyataan dulu','err');return;}
  var code=_rid('SMK-');var jml=(+f.jml||1);var tar=SK_TARIF[f.jalur]||SK_TARIF.lembanna;var amount=tar.price*jml;
  var row={code:code,nama:f.nama,wa:_waNorm(f.wa),jml:jml,org:f.org||'-',jalur:tar.label,naik:f.naik,turun:f.turun,ktp:_skKtp,doc:_skDoc||'',stage:'diajukan',astatus:'baru',pnbp_amount:amount,pnbp_code:''};
  try{if(typeof _lsSet==='function'){var arr=_lsGet('bwkSimaksi',[]);arr.unshift(Object.assign({ts:Date.now()},row));_lsSet('bwkSimaksi',arr);}localStorage.setItem('bwkLastSimaksiCode',code);}catch(e){}
  var btn=document.getElementById('skSubmitBtn');if(btn){btn.disabled=true;btn.textContent='Mengirim...';}
  function after(ok,err){
    _skForm={};_skKtp='';_skDoc='';_skKtpReady=false;_skDocReady=false;_skStep=1;_skTab='status';
    ['ajukan','status','info'].forEach(function(x){var bb=document.getElementById('sktab-'+x);if(bb)bb.classList.toggle('on',x==='status');});
    var a=document.getElementById('skApp');if(!a)return;
    var msg='Halo Tim Reichas Chelebes, saya mengajukan SIMAKSI. Kode: '+code+' - Ketua: '+f.nama+' - '+jml+' org - '+tar.label+' - Naik '+f.naik+' s/d '+f.turun+' - WA saya: '+_waNorm(f.wa)+'. Mohon verifikasi. Terima kasih.';
    var waAdmin='https://wa.me/'+_rcWA()+'?text='+encodeURIComponent(msg);
    var sync=ok?`<div class='sknotice ok'>✅ Pengajuan berhasil tersimpan di server. Kami akan mengirim pembaruan ke WhatsApp ${_skEsc(_waNorm(f.wa))}.</div>`:`<div class='sknotice warn'>⚠️ Pengajuan tersimpan di perangkat ini, tetapi belum tersinkron ke server${err?': '+_skEsc(err):''}. Kirim detail ke petugas via WhatsApp agar tetap diproses.</div>`;
    a.innerHTML=`<div class='permit sk-ok'><h4>${ok?'✅ Pengajuan Berhasil Dikirim':'⚠️ Pengajuan Belum Tersinkron'}</h4><small>Nomor pengajuan — simpan atau screenshot</small><div class='code'>${_skEsc(code)}</div><div class='pdet'><span>Status awal</span><b>Menunggu Verifikasi</b></div><div class='pdet'><span>Ketua</span><b>${_skEsc(f.nama)}</b></div><div class='pdet'><span>Jalur</span><b>${_skEsc(tar.label)}</b></div><div class='pdet'><span>Estimasi PNBP</span><b>${_skEsc(_rupiah(amount))}</b></div></div>${sync}<a class='btn' style='background:#25D366;color:#fff;display:block;text-decoration:none;text-align:center;margin-top:10px' href='${waAdmin}' target='_blank' rel='noopener'>📲 Kirim Detail ke Petugas via WhatsApp</a><p class='note'>Verifikasi maksimal 1×24 jam pada hari kerja. Kode PNBP dan dokumen terbit dapat dilihat di menu SIMAKSI Saya.</p><button class='btn gh' onclick='skGo(&#39;status&#39;)'>👤 Buka SIMAKSI Saya</button>`;
    if(window.toast)toast(ok?'Pengajuan berhasil dikirim.':'Pengajuan tersimpan lokal — hubungi petugas. ',ok?'ok':'err');
  }
  if(typeof sbInsert==='function'){sbInsert('simaksi',row).then(function(res){after(res&&res.ok,res&&res.error&&res.error.message);}).catch(function(e){after(false,(e&&e.message)||'');});}else{after(false,'offline');}
}

function _skStageIdx(s){var m={diajukan:0,diverifikasi:1,menunggu_konfirmasi:1,dibayar:2,terbit:3};return (m[s]===undefined)?0:m[s];}

function _skLocalPatch(code,patch){try{var rows=_lsGet('bwkSimaksi',[]);for(var i=0;i<rows.length;i++){if(rows[i]&&rows[i].code===code){Object.assign(rows[i],patch);_lsSet('bwkSimaksi',rows);return rows[i];}}}catch(e){}return null;}
function skPaymentPick(inp,code){if(!(inp&&inp.files&&inp.files[0]))return;var f=inp.files[0],ok=['image/jpeg','image/png','image/webp'].indexOf((f.type||'').toLowerCase())>=0;if(!ok){inp.value='';toast('Bukti harus berupa JPEG, PNG, atau WebP','err');return;}if(f.size>5*1024*1024){inp.value='';toast('Ukuran bukti maksimal 5 MB','err');return;}toast('Memproses bukti pembayaran...','ok');_compressImg(f,function(data){if(!data){toast('Bukti pembayaran tidak dapat diproses','err');return;}if(data.length>1500000){toast('Bukti terlalu besar. Gunakan foto yang lebih jelas dan ringkas','err');return;}_skPaymentDraft[code]=data;renderSimaksi();});}
function skPaymentSubmit(code){var proof=_skPaymentDraft[code];if(!proof){toast('Pilih foto bukti pembayaran terlebih dahulu','err');return;}var c=(typeof _sbClient==='function')?_sbClient():null;var done=function(ok,msg){if(ok){_skLocalPatch(code,{stage:'menunggu_konfirmasi',payment_proof:proof,payment_submitted_at:new Date().toISOString()});delete _skPaymentDraft[code];renderSimaksi();toast('Bukti dikirim. Menunggu konfirmasi petugas','ok');}else{toast(msg||'Gagal mengirim bukti. Coba lagi atau hubungi petugas','err');}};if(!c){done(true);return;}c.rpc('submit_simaksi_payment',{p_code:code,p_payment_proof:proof}).then(function(res){if(res&&res.error){done(false,res.error.message);return;}done(true);}).catch(function(){done(false);});}


function _skStatusHtml(){
  var arr=[];try{arr=_lsGet('bwkSimaksi',[]);}catch(e){}
  var last=_skLastCode();
  var lookup=`<div class='skmy-hero'><h3>👤 SIMAKSI Saya</h3><p>Lihat nomor pengajuan, status terbaru, kode PNBP, dan dokumen SIMAKSI yang sudah terbit.</p></div><div class='form-card'><div class='fld'><label>Cari Nomor Pengajuan</label><div class='frow' style='gap:8px'><input id='sk-cek' value='${_skEsc(last)}' placeholder='SMK-XXXXX' style='flex:1;text-transform:uppercase'/><button class='btn g-indigo' style='width:auto;padding:0 16px' onclick='skCek()'>Cek</button></div><small class='fhint'>Masukkan nomor pengajuan jika membuka aplikasi dari perangkat lain.</small></div><div id='skCekRes'></div></div><div class='form-card'><div class='fld'><label>🪪 Cek Status Kelayakan Mendaki</label><div class='frow' style='gap:8px'><input id='sk-ktp-check' inputmode='numeric' maxlength='16' placeholder='Masukkan No. KTP · 16 digit' style='flex:1'/><button class='btn g-indigo' style='width:auto;padding:0 16px' onclick='skCheckEligibility()'>Cek</button></div><small class='fhint'>Hasil hanya menampilkan status kelayakan, tanpa nama atau alasan pelanggaran.</small></div><div id='skKtpCheckRes'></div></div>`;
  var list='';
  if(arr&&arr.length){list=`<div class='sh'><span class='bar' style='background:var(--g-indigo,#4b47e6)'></span><h3>Pengajuan di Perangkat Ini</h3></div>`+arr.map(function(r){return _skStatusCard(r);}).join('');}
  else{list=`<div class='aempty' style='text-align:center;color:#8b98ad;padding:20px'>Belum ada SIMAKSI tersimpan di perangkat ini. Masukkan nomor pengajuan untuk melihat status.</div>`;}
  return lookup+list;
}

function skCek(){
  var v=(document.getElementById('sk-cek').value||'').trim().toUpperCase();var res=document.getElementById('skCekRes');if(!res)return;
  if(!v){res.innerHTML='';return;}
  res.innerHTML=`<div class='aempty'>Mencari...</div>`;
  var c=(typeof _sbClient==='function')?_sbClient():null;
  if(!c){var arr=[];try{arr=_lsGet('bwkSimaksi',[]);}catch(e){}var hit=arr.filter(function(x){return (x.code||'').toUpperCase()===v;})[0];res.innerHTML=hit?_skStatusCard(hit):`<div class='aempty'>Kode tidak ditemukan di perangkat ini.</div>`;return;}
  c.from('simaksi').select('*').eq('code',v).limit(1).then(function(r){if(r.error||!r.data||!r.data.length){res.innerHTML=`<div class='aempty'>Kode tidak ditemukan.</div>`;return;}res.innerHTML=_skStatusCard(r.data[0]);}).catch(function(){res.innerHTML=`<div class='aempty'>Gagal memuat.</div>`;});
}

function skCheckEligibility(){
  var input=document.getElementById('sk-ktp-check'),res=document.getElementById('skKtpCheckRes');if(!input||!res)return;
  var ktp=(input.value||'').replace(/\D/g,'');if(ktp.length!==16){res.innerHTML=`<div class='sknotice err'>Masukkan No. KTP yang terdiri dari 16 digit.</div>`;return;}
  var c=(typeof _sbClient==='function')?_sbClient():null;if(!c){res.innerHTML=`<div class='sknotice warn'>Sambungkan internet untuk memeriksa status kelayakan mendaki.</div>`;return;}
  res.innerHTML=`<div class='aempty'>Memeriksa status…</div>`;
  c.rpc('check_climbing_eligibility',{p_identity_number:ktp}).then(function(r){if(r&&r.error)throw r.error;var row=(r&&r.data&&r.data[0])||null;if(!row)throw new Error('Status tidak tersedia');if(row.is_allowed){res.innerHTML=`<div class='sknotice ok'><b>✅ Bebas Mendaki</b><br/>No. KTP ini tidak tercatat dalam daftar larangan mendaki aktif. Tetap wajib mengajukan SIMAKSI dan mematuhi tata tertib kawasan.</div>`;return;}var until=row.expires_at?(' Larangan berlaku sampai '+new Date(row.expires_at).toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})+'.'):' Larangan berlaku permanen hingga ada keputusan pencabutan.';res.innerHTML=`<div class='sknotice err'><b>⛔ Masuk Daftar Larangan Mendaki</b><br/>No. KTP ini belum dapat mengajukan SIMAKSI.`+until+`</div>`;}).catch(function(){res.innerHTML=`<div class='sknotice err'>Status tidak dapat diperiksa. Coba lagi atau hubungi petugas.</div>`;});
}

function _skStatusCard(r){
  var stage=r.stage||'diajukan';var rej=(stage==='ditolak'||r.astatus==='ditolak');
  var steps=[['diajukan','Diajukan','📨'],['diverifikasi','Verifikasi + PNBP','✅'],['dibayar','Pembayaran','💰'],['terbit','Terbit','🎫']];
  var cur=_skStageIdx(stage);
  var tl=`<div class='sktl'>`+steps.map(function(sp,i){var st=rej?'':(i<cur?'done':(i===cur?'on':''));return `<div class='sktl-i ${st}'><span class='sktl-d'>${i<cur?'✓':sp[2]}</span><span class='sktl-l'>${sp[1]}</span></div>`;}).join('')+`</div>`;
  var amt=r.pnbp_amount?_rupiah(r.pnbp_amount):'-';var body='';
  var statusText=rej?'Ditolak':(stage==='terbit'?'Dokumen Terbit':(stage==='dibayar'?'Pembayaran Dikonfirmasi':(stage==='menunggu_konfirmasi'?'Bukti Sedang Dicek':(stage==='diverifikasi'?'Menunggu Pembayaran':'Menunggu Verifikasi'))));
  var statusClass=rej?'no':(stage==='terbit'?'ok':(stage==='diverifikasi'||stage==='menunggu_konfirmasi'||stage==='dibayar'?'wait':''));
  if(rej){body=`<div class='sknotice err'>❌ Pengajuan belum dapat disetujui. Hubungi petugas via WhatsApp untuk mengetahui dokumen atau data yang perlu diperbaiki.</div>`;}
  else if(stage==='diverifikasi'){var draft=_skPaymentDraft[r.code||''];var preview=draft?`<img class='skproof-preview' src='${_skEsc(draft)}' alt='Pratinjau bukti pembayaran'/>`:'';var inputId='sk-pay-'+String(r.code||'x').replace(/[^a-zA-Z0-9_-]/g,'');body=`<div class='skbox pay'><b>💰 Menunggu Pembayaran PNBP</b><div class='pdet'><span>Kode Pembayaran</span><b>${_skEsc(r.pnbp_code||'-')}</b></div><div class='pdet'><span>Jumlah</span><b>${_skEsc(amt)}</b></div><div class='pdet'><span>Tujuan</span><b>GoPay 082320124040 a.n Reichas Chelebes</b></div><small>Transfer sesuai jumlah dan kode pembayaran. Setelah itu, unggah bukti di bawah agar petugas dapat memeriksa pembayaran.</small></div><div class='skproof'><b>📎 Unggah Bukti Pembayaran</b><p>Gunakan screenshot atau foto bukti transfer yang jelas. Format JPEG, PNG, atau WebP · maksimal 5 MB.</p>${preview}<label class='skproof-label' for='${inputId}'>${draft?'↻ Ganti Foto Bukti':'📷 Pilih Foto Bukti'}</label><input id='${inputId}' type='file' accept='image/jpeg,image/png,image/webp' onchange='skPaymentPick(this,${JSON.stringify(String(r.code||''))})'/><button class='btn g-indigo' ${draft?'':'disabled'} onclick='skPaymentSubmit(${JSON.stringify(String(r.code||''))})'>${draft?'📤 Kirim Bukti ke Petugas':'Pilih Foto Terlebih Dahulu'}</button></div>`;}
  else if(stage==='menunggu_konfirmasi'){var proof=_skAsset(r.payment_proof||'');body=`<div class='sknotice warn'>🔎 Bukti pembayaran sudah dikirim dan sedang diperiksa petugas. Dokumen SIMAKSI akan tersedia di kartu ini setelah pembayaran dikonfirmasi.</div>${proof?`<img class='skproof-preview' src='${_skEsc(proof)}' alt='Bukti pembayaran terkirim'/>`:''}`;}
  else if(stage==='dibayar'){body=`<div class='sknotice ok'>✅ Pembayaran telah dikonfirmasi. Petugas sedang menyiapkan dokumen SIMAKSI resmi Anda.</div>`;}
  else if(stage==='terbit'){var safeCode=_skEsc(r.code||'');var docId='sk-doc-'+String(r.code||'x').replace(/[^a-zA-Z0-9_-]/g,'');var qrPayload=(typeof window.simaksiQrPayload==='function')?window.simaksiQrPayload(r):('SIMAKSI '+r.code);var qurl='https://api.qrserver.com/v1/create-qr-code/?size=140x140&data='+encodeURIComponent(qrPayload);body=`<div id='${docId}'><div class='permit'><h4>🎫 Dokumen SIMAKSI Resmi</h4><small>Gunung Bawakaraeng · Reichas Chelebes</small><div class='code'>${safeCode}</div><div class='qr'><img src='${qurl}' onerror='this.parentNode.innerHTML=&#39;📄&#39;'/></div><div class='pdet'><span>Ketua</span><b>${_skEsc(r.nama||'')}</b></div><div class='pdet'><span>Anggota</span><b>${_skEsc(r.jml||'')} orang</b></div><div class='pdet'><span>Jalur</span><b>${_skEsc(r.jalur||'-')}</b></div><div class='pdet'><span>Berlaku</span><b>${_skEsc(r.naik||'')} s/d ${_skEsc(r.turun||'')}</b></div><div class='tag ok'>✅ Sah dan Terverifikasi</div></div></div><button class='pdf-btn' onclick='printCard(&#39;${docId}&#39;)'>⬇️ Simpan / Cetak Dokumen</button>`;}
  else{body=`<div class='sknotice ok'>📨 Pengajuan diterima. Petugas akan memverifikasi maksimal 1×24 jam pada hari kerja. Pembaruan dikirim ke WhatsApp ${_skEsc(r.wa||'-')}.</div>`;}
  var wa='https://wa.me/'+_rcWA()+'?text='+encodeURIComponent('Halo, saya menanyakan status SIMAKSI kode '+(r.code||'')+' a.n '+(r.nama||'')+'.');
  return `<div class='skstat'><div class='skstat-h'><div><b>Nomor Pengajuan</b><div style='font-size:16px;margin-top:2px'>${_skEsc(r.code||'-')}</div></div><span class='skstat-badge ${statusClass}'>${statusText}</span></div><div class='skstat-meta'><div><small>Status</small><b>${statusText}</b></div><div><small>Kode PNBP</small><b>${_skEsc(r.pnbp_code||'Belum tersedia')}</b></div><div><small>Jalur</small><b>${_skEsc(r.jalur||'-')}</b></div><div><small>Jadwal</small><b>${_skEsc(r.naik||'-')} – ${_skEsc(r.turun||'-')}</b></div></div>${tl}${body}<a class='btn gh' style='text-decoration:none;text-align:center;display:block;margin-top:8px' href='${wa}' target='_blank' rel='noopener'>💬 Tanya Petugas via WhatsApp</a></div>`;
}

function _skInfoHtml(){
  var alur=[['Pengajuan (H-10)','Ajukan minimal 10 hari sebelum mendaki lewat aplikasi.'],['Kode Registrasi','Dapatkan kode untuk melacak progres pengajuan.'],['Verifikasi (1 hari kerja)','Petugas memeriksa berkas dan data; diterima atau ditolak.'],['Kode Pembayaran PNBP','Jika lolos verifikasi, kode pembayaran PNBP dikirim via WhatsApp.'],['Pembayaran','Bayar PNBP sesuai jumlah dan kode, lalu kirim bukti ke petugas.'],['Penerbitan','Dokumen SIMAKSI resmi terbit setelah pembayaran dikonfirmasi.'],['Notifikasi WhatsApp','Setiap perubahan status dikirim ke nomor WhatsApp terdaftar.'],['Pelaporan','Setelah kegiatan, laporkan kondisi dan sampah via menu Lapor.']];
  var syarat=['Foto KTP / identitas ketua rombongan (wajib).','Nomor WhatsApp aktif untuk notifikasi.','Surat pengantar / proposal kegiatan (opsional).','Menyetujui Surat Pernyataan pemohon.','Membayar PNBP sesuai jalur (Lembanna Rp75rb, Lembang Rp95rb per orang).'];
  return `<div class='form-card'><b>🧭 Alur Penerbitan SIMAKSI</b><div class='skflow'>${alur.map(function(a,i){return `<div class='skflow-i'><span class='skflow-n'>${i+1}</span><div><b>${a[0]}</b><small>${a[1]}</small></div></div>`;}).join('')}</div></div><div class='form-card'><b>📋 Syarat dan Ketentuan</b><ul class='skreq'>${syarat.map(function(x){return `<li>${x}</li>`;}).join('')}</ul><button class='btn g-indigo' onclick='skGo(&#39;ajukan&#39;)'>📝 Mulai Ajukan</button></div>`;
}

function _skFindRow(ref,cloud){var rows=_skRows||[];if(cloud){for(var i=0;i<rows.length;i++){if(rows[i].id===ref)return rows[i];}return null;}return rows[ref]||null;}

function _skAdminCard(r,ref,cloud){
  var stage=r.stage||'diajukan';var rej=(stage==='ditolak'||r.astatus==='ditolak');
  var badge=rej?`<span class='abadge no'>Ditolak</span>`:(stage==='terbit'?`<span class='abadge ok'>Terbit</span>`:(stage==='dibayar'?`<span class='abadge'>Dibayar</span>`:(stage==='menunggu_konfirmasi'?`<span class='abadge'>Bukti Dicek</span>`:(stage==='diverifikasi'?`<span class='abadge'>Menunggu Bayar</span>`:`<span class='abadge'>Baru</span>`))));
  var docs='';
  var ktp=_skAsset(r.ktp),doc=_skAsset(r.doc);
  if(ktp)docs+=`<img class='rimg' style='cursor:zoom-in;max-width:82px;margin-right:6px;border-radius:8px' src='${_skEsc(ktp)}' alt='Lampiran identitas' loading='lazy' onclick='openImg(this.src)'/>`;
  if(doc)docs+=`<img class='rimg' style='cursor:zoom-in;max-width:82px;border-radius:8px' src='${_skEsc(doc)}' alt='Lampiran dokumen' loading='lazy' onclick='openImg(this.src)'/>`;
  if(!docs)docs=`<small style='color:#8b98ad'>Tidak ada berkas terlampir</small>`;
  var amt=r.pnbp_amount?_rupiah(r.pnbp_amount):'-';
  var paymentProof=_skAsset(r.payment_proof||'');
  var proofHtml=paymentProof?`<div class='skproof-admin'><small style='color:#8b98ad'>Bukti pembayaran pemohon</small><img src='${_skEsc(paymentProof)}' alt='Bukti pembayaran' loading='lazy' onclick='openImg(this.src)'/></div>`:'';
  var pnbp=r.pnbp_code?`<div class='pdet'><span>Kode PNBP</span><b>${_skEsc(r.pnbp_code)}</b></div>`:'';
  var rf=cloud?(`&#39;`+String(ref).replace(/'/g,'')+`&#39;`):ref;
  var cf=cloud?'true':'false';
  var btns='';
  var del=`<button class='btn gh sk-del' onclick='skAdminDelete(${rf},${cf})'>🗑️ Hapus Aktivitas</button>`;
  if(!rej&&stage==='diajukan'){btns=`<button class='btn g-indigo' onclick='skAdminAct(${rf},${cf},&#39;verif&#39;)'>✅ Verifikasi + Terbitkan Kode PNBP</button><button class='btn gh' onclick='skAdminAct(${rf},${cf},&#39;tolak&#39;)'>❌ Tolak</button>`;}
  else if(!rej&&stage==='diverifikasi'){btns=`<button class='btn g-indigo' onclick='skAdminAct(${rf},${cf},&#39;bayar&#39;)'>💰 Tandai Sudah Bayar</button><button class='btn gh' onclick='skWA(${rf},${cf})'>💬 Kirim Kode via WA</button>`;}
  else if(!rej&&stage==='menunggu_konfirmasi'){btns=`<button class='btn g-indigo' onclick='skAdminAct(${rf},${cf},&#39;bayar&#39;)'>✅ Konfirmasi Pembayaran</button><button class='btn gh' onclick='skWA(${rf},${cf})'>💬 Tanya Pemohon</button>`;}
  else if(!rej&&stage==='dibayar'){btns=`<button class='btn g-indigo' onclick='skAdminAct(${rf},${cf},&#39;terbit&#39;)'>🎫 Terbitkan Dokumen SIMAKSI</button>`;}
  else if(stage==='terbit'){btns=`<button class='btn gh' onclick='skWA(${rf},${cf})'>💬 Kirim Dokumen via WA</button>`;}
  else{btns=`<button class='btn gh' onclick='skWA(${rf},${cf})'>💬 Hubungi Pemohon</button>`;}
  return `<div class='acard'><div class='ac-h'><b>🎫 ${_skEsc(r.code||'')} · ${_skEsc(r.nama||'-')}</b>${badge}</div><div class='sk-delete-top'>${del}</div><div class='ac-b'><div class='pdet'><span>WhatsApp</span><b>${_skEsc(r.wa||'-')}</b></div><div class='pdet'><span>Jalur</span><b>${_skEsc(r.jalur||'-')}</b></div><div class='pdet'><span>Anggota</span><b>${_skEsc(r.jml||'-')} org · ${_skEsc(r.org||'-')}</b></div><div class='pdet'><span>Tanggal</span><b>${_skEsc(r.naik||'?')} s/d ${_skEsc(r.turun||'?')}</b></div><div class='pdet'><span>PNBP</span><b>${_skEsc(amt)}</b></div>${pnbp}<div style='margin:8px 0'>${docs}</div>${proofHtml}</div><div class='skbtns' style='flex-direction:column;gap:6px'>${btns}</div></div>`;
}

function skAdminAct(ref,cloud,action){
  var r=_skFindRow(ref,cloud);if(!r){toast('Data tidak ditemukan','err');return;}
  var patch={};var stageMsg='';
  if(action==='verif'){var pc='PNBP'+Math.random().toString().slice(2,12);patch={stage:'diverifikasi',pnbp_code:pc};r.pnbp_code=pc;r.stage='diverifikasi';var amt=r.pnbp_amount?_rupiah(r.pnbp_amount):'-';stageMsg='Pengajuan SIMAKSI '+r.code+' a.n '+r.nama+' TERVERIFIKASI. Silakan bayar PNBP sejumlah '+amt+' dengan KODE PEMBAYARAN: '+pc+' ke GoPay 082320124040 a.n Reichas Chelebes. Kirim bukti transfer ke chat ini. Dokumen resmi terbit setelah pembayaran dikonfirmasi.';}
  else if(action==='bayar'){patch={stage:'dibayar'};r.stage='dibayar';stageMsg='Pembayaran PNBP untuk SIMAKSI '+r.code+' sedang kami konfirmasi. Dokumen akan segera diterbitkan. Terima kasih.';}
  else if(action==='terbit'){patch={stage:'terbit',astatus:'disetujui'};r.stage='terbit';r.astatus='disetujui';stageMsg='SELAMAT! Dokumen SIMAKSI '+r.code+' a.n '+r.nama+' telah TERBIT dan sah. Tunjukkan kode '+r.code+' saat registrasi di pos jalur. Salam lestari!';}
  else if(action==='tolak'){patch={stage:'ditolak',astatus:'ditolak'};r.stage='ditolak';r.astatus='ditolak';stageMsg='Mohon maaf, pengajuan SIMAKSI '+r.code+' belum dapat disetujui. Silakan balas chat ini untuk info perbaikan berkas.';}
  else return;
  var done=function(){try{if(typeof renderAdmin==='function')renderAdmin('simaksi');}catch(e){}try{if(typeof refreshBellBadge==='function')refreshBellBadge();}catch(e){}var wa='https://wa.me/'+_waNorm(r.wa)+'?text='+encodeURIComponent(stageMsg);try{window.open(wa,'_blank');}catch(e){}toast('Status diperbarui. Membuka WhatsApp ke pemohon...','ok');};
  if(cloud&&typeof _sbClient==='function'){var c=_sbClient();if(c){c.from('simaksi').update(patch).eq('id',ref).then(function(){done();}).catch(function(){toast('Gagal update server','err');});return;}}
  try{var arr=_lsGet('bwkSimaksi',[]);var idx=(typeof ref==='number')?ref:-1;if(idx<0){for(var i=0;i<arr.length;i++){if(arr[i].code===r.code){idx=i;break;}}}if(idx>=0){Object.assign(arr[idx],patch);_lsSet('bwkSimaksi',arr);}}catch(e){}
  done();
}

function skAdminDelete(ref,cloud){
  var r=_skFindRow(ref,cloud);if(!r){toast('Data tidak ditemukan','err');return;}
  var stage=r.stage||'diajukan';
  var label=(stage==='terbit')?'transaksi selesai':'aktivitas belum selesai/gagal';
  if(!confirm('Hapus '+label+' SIMAKSI '+(r.code||'')+' secara permanen?'))return;
  var done=function(){try{renderAdmin('simaksi');}catch(e){}toast('Aktivitas SIMAKSI dihapus','ok');};
  if(cloud&&typeof _sbClient==='function'){
    var c=_sbClient();if(c){c.from('simaksi').delete().eq('id',ref).then(function(res){if(res&&res.error){toast('Gagal menghapus aktivitas','err');return;}done();}).catch(function(){toast('Gagal menghapus aktivitas','err');});return;}
  }
  try{var arr=_lsGet('bwkSimaksi',[]);arr.splice(ref,1);_lsSet('bwkSimaksi',arr);}catch(e){}
  done();
}

function skWA(ref,cloud){
  var r=_skFindRow(ref,cloud);if(!r){toast('Data tidak ditemukan','err');return;}
  var stage=r.stage||'diajukan';var m='';
  if(stage==='diverifikasi'){var amt=r.pnbp_amount?_rupiah(r.pnbp_amount):'-';m='Pengajuan SIMAKSI '+r.code+' terverifikasi. Kode pembayaran PNBP: '+(r.pnbp_code||'-')+' sejumlah '+amt+'. Bayar ke GoPay 082320124040 a.n Reichas Chelebes lalu kirim bukti ke sini.';}
  else if(stage==='terbit'){m='Dokumen SIMAKSI '+r.code+' a.n '+r.nama+' sudah TERBIT dan sah. Tunjukkan kode '+r.code+' saat registrasi di pos jalur.';}
  else{m='Halo '+r.nama+', terkait pengajuan SIMAKSI '+r.code+'.';}
  var wa='https://wa.me/'+_waNorm(r.wa)+'?text='+encodeURIComponent(m);try{window.open(wa,'_blank');}catch(e){}
}

(function(){try{var css=`
  .acard .ac-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
  .acard .ac-h b{font-size:13px}
  .acard .ac-b{font-size:12.5px;color:#42506b}
  .acard .ac-b .pdet{display:flex;justify-content:space-between;margin:3px 0}
  .acard .ac-b .pdet span{color:#8b98ad}
  .sk-delete-top{display:flex;justify-content:flex-end;margin:6px 0 10px}.sk-delete-top .sk-del{width:auto;min-height:36px;padding:7px 12px;color:#c0333c;border:1px solid #f2b9c0}
  `;var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);}catch(e){}})();
