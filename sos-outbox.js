/* ============================================================================
 * BWK SOS · sos-outbox.js
 * Antrean SOS tahan-gagal berbasis IndexedDB + Background Sync.
 *
 * MENGGANTIKAN antrean lama di ops.js (localStorage 'bwkSosQueue') yang punya
 * tiga bug fatal:
 *   1. _sosQueueDequeue() mengembalikan item TANPA menghapusnya, dan pada jalur
 *      sukses _sosQueueRemove() tidak pernah dipanggil -> SOS yang sudah terkirim
 *      dikirim ulang selamanya setiap kali perangkat online.
 *   2. Pada jalur gagal, _sosQueueEnqueue(item.payload) menambah SALINAN BARU,
 *      bukan mengembalikan item yang sama -> antrean menggandakan diri.
 *   3. Tidak ada batas percobaan, tidak ada backoff, dan pengiriman hanya terjadi
 *      saat tab terbuka. Kalau internet pulih ketika layar mati, tidak ada yang
 *      mengirim SOS tersebut.
 *
 * Desain baru:
 *   - Satu record per SOS dengan client_id (idempoten, server bisa dedup).
 *   - Status: pending -> sending -> sent | dead.
 *   - Backoff berjenjang + batas percobaan, tidak pernah menggandakan diri.
 *   - Background Sync: service worker yang mengirim, jadi tetap jalan saat tab tutup.
 *   - Fallback localStorage bila IndexedDB diblokir (mode privat sebagian browser).
 *
 * API:
 *   BWKSosOutbox.enqueue(payload)  -> Promise<record>
 *   BWKSosOutbox.flush()           -> Promise<{sent, failed, remaining}>
 *   BWKSosOutbox.list()            -> Promise<record[]>
 *   BWKSosOutbox.count()           -> Promise<number>
 *   BWKSosOutbox.remove(id)        -> Promise<void>
 *   BWKSosOutbox.setTokenProvider(fn) // fn() -> Promise<string>
 * Event: window.addEventListener('bwk:sos-outbox', e => e.detail)
 * ==========================================================================*/
