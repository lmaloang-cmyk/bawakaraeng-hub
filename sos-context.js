/* ============================================================================
 * BWK SOS · sos-context.js
 * Mengumpulkan konteks darurat yang selama ini TIDAK ikut terkirim.
 *
 * Payload SOS lama hanya {lat, lng, device}. Tim SAR tidak tahu:
 *   - seberapa presisi titiknya (akurasi 8 m atau 800 m? beda strategi pencarian)
 *   - ketinggian (menyempitkan pencarian di punggungan vs lembah secara drastis)
 *   - sisa baterai korban (menentukan apakah masih bisa dihubungi nanti)
 *   - kondisi medis / kontak keluarga
 *
 * Semua data di sini dikumpulkan LOKAL dan dilampirkan ke payload SOS.
 * Profil medis disimpan di perangkat sendiri (localStorage) dan hanya ikut
 * terkirim saat pengguna benar-benar menekan SOS.
 *
 * API:
 *   BWKSosContext.collect(position) -> Promise<contextObject>
 *   BWKSosContext.getProfile() / setProfile(obj)
 *   BWKSosContext.renderCard(hostEl) // Kartu Darurat offline
 *   BWKSosContext.summaryText(ctx)   // teks siap kirim WA/SMS/HT
 * ==========================================================================*/
