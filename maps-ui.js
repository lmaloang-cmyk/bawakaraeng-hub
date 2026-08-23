/*!
 * maps-ui.js — Antarmuka MAPS ramah pemula (Mode Simpel & Mode Pro)
 * Paket perbaikan hasil audit 23 Agustus 2026.
 *
 * Menggantikan solusi `display:none` pada tombol WP / Rekam / Ukur:
 * tombol lanjutan tidak dihapus, hanya disembunyikan di Mode Simpel dan
 * muncul di Mode Pro.
 *
 * Butuh: maps-storage.js, maps-offline.js, maps-safety.js, maps-ui.css
 *
 * Pakai:
 *   BWKMapsUI.boot({
 *     map: mapsMap,                 // instance Leaflet yang sudah ada
 *     bounds: { north:-5.22, south:-5.40, east:120.00, west:119.85 },
 *     route: JALUR_PINTU_ANGIN,     // [{lat,lng,alt}]
 *     checkpoints: CHECKPOINTS,     // [{id,name,lat,lng}]
 *     source: 'osm',
 *     hooks: { locate, addWaypoint, toggleRecording, toggleMeasure, toggleCompass, sos }
 *   });
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var cfg = null;
  var el = {};
  var mode = 'simpel';
  var dl = null; // proses unduh berjalan

  function h(tag, attrs, children) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function btn(icon, label, opts) {
    return h('button', Object.assign({
      class: 'bwk-btn' + (opts && opts.cls ? ' ' + opts.cls : ''),
      type: 'button',
      'aria-label': label
    }, opts && opts.attrs || {}), [
      h('i', { text: icon, 'aria-hidden': 'true' }),
      h('span', { text: label })
    ]);
  }

  function toast(msg, kind, ms) {
    if (!el.alert) return;
    el.alert.textContent = msg;
    el.alert.className = 'bwk-alert' + (kind ? ' bwk-' + kind : '');
    el.alert.hidden = false;
    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(function () { el.alert.hidden = true; }, ms || 6000);
  }

  function call(name, fallbackMsg) {
    var fn = cfg.hooks && cfg.hooks[name];
    if (typeof fn === 'function') { try { return fn(); } catch (e) { toast('Gagal: ' + e.message, null, 5000); } }
    else toast(fallbackMsg || 'Fitur ini belum terhubung.', 'info');
    return null;
  }

  // ---------------------------------------------------------------- status bar
  function renderStatus(patch) {
    el._status = Object.assign({ tiles: 0, gps: null, offline: false, storage: null }, el._status, patch || {});
    var s = el._status;
    var parts = [];

    parts.push(s.tiles > 0
      ? '<span class="bwk-ok">✓ Peta offline siap · ' + s.tiles.toLocaleString('id-ID') + ' petak</span>'
      : '<span class="bwk-warn">⚠ Peta offline belum diunduh</span>');

    if (s.gps === null) parts.push('<span>📍 GPS mati</span>');
    else if (s.gps > 30) parts.push('<span class="bwk-warn">📍 GPS lemah ±' + s.gps + ' m</span>');
    else parts.push('<span class="bwk-ok">📍 GPS ±' + s.gps + ' m</span>');

    if (s.offline) parts.push('<span class="bwk-warn">📶 Tanpa sinyal</span>');
    if (s.storage) parts.push('<span>💾 ' + s.storage + '</span>');

    el.status.innerHTML = parts.join('');
  }

  function refreshStats() {
    if (global.BWKOfflineTiles) {
      global.BWKOfflineTiles.stats().then(function (st) { renderStatus({ tiles: st.tiles }); }).catch(function () {});
    }
    if (global.BWKStore) {
      global.BWKStore.storage.estimate().then(function (e) {
        if (e.supported) {
          renderStatus({ storage: global.BWKStore.storage.human(e.usage) + ' / ' + global.BWKStore.storage.human(e.quota) });
        }
      }).catch(function () {});
    }
  }

  // ------------------------------------------------------------- panel unduhan
  function openDownload() {
    var zoomWrap = h('div', { class: 'bwk-choice' }, [
      choice('bwkZoom', '14', 'Ringan', 'Cukup untuk melihat bentuk jalur. Paling cepat & hemat memori.'),
      choice('bwkZoom', '15', 'Sedang', 'Pilihan seimbang untuk pendakian biasa.', true),
      choice('bwkZoom', '16', 'Detail', 'Paling tajam saat mendekati puncak. Butuh ruang lebih besar.')
    ]);

    var estimate = h('p', { class: 'bwk-log', text: 'Menghitung perkiraan ukuran…' });
    var bar = h('div', { class: 'bwk-progress' }, [h('i', {})]);
    var log = h('div', { class: 'bwk-log', text: '' });
    var startBtn = h('button', { class: 'bwk-cta', type: 'button', text: 'Unduh sekarang' });
    var cancelBtn = h('button', { class: 'bwk-cta bwk-ghost', type: 'button', text: 'Tutup' });

    function zooms() {
      var v = 15;
      Array.prototype.forEach.call(zoomWrap.querySelectorAll('input'), function (i) { if (i.checked) v = Number(i.value); });
      var list = [];
      for (var z = 12; z <= v; z++) list.push(z);
      return list;
    }

    function updateEstimate() {
      if (!global.BWKOfflineTiles) return;
      var e = global.BWKOfflineTiles.estimate({ bounds: cfg.bounds, zooms: zooms() });
      estimate.textContent = 'Perkiraan: ' + e.count.toLocaleString('id-ID') + ' petak peta · ±' +
        (global.BWKStore ? global.BWKStore.storage.human(e.bytes) : Math.round(e.bytes / 1048576) + ' MB') +
        ' · unduh sekali, dipakai selamanya.';
    }

    zoomWrap.addEventListener('change', updateEstimate);
    updateEstimate();

    startBtn.addEventListener('click', function () {
      if (dl) { dl.cancel(); return; }
      if (global.BWKStore) global.BWKStore.storage.persist();

      dl = global.BWKOfflineTiles.download({
        source: cfg.source || 'osm',
        bounds: cfg.bounds,
        zooms: zooms(),
        onProgress: function (p) {
          bar.firstChild.style.width = p.percent + '%';
          log.textContent = p.percent + '% · ' + p.done + '/' + p.total + ' petak' +
            (p.failed ? ' · ' + p.failed + ' gagal' : '');
        }
      });

      startBtn.textContent = 'Batalkan unduhan';

      dl.promise.then(function (r) {
        dl = null;
        startBtn.textContent = 'Unduh sekarang';
        if (r.status === 'penyimpanan-penuh') {
          toast('Penyimpanan HP penuh. Hapus sebagian data lalu coba lagi.', null, 8000);
        } else if (r.status === 'dibatalkan') {
          toast('Unduhan dibatalkan. Petak yang sudah tersimpan tetap bisa dipakai.', 'info');
        } else {
          toast('Peta offline siap: ' + (r.saved + r.skipped).toLocaleString('id-ID') + ' petak tersimpan.', 'good');
        }
        refreshStats();
      }).catch(function (err) {
        dl = null;
        startBtn.textContent = 'Unduh sekarang';
        log.textContent = '';
        toast(err.message || 'Unduhan gagal.', null, 9000);
      });
    });

    cancelBtn.addEventListener('click', function () { closeSheet(); });

    openSheet('Unduh peta untuk offline', [
      h('p', { text: 'Lakukan ini saat masih ada sinyal, di rumah atau di basecamp. Setelah selesai, peta tetap terbuka walau tanpa internet.' }),
      zoomWrap, estimate, bar, log,
      h('div', { class: 'bwk-row' }, [startBtn, cancelBtn])
    ]);
  }

  function choice(name, value, title, desc, checked) {
    return h('label', {}, [
      h('input', { type: 'radio', name: name, value: value, checked: checked ? 'checked' : null }),
      h('span', { html: title + '<small>' + desc + '</small>' })
    ]);
  }

  // -------------------------------------------------------------- onboarding
  function openOnboarding() {
    var next = h('button', { class: 'bwk-cta', type: 'button', text: 'Mulai langkah 1' });
    next.addEventListener('click', function () { closeSheet(); openDownload(); });
    var skip = h('button', { class: 'bwk-cta bwk-ghost', type: 'button', text: 'Nanti saja' });
    skip.addEventListener('click', function () { closeSheet(); });

    openSheet('Siapkan peta dalam 3 langkah', [
      h('p', { text: 'Panduan singkat untuk yang baru pertama memakai peta Pintu Angin.' }),
      h('ol', { html:
        '<li><b>Unduh peta area</b> selagi ada sinyal — supaya peta tetap terbuka di gunung.</li>' +
        '<li><b>Pilih jalur</b> yang akan didaki, jalur resmi akan tergambar di peta.</li>' +
        '<li><b>Mulai jalur</b> saat berangkat — aplikasi memberi tahu setiap pos dan jika kamu keluar jalur.</li>' }),
      h('p', { text: 'Butuh alat lengkap seperti rekam trek, ukur jarak, dan kompas? Ketuk tombol “Mode Pro” di kanan atas.' }),
      h('div', { class: 'bwk-row' }, [next, skip])
    ]);
    try { global.localStorage.setItem('bwkMapsOnboarded', '1'); } catch (e) {}
  }

  function openSheet(title, nodes) {
    el.sheetBody.innerHTML = '';
    el.sheetBody.appendChild(h('h3', { text: title }));
    nodes.forEach(function (n) { el.sheetBody.appendChild(n); });
    el.sheet.hidden = false;
  }

  function closeSheet() { el.sheet.hidden = true; }

  // -------------------------------------------------------------------- mode
  function setMode(next) {
    mode = next;
    el.actions.className = 'bwk-actions' + (mode === 'pro' ? ' bwk-pro' : '');
    el.modeBtn.textContent = mode === 'pro' ? 'Mode Pro ✓' : 'Mode Simpel';
    try { global.localStorage.setItem('bwkMapsMode', mode); } catch (e) {}
  }

  var BWKMapsUI = {
    boot: function (options) {
      cfg = options || {};
      if (!cfg.bounds) {
        // Kotak area Gunung Bawakaraeng (default aman).
        cfg.bounds = { north: -5.22, south: -5.40, east: 120.00, west: 119.85 };
      }
      var host = cfg.container ||
        (cfg.map && cfg.map.getContainer && cfg.map.getContainer().parentNode) ||
        doc.getElementById('mapsMap');
      if (!host) { console.warn('[BWKMapsUI] container peta tidak ditemukan'); return false; }
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      if (host.querySelector('.bwk-ui')) return false; // cegah dobel (bug lama tombol kompas)

      var root = h('div', { class: 'bwk-ui' });
      el.status = h('div', { class: 'bwk-status', role: 'status', 'aria-live': 'polite' });
      el.alert = h('div', { class: 'bwk-alert', role: 'alert', hidden: 'hidden' });
      el.modeBtn = h('button', { class: 'bwk-mode', type: 'button', text: 'Mode Simpel' });
      el.modeBtn.addEventListener('click', function () { setMode(mode === 'pro' ? 'simpel' : 'pro'); });

      var bLocate = btn('📍', 'Lokasi Saya');
      var bHike = btn('🥾', 'Mulai Jalur');
      var bMark = btn('📌', 'Tandai Titik');
      var bSos = btn('🆘', 'SOS', { cls: 'bwk-danger' });
      var bDownload = btn('⬇️', 'Unduh Peta', { cls: 'bwk-pro-only' });
      var bRecord = btn('⏺', 'Rekam Trek', { cls: 'bwk-pro-only' });
      var bMeasure = btn('📏', 'Ukur Jarak', { cls: 'bwk-pro-only' });
      var bCompass = btn('🧭', 'Kompas', { cls: 'bwk-pro-only' });

      bLocate.addEventListener('click', function () { call('locate', 'Fungsi lokasi belum dihubungkan ke toggleGPS().'); });
      bMark.addEventListener('click', function () { call('addWaypoint', 'Fungsi tandai titik belum dihubungkan.'); });
      bMeasure.addEventListener('click', function () { call('toggleMeasure', 'Fungsi ukur jarak belum dihubungkan.'); });
      bCompass.addEventListener('click', function () { call('toggleCompass', 'Fungsi kompas belum dihubungkan.'); });
      bRecord.addEventListener('click', function () { call('toggleRecording', 'Fungsi rekam trek belum dihubungkan.'); });
      bSos.addEventListener('click', function () { call('sos', 'Tombol SOS belum dihubungkan.'); });
      bDownload.addEventListener('click', openDownload);

      bHike.addEventListener('click', function () {
        if (!global.BWKSafety) { toast('Modul keselamatan belum dimuat.', null, 5000); return; }
        var st = global.BWKSafety.state();
        if (st.running) {
          global.BWKSafety.stop();
          bHike.setAttribute('aria-pressed', 'false');
          toast('Pendakian dihentikan. Trek tersimpan otomatis.', 'good');
          return;
        }
        var ok = global.BWKSafety.start({
          route: cfg.route || [],
          checkpoints: cfg.checkpoints || [],
          onEvent: onSafetyEvent
        });
        if (ok) {
          bHike.setAttribute('aria-pressed', 'true');
          toast('Pendakian dimulai. Jaga HP tetap hangat dan hemat baterai.', 'good');
        }
      });

      el.actions = h('div', { class: 'bwk-actions' }, [
        bLocate, bHike, bMark, bSos, bDownload, bRecord, bMeasure, bCompass
      ]);

      el.sheetBody = h('div', { class: 'bwk-sheet-in' });
      el.sheet = h('div', { class: 'bwk-sheet', hidden: 'hidden' }, [el.sheetBody]);
      el.sheet.addEventListener('click', function (e) { if (e.target === el.sheet) closeSheet(); });

      root.appendChild(el.status);
      root.appendChild(el.alert);
      root.appendChild(el.modeBtn);
      root.appendChild(el.actions);
      host.appendChild(root);
      doc.body.appendChild(el.sheet);

      var savedMode = 'simpel';
      try { savedMode = global.localStorage.getItem('bwkMapsMode') || 'simpel'; } catch (e) {}
      setMode(savedMode);

      renderStatus({ offline: global.navigator && navigator.onLine === false });
      refreshStats();
      global.addEventListener('online', function () { renderStatus({ offline: false }); });
      global.addEventListener('offline', function () { renderStatus({ offline: true }); });

      if (global.BWKStore) {
        global.BWKStore.migrateFromLocalStorage().catch(function () {});
      }

      var onboarded = false;
      try { onboarded = global.localStorage.getItem('bwkMapsOnboarded') === '1'; } catch (e) {}
      if (!onboarded) setTimeout(openOnboarding, 600);

      return true;
    },

    openDownload: openDownload,
    openOnboarding: openOnboarding,
    toast: toast,
    setMode: setMode
  };

  function onSafetyEvent(ev) {
    switch (ev.type) {
      case 'posisi':
        renderStatus({ gps: ev.accuracy });
        if (ev.remainingMeters !== undefined && global.BWKSafety) {
          el.status.title = 'Sisa ' + (ev.remainingMeters / 1000).toFixed(1) + ' km · +' +
            ev.remainingGain + ' m · perkiraan ' + global.BWKSafety.formatEta(ev.etaSeconds);
        }
        break;
      case 'keluar-jalur':
        toast('⚠️ Kamu ' + ev.meters + ' m di luar jalur. Berhenti, lihat peta, kembali ke jalur terakhir.', null, 12000);
        break;
      case 'kembali-ke-jalur':
        toast('✓ Kembali di jalur.', 'good', 4000);
        break;
      case 'checkpoint':
        toast('📍 Sampai di ' + (ev.checkpoint.name || 'pos berikutnya') + ' (' + (ev.index + 1) + '/' + ev.total + ')', 'good');
        break;
      case 'gps-error':
      case 'gps-hilang':
        toast(ev.message, null, 10000);
        renderStatus({ gps: null });
        break;
      case 'gps-lemah':
        renderStatus({ gps: ev.accuracy });
        break;
    }
  }

  global.BWKMapsUI = BWKMapsUI;
})(typeof window !== 'undefined' ? window : this);
