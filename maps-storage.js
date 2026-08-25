/*!
 * maps-storage.js — Penyimpanan data MAPS Pintu Angin
 * Paket perbaikan hasil audit 23 Agustus 2026.
 *
 * Kenapa ada file ini:
 *   - bwkTracks & bwkWaypoints saat ini disimpan di localStorage (batas ~5 MB,
 *     API sinkron -> UI nge-lag saat merekam track panjang).
 *   - Check-in offline (bwkOfflineCheckins) punya pola antrean sendiri; di sini
 *     dijadikan satu "outbox" untuk check-in, SOS, laporan, dan waypoint.
 *
 * Vanilla JS, tanpa build step. Muat PALING AWAL di antara file maps-*.js.
 *
 * API:
 *   BWKStore.put(store, obj) / get / del / all / clear / count
 *   BWKStore.migrateFromLocalStorage()
 *   BWKStore.outbox.add(type, payload) / setSender(fn) / flush() / all()
 *   BWKStore.storage.estimate() / persist() / human(bytes)
 */
(function (global) {
  'use strict';

  var DB_NAME = 'bwk-data-db';
  var DB_VERSION = 1;
  var STORES = ['tracks', 'waypoints', 'outbox', 'meta'];
  var dbPromise = null;

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB tidak tersedia di perangkat ini'));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('Database terkunci tab lain')); };
    });
    return dbPromise;
  }

  function run(storeName, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, mode);
        var req = fn(t.objectStore(storeName));
        var value;
        if (req) { req.onsuccess = function () { value = req.result; }; }
        t.oncomplete = function () { resolve(value); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaksi dibatalkan')); };
      });
    });
  }

  var BWKStore = {
    uid: uid,

    put: function (store, obj) {
      var rec = obj || {};
      if (!rec.id) rec.id = uid();
      if (!rec.updatedAt) rec.updatedAt = Date.now();
      return run(store, 'readwrite', function (os) { return os.put(rec); })
        .then(function () { return rec; });
    },

    putMany: function (store, list) {
      var arr = (list || []).map(function (o) {
        var r = o || {};
        if (!r.id) r.id = uid();
        return r;
      });
      return run(store, 'readwrite', function (os) {
        arr.forEach(function (r) { os.put(r); });
        return null;
      }).then(function () { return arr.length; });
    },

    get: function (store, id) {
      return run(store, 'readonly', function (os) { return os.get(id); });
    },

    del: function (store, id) {
      return run(store, 'readwrite', function (os) { return os.delete(id); });
    },

    all: function (store) {
      return run(store, 'readonly', function (os) { return os.getAll(); })
        .then(function (r) { return r || []; });
    },

    count: function (store) {
      return run(store, 'readonly', function (os) { return os.count(); })
        .then(function (r) { return r || 0; });
    },

    clear: function (store) {
      return run(store, 'readwrite', function (os) { return os.clear(); });
    },

    /**
     * Pindahkan bwkTracks & bwkWaypoints dari localStorage ke IndexedDB.
     * Aman dijalankan berkali-kali (idempoten). Data lama TIDAK dihapus,
     * hanya diberi nama cadangan supaya bisa dipulihkan jika ada masalah.
     */
    migrateFromLocalStorage: function () {
      var self = this;
      return self.get('meta', 'migration-v1').then(function (done) {
        if (done && done.value === true) return { skipped: true };

        var jobs = [];
        var moved = { tracks: 0, waypoints: 0 };

        function pull(lsKey, store, mapper) {
          var raw;
          try { raw = global.localStorage.getItem(lsKey); } catch (e) { raw = null; }
          if (!raw) return;
          var parsed;
          try { parsed = JSON.parse(raw); } catch (e) { return; }
          if (!Array.isArray(parsed) || !parsed.length) return;
          jobs.push(self.putMany(store, parsed.map(mapper)).then(function (n) {
            moved[store] = n;
            try {
              global.localStorage.setItem(lsKey + '.backup', raw);
              global.localStorage.removeItem(lsKey);
            } catch (e) { /* kuota penuh: biarkan, data sudah aman di IndexedDB */ }
          }));
        }

        pull('bwkTracks', 'tracks', function (t, i) {
          return {
            id: t && t.id ? String(t.id) : 'track-' + i + '-' + uid(),
            name: (t && t.name) || 'Trek tersimpan',
            points: (t && (t.points || t.latlngs)) || [],
            createdAt: (t && t.createdAt) || Date.now()
          };
        });

        pull('bwkWaypoints', 'waypoints', function (w, i) {
          return {
            id: w && w.id ? String(w.id) : 'wp-' + i + '-' + uid(),
            name: (w && w.name) || 'Titik ' + (i + 1),
            lat: w && (w.lat !== undefined ? w.lat : w.latitude),
            lng: w && (w.lng !== undefined ? w.lng : w.longitude),
            note: (w && w.note) || '',
            createdAt: (w && w.createdAt) || Date.now()
          };
        });

        return Promise.all(jobs)
          .then(function () { return self.put('meta', { id: 'migration-v1', value: true }); })
          .then(function () { return { skipped: false, moved: moved }; });
      });
    },

    outbox: {
      _sender: null,
      _busy: false,

      /** Daftarkan fungsi pengirim: fn(item) -> Promise<boolean berhasil> */
      setSender: function (fn) { this._sender = fn; return this; },

      add: function (type, payload) {
        return BWKStore.put('outbox', {
          id: uid(),
          type: String(type || 'unknown'),
          payload: payload || {},
          tries: 0,
          createdAt: Date.now()
        }).then(function (rec) {
          BWKStore.outbox.requestBackgroundSync();
          return rec;
        });
      },

      all: function () { return BWKStore.all('outbox'); },

      /** Kirim semua antrean. Gagal = tetap di antrean, dicoba lagi nanti. */
      flush: function () {
        var ob = this;
        if (ob._busy) return Promise.resolve({ busy: true });
        if (!ob._sender) return Promise.resolve({ noSender: true });
        if (global.navigator && global.navigator.onLine === false) {
          return Promise.resolve({ offline: true });
        }
        ob._busy = true;
        var sent = 0, failed = 0;

        return BWKStore.all('outbox').then(function (items) {
          return items.reduce(function (chain, item) {
            return chain.then(function () {
              return Promise.resolve()
                .then(function () { return ob._sender(item); })
                .then(function (ok) {
                  if (ok) { sent++; return BWKStore.del('outbox', item.id); }
                  failed++;
                  item.tries = (item.tries || 0) + 1;
                  item.lastTryAt = Date.now();
                  return BWKStore.put('outbox', item);
                })
                .catch(function () {
                  failed++;
                  item.tries = (item.tries || 0) + 1;
                  item.lastTryAt = Date.now();
                  return BWKStore.put('outbox', item);
                });
            });
          }, Promise.resolve());
        }).then(function () {
          ob._busy = false;
          var res = { sent: sent, failed: failed };
          try {
            global.dispatchEvent(new CustomEvent('bwk:outbox-flushed', { detail: res }));
          } catch (e) { /* CustomEvent tidak didukung */ }
          return res;
        }).catch(function (err) {
          ob._busy = false;
          throw err;
        });
      },

      requestBackgroundSync: function () {
        if (!global.navigator || !global.navigator.serviceWorker || !global.SyncManager) return;
        global.navigator.serviceWorker.ready.then(function (reg) {
          if (reg.sync) return reg.sync.register('bwk-outbox');
        }).catch(function () { /* diabaikan: fallback ke event online */ });
      }
    },

    storage: {
      human: function (bytes) {
        var b = Number(bytes) || 0;
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(2) + ' GB';
      },

      estimate: function () {
        if (!global.navigator || !navigator.storage || !navigator.storage.estimate) {
          return Promise.resolve({ supported: false, usage: 0, quota: 0, free: 0 });
        }
        return navigator.storage.estimate().then(function (e) {
          var usage = e.usage || 0, quota = e.quota || 0;
          return {
            supported: true,
            usage: usage,
            quota: quota,
            free: Math.max(0, quota - usage),
            percent: quota ? Math.round((usage / quota) * 100) : 0
          };
        });
      },

      /** Minta browser tidak menghapus data offline saat penyimpanan menipis. */
      persist: function () {
        if (!global.navigator || !navigator.storage || !navigator.storage.persist) {
          return Promise.resolve(false);
        }
        return navigator.storage.persisted().then(function (already) {
          return already ? true : navigator.storage.persist();
        }).catch(function () { return false; });
      }
    }
  };

  global.addEventListener('online', function () { BWKStore.outbox.flush(); });

  global.BWKStore = BWKStore;
})(typeof window !== 'undefined' ? window : this);
