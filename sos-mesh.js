/* ============================================================================
 * BWK SOS · sos-mesh.js  [OPSIONAL · EKSPERIMENTAL]
 * Jembatan SOS ke jaringan LoRa mesh Meshtastic lewat Web Bluetooth.
 *
 * INI ADALAH LAPIS KE-3: bekerja tanpa sinyal seluler sama sekali.
 *   Lapis 1 internet (Web Push)  -> sudah ada
 *   Lapis 2 GSM (SMS/WA/telepon) -> sos-relay.js
 *   Lapis 3 LoRa mesh            -> file ini
 *
 * CARA KERJA:
 *   Pendaki membawa satu node LoRa murah (Heltec V3 / T-Beam, ~Rp250-400rb)
 *   berisi firmware Meshtastic. HP tersambung ke node lewat Bluetooth langsung
 *   dari browser — tanpa aplikasi native. Setiap node meneruskan paket ke node
 *   lain, jadi SOS melompat sampai node gateway di basecamp yang punya internet.
 *
 * PENTING — BACA SEBELUM DIPAKAI:
 *   1. Web Bluetooth hanya tersedia di Chrome/Edge Android & desktop, wajib HTTPS.
 *      Safari iOS TIDAK mendukung. Modul ini otomatis menonaktifkan diri.
 *   2. Protokol Meshtastic memakai Protobuf. Membangun paket biner sendiri di
 *      sini akan rapuh dan mudah rusak saat firmware naik versi. Karena itu
 *      modul ini TIDAK menulis paket sendiri: ia memakai pustaka resmi
 *      @meshtastic/js bila tersedia (window.Meshtastic), dan hanya melakukan
 *      deteksi perangkat bila tidak.
 *      Pustaka resmi: https://github.com/meshtastic/web (838 bintang, TypeScript)
 *   3. UUID BLE di bawah harus diverifikasi ulang terhadap firmware yang dipakai
 *      sebelum dianggap final. Sudah disiapkan agar mudah diganti.
 *
 * API:
 *   BWKSosMesh.available()      -> boolean
 *   BWKSosMesh.status()         -> {supported, connected, deviceName, libLoaded}
 *   BWKSosMesh.connect()        -> Promise<{ok, deviceName, error}>
 *   BWKSosMesh.disconnect()
 *   BWKSosMesh.sendSos(ctx)     -> Promise<{ok, via, error}>
 * ==========================================================================*/