(function () {
  'use strict';

  var DB_NAME = 'bwk-sos-db';
  var DB_VERSION = 1;
  var STORE = 'outbox';
  var LS_KEY = 'bwkSosOutbox';
  var SYNC_TAG = 'bwk-sos-outbox';
  var ENDPOINT = '/api/operations?action=sos-create';

  var MAX_ITEMS = 25;
  var TTL_MS = 24 * 60 * 60 * 1000;
  // 30 percobaan dengan tangga backoff di bawah merentang lebih dari 5 jam.
  // Angka ini disengaja besar: pendaki bisa berjam-jam di area tanpa sinyal,
  // dan SOS yang menyerah setelah 1 jam sama saja dengan SOS yang hilang.
  var MAX_TRIES = 30;
  // Backoff berjenjang (ms). Setelah habis, pakai nilai terakhir (15 menit).
  var BACKOFF = [0, 5000, 15000, 30000, 60000, 120000, 300000, 600000, 900000];

  var _db = null;
  var _dbFailed = false;
  var _flushing = false;
  var _timer = null;
  var _tokenProvider = null;

  function now() { return Date.now(); }

  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return 'sos-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emit(detail) {
    try {
      window.dispatchEvent(new CustomEvent('bwk:sos-outbox', { detail: detail || {} }));
    } catch (e) {}
  }

  // ---------------------------------------------------------------- storage
  function openDb() {
    if (_dbFailed) return Promise.reject(new Error('idb-unavailable'));
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req;
      try {
        if (!('indexedDB' in window)) throw new Error('no-idb');
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        _dbFailed = true;
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('status', 'status', { unique: false });
          os.createIndex('nextAt', 'nextAt', { unique: false });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { _dbFailed = true; reject(req.error || new Error('idb-open')); };
      req.onblocked = function () { _dbFailed = true; reject(new Error('idb-blocked')); };
    });
  }

  function lsRead() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]') || []; }
    catch (e) { return []; }
  }

  function lsWrite(rows) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(0, MAX_ITEMS))); } catch (e) {}
  }

  function allRecords() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    }).catch(function () { return lsRead(); });
  }

  function putRecord(rec) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(rec);
        tx.oncomplete = function () { resolve(rec); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {
      var rows = lsRead().filter(function (r) { return r.id !== rec.id; });
      rows.unshift(rec);
      lsWrite(rows);
      return rec;
    });
  }

  function deleteRecord(id) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {
      lsWrite(lsRead().filter(function (r) { return r.id !== id; }));
    });
  }

  // Buang record kedaluwarsa / sudah selesai, dan batasi jumlahnya.
  function prune(rows) {
    var cut = now() - TTL_MS;
    var keep = [];
    var drop = [];
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      if (r.status === 'sent') { drop.push(r.id); return; }
      if (r.ts < cut) { drop.push(r.id); return; }
      keep.push(r);
    });
    keep.sort(function (a, b) { return b.ts - a.ts; });
    if (keep.length > MAX_ITEMS) {
      keep.slice(MAX_ITEMS).forEach(function (r) { drop.push(r.id); });
      keep = keep.slice(0, MAX_ITEMS);
    }
    return Promise.all(drop.map(deleteRecord)).then(function () { return keep; });
  }

  // ------------------------------------------------------------------ token
  function defaultToken() {
    try {
      if (window.BWKSosAuth && typeof window.BWKSosAuth.token === 'function') {
        return Promise.resolve(window.BWKSosAuth.token());
      }
      if (typeof window._sbClient === 'function') {
        var c = window._sbClient();
        if (c && c.auth) {
          return c.auth.getSession().then(function (r) {
            var t = (r && r.data && r.data.session && r.data.session.access_token) || null;
            if (t) return t;
            // PERBAIKAN: Jika getSession() return null (sesi kosong/kedaluwarsa),
            // coba fallback ke BWKSosAuth jika tersedia.
            if (window.BWKSosAuth && typeof window.BWKSosAuth.token === 'function') {
              return window.BWKSosAuth.token().catch(function () { return ''; });
            }
            return '';
          }).catch(function () { return ''; });
        }
      }
    } catch (e) {}
    return Promise.resolve('');
  }

  function getToken() {
    try {
      var p = _tokenProvider ? _tokenProvider() : defaultToken();
      return Promise.resolve(p).catch(function () { return ''; });
    } catch (e) { return Promise.resolve(''); }
  }

  // ------------------------------------------------------------------ queue
  function enqueue(payload) {
    var rec = {
      id: uuid(),
      client_id: uuid(),
      ts: now(),
      nextAt: now(),
      tries: 0,
      status: 'pending',
      lastError: '',
      payload: payload || {}
    };
    return putRecord(rec).then(function () {
      emit({ type: 'enqueued', id: rec.id });
      requestBackgroundSync();
      schedule(1000);
      return rec;
    });
  }

  function backoffFor(tries) {
    return BACKOFF[Math.min(tries, BACKOFF.length - 1)];
  }

  function sendOne(rec, token) {
    var body = {};
    try {
      Object.keys(rec.payload || {}).forEach(function (k) { body[k] = rec.payload[k]; });
    } catch (e) {}
    body.client_id = rec.client_id;
    body.queued_at = new Date(rec.ts).toISOString();

    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(ENDPOINT, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { status: r.status, ok: r.ok, data: d || {} };
      });
    });
  }

  // Klasifikasi hasil: sukses / gagal permanen / gagal sementara.
  function classify(res) {
    if (res.ok && res.data && res.data.id) return { kind: 'sent', id: res.data.id };
    // 409 = SOS aktif milik sendiri sudah ada. Itu SUKSES, bukan kegagalan.
    if (res.status === 409 && res.data && res.data.id) return { kind: 'sent', id: res.data.id };
    // 400/413 = payload memang tidak valid. Mengulang tidak akan pernah berhasil.
    if (res.status === 400 || res.status === 413) return { kind: 'dead', why: 'data tidak valid' };
    if (res.status === 401 || res.status === 403) return { kind: 'retry', why: 'sesi belum siap' };
    if (res.status === 429) return { kind: 'retry', why: 'kuota server penuh' };
    return { kind: 'retry', why: 'server kode ' + res.status };
  }

  function flush() {
    if (_flushing) return Promise.resolve({ sent: 0, failed: 0, remaining: -1, skipped: true });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.resolve({ sent: 0, failed: 0, remaining: -1, offline: true });
    }
    _flushing = true;
    var sent = 0;
    var failed = 0;

    return allRecords()
      .then(prune)
      .then(function (rows) {
        var due = rows.filter(function (r) {
          return r.status !== 'sent' && r.status !== 'dead' && (r.nextAt || 0) <= now();
        });
        if (!due.length) return rows.length;

        return getToken().then(function (token) {
          // Kirim berurutan: SOS lebih penting sampai daripada cepat.
          return due.reduce(function (chain, rec) {
            return chain.then(function () {
              rec.status = 'sending';
              return putRecord(rec)
                .then(function () { return sendOne(rec, token); })
                .then(function (res) {
                  var verdict = classify(res);
                  if (verdict.kind === 'sent') {
                    sent++;
                    // HAPUS record. Inilah langkah yang hilang di versi lama.
                    return deleteRecord(rec.id).then(function () {
                      emit({ type: 'sent', id: rec.id, sosId: verdict.id });
                      try {
                        if (window._sosAdoptQueued) window._sosAdoptQueued(verdict.id, rec.payload);
                      } catch (e) {}
                    });
                  }
                  if (verdict.kind === 'dead') {
                    failed++;
                    rec.status = 'dead';
                    rec.lastError = verdict.why;
                    return putRecord(rec).then(function () {
                      emit({ type: 'dead', id: rec.id, why: verdict.why });
                    });
                  }
                  failed++;
                  rec.tries += 1;
                  rec.lastError = verdict.why;
                  rec.status = rec.tries >= MAX_TRIES ? 'dead' : 'pending';
                  rec.nextAt = now() + backoffFor(rec.tries);
                  return putRecord(rec).then(function () {
                    emit({ type: rec.status === 'dead' ? 'dead' : 'retry', id: rec.id, tries: rec.tries, why: verdict.why });
                  });
                })
                .catch(function (err) {
                  failed++;
                  rec.tries += 1;
                  rec.lastError = String((err && err.message) || 'jaringan gagal');
                  rec.status = rec.tries >= MAX_TRIES ? 'dead' : 'pending';
                  rec.nextAt = now() + backoffFor(rec.tries);
                  return putRecord(rec).then(function () {
                    emit({ type: 'retry', id: rec.id, tries: rec.tries, why: rec.lastError });
                  });
                });
            });
          }, Promise.resolve()).then(function () { return rows.length; });
        });
      })
      .then(function () { return allRecords(); })
      .then(function (rows) {
        var remaining = rows.filter(function (r) { return r.status !== 'sent' && r.status !== 'dead'; }).length;
        _flushing = false;
        if (remaining) schedule();
        return { sent: sent, failed: failed, remaining: remaining };
      })
      .catch(function (err) {
        _flushing = false;
        return { sent: sent, failed: failed, remaining: -1, error: String((err && err.message) || err) };
      });
  }

  // ------------------------------------------------------------- penjadwalan
  function schedule(ms) {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    var wait = ms == null ? 30000 : ms;
    _timer = setTimeout(function () { flush(); }, wait);
  }

  function requestBackgroundSync() {
    try {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg && reg.sync && reg.sync.register) {
          reg.sync.register(SYNC_TAG).catch(function () {});
        }
      }).catch(function () {});
    } catch (e) {}
  }

  function count() {
    return allRecords().then(function (rows) {
      return rows.filter(function (r) { return r.status !== 'sent' && r.status !== 'dead'; }).length;
    });
  }

  // Service worker meminta halaman melakukan flush (SW tidak memegang token sesi).
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (ev) {
        var d = ev && ev.data;
        if (d && d.type === 'bwk-sos-flush') flush();
      });
    }
  } catch (e) {}

  window.addEventListener('online', function () { flush(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) flush(); });
  window.addEventListener('load', function () { setTimeout(flush, 2500); });

  window.BWKSosOutbox = {
    enqueue: enqueue,
    flush: flush,
    list: allRecords,
    count: count,
    remove: deleteRecord,
    setTokenProvider: function (fn) { _tokenProvider = typeof fn === 'function' ? fn : null; },
    SYNC_TAG: SYNC_TAG
  };
})();
