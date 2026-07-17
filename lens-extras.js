/* Lensa Bawakaraeng - fitur tambahan: Bagikan/Simpan/Salin hasil + catatan cakupan.
   Aman & aditif: hanya membaca DOM kartu hasil (#lensResult) dan foto (#lensImage). */
(function () {
  'use strict';
  function toast(msg, kind){ try { if (typeof window.toast === 'function') { window.toast(msg, kind || 'ok'); return; } } catch (e) {} }

  function addScopeNote(){
    try {
      if (document.getElementById('lensScopeNote')) return;
      var anchor = document.getElementById('lensAction') || document.getElementById('lensResult');
      if (!anchor || !anchor.parentNode) return;
      var n = document.createElement('div');
      n.id = 'lensScopeNote';
      n.style.cssText = 'margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);font-size:12.5px;line-height:1.5;color:#d9e8d9;';
      n.innerHTML = '\u2139\ufe0f <b>Lensa hanya mengenali flora, fauna, dan batuan.</b> Objek lain (mis. wajah, layar, tulisan, kendaraan, makanan) tidak akan dikenali.';
      anchor.parentNode.insertBefore(n, anchor.nextSibling);
    } catch (e) {}
  }

  function summaryText(res){
    try {
      var clone = res.cloneNode(true);
      var bar = clone.querySelector('.lens-extra-bar'); if (bar) bar.parentNode.removeChild(bar);
      var txt = (clone.innerText || clone.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
      return 'Hasil Lensa Bawakaraeng (perkiraan AI)\n\n' + txt + '\n\n\u2014 Hasil perkiraan, perlu verifikasi ahli. Aplikasi Bawakaraeng.';
    } catch (e) { return 'Hasil Lensa Bawakaraeng (perkiraan AI)'; }
  }

  function photoSrc(){ var img = document.getElementById('lensImage'); return (img && img.getAttribute('src')) || ''; }

  function doCopy(res){
    var text = summaryText(res);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){ toast('Hasil disalin', 'ok'); }).catch(function(){ fallbackCopy(text); });
    } else { fallbackCopy(text); }
  }
  function fallbackCopy(text){
    try { var ta = document.createElement('textarea'); ta.value = text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('Hasil disalin', 'ok'); }
    catch (e) { toast('Gagal menyalin', 'err'); }
  }

  function doShare(res){
    var text = summaryText(res);
    var src = photoSrc();
    function shareText(){ if (navigator.share) { navigator.share({ title: 'Hasil Lensa Bawakaraeng', text: text }).catch(function(){}); } else { doCopy(res); } }
    if (src && navigator.canShare) {
      fetch(src).then(function(r){ return r.blob(); }).then(function(b){
        var file = new File([b], 'lensa-bawakaraeng.jpg', { type: b.type || 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'Hasil Lensa Bawakaraeng', text: text }).catch(function(){ shareText(); });
        } else { shareText(); }
      }).catch(function(){ shareText(); });
    } else { shareText(); }
  }

  function wrapLines(ctx, text, maxW){
    var words = String(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = words[i]; } else { cur = test; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function doSaveImage(res){
    try {
      var W = 1080, pad = 56, y = pad;
      var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = 4000;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0f2a1c'; ctx.fillRect(0, 0, W, 4000);
      ctx.fillStyle = '#7CFFB2'; ctx.font = 'bold 30px sans-serif';
      ctx.fillText('Lensa Bawakaraeng \u00b7 Perkiraan AI', pad, y + 10); y += 56;
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke(); y += 30;
      var img = document.getElementById('lensImage');
      if (img && img.complete && img.naturalWidth) {
        try { var iw = img.naturalWidth, ih = img.naturalHeight; var tw = W - pad * 2; var th = Math.min(Math.round(ih * (tw / iw)), 560); ctx.drawImage(img, pad, y, tw, th); y += th + 30; } catch (e) {}
      }
      var clone = res.cloneNode(true);
      var bar = clone.querySelector('.lens-extra-bar'); if (bar) bar.parentNode.removeChild(bar);
      var raw = (clone.innerText || clone.textContent || '').trim();
      var blocks = raw.split(/\n+/).map(function(s){ return s.trim(); }).filter(Boolean);
      for (var i = 0; i < blocks.length; i++) {
        var isTitle = (i === 0);
        ctx.fillStyle = isTitle ? '#ffffff' : '#dbe9db';
        ctx.font = (isTitle ? 'bold 40px' : '26px') + ' sans-serif';
        var lines = wrapLines(ctx, blocks[i], W - pad * 2);
        for (var j = 0; j < lines.length; j++) { ctx.fillText(lines[j], pad, y); y += (isTitle ? 50 : 38); }
        y += 12;
      }
      y += pad;
      var outc = document.createElement('canvas'); outc.width = W; outc.height = Math.min(y, 4000);
      outc.getContext('2d').drawImage(canvas, 0, 0);
      var url = outc.toDataURL('image/png');
      var a = document.createElement('a'); a.href = url; a.download = 'lensa-bawakaraeng.png'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('Gambar hasil disimpan', 'ok');
    } catch (e) { toast('Gagal menyimpan gambar', 'err'); }
  }

  function mkBtn(label){ var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.style.cssText = 'flex:1;min-width:110px;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#eafff0;font-weight:600;font-size:13.5px;cursor:pointer;'; return b; }

  function buildBar(res){
    if (res.querySelector('.lens-extra-bar')) return;
    var bar = document.createElement('div'); bar.className = 'lens-extra-bar';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';
    var bShare = mkBtn('\ud83d\udce4 Bagikan');
    var bSave = mkBtn('\ud83d\udcbe Simpan gambar');
    var bCopy = mkBtn('\ud83d\udccb Salin teks');
    bShare.onclick = function(){ doShare(res); };
    bSave.onclick = function(){ doSaveImage(res); };
    bCopy.onclick = function(){ doCopy(res); };
    bar.appendChild(bShare); bar.appendChild(bSave); bar.appendChild(bCopy);
    res.appendChild(bar);
  }

  function checkResult(){
    var res = document.getElementById('lensResult');
    if (!res) return;
    var txt = res.innerText || res.textContent || '';
    if (txt.indexOf('Keyakinan') !== -1) buildBar(res);
  }

  function init(){
    addScopeNote();
    var res = document.getElementById('lensResult');
    if (res && window.MutationObserver) { new MutationObserver(function(){ checkResult(); }).observe(res, { childList: true, subtree: true }); }
    checkResult();
    var tries = 0; var t = setInterval(function(){ addScopeNote(); checkResult(); if (++tries > 20) clearInterval(t); }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