(function () {
  'use strict';

  // UUID layanan BLE Meshtastic. Verifikasi terhadap firmware sebelum produksi.
  var SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
  var CH_TO_RADIO = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
  var CH_FROM_RADIO = '2c55e69e-4993-11ed-b878-0242ac120002';
  var CH_FROM_NUM = 'ed9da18c-a800-4f66-a670-aa7547e34453';

  var _device = null;
  var _server = null;
  var _service = null;
  var _connected = false;

  function supported() {
    try {
      return !!(navigator && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function' &&
        window.isSecureContext);
    } catch (e) { return false; }
  }

  function libLoaded() {
    try { return !!(window.Meshtastic || window.MeshtasticClient); } catch (e) { return false; }
  }

  function status() {
    return {
      supported: supported(),
      connected: _connected,
      deviceName: _device ? String(_device.name || 'Node LoRa') : '',
      libLoaded: libLoaded()
    };
  }

  function onDisconnected() {
    _connected = false;
    _server = null;
    _service = null;
    try {
      window.dispatchEvent(new CustomEvent('bwk:mesh', { detail: { type: 'disconnected' } }));
    } catch (e) {}
  }

  function connect() {
    if (!supported()) {
      return Promise.resolve({ ok: false, error: 'Web Bluetooth tidak didukung di perangkat/browser ini' });
    }
    return navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    }).then(function (dev) {
      _device = dev;
      try { dev.addEventListener('gattserverdisconnected', onDisconnected); } catch (e) {}
      return dev.gatt.connect();
    }).then(function (srv) {
      _server = srv;
      return srv.getPrimaryService(SERVICE_UUID);
    }).then(function (svc) {
      _service = svc;
      _connected = true;
      try {
        window.dispatchEvent(new CustomEvent('bwk:mesh', {
          detail: { type: 'connected', name: _device && _device.name }
        }));
      } catch (e) {}
      return { ok: true, deviceName: (_device && _device.name) || 'Node LoRa' };
    }).catch(function (err) {
      _connected = false;
      var msg = String((err && err.message) || err);
      if (/User cancelled|cancell?ed/i.test(msg)) msg = 'Pemilihan perangkat dibatalkan';
      return { ok: false, error: msg };
    });
  }

  function disconnect() {
    try {
      if (_device && _device.gatt && _device.gatt.connected) _device.gatt.disconnect();
    } catch (e) {}
    onDisconnected();
  }

  // Teks SOS dipadatkan agar muat di batas payload LoRa (aman di bawah 200 byte).
  function compactText(ctx) {
    var c = ctx || (window.BWKSosContext && window.BWKSosContext.lastContext()) || {};
    var nama = 'Pendaki';
    try {
      if (window.BWKSosAuth && window.BWKSosAuth.displayName) nama = window.BWKSosAuth.displayName();
    } catch (e) {}
    var parts = ['SOS', nama];
    if (c.plus_code) parts.push(c.plus_code);
    else if (isFinite(c.lat) && isFinite(c.lng)) parts.push(Number(c.lat).toFixed(5) + ',' + Number(c.lng).toFixed(5));
    if (c.altitude_m != null) parts.push(c.altitude_m + 'mdpl');
    if (c.battery_pct != null) parts.push('bat' + c.battery_pct);
    var text = parts.join(' ');
    return text.length > 190 ? text.slice(0, 190) : text;
  }

  function sendSos(ctx) {
    var text = compactText(ctx);
    // Jalur 1 (disarankan): pustaka resmi @meshtastic/js sudah dimuat halaman.
    try {
      var lib = window.Meshtastic || window.MeshtasticClient;
      if (lib && typeof window.bwkMeshSendText === 'function') {
        return Promise.resolve(window.bwkMeshSendText(text))
          .then(function () { return { ok: true, via: 'meshtastic-js' }; })
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
      }
    } catch (e) {}

    // Jalur 2: belum ada pustaka. Jangan pura-pura berhasil — laporkan apa adanya
    // supaya pengguna tidak merasa aman padahal pesan tidak terkirim.
    if (!_connected) {
      return Promise.resolve({
        ok: false,
        error: 'Node LoRa belum tersambung. Tekan "Sambungkan Node LoRa" dulu.'
      });
    }
    return Promise.resolve({
      ok: false,
      via: 'ble-detected',
      error: 'Node terdeteksi, tetapi pustaka @meshtastic/js belum dimuat. ' +
             'Tambahkan bundel @meshtastic/js lalu sediakan window.bwkMeshSendText(text).'
    });
  }

  function renderPanel(host) {
    var el = typeof host === 'string' ? document.getElementById(host) : host;
    if (!el) return null;
    var st = status();
    if (!st.supported) {
      el.innerHTML = '<div class="bwk-mesh off">Radio LoRa tidak tersedia di browser ini. ' +
        'Gunakan Chrome di Android untuk fitur mesh.</div>';
      return el;
    }
    el.innerHTML =
      '<div class="bwk-mesh">' +
        '<div class="bwk-mesh-h"><b>\uD83D\uDCE1 Radio LoRa (tanpa sinyal)</b>' +
        '<small>' + (st.connected ? ('Tersambung: ' + st.deviceName) : 'Belum tersambung') + '</small></div>' +
        '<button type="button" id="bwkMeshBtn" class="bwk-mesh-b">' +
        (st.connected ? 'Putuskan' : 'Sambungkan Node LoRa') + '</button>' +
        '<div class="bwk-mesh-note" id="bwkMeshNote"></div>' +
      '</div>';
    var btn = el.querySelector('#bwkMeshBtn');
    var note = el.querySelector('#bwkMeshNote');
    if (btn) {
      btn.addEventListener('click', function () {
        if (status().connected) { disconnect(); renderPanel(el); return; }
        btn.disabled = true;
        if (note) note.textContent = 'Mencari node LoRa terdekat...';
        connect().then(function (r) {
          btn.disabled = false;
          if (note) note.textContent = r.ok ? ('Tersambung ke ' + r.deviceName) : ('Gagal: ' + r.error);
          renderPanel(el);
        });
      });
    }
    return el;
  }

  window.BWKSosMesh = {
    available: supported,
    status: status,
    connect: connect,
    disconnect: disconnect,
    sendSos: sendSos,
    renderPanel: renderPanel,
    UUIDS: { service: SERVICE_UUID, toRadio: CH_TO_RADIO, fromRadio: CH_FROM_RADIO, fromNum: CH_FROM_NUM }
  };
})();
