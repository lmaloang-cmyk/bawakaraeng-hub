/* ============================================================================
 * BWK SOS · sos-relay.js
 * Jalur cadangan saat internet mati, dan eskalasi otomatis bila SOS didiamkan.
 *
 * MASALAH: seluruh rantai SOS bergantung internet
 *   HP -> Vercel -> Supabase -> push gateway -> HP penerima
 * Di jalur Bawakaraeng, itu persis rantai yang paling sering putus.
 *
 * Modul ini menambah dua hal:
 *   1. RELAY MANUAL. Tombol yang membuka WhatsApp / SMS / Telepon dengan pesan
 *      darurat yang sudah terisi lengkap (koordinat + Plus Code + baterai +
 *      data medis). SMS lewat pada sinyal 1 bar ketika HTTP sudah gagal total.
 *   2. ESKALASI OTOMATIS. Bila SOS masih aktif setelah N menit tanpa ditangani,
 *      tampilkan panel eskalasi, bunyikan pengingat, dan dorong gelombang push
 *      tambahan.
 *
 * Tidak ada satu pun aksi otomatis yang mengirim pesan tanpa persetujuan
 * pengguna — browser memang tidak mengizinkannya, dan itu justru benar:
 * pengguna harus menekan tombol kirim di aplikasi WA/SMS.
 *
 * API:
 *   BWKSosRelay.channels(ctx)      -> [{id,label,href,icon}]
 *   BWKSosRelay.render(hostEl, ctx)
 *   BWKSosRelay.startEscalation(sosId)
 *   BWKSosRelay.stopEscalation()
 * ==========================================================================*/
