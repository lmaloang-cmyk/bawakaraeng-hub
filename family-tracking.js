/* ============================================================================
 * BWK Family Tracking · family-tracking.js
 *
 * Fitur:
 *   - Mulai/berhenti session tracking real-time
 *   - Generate shareable link (URL pendek + token)
 *   - Bagikan ke WhatsApp, Salin link
 *   - Tampilkan status & posisi terakhir
 *   - Background sync saat tab tidak aktif
 *   - Offline queue (IndexedDB) untuk posisi yang gagal dikirim
 *
 * API:
 *   FamilyTracker.start()         -> Promise<{id, token, share_url}>
 *   FamilyTracker.stop()          -> Promise<void>
 *   FamilyTracker.share()         -> opens WA / copy link
 *   FamilyTracker.getStatus()     -> {active, last_pos, mins_ago}
 *   FamilyTracker.getPositions()  -> {positions[], total}
 *
 * Event: window.addEventListener('bwk:tracking', e => e.detail)
 * ==========================================================================*/
(function () {
  'use strict';

  var API = '/api/tracking';
  var LS_KEY = 'bwkTracking';
  var QUEUE_KEY = 'bwkTrackingQueue';
  var SYNC_TAG = 'bwk-tracking-pos';
  var DB_NAME = 'bwk-tracking-db';
  var DB_STORE = 'positions';
  var CHECK_INTERVAL = 15000; // 15 detik
  var MAX_QUEUE = 50;

  var _watchId = null;
  var _checkTimer = null;
  var _db = null;
  var _dbFailed = false;
  var _currentSession = null;
  var _lastSentPos = null;
  var _lastSentAt = 0;

  function now() { return Date.now(); }

  function emit(evt, detail) {
    try {
      window.dispatchEvent(new CustomEvent('bwk:tracking', { detail: { event: evt, ...detail } }));
    } catch (e) {}
  }

  function user() {
    try { return typeof bwkUser === 'function' ? bwkUser() : null; } catch (e) { return null; }
  }

  function token() {
    try {
      if (typeof _sbClient === 'function') {
        var c = _sbClient();
        if (!c) return Promise.resolve('');
        return c.auth.getSession().then(function (r) {
          return (r && r.data && r.data.session && r.data.session.access_token) || '';
        });
      }
    } catch (e) {}
    return Promise.resolve('');
  }

  function toast(m, t) { try { if (window.toast) window.toast(m, t || 'ok'); } catch (e) {} }

  function shareUrlFor(sessionId, shareToken) {
    if (!sessionId || !shareToken) return '';
    return window.location.origin + '/tracker.html?session=' +
      encodeURIComponent(sessionId) + '&token=' + encodeURIComponent(shareToken);
  }

  // ---------------------------------------------------------------- storage
  function openDb() {
    if (_dbFailed) return Promise.reject(new Error('idb-unavailable'));
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      try {
        if (!('indexedDB' in window)) throw new Error('no-idb');
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            var os = db.createObjectStore(DB_STORE, { keyPath: 'id' });
            os.createIndex('sessionId', 'sessionId', { unique: false });
            os.createIndex('sentAt', 'sentAt', { unique: false });
          }
        };
        req.onsuccess = function () { _db = req.result; resolve(_db); };
        req.onerror = function () { _dbFailed = true; reject(req.error || new Error('idb-open')); };
      } catch (e) { _dbFailed = true; reject(e); }
    });
  }

  function dbPut(item) {
    return new Promise(function (resolve, reject) {
      openDb().then(function (db) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(item);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      }).catch(reject);
    });
  }

  function dbGetAll(sessionId) {
    return new Promise(function (resolve, reject) {
      openDb().then(function (db) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var store = tx.objectStore(DB_STORE);
        var req = sessionId
          ? store.index('sessionId').getAll(IDBKeyRange.only(sessionId))
          : store.getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      }).catch(function () { resolve([]); });
    });
  }

  function dbClear(sessionId) {
    return new Promise(function (resolve) {
      openDb().then(function (db) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        var store = tx.objectStore(DB_STORE);
        if (!sessionId) {
          store.clear();
        } else {
          // IDBIndex tidak punya deleteAll() — hapus lewat cursor
          var req = store.index('sessionId').openCursor(IDBKeyRange.only(sessionId));
          req.onsuccess = function () {
            var cursor = req.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
          };
        }
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      }).catch(function () { resolve(); });
    });
  }

  // ---------------------------------------------------------------- localStorage
  function loadState() {
    try {
      var s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  function saveState(s) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function loadQueue() {
    try {
      var q = localStorage.getItem(QUEUE_KEY);
      return q ? JSON.parse(q) : [];
    } catch (e) { return []; }
  }

  function saveQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
  }

  // ---------------------------------------------------------------- API calls
  function apiPost(act, body) {
    return token().then(function (t) {
      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      };
      if (t) opts.headers['Authorization'] = 'Bearer ' + t;
      return fetch(API + '?act=' + act, opts).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; });
      });
    });
  }

  function apiGet(act, params) {
    var qs = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = API + '?act=' + act + (qs ? '&' + qs : '');
    return token().then(function (t) {
      var opts = {};
      if (t) opts.headers = { 'Authorization': 'Bearer ' + t };
      return fetch(url, opts).then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; });
      });
    });
  }

  // ---------------------------------------------------------------- core
  window.FamilyTracker = {

    /** Mulai pelacakan untuk sesi baru */
    start: function (opts) {
      opts = opts || {};
      var name = opts.name || 'Pelacakan Keluargaku';
      var note = opts.note || '';
      var expiryHours = opts.expiry_hours || 24;

      return apiPost('create', { name: name, note: note, expiry_hours: expiryHours })
        .then(function (r) {
          if (!r.ok || !r.data.ok) throw new Error(r.data?.error || 'Gagal membuat sesi');
          var s = r.data.session;
          var shareToken = r.data.token || '';
          _currentSession = s;
          // Simpan token di sesi aktif supaya tombol Bagikan langsung bisa dipakai
          _currentSession._shareToken = shareToken;
          _lastSentPos = null;
          _lastSentAt = 0;
          saveState({ sessionId: s.id, token: shareToken, name: s.name, startedAt: now() });
          emit('started', { session: s, token: shareToken });
          startWatching();
          toast('📍 Pelacakan dimulai — ' + s.name, 'ok');
          return {
            id: s.id,
            token: shareToken,
            share_url: r.data.share_url || shareUrlFor(s.id, shareToken)
          };
        })
        .catch(function (e) {
          toast('Gagal memulai: ' + (e.message || 'unknown'), 'err');
          emit('error', { error: e.message });
          throw e;
        });
    },

    /** Hentikan pelacakan */
    stop: function () {
      return apiPost('stop', { session_id: _currentSession?.id })
        .then(function (r) {
          stopWatching();
          _currentSession = null;
          saveState(null);
          emit('stopped', {});
          toast('🛑 Pelacakan dihentikan', 'ok');
        })
        .catch(function (e) {
          stopWatching();
          _currentSession = null;
          saveState(null);
          emit('stopped', {});
          toast('Pelacakan dihentikan', 'warn');
        });
    },

    /** Bagikan session ke WhatsApp atau salin link */
    share: function (sessionId, shareToken) {
      var state = loadState();
      var s = sessionId || _currentSession?.id || state?.sessionId;
      var t = shareToken || _currentSession?._shareToken || state?.token;
      if (!s || !t) { toast('Belum ada sesi aktif', 'err'); return; }

      var shareUrl = shareUrlFor(s, t);
      var sessName = state?.name || 'Pelacakan';

      var msg = '🥾 *Live Tracking — Pintu Angin*\n\nAku lagi mendaki *Gunung Bawakaraeng* 🏔️\nPantau posisiku real-time di sini:\n👉 ' + shareUrl + '\n\n_Link aman & otomatis berhenti saat sesi berakhir_';

      // Tampilkan pilihan bagikan
      var html = '<div style="padding:16px">';
      html += '<div style="font-weight:600;margin-bottom:12px">Bagikan Pelacakan:</div>';
      html += '<a href="https://wa.me/?text=' + encodeURIComponent(msg) + '" target="_blank" ' +
        'style="display:block;padding:10px 16px;background:#25D366;color:#fff;border-radius:10px;text-align:center;text-decoration:none;margin-bottom:8px;font-weight:600">📱 WhatsApp</a>';
      html += '<button onclick="FamilyTracker.copyShare(\'' + shareUrl + '\')" ' +
        'style="display:block;width:100%;padding:10px 16px;background:#2b6fff;color:#fff;border-radius:10px;border:none;font-size:14px;font-weight:600">📋 Salin Link</button>';
      html += '</div>';

      if (window.showModal) {
        window.showModal('Bagikan Pelacakan', html, 'ok');
      } else {
        // Fallback: buka WA langsung
        window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
      }
    },

    copyShare: function (url) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          toast('✅ Link berhasil disalin!', 'ok');
        }).catch(function () {
          fallbackCopy(url);
        });
      } else {
        fallbackCopy(url);
      }
    },

    getStatus: function () {
      if (!_currentSession || !_currentSession.id) return Promise.resolve(null);
      return apiGet('status', { id: _currentSession.id })
        .then(function (r) {
          if (r.ok && r.data.ok) return r.data.session;
          return null;
        })
        .catch(function () { return null; });
    },

    getPositions: function () {
      if (!_currentSession || !_currentSession.id) return Promise.resolve([]);
      return apiGet('history', { id: _currentSession.id, hours: 24, limit: 200 })
        .then(function (r) {
          if (r.ok && r.data.ok) return r.data.positions || [];
          return [];
        })
        .catch(function () { return []; });
    },

    getQueueSize: function () {
      return loadQueue().length;
    }
  };

  // ---------------------------------------------------------------- GPS watch
  function startWatching() {
    if (_watchId !== null) return;
    if (!navigator.geolocation) {
      toast('GPS tidak tersedia di perangkat ini', 'err');
      return;
    }

    _watchId = navigator.geolocation.watchPosition(
      function (pos) { sendPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); },
      function (err) { console.error('[tracking] GPS error:', err); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Periodic check jika watchPosition gagal
    _checkTimer = setInterval(checkAndSend, CHECK_INTERVAL);
    checkAndSend();
  }

  function stopWatching() {
    if (_watchId !== null) {
      navigator.geolocation.clearWatch(_watchId);
      _watchId = null;
    }
    if (_checkTimer) {
      clearInterval(_checkTimer);
      _checkTimer = null;
    }
  }

  function checkAndSend() {
    if (!_currentSession || !_currentSession.id) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      function (pos) { sendPosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); },
      function (err) { console.error('[tracking] check error:', err); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  function sendPosition(lat, lng, accuracy) {
    if (!_currentSession || !_currentSession.id) return;

    // Throttle: max 1 pos per 15 detik
    var ts = Date.now();
    if (ts - _lastSentAt < 15000) return;
    _lastSentAt = ts;

    var sessionId = _currentSession.id;

    // Battery API async — harus ditunggu, kalau tidak nilainya jadi Promise
    getBattery().then(function (battery) {
      var payload = {
        session_id: sessionId,
        lat: lat,
        lng: lng,
        accuracy: accuracy,
        battery_pct: battery,
        client_id: getClientId()
      };
      _lastSentPos = payload;

      // apiPost menyertakan access token Supabase yang asli
      return apiPost('positions', payload).then(function (r) {
        if (!r.ok || !r.data || !r.data.ok) {
          queuePosition(payload);
          emit('position_failed', { error: r.data?.error || 'unknown' });
          return;
        }
        dbClear(sessionId).catch(function () {});
        emit('position_sent', { lat: lat, lng: lng });
        if (loadQueue().length > 0) setTimeout(flushQueue, 1000);
      }).catch(function (e) {
        queuePosition(payload);
        console.error('[tracking] send failed:', e);
      });
    }).catch(function (e) {
      console.error('[tracking] send failed:', e);
    });
  }

  function queuePosition(payload) {
    var q = loadQueue();
    q.push({
      id: 'tq-' + now() + '-' + Math.random().toString(36).slice(2, 6),
      session_id: payload.session_id,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      battery_pct: payload.battery_pct,
      client_id: payload.client_id,
      queued_at: now()
    });
    if (q.length > MAX_QUEUE) q = q.slice(-MAX_QUEUE);
    saveQueue(q);
    emit('position_queued', { count: q.length });
  }

  function flushQueue() {
    var q = loadQueue();
    if (!q.length || !_currentSession || !_currentSession.id) return;

    // Send oldest first
    var item = q[0];
    apiPost('positions', {
      session_id: _currentSession.id,
      lat: item.lat,
      lng: item.lng,
      accuracy: item.accuracy,
      battery_pct: item.battery_pct,
      client_id: item.client_id
    }).then(function (r) {
      if (!r.ok || !r.data || !r.data.ok) return;
      var cur = loadQueue();
      cur.shift();
      saveQueue(cur);
      emit('queue_flushed', { remaining: cur.length });
      if (cur.length > 0) setTimeout(flushQueue, 2000);
    }).catch(function () { /* will retry on next flush */ });
  }

  // ---------------------------------------------------------------- helpers
  function getBattery() {
    try {
      if (typeof navigator.getBattery === 'function') {
        return navigator.getBattery().then(function (b) {
          return b && typeof b.level === 'number' ? Math.round(b.level * 100) : null;
        }).catch(function () { return null; });
      }
    } catch (e) {}
    return Promise.resolve(null);
  }

  function getClientId() {
    try {
      var cid = localStorage.getItem('bwkTrackingClientId');
      if (cid) return cid;
      cid = 'ft-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('bwkTrackingClientId', cid);
      return cid;
    } catch (e) { return ''; }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('✅ Link berhasil disalin!', 'ok'); }
    catch (e) { toast('Gagal menyalin link', 'err'); }
    document.body.removeChild(ta);
  }

  // ---------------------------------------------------------------- init
  function init() {
    // Restore session
    var state = loadState();
    if (state && state.sessionId) {
      _currentSession = { id: state.sessionId, name: state.name, _shareToken: state.token || '' };
      emit('restored', { session: _currentSession });
      startWatching();
      flushQueue();
    }

    // Listen for online event to flush queue
    window.addEventListener('online', function () {
      if (loadQueue().length > 0) flushQueue();
    });

    // Listen for storage events (tab sync)
    window.addEventListener('storage', function (e) {
      if (e.key === LS_KEY) {
        var newState = e.newValue ? JSON.parse(e.newValue) : null;
        if (newState && newState.sessionId !== _currentSession?.id) {
          stopWatching();
          _currentSession = { id: newState.sessionId, name: newState.name, _shareToken: newState.token || '' };
          emit('restored', { session: _currentSession });
          startWatching();
        } else if (!newState) {
          stopWatching();
          _currentSession = null;
          emit('stopped', {});
        }
      }
    });
  }

  // Expose flush for manual trigger
  window.flushTrackingQueue = flushQueue;

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
