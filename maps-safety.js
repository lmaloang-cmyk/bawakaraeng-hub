/*!
 * maps-safety.js - Navigasi & keselamatan MAPS Pintu Angin
 * Paket perbaikan hasil audit 23 Agustus 2026.
 *
 * Menambahkan yang belum ada di aplikasi:
 *   - error boundary GPS (pendaki tidak dibiarkan menatap layar diam)
 *   - reset progress checkpoint
 *   - alarm keluar jalur (off-trail alert) dengan histeresis
 *   - sisa jarak, sisa tanjakan, dan ETA (Tobler hiking function)
 *   - Wake Lock + filter akurasi GPS
 *   - perekaman track ke IndexedDB (bukan localStorage)
 *
 * Butuh maps-storage.js dimuat lebih dulu.
 *
 * API:
 *   BWKSafety.start({ route, checkpoints, onEvent })
 *   BWKSafety.stop() / resetProgress() / state() / formatEta(detik)
 *   BWKSafety.exportGpx(points, name)
 */
(function (global) {
  'use strict';

  var R = 6371000;

  function toRad(d) { return (d * Math.PI) / 180; }

  function haversine(a, b) {
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var la1 = toRad(a.lat), la2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function distToSegment(p, a, b) {
    var kx = Math.cos(toRad(p.lat)) * 111320, ky = 110540;
    var px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
    var bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky;
    var len2 = bx * bx + by * by;
    var t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    var dx = px - bx * t, dy = py - by * t;
    return { dist: Math.sqrt(dx * dx + dy * dy), t: t };
  }

  function nearestOnRoute(p, route) {
    var best = { dist: Infinity, index: 0, t: 0 };
    for (var i = 0; i < route.length - 1; i++) {
      var r = distToSegment(p, route[i], route[i + 1]);
      if (r.dist < best.dist) best = { dist: r.dist, index: i, t: r.t };
    }
    return best;
  }

  function toblerSpeed(slope) {
    return 6 * Math.exp(-3.5 * Math.abs(slope + 0.05)) * 1000 / 3600;
  }

  function routeRemaining(route, fromIndex) {
    var dist = 0, gain = 0;
    for (var i = fromIndex; i < route.length - 1; i++) {
      dist += haversine(route[i], route[i + 1]);
      var dh = (route[i + 1].alt || 0) - (route[i].alt || 0);
      if (dh > 0) gain += dh;
    }
    return { dist: dist, gain: gain };
  }

  function etaSeconds(route, fromIndex) {
    var secs = 0;
    for (var i = fromIndex; i < route.length - 1; i++) {
      var d = haversine(route[i], route[i + 1]);
      if (!d) continue;
      var dh = (route[i + 1].alt || 0) - (route[i].alt || 0);
      secs += d / toblerSpeed(dh / d);
    }
    return secs;
  }

  function beep() {
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () { try { osc.stop(); ctx.close(); } catch (e) {} }, 350);
    } catch (e) { /* audio diblokir browser */ }
  }

  function buzz(pattern) {
    if (global.navigator && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  var OFF_ROUTE_M = 50;
  var BACK_ON_ROUTE_M = 30;
  var ALERT_COOLDOWN_MS = 60000;
  var CHECKPOINT_RADIUS_M = 100;
  var MAX_ACCURACY_M = 30;

  var state = {
    running: false,
    watchId: null,
    guard: null,
    wakeLock: null,
    route: [],
    checkpoints: [],
    reached: {},
    points: [],
    buffer: [],
    trackId: null,
    offRoute: false,
    lastAlertAt: 0,
    lastFixAt: 0,
    lastPos: null,
    onEvent: function () {}
  };

  function emit(type, data) {
    var detail = { type: type };
    Object.keys(data || {}).forEach(function (k) { detail[k] = data[k]; });
    try { state.onEvent(detail); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent('bwk:safety', { detail: detail })); } catch (e) {}
  }

  function loadProgress() {
    try {
      var raw = global.localStorage.getItem('bwkHikeProgress');
      state.reached = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { state.reached = {}; }
  }

  function saveProgress() {
    try { global.localStorage.setItem('bwkHikeProgress', JSON.stringify(state.reached)); } catch (e) {}
  }

  function flushBuffer(force) {
    if (!global.BWKStore) return;
    if (!force && state.buffer.length < 20) return;
    var chunk = state.buffer.splice(0, state.buffer.length);
    if (!chunk.length) return;
    state.points = state.points.concat(chunk);
    global.BWKStore.put('tracks', {
      id: state.trackId,
      name: 'Trek ' + new Date(state.points[0].t).toLocaleString('id-ID'),
      points: state.points,
      createdAt: state.points[0].t
    }).catch(function () {});
  }

  function handleFix(pos) {
    var acc = pos.coords.accuracy;
    state.lastFixAt = Date.now();

    if (acc > MAX_ACCURACY_M) {
      emit('gps-lemah', { accuracy: Math.round(acc) });
      return;
    }

    var p = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      alt: pos.coords.altitude || 0,
      acc: acc,
      t: Date.now()
    };

    if (state.lastPos) {
      var dt = Math.max(1, (p.t - state.lastPos.t) / 1000);
      if (haversine(state.lastPos, p) / dt > 40) return; // lompatan mustahil
    }
    state.lastPos = p;
    state.buffer.push(p);
    flushBuffer(false);

    var info = { position: p, accuracy: Math.round(acc) };

    if (state.route.length > 1) {
      var near = nearestOnRoute(p, state.route);
      var rem = routeRemaining(state.route, near.index);
      info.offRouteMeters = Math.round(near.dist);
      info.remainingMeters = Math.round(rem.dist);
      info.remainingGain = Math.round(rem.gain);
      info.etaSeconds = Math.round(etaSeconds(state.route, near.index));

      var now = Date.now();
      if (!state.offRoute && near.dist > OFF_ROUTE_M) {
        state.offRoute = true;
        if (now - state.lastAlertAt > ALERT_COOLDOWN_MS) {
          state.lastAlertAt = now;
          buzz([300, 150, 300]);
          beep();
          emit('keluar-jalur', { meters: Math.round(near.dist) });
        }
      } else if (state.offRoute && near.dist < BACK_ON_ROUTE_M) {
        state.offRoute = false;
        buzz(120);
        emit('kembali-ke-jalur', { meters: Math.round(near.dist) });
      }
    }

    state.checkpoints.forEach(function (cp, i) {
      var id = cp.id || ('cp-' + i);
      if (state.reached[id]) return;
      if (haversine(p, cp) <= (cp.radius || CHECKPOINT_RADIUS_M)) {
        state.reached[id] = Date.now();
        saveProgress();
        buzz([100, 80, 100]);
        emit('checkpoint', { checkpoint: cp, index: i, total: state.checkpoints.length });
        if (global.BWKStore) {
          global.BWKStore.outbox.add('checkin', {
            checkpoint: id, lat: p.lat, lng: p.lng, alt: p.alt, at: new Date().toISOString()
          }).catch(function () {});
        }
      }
    });

    emit('posisi', info);
  }

  function handleError(err) {
    var pesan;
    if (err.code === 1) pesan = 'Izin lokasi ditolak. Buka Pengaturan > Situs > Lokasi, lalu izinkan.';
    else if (err.code === 2) pesan = 'GPS belum dapat sinyal. Keluar dari tenda atau pohon rapat, tunggu 30 detik.';
    else if (err.code === 3) pesan = 'GPS lambat merespons. Tetap di tempat terbuka, aplikasi terus mencoba.';
    else pesan = 'GPS bermasalah. Coba matikan lalu nyalakan lagi lokasi di HP.';
    emit('gps-error', { code: err.code, message: pesan });
  }

  function requestWakeLock() {
    if (!global.navigator || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      state.wakeLock = lock;
      lock.addEventListener('release', function () { state.wakeLock = null; });
    }).catch(function () {});
  }

  var BWKSafety = {
    OFF_ROUTE_M: OFF_ROUTE_M,

    start: function (opts) {
      if (state.running) return false;
      if (!global.navigator || !navigator.geolocation) {
        emit('gps-error', { code: 0, message: 'Perangkat ini tidak mendukung GPS.' });
        return false;
      }
      opts = opts || {};
      state.route = opts.route || [];
      state.checkpoints = opts.checkpoints || [];
      state.onEvent = opts.onEvent || function () {};
      state.points = [];
      state.buffer = [];
      state.lastPos = null;
      state.offRoute = false;
      state.trackId = 'track-' + Date.now();
      loadProgress();

      try {
        state.watchId = navigator.geolocation.watchPosition(handleFix, handleError, {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 20000
        });
      } catch (e) {
        emit('gps-error', { code: 0, message: 'Gagal memulai GPS: ' + e.message });
        return false;
      }

      state.running = true;
      requestWakeLock();
      global.document.addEventListener('visibilitychange', BWKSafety._onVisibility);

      state.guard = setInterval(function () {
        if (state.lastFixAt && Date.now() - state.lastFixAt > 90000) {
          emit('gps-hilang', { message: 'Sinyal GPS hilang lebih dari 1 menit. Cari langit terbuka.' });
          state.lastFixAt = Date.now();
        }
      }, 30000);

      emit('mulai', { checkpoints: state.checkpoints.length });
      return true;
    },

    _onVisibility: function () {
      if (global.document.visibilityState === 'visible' && state.running && !state.wakeLock) {
        requestWakeLock();
      }
    },

    stop: function () {
      if (!state.running) return null;
      if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
      if (state.guard) clearInterval(state.guard);
      global.document.removeEventListener('visibilitychange', BWKSafety._onVisibility);
      if (state.wakeLock) { try { state.wakeLock.release(); } catch (e) {} state.wakeLock = null; }
      flushBuffer(true);
      state.running = false;
      state.watchId = null;
      emit('berhenti', { points: state.points.length });
      return { trackId: state.trackId, points: state.points.slice() };
    },

    resetProgress: function () {
      state.reached = {};
      saveProgress();
      emit('progress-direset', {});
      return true;
    },

    state: function () {
      return {
        running: state.running,
        offRoute: state.offRoute,
        reached: Object.keys(state.reached).length,
        totalCheckpoints: state.checkpoints.length,
        points: state.points.length
      };
    },

    formatEta: function (secs) {
      if (!secs || secs < 0) return '-';
      var h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60);
      return h ? (h + ' j ' + m + ' m') : (m + ' menit');
    },

    exportGpx: function (points, name) {
      var head = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<gpx version="1.1" creator="Pintu Angin" xmlns="http://www.topografix.com/GPX/1/1">\n' +
        '<trk><name>' + String(name || 'Trek Pintu Angin').replace(/[<&>]/g, '') + '</name><trkseg>\n';
      var body = (points || []).map(function (p) {
        return '<trkpt lat="' + p.lat + '" lon="' + p.lng + '">' +
          '<ele>' + (p.alt || 0) + '</ele>' +
          '<time>' + new Date(p.t || Date.now()).toISOString() + '</time></trkpt>';
      }).join('\n');
      return head + body + '\n</trkseg></trk></gpx>';
    },

    _util: {
      haversine: haversine,
      nearestOnRoute: nearestOnRoute,
      etaSeconds: etaSeconds,
      routeRemaining: routeRemaining
    }
  };

  global.BWKSafety = BWKSafety;
})(typeof window !== 'undefined' ? window : this);