(function () {
  'use strict';

  // Menit ke berapa eskalasi dinaikkan.
  var STEPS = [5, 15, 30, 60];
  var CHECK_EVERY = 60000;
  var ACTIVE_KEY = 'bwkActiveSos';

  var _timer = null;
  var _startedAt = 0;
  var _sosId = null;
  var _stepDone = {};

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function waNumber() {
    try {
      if (typeof window._rcWA === 'function') {
        var n = String(window._rcWA() || '').replace(/[^0-9]/g, '');
        if (n) return n;
      }
    } catch (e) {}
    try {
      var cfg = String(localStorage.getItem('bwkWaNumber') || '').replace(/[^0-9]/g, '');
      if (cfg) return cfg;
    } catch (e) {}
    return '';
  }

  function emergencyNumbers() {
    // Nomor darurat nasional + SAR. Dapat ditimpa lewat localStorage bwkSarNumbers
    // (JSON array of {label, number}) supaya tiap basecamp bisa menyesuaikan.
    var def = [
      { label: 'Panggilan Darurat 112', number: '112' },
      { label: 'BASARNAS 115', number: '115' }
    ];
    try {
      var raw = localStorage.getItem('bwkSarNumbers');
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          return arr.filter(function (x) { return x && x.number; }).slice(0, 6);
        }
      }
    } catch (e) {}
    return def;
  }

  function message(ctx) {
    try {
      if (window.BWKSosContext && window.BWKSosContext.summaryText) {
        return window.BWKSosContext.summaryText(ctx);
      }
    } catch (e) {}
    return 'DARURAT SOS di jalur Bawakaraeng. Mohon bantuan.';
  }

  function channels(ctx) {
    var text = message(ctx);
    var enc = encodeURIComponent(text);
    var out = [];
    var wa = waNumber();

    if (wa) {
      out.push({
        id: 'wa',
        icon: '\uD83D\uDCAC',
        label: 'Kirim lewat WhatsApp',
        note: 'Butuh data seluler / WiFi',
        href: 'https://wa.me/' + wa + '?text=' + enc
      });
    }
    out.push({
      id: 'wa-share',
      icon: '\uD83D\uDCE2',
      label: 'Sebar ke kontak WhatsApp',
      note: 'Pilih grup atau siapa pun yang online',
      href: 'https://api.whatsapp.com/send?text=' + enc
    });
    out.push({
      id: 'sms',
      icon: '\u2709\uFE0F',
      label: 'Kirim lewat SMS',
      note: 'Tetap lewat di sinyal 1 bar saat internet mati',
      href: 'sms:' + (wa ? '+' + wa : '') + '?&body=' + enc
    });
    emergencyNumbers().forEach(function (n) {
      out.push({
        id: 'call-' + n.number,
        icon: '\uD83D\uDCDE',
        label: 'Telepon ' + n.label,
        note: 'Panggilan suara tetap jalan tanpa paket data',
        href: 'tel:' + String(n.number).replace(/[^0-9+]/g, '')
      });
    });
    out.push({
      id: 'copy',
      icon: '\uD83D\uDCCB',
      label: 'Salin teks darurat',
      note: 'Tempel ke aplikasi apa pun, atau bacakan lewat HT',
      action: 'copy'
    });
    return out;
  }

  function copyText(ctx) {
    var text = message(ctx);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(!!ok);
    } catch (e) { return Promise.resolve(false); }
  }

  function render(host, ctx) {
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return null;
    var list = channels(ctx);
    var pc = '';
    try {
      var c = ctx || (window.BWKSosContext && window.BWKSosContext.lastContext());
      if (c && c.plus_code) pc = c.plus_code;
    } catch (e) {}

    el.innerHTML =
      '<div class="bwk-relay">' +
        '<div class="bwk-relay-h"><b>Jalur bantuan cadangan</b>' +
        '<small>Pakai ini bila SOS lewat internet belum dijawab.</small></div>' +
        (pc ? '<div class="bwk-relay-pc">Plus Code: <code>' + esc(pc) + '</code>' +
              '<small>Bisa dibacakan lewat HT: ' + esc(window.BWKPlusCode ? window.BWKPlusCode.spoken(pc) : pc) + '</small></div>' : '') +
        list.map(function (ch) {
          if (ch.action === 'copy') {
            return '<button type="button" class="bwk-relay-b" data-relay-copy="1">' +
              '<span class="bwk-relay-ic">' + ch.icon + '</span>' +
              '<span class="bwk-relay-tx"><b>' + esc(ch.label) + '</b><small>' + esc(ch.note) + '</small></span></button>';
          }
          return '<a class="bwk-relay-b" href="' + esc(ch.href) + '" target="_blank" rel="noopener">' +
            '<span class="bwk-relay-ic">' + ch.icon + '</span>' +
            '<span class="bwk-relay-tx"><b>' + esc(ch.label) + '</b><small>' + esc(ch.note) + '</small></span></a>';
        }).join('') +
      '</div>';

    var copyBtn = el.querySelector('[data-relay-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        copyText(ctx).then(function (ok) {
          copyBtn.querySelector('b').textContent = ok ? 'Teks darurat tersalin' : 'Gagal menyalin — salin manual';
        });
      });
    }
    return el;
  }

  // -------------------------------------------------------------- eskalasi
  function panelHost() {
    var el = document.getElementById('bwkSosEscalate');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bwkSosEscalate';
      el.className = 'bwk-esc';
      document.body.appendChild(el);
    }
    return el;
  }

  function showEscalation(minutes) {
    var host = panelHost();
    host.innerHTML =
      '<div class="bwk-esc-card">' +
        '<div class="bwk-esc-h">\u26A0\uFE0F SOS kamu sudah ' + minutes + ' menit belum ditangani</div>' +
        '<div class="bwk-esc-b">Jangan menunggu. Coba jalur lain sekarang.</div>' +
        '<div id="bwkEscRelay"></div>' +
        '<button type="button" class="bwk-esc-x" id="bwkEscClose">Tutup</button>' +
      '</div>';
    render(host.querySelector('#bwkEscRelay'), null);
    var x = host.querySelector('#bwkEscClose');
    if (x) x.addEventListener('click', function () { host.innerHTML = ''; });
    try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]); } catch (e) {}
  }

  function pushAgain(id) {
    try {
      // pushAgain TIDAK punya token otorisasi karena jalan di thread UI yang bisa jadi
      // belum pernah login. Itu risiko yang diterima: eskalasi adalah upaya terakhir,
      // bukan mekanisme utama. Yang penting tombol WA/SMS tetap ada selalu.
      fetch('/api/sos-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      }).catch(function () {});
    } catch (e) {}
  }

  function tick() {
    var act = null;
    try { act = JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null'); } catch (e) {}
    if (!act || !act.id) { stopEscalation(); return; }
    var mins = Math.floor((Date.now() - (_startedAt || act.created_at || Date.now())) / 60000);
    for (var i = 0; i < STEPS.length; i++) {
      var step = STEPS[i];
      if (mins >= step && !_stepDone[step]) {
        _stepDone[step] = true;
        showEscalation(step);
        pushAgain(act.id);
      }
    }
  }

  function startEscalation(sosId) {
    stopEscalation();
    _sosId = sosId || null;
    _startedAt = Date.now();
    _stepDone = {};
    _timer = setInterval(tick, CHECK_EVERY);
  }

  function stopEscalation() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _sosId = null;
    _stepDone = {};
    var host = document.getElementById('bwkSosEscalate');
    if (host) host.innerHTML = '';
  }

  window.BWKSosRelay = {
    channels: channels,
    render: render,
    message: message,
    copyText: copyText,
    startEscalation: startEscalation,
    stopEscalation: stopEscalation
  };
})();