(function () {
  'use strict';

  var PROFILE_KEY = 'bwkEmergencyProfile';
  var LAST_CTX_KEY = 'bwkSosLastContext';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getProfile() {
    try {
      var o = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {};
      return {
        name: String(o.name || ''),
        phone: String(o.phone || ''),
        blood: String(o.blood || ''),
        allergy: String(o.allergy || ''),
        illness: String(o.illness || ''),
        kin_name: String(o.kin_name || ''),
        kin_phone: String(o.kin_phone || ''),
        group_size: Number(o.group_size || 0) || 0,
        route: String(o.route || '')
      };
    } catch (e) {
      return { name: '', phone: '', blood: '', allergy: '', illness: '', kin_name: '', kin_phone: '', group_size: 0, route: '' };
    }
  }

  function setProfile(obj) {
    var cur = getProfile();
    Object.keys(obj || {}).forEach(function (k) {
      if (k in cur) cur[k] = obj[k];
    });
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(cur)); } catch (e) {}
    return cur;
  }

  function battery() {
    try {
      if (!navigator.getBattery) return Promise.resolve(null);
      return navigator.getBattery().then(function (b) {
        return { level: Math.round((b.level || 0) * 100), charging: !!b.charging };
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  function network() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (!c) return null;
      return {
        type: String(c.effectiveType || c.type || ''),
        downlink: Number(c.downlink || 0) || 0,
        saveData: !!c.saveData
      };
    } catch (e) { return null; }
  }

  function plusCode(lat, lng) {
    try {
      if (window.BWKPlusCode && isFinite(lat) && isFinite(lng)) {
        return window.BWKPlusCode.encode(lat, lng, 10);
      }
    } catch (e) {}
    return '';
  }

  // position = objek GeolocationPosition ATAU {lat,lng,accuracy,altitude}
  function collect(position) {
    var coords = {};
    try {
      if (position && position.coords) {
        coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy || 0) || null,
          altitude: position.coords.altitude != null ? Math.round(position.coords.altitude) : null,
          alt_accuracy: position.coords.altitudeAccuracy != null ? Math.round(position.coords.altitudeAccuracy) : null,
          heading: position.coords.heading != null ? Math.round(position.coords.heading) : null,
          speed: position.coords.speed != null ? Number(position.coords.speed.toFixed(1)) : null,
          fixed_at: new Date(position.timestamp || Date.now()).toISOString()
        };
      } else if (position) {
        coords = {
          lat: Number(position.lat),
          lng: Number(position.lng),
          accuracy: position.accuracy != null ? Math.round(position.accuracy) : null,
          altitude: position.altitude != null ? Math.round(position.altitude) : null,
          alt_accuracy: null,
          heading: null,
          speed: null,
          fixed_at: new Date().toISOString()
        };
      }
    } catch (e) {}

    var p = getProfile();
    return battery().then(function (bat) {
      var ctx = {
        lat: coords.lat,
        lng: coords.lng,
        accuracy_m: coords.accuracy,
        altitude_m: coords.altitude,
        altitude_accuracy_m: coords.alt_accuracy,
        heading_deg: coords.heading,
        speed_ms: coords.speed,
        fixed_at: coords.fixed_at,
        plus_code: plusCode(coords.lat, coords.lng),
        battery_pct: bat ? bat.level : null,
        battery_charging: bat ? bat.charging : null,
        network: network(),
        offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
        profile: {
          blood: p.blood || null,
          allergy: p.allergy || null,
          illness: p.illness || null,
          kin_name: p.kin_name || null,
          kin_phone: p.kin_phone || null,
          group_size: p.group_size || null,
          route: p.route || null
        },
        collected_at: new Date().toISOString()
      };
      try { localStorage.setItem(LAST_CTX_KEY, JSON.stringify(ctx)); } catch (e) {}
      return ctx;
    });
  }

  function lastContext() {
    try { return JSON.parse(localStorage.getItem(LAST_CTX_KEY) || 'null'); }
    catch (e) { return null; }
  }

  // Teks ringkas untuk WA / SMS / dibacakan lewat HT.
  function summaryText(ctx, who) {
    var c = ctx || lastContext() || {};
    var nama = who || (window.BWKSosAuth && window.BWKSosAuth.displayName && window.BWKSosAuth.displayName()) || 'Pendaki';
    var lines = [];
    lines.push('DARURAT SOS - Jalur Bawakaraeng');
    lines.push('Nama: ' + nama);
    if (isFinite(c.lat) && isFinite(c.lng)) {
      lines.push('Koordinat: ' + Number(c.lat).toFixed(6) + ', ' + Number(c.lng).toFixed(6));
      if (c.plus_code) lines.push('Plus Code: ' + c.plus_code);
      lines.push('Peta: https://maps.google.com/?q=' + Number(c.lat).toFixed(6) + ',' + Number(c.lng).toFixed(6));
    } else {
      lines.push('Koordinat: BELUM TERKUNCI (GPS gagal)');
    }
    if (c.accuracy_m) lines.push('Akurasi: +/- ' + c.accuracy_m + ' m');
    if (c.altitude_m != null) lines.push('Ketinggian: ' + c.altitude_m + ' mdpl');
    if (c.battery_pct != null) lines.push('Baterai HP: ' + c.battery_pct + '%' + (c.battery_charging ? ' (mengisi)' : ''));
    var p = c.profile || {};
    if (p.group_size) lines.push('Jumlah rombongan: ' + p.group_size + ' orang');
    if (p.blood) lines.push('Golongan darah: ' + p.blood);
    if (p.allergy) lines.push('Alergi: ' + p.allergy);
    if (p.illness) lines.push('Riwayat penyakit: ' + p.illness);
    if (p.kin_name || p.kin_phone) lines.push('Kontak keluarga: ' + (p.kin_name || '-') + ' ' + (p.kin_phone || ''));
    if (c.fixed_at) lines.push('Waktu GPS: ' + new Date(c.fixed_at).toLocaleString('id-ID'));
    return lines.join('\n');
  }

  // ------------------------------------------------ Kartu Darurat (offline)
  function renderCard(host) {
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return null;
    var p = getProfile();
    var c = lastContext() || {};
    var koord = (isFinite(c.lat) && isFinite(c.lng))
      ? (Number(c.lat).toFixed(5) + ', ' + Number(c.lng).toFixed(5))
      : 'Belum ada';
    el.innerHTML =
      '<div class="bwk-ecard">' +
        '<div class="bwk-ecard-h"><span>\uD83E\uDE7A</span><b>Kartu Darurat</b>' +
        '<small>Tunjukkan ke penolong. Bekerja tanpa sinyal.</small></div>' +
        '<dl class="bwk-ecard-b">' +
          '<dt>Nama</dt><dd>' + esc(p.name || (window.BWKSosAuth ? window.BWKSosAuth.displayName() : 'Pendaki')) + '</dd>' +
          '<dt>Golongan darah</dt><dd>' + esc(p.blood || '-') + '</dd>' +
          '<dt>Alergi</dt><dd>' + esc(p.allergy || '-') + '</dd>' +
          '<dt>Riwayat penyakit</dt><dd>' + esc(p.illness || '-') + '</dd>' +
          '<dt>Kontak keluarga</dt><dd>' + esc((p.kin_name || '-') + ' ' + (p.kin_phone || '')) + '</dd>' +
          '<dt>Jalur</dt><dd>' + esc(p.route || '-') + '</dd>' +
          '<dt>Posisi terakhir</dt><dd>' + esc(koord) + '</dd>' +
          '<dt>Plus Code</dt><dd class="bwk-ecard-code">' + esc(c.plus_code || '-') + '</dd>' +
        '</dl>' +
        '<div class="bwk-ecard-f">Bacakan Plus Code lewat HT bila koordinat sulit disebut.</div>' +
      '</div>';
    return el;
  }

  // Form pengisian profil darurat.
  function renderForm(host) {
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return null;
    var p = getProfile();
    function row(id, label, val, ph) {
      return '<label class="bwk-ef-row"><span>' + esc(label) + '</span>' +
        '<input id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(ph || '') + '" /></label>';
    }
    el.innerHTML =
      '<div class="bwk-eform">' +
        row('efName', 'Nama lengkap', p.name, 'Nama yang muncul di alarm SOS') +
        row('efPhone', 'Nomor HP', p.phone, '08xxxxxxxxxx') +
        row('efBlood', 'Golongan darah', p.blood, 'A / B / AB / O') +
        row('efAllergy', 'Alergi', p.allergy, 'obat, makanan, sengatan') +
        row('efIllness', 'Riwayat penyakit', p.illness, 'asma, jantung, dll') +
        row('efKinName', 'Kontak keluarga', p.kin_name, 'nama') +
        row('efKinPhone', 'Nomor keluarga', p.kin_phone, '08xxxxxxxxxx') +
        row('efGroup', 'Jumlah rombongan', p.group_size || '', 'contoh: 4') +
        row('efRoute', 'Jalur pendakian', p.route, 'Lembanna - Pintu Angin') +
        '<button type="button" class="bwk-ef-save" id="efSave">Simpan Kartu Darurat</button>' +
        '<div class="bwk-ef-note" id="efNote"></div>' +
      '</div>';
    var btn = el.querySelector('#efSave');
    if (btn) {
      btn.addEventListener('click', function () {
        function val(id) { var n = el.querySelector('#' + id); return n ? n.value : ''; }
        setProfile({
          name: val('efName'), phone: val('efPhone'), blood: val('efBlood'),
          allergy: val('efAllergy'), illness: val('efIllness'),
          kin_name: val('efKinName'), kin_phone: val('efKinPhone'),
          group_size: val('efGroup'), route: val('efRoute')
        });
        try {
          if (window.BWKSosAuth && val('efName')) window.BWKSosAuth.setDisplayName(val('efName'));
        } catch (e) {}
        var note = el.querySelector('#efNote');
        if (note) note.textContent = 'Tersimpan di perangkat ini. Data hanya terkirim saat kamu menekan SOS.';
      });
    }
    return el;
  }

  window.BWKSosContext = {
    collect: collect,
    getProfile: getProfile,
    setProfile: setProfile,
    lastContext: lastContext,
    summaryText: summaryText,
    renderCard: renderCard,
    renderForm: renderForm
  };
})();
