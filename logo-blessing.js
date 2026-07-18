/* Shared click blessing for every Reichas Chelebes logo. */
(function(){
  const message='Dengan nama-MU Yang Maha Pengasih, Maha Penyayang.';
  const targetSelector='img[src*="rc-logo"], .logo, .login-ic, .intro-icon, .in-ic.g-brand, .circle.g-brand';
  let timer;

  function ensureOverlay(){
    let overlay=document.getElementById('logoBlessingOverlay');
    if(overlay) return overlay;
    const style=document.createElement('style');
    style.textContent=`
      #logoBlessingOverlay{position:fixed;inset:0;z-index:10050;display:grid;place-items:center;padding:24px;background:rgba(7,18,29,.56);backdrop-filter:blur(7px);opacity:0;pointer-events:none;transition:opacity .26s ease}
      #logoBlessingOverlay.is-open{opacity:1;pointer-events:auto}
      #logoBlessingCard{position:relative;max-width:430px;width:min(100%,430px);padding:34px 30px 30px;text-align:center;color:#fff;border:1px solid rgba(165,231,255,.5);border-radius:24px;background:linear-gradient(145deg,rgba(14,49,67,.96),rgba(21,24,52,.98));box-shadow:0 20px 60px rgba(0,0,0,.45),0 0 38px rgba(94,215,255,.22);transform:translateY(16px) scale(.96);transition:transform .32s cubic-bezier(.2,.85,.25,1)}
      #logoBlessingOverlay.is-open #logoBlessingCard{transform:translateY(0) scale(1)}
      #logoBlessingAura{width:68px;height:68px;margin:0 auto 18px;border:2px solid rgba(145,229,255,.9);border-radius:50%;box-shadow:0 0 0 8px rgba(117,213,255,.1),0 0 25px rgba(95,211,255,.65);animation:logoBlessingAura 1.8s ease-in-out infinite}
      #logoBlessingAura::before{content:'✦';display:grid;place-items:center;height:100%;font-size:28px;color:#fff0a4;text-shadow:0 0 16px rgba(255,221,112,.9)}
      #logoBlessingText{margin:0;font:700 clamp(20px,5.7vw,28px)/1.38 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.01em;text-wrap:balance;text-shadow:0 1px 0 rgba(0,0,0,.3)}
      #logoBlessingText strong{color:#bceeff;font-weight:800}
      #logoBlessingHint{display:block;margin-top:17px;color:rgba(231,246,255,.72);font:600 12px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.12em;text-transform:uppercase}
      @keyframes logoBlessingAura{50%{transform:scale(1.09);box-shadow:0 0 0 15px rgba(117,213,255,.04),0 0 34px rgba(95,211,255,.88)}}
      @media(prefers-reduced-motion:reduce){#logoBlessingOverlay,#logoBlessingCard{transition:none}#logoBlessingAura{animation:none}}
    `;
    document.head.appendChild(style);
    overlay=document.createElement('div');
    overlay.id='logoBlessingOverlay';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','Pesan refleksi');
    overlay.innerHTML='<div id="logoBlessingCard"><div id="logoBlessingAura" aria-hidden="true"></div><p id="logoBlessingText"><strong>Dengan nama-MU</strong><br>Yang Maha Pengasih,<br>Maha Penyayang.</p><span id="logoBlessingHint">Ketuk di mana saja untuk menutup</span></div>';
    overlay.addEventListener('click',function(){closeOverlay();});
    document.body.appendChild(overlay);
    return overlay;
  }
  function closeOverlay(){
    const overlay=document.getElementById('logoBlessingOverlay');
    if(overlay) overlay.classList.remove('is-open');
    window.clearTimeout(timer);
  }
  function showOverlay(){
    const overlay=ensureOverlay();
    overlay.classList.add('is-open');
    window.clearTimeout(timer);
    timer=window.setTimeout(closeOverlay,3800);
  }
  document.addEventListener('click',function(event){
    if(event.target.closest('#logoBlessingOverlay')) return;
    if(event.target.closest(targetSelector)) showOverlay();
  },true);
  document.addEventListener('keydown',function(event){if(event.key==='Escape')closeOverlay();});
})();
