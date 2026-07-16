/* Obrolan Pendaki - chat multi-channel untuk semua pengguna. Data di Supabase tabel 'messages'. Admin bisa hapus pesan. */
(function(){
  var CHANNELS=[{id:'ai',n:'AI Pendamping',e:'✦'},{id:'umum',n:'Umum',e:'💬'},{id:'jalur',n:'Info Jalur',e:'🧭'},{id:'tanya',n:'Tanya-Jawab',e:'❓'},{id:'jualbeli',n:'Jual-Beli',e:'🏷️'}];
  var curCh='ai';var _open=false;var _poll=null;var _lastSig='';

  try{var css=`
  .chat-fab{position:fixed;right:16px;bottom:88px;z-index:118;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#2b6fff,#08a35f);color:#fff;border:none;box-shadow:0 8px 20px rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;font-size:24px;cursor:pointer}
  .chat-fab:active{transform:scale(.94)}
  .admin-fab{bottom:150px !important}
  .chatwrap{position:fixed;inset:0;z-index:9998;display:none;flex-direction:column;background:#f4f6fb;max-width:460px;margin:0 auto}
  html.dark .chatwrap{background:#0c1526}
  .chat-head{display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 12px) 16px 12px;background:linear-gradient(135deg,#2b6fff,#08a35f);color:#fff;font-size:16px;font-weight:800}
  .chat-x{cursor:pointer;font-size:20px;padding:2px 8px;line-height:1}
  .chat-tabs{display:flex;gap:8px;overflow-x:auto;padding:10px 12px;background:var(--card,#fff);border-bottom:1px solid var(--line,#e6e9ef)}
  .chat-tabs::-webkit-scrollbar{display:none}
  .chtab{flex:none;border:1px solid var(--line,#e6e9ef);background:transparent;color:var(--sub,#667);border-radius:20px;padding:6px 13px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap}
  .chtab.on{background:#2b6fff;color:#fff;border-color:transparent}
  html.dark .chtab{color:var(--sub)}
  .chat-body{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:8px}
  .cempty{text-align:center;color:var(--sub,#8b98ad);font-size:13px;padding:30px 12px;margin:auto}
  .cmsg{display:flex;max-width:82%}
  .cmsg.me{align-self:flex-end;justify-content:flex-end}
  .cmb{background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:14px;padding:8px 11px}
  .cmsg.me .cmb{background:#2b6fff;border-color:transparent;color:#fff}
  .cmh{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:2px}
  .cmh b{font-size:11.5px;color:#2b6fff}
  .cmsg.me .cmh b{color:#dfeaff}
  .cmh time{color:var(--sub,#9aa6ba);font-size:10px}
  .cmsg.me .cmh time{color:#dfeaff}
  .chd{margin-left:auto;border:none;background:transparent;color:#ff5570;cursor:pointer;font-size:12px;font-weight:800;padding:0 2px}
  .cmsg.me .chd{color:#ffd7de}
  .cmt{font-size:14px;line-height:1.42;white-space:pre-wrap;word-break:break-word}
  .chat-foot{background:var(--card,#fff);border-top:1px solid var(--line,#e6e9ef);padding:8px 12px calc(env(safe-area-inset-bottom) + 10px)}
  .chat-who{border:none;background:transparent;color:var(--sub,#8b98ad);font-size:11.5px;font-weight:700;cursor:pointer;padding:2px 2px 6px}
  .chat-input-row{display:flex;gap:8px;align-items:flex-end}
  .chat-input{flex:1;resize:none;max-height:120px;border:1px solid var(--line,#e6e9ef);border-radius:18px;padding:9px 13px;font-size:14px;font-family:inherit;background:#f4f6fb;color:var(--ink,#20263a);outline:none}
  html.dark .chat-input{background:#16233c;color:#eef2f8}
  .chat-send{flex:none;width:42px;height:42px;border-radius:50%;border:none;background:#2b6fff;color:#fff;font-size:17px;cursor:pointer}
  .chat-send:active{transform:scale(.92)}
  html.dark .cmb{background:#16233c;border-color:#27324c}
  html.dark .cmt{color:#ffffff}
  html.dark .cmh b{color:#8fb4ff}
  html.dark .cmh time{color:#9aa7c2}
  html.dark .cempty{color:#cfd8ea}
  html.dark .chat-who{color:#cfd8ea}
  .chat-ai-note{font-size:11px;color:var(--sub,#7d879b);text-align:center;padding:2px 10px 7px}
  .chat-ai-source{display:inline-flex;margin-top:5px;padding:2px 7px;border-radius:9px;background:#e8f1ec;color:#26705a;font-size:10px;font-weight:800}
  .chat-thinking{opacity:.72}
  `;var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);}catch(e){}

  function _sb(){return (typeof _sbClient==='function')?_sbClient():null;}
  function _devId(){try{var d=localStorage.getItem('bwkDev');if(!d){d='d'+Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('bwkDev',d);}return d;}catch(e){return 'd0';}}
  function _isAdmin(){try{var u=(typeof bwkUser==='function')?bwkUser():null;return !!(u&&u.role==='Admin');}catch(e){return false;}}
  function _name(){try{var n=localStorage.getItem('bwkChatName');if(n)return n;}catch(e){}try{var u=(typeof bwkUser==='function')?bwkUser():null;if(u&&u.name)return u.name;}catch(e){}return 'Pendaki';}
  function _esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function _fmtTime(iso){try{var d=new Date(iso);var now=new Date();var hm=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');if(d.toDateString()===now.toDateString())return hm;return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+' '+hm;}catch(e){return '';}}

  function _tabsHtml(){return CHANNELS.map(function(ch){return `<button class='chtab${ch.id===curCh?' on':''}' onclick="chatGo('${ch.id}')">${ch.e} ${ch.n}</button>`;}).join('');}
  function _syncWho(){var e=document.getElementById('chatWhoName');if(e)e.textContent=_name();}

  function _rowHtml(m){
    var mine=(m.mine===true)||(m.device&&m.device===_devId());
    var del=_isAdmin()?`<button class='chd' onclick="chatDel('${m.id}')" title='Hapus'>✕</button>`:'';
    return `<div class='cmsg ${mine?'me':''}'><div class='cmb'><div class='cmh'><b>${_esc(m.name||'Pendaki')}</b><time>${_fmtTime(m.created_at)}</time>${del}</div><div class='cmt'>${_esc(m.body||'')}</div>${m.source?`<span class='chat-ai-source'>${_esc(m.source)}</span>`:''}</div></div>`;
  }

  var _aiMsgs=[];
  function _loadAiHistory(){
    if(_aiMsgs.length)return;
    try{_aiMsgs=JSON.parse(localStorage.getItem('bwkAiHistory')||'[]')||[];}catch(e){_aiMsgs=[];}
    if(!_aiMsgs.length)_aiMsgs=[{id:'welcome',name:'AI Pendamping',body:'Halo! Saya membantu menjelaskan keselamatan, jalur, perlengkapan, SIMAKSI, pelaporan, dan konservasi Bawakaraeng. Apa yang ingin kamu ketahui?',created_at:new Date().toISOString(),source:'Panduan lokal'}];
  }
  function _saveAiHistory(){try{localStorage.setItem('bwkAiHistory',JSON.stringify(_aiMsgs.slice(-40)));}catch(e){}}
  function _aiRender(){
    _loadAiHistory();var box=document.getElementById('chatBody');if(!box)return;
    box.innerHTML=_aiMsgs.map(_rowHtml).join('');box.scrollTop=box.scrollHeight;
    var who=document.getElementById('chatWho');if(who)who.style.display='none';
    var inp=document.getElementById('chatInput');if(inp)inp.placeholder='Tanya tentang Bawakaraeng…';
  }
  function _weatherContext(){
    function tx(id){var e=document.getElementById(id);return e?(e.textContent||'').trim():'';}
    return {description:tx('wDesc'),temperature:tx('wTemp'),humidity:tx('wHum'),wind:tx('wWind'),area:tx('wArea'),updatedAt:new Date().toISOString()};
  }
  function _localAi(q){
    var t=(q||'').toLowerCase();
    if(/darurat|sos|hilang|tersesat|cedera|kecelakaan/.test(t))return 'Jika dalam keadaan darurat: tetap tenang, hentikan perjalanan, cari tempat aman, aktifkan tombol SOS aplikasi, bagikan lokasi GPS, dan hubungi petugas/pos terdekat. Jika tersesat, jangan terus berpindah tanpa arah. Hemat baterai dan buat penanda yang mudah terlihat.';
    if(/cuaca|hujan|angin|badai|petir/.test(t)){var w=_weatherContext();return 'Kondisi yang tampil di aplikasi: '+(w.temperature||'suhu belum tersedia')+', '+(w.description||'cuaca belum tersedia')+', angin '+(w.wind||'belum tersedia')+'. Periksa waktu pembaruan dan sumber BMKG. Tunda pendakian saat badai petir, hujan ekstrem, atau angin kencang; AI tidak menggantikan peringatan resmi.';}
    if(/simaksi|izin|registrasi/.test(t))return 'Buka SIMAKSI dari Beranda, pilih jalur dan tanggal, lengkapi identitas serta berkas yang diminta, lalu tunggu verifikasi dan pembayaran. Jangan mendaki sebelum izin dinyatakan berlaku.';
    if(/perlengkapan|checklist|bawa|packing/.test(t))return 'Perlengkapan minimum: jas hujan, pakaian hangat, lampu dan baterai cadangan, navigasi offline, P3K, air dan makanan darurat, peluit, power bank, serta kantong sampah. Sesuaikan dengan cuaca, durasi, dan jumlah anggota.';
    if(/jalur|pos|peta|sumber air/.test(t))return 'Gunakan menu Peta Jalur untuk melihat pos, profil ketinggian, dan sumber air. Simpan peta offline sebelum berangkat. Kondisi sumber air dapat berubah; konfirmasi kembali di pos registrasi atau kepada pengelola lokal.';
    if(/sampah|konservasi|pohon|flora|fauna|satwa/.test(t))return 'Terapkan prinsip bawa turun seluruh sampah, jangan memetik tumbuhan, memberi makan satwa, membuat vandalisme, atau menyalakan api di area terlarang. Dokumentasikan temuan penting melalui menu Laporan tanpa mengganggu habitat.';
    if(/lapor|laporan|foto|insiden/.test(t))return 'Buka Buat Laporan, pilih kategori, tambahkan foto, pastikan lokasi GPS benar, dan tulis kondisi secara faktual. Untuk bahaya yang membutuhkan respons segera, gunakan SOS—jangan hanya mengandalkan laporan biasa.';
    if(/api|gemini|mode|offline/.test(t))return 'Saya memakai Gemini ketika layanan tersedia. Tanpa API atau saat kuota habis, saya tetap menjawab dari panduan lokal yang tersimpan di aplikasi. Jawaban lokal tidak menggunakan biaya token.';
    return 'Saya dapat membantu tentang: cuaca dan keputusan aman, SIMAKSI, jalur dan sumber air, checklist perlengkapan, prosedur tersesat/SOS, pelaporan, serta konservasi. Tulis pertanyaan yang lebih spesifik agar jawabannya lebih tepat.';
  }
  function _syncChatMode(){
    var who=document.getElementById('chatWho');var inp=document.getElementById('chatInput');
    if(curCh==='ai'){if(who)who.style.display='none';if(inp)inp.placeholder='Tanya tentang Bawakaraeng…';}
    else{if(who)who.style.display='block';if(inp)inp.placeholder='Tanya tentang Bawakaraeng…';_syncWho();}
  }
  function _askAi(t){
    _loadAiHistory();var now=new Date().toISOString();
    _aiMsgs.push({id:'u'+Date.now(),name:_name(),body:t,mine:true,created_at:now});
    var wait={id:'wait',name:'AI Pendamping',body:'Sedang menyusun jawaban…',created_at:now,source:'Memproses'};_aiMsgs.push(wait);_aiRender();
    var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;var timer=ctrl?setTimeout(function(){ctrl.abort();},14000):null;
    fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:t,context:_weatherContext()}),signal:ctrl?ctrl.signal:undefined})
      .then(function(r){if(!r.ok)throw new Error('AI cloud unavailable');return r.json();})
      .then(function(d){wait.body=(d&&d.answer)?d.answer:_localAi(t);wait.source=(d&&d.source)||'Gemini';})
      .catch(function(){wait.body=_localAi(t);wait.source='Panduan lokal · gratis';})
      .finally(function(){if(timer)clearTimeout(timer);_saveAiHistory();_aiRender();});
  }

  window.chatGo=function(ch){curCh=ch;var tb=document.getElementById('chatTabs');if(tb)tb.innerHTML=_tabsHtml();_lastSig='';_syncChatMode();loadMsgs(true);};

  window.loadMsgs=function(force){
    if(curCh==='ai'){_aiRender();return;}
    var c=_sb();var box=document.getElementById('chatBody');if(!box)return;
    if(!c){box.innerHTML='<div class="cempty">Sambungkan internet untuk memuat obrolan.</div>';return;}
    c.from('messages').select('*').eq('channel',curCh).order('created_at',{ascending:true}).limit(300).then(function(res){
      if(res.error){box.innerHTML='<div class="cempty">Gagal memuat obrolan.<br><small>'+(res.error.message||'')+'</small><br>Pastikan tabel <b>messages</b> sudah dibuat di Supabase.</div>';return;}
      var rows=res.data||[];var sig=rows.map(function(r){return r.id;}).join(',');
      if(!force&&sig===_lastSig)return;_lastSig=sig;
      if(!rows.length){box.innerHTML='<div class="cempty">Belum ada pesan di channel ini.<br>Mulai obrolan! 👋</div>';return;}
      var atBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<90;
      box.innerHTML=rows.map(_rowHtml).join('');
      if(atBottom||force)box.scrollTop=box.scrollHeight;
    }).catch(function(){});
  };

  window.sendMsg=function(){
    var inp=document.getElementById('chatInput');if(!inp)return;var t=(inp.value||'').trim();if(!t)return;
    if(curCh==='ai'){inp.value='';inp.style.height='auto';_askAi(t.slice(0,600));return;}
    var c=_sb();if(!c){if(window.toast)toast('Butuh koneksi internet','err');return;}
    inp.value='';inp.style.height='auto';
    var row={channel:curCh,name:_name(),device:_devId(),body:t.slice(0,1000)};
    c.from('messages').insert(row).select().then(function(res){if(res.error){if(window.toast)toast('Gagal kirim: '+res.error.message,'err');return;}_lastSig='';loadMsgs(true);}).catch(function(){if(window.toast)toast('Gagal kirim pesan','err');});
  };

  window.chatDel=function(id){if(!_isAdmin())return;if(!confirm('Hapus pesan ini?'))return;var c=_sb();if(!c)return;c.from('messages').delete().eq('id',id).then(function(res){if(res.error){if(window.toast)toast('Gagal hapus','err');return;}if(window.toast)toast('Pesan dihapus','ok');_lastSig='';loadMsgs(true);}).catch(function(){});};

  window.chatName=function(){var cur=_name();var n=prompt('Nama tampil di chat:',cur);if(n==null)return;n=(n||'').trim().slice(0,24);if(!n)return;try{localStorage.setItem('bwkChatName',n);}catch(e){}_syncWho();};

  window.openChat=function(){var w=document.getElementById('chatWrap');if(!w)return;w.style.display='flex';_open=true;_syncChatMode();_lastSig='';loadMsgs(true);if(_poll)clearInterval(_poll);_poll=setInterval(function(){if(_open&&!document.hidden)loadMsgs(false);},4000);};
  window.closeChat=function(){var w=document.getElementById('chatWrap');if(w)w.style.display='none';_open=false;if(_poll){clearInterval(_poll);_poll=null;}};

  function _build(){
    if(document.getElementById('chatFab'))return;
    var fab=document.createElement('button');fab.id='chatFab';fab.className='chat-fab';fab.title='AI Pendamping & Obrolan';fab.setAttribute('aria-label','Buka AI Pendamping');fab.innerHTML='✦';fab.setAttribute('onclick','openChat()');document.body.appendChild(fab);
    var w=document.createElement('div');w.id='chatWrap';w.className='chatwrap';
    w.innerHTML=`<div class='chat-head'><b>✦ Pendamping Bawakaraeng</b><span class='chat-x' onclick='closeChat()'>✕</span></div><div class='chat-tabs' id='chatTabs'></div><div class='chat-body' id='chatBody'></div><div class='chat-foot'><button class='chat-who' id='chatWho' onclick='chatName()'>👤 <span id='chatWhoName'></span> ✎ ganti nama</button><div class='chat-input-row'><textarea id='chatInput' class='chat-input' rows='1' placeholder='Tanya tentang Bawakaraeng…'></textarea><button class='chat-send' onclick='sendMsg()'>➤</button></div></div>`;
    document.body.appendChild(w);
    var tb=document.getElementById('chatTabs');if(tb)tb.innerHTML=_tabsHtml();
    var inp=document.getElementById('chatInput');
    if(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});inp.addEventListener('input',function(){inp.style.height='auto';inp.style.height=Math.min(120,inp.scrollHeight)+'px';});}
    _syncWho();
  }
  window.addEventListener('load',function(){setTimeout(_build,800);});
})();
