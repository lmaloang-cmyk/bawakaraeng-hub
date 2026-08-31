/*!
 * maps-offline.js — Peta offline MAPS Pintu Angin
 * Paket perbaikan hasil audit 23 Agustus 2026.
 *
 * Memperbaiki:
 *   [P0] downloader tile tanpa AbortController/timeout/retry (commit 179c9bf ternyata kosong)
 *   [P0] bulk download ke server tile OSM/Esri yang melanggar Tile Usage Policy
 *   [P1] tidak ada manajemen kuota penyimpanan / tidak ada tombol batal
 *
 * API:
 *   BWKOfflineTiles.configure({ sources })
 *   BWKOfflineTiles.estimate({ bounds, zooms })       -> { count, bytes }
 *   BWKOfflineTiles.download({ ... })                 -> { promise, cancel }
 *   BWKOfflineTiles.createLayer(L, sourceKey, opts)   -> L.TileLayer offline-first
 *   BWKOfflineTiles.stats() / clear(sourceKey)
 */
(function (global) {
  'use strict';

  var DB_NAME = 'bwk-tiles-db';   // DB terpisah agar tidak bentrok dengan bwk-maps-db lama
  var DB_VERSION = 1;
  var STORE = 'tiles';
  var AVG_TILE_BYTES = 16 * 1024; // perkiraan untuk estimasi ukuran unduhan
  var dbPromise = null;

  /**
   * PENTING (legal): OpenStreetMap dan Esri MELARANG bulk downloading tile.
   * Sumber dengan allowBulkDownload:false hanya boleh di-cache secara oportunistik
   * (tile yang memang dilihat pengguna), bukan diunduh massal per-area.
   * Untuk fitur "Download Area", pakai penyedia berbayar/ber-izin (MapTiler, Stadia,
   * Thunderforest) atau host sendiri (PMTiles/MBTiles). Lihat AUDIT-MAPS-PINTU-ANGIN.md.
   */
  var SOURCES = {
    osm: {
      name: '🗺️ OSM',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
      allowBulkDownload: false
    },
    satelit: {
      name: '🛰️ Satelit',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 18,
      attribution: '© Esri',
      allowBulkDownload: false
    }
    // Contoh sumber yang BOLEH diunduh massal (isi kunci lalu aktifkan):
    // topo: {
    //   name: '🏔️ Topo',
    //   url: 'https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}.png?key=ISI_KUNCI',
    //   maxZoom: 18,
    //   attribution: '© MapTiler © OpenStreetMap contributors',
    //   allowBulkDownload: true
    // }
  };

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB tidak tersedia')); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'k' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function idb(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var req = fn(t.objectStore(STORE));
        var value;
        if (req) { req.onsuccess = function () { value = req.result; }; }
        t.oncomplete = function () { resolve(value); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('Transaksi dibatalkan')); };
      });
    });
  }

  function keyFor(src, z, x, y) { return src + '/' + z + '/' + x + '/' + y; }

  function tileUrl(src, z, x, y) {
    var s = SOURCES[src];
    if (!s) return null;
    return s.url
      .replace('{z}', z).replace('{x}', x).replace('{y}', y)
      .replace('{s}', 'abc'[(x + y) % 3]).replace('{r}', '');
  }

  function lon2x(lon, z) { return Math.floor(((lon + 180) / 360) * Math.pow(2, z)); }
  function lat2y(lat, z) {
    var r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z));
  }

  /** bounds: { north, south, east, west } */
  function tilesForBounds(bounds, z) {
    var x1 = lon2x(bounds.west, z), x2 = lon2x(bounds.east, z);
    var y1 = lat2y(bounds.north, z), y2 = lat2y(bounds.south, z);
    var list = [];
    for (var x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (var y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        list.push({ z: z, x: x, y: y });
      }
    }
    return list;
  }

  function fetchWithTimeout(url, signal, timeoutMs) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 10000);
    function onOuterAbort() { ctrl.abort(); }
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', onOuterAbort);
    }
    return fetch(url, { signal: ctrl.signal, mode: 'cors', cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .finally(function () {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onOuterAbort);
      });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var BWKOfflineTiles = {
    sources: SOURCES,
    keyFor: keyFor,

    configure: function (opts) {
      if (opts && opts.sources) {
        Object.keys(opts.sources).forEach(function (k) { SOURCES[k] = opts.sources[k]; });
      }
      return this;
    },

    estimate: function (opts) {
      var zooms = opts.zooms || [14, 15, 16];
      var count = zooms.reduce(function (sum, z) {
        return sum + tilesForBounds(opts.bounds, z).length;
      }, 0);
      return { count: count, bytes: count * AVG_TILE_BYTES };
    },

    getTile: function (src, z, x, y) {
      return idb('readonly', function (os) { return os.get(keyFor(src, z, x, y)); })
        .then(function (rec) { return rec ? rec.blob : null; });
    },

    putTile: function (src, z, x, y, blob) {
      return idb('readwrite', function (os) {
        return os.put({ k: keyFor(src, z, x, y), src: src, blob: blob, savedAt: Date.now() });
      });
    },

    stats: function () {
      return idb('readonly', function (os) { return os.count(); })
        .then(function (n) { return { tiles: n || 0, approxBytes: (n || 0) * AVG_TILE_BYTES }; });
    },

    clear: function (src) {
      if (!src) return idb('readwrite', function (os) { return os.clear(); });
      return openDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, 'readwrite');
          var cur = t.objectStore(STORE).openCursor();
          var removed = 0;
          cur.onsuccess = function () {
            var c = cur.result;
            if (!c) return;
            if (c.value && c.value.src === src) { c.delete(); removed++; }
            c.continue();
          };
          t.oncomplete = function () { resolve(removed); };
          t.onerror = function () { reject(t.error); };
        });
      });
    },

    /**
     * Unduh area untuk dipakai offline.
     * opts: { source, bounds, zooms, concurrency, timeoutMs, retries, force, onProgress }
     * return: { promise, cancel }
     */
    download: function (opts) {
      var src = opts.source;
      var cfg = SOURCES[src];
      var ctrl = new AbortController();

      if (!cfg) {
        return { promise: Promise.reject(new Error('Sumber peta "' + src + '" tidak dikenal')), cancel: function () {} };
      }
      if (!cfg.allowBulkDownload && !opts.force) {
        return {
          promise: Promise.reject(new Error(
            'Sumber "' + (cfg.name || src) + '" tidak mengizinkan unduh massal. ' +
            'Gunakan penyedia berizin (MapTiler/Stadia) atau host peta sendiri.'
          )),
          cancel: function () {}
        };
      }
      if (global.navigator && global.navigator.onLine === false) {
        return { promise: Promise.reject(new Error('Tidak ada koneksi internet')), cancel: function () {} };
      }

      var zooms = (opts.zooms || [14, 15, 16]).filter(function (z) { return z <= (cfg.maxZoom || 18); });
      var all = [];
      zooms.forEach(function (z) { all = all.concat(tilesForBounds(opts.bounds, z)); });

      var concurrency = Math.max(1, Math.min(opts.concurrency || 6, 8));
      var retries = opts.retries === undefined ? 2 : opts.retries;
      var timeoutMs = opts.timeoutMs || 10000;
      var onProgress = opts.onProgress || function () {};

      var total = all.length, done = 0, saved = 0, skipped = 0, failedList = [], bytes = 0;
      var quotaFull = false;
      var idx = 0;

      function report(status) {
        onProgress({
          total: total, done: done, saved: saved, skipped: skipped,
          failed: failedList.length, bytes: bytes,
          percent: total ? Math.round((done / total) * 100) : 100,
          status: status || 'berjalan'
        });
      }

      function one(t) {
        var url = tileUrl(src, t.z, t.x, t.y);
        return BWKOfflineTiles.getTile(src, t.z, t.x, t.y).then(function (existing) {
          if (existing) { skipped++; return null; }
          var attempt = 0;
          function tryFetch() {
            return fetchWithTimeout(url, ctrl.signal, timeoutMs)
              .then(function (blob) {
                bytes += blob.size || 0;
                return BWKOfflineTiles.putTile(src, t.z, t.x, t.y, blob).then(function () { saved++; });
              })
              .catch(function (err) {
                if (ctrl.signal.aborted) throw err;
                if (err && (err.name === 'QuotaExceededError' || /quota/i.test(err.message || ''))) {
                  quotaFull = true;
                  ctrl.abort();
                  throw err;
                }
                attempt++;
                if (attempt > retries) { failedList.push(t); return null; }
                return sleep(400 * attempt).then(tryFetch);
              });
          }
          return tryFetch();
        }).then(function () {
          done++;
          if (done % 5 === 0 || done === total) report();
        }, function () {
          done++;
        });
      }

      function worker() {
        if (ctrl.signal.aborted || idx >= total) return Promise.resolve();
        var t = all[idx++];
        return one(t).then(worker);
      }

      report('mulai');
      var workers = [];
      for (var i = 0; i < concurrency; i++) workers.push(worker());

      var promise = Promise.all(workers).then(function () {
        var status = ctrl.signal.aborted ? (quotaFull ? 'penyimpanan-penuh' : 'dibatalkan') : 'selesai';
        report(status);
        return {
          status: status, total: total, saved: saved, skipped: skipped,
          failed: failedList.slice(), bytes: bytes
        };
      });

      return {
        promise: promise,
        cancel: function () { ctrl.abort(); },
        get failed() { return failedList.slice(); }
      };
    },

    /**
     * Layer Leaflet offline-first: baca dari IndexedDB dulu, baru jaringan.
     * Tile yang berhasil diambil dari jaringan otomatis ikut tersimpan
     * (cache oportunistik — ini legal untuk semua sumber).
     */
    createLayer: function (L, sourceKey, opts) {
      var cfg = SOURCES[sourceKey] || SOURCES.osm;
      var options = opts || {};
      var Offline = L.TileLayer.extend({
        createTile: function (coords, done) {
          var tile = document.createElement('img');
          tile.alt = '';
          tile.setAttribute('role', 'presentation');
          var self = this;
          var revoke = null;

          function finish(err) {
            if (revoke) {
              tile.addEventListener('load', function () { URL.revokeObjectURL(revoke); }, { once: true });
            }
            done(err || null, tile);
          }

          BWKOfflineTiles.getTile(sourceKey, coords.z, coords.x, coords.y)
            .then(function (blob) {
              if (blob) {
                revoke = URL.createObjectURL(blob);
                tile.src = revoke;
                finish();
                return;
              }
              if (global.navigator && global.navigator.onLine === false) {
                tile.src = self.options.errorTileUrl || '';
                finish();
                return;
              }
              var url = tileUrl(sourceKey, coords.z, coords.x, coords.y);
              return fetchWithTimeout(url, null, 12000).then(function (b) {
                revoke = URL.createObjectURL(b);
                tile.src = revoke;
                finish();
                BWKOfflineTiles.putTile(sourceKey, coords.z, coords.x, coords.y, b).catch(function () {});
              });
            })
            .catch(function () {
              tile.src = self.options.errorTileUrl || '';
              finish();
            });

          return tile;
        }
      });

      return new Offline(cfg.url, {
        attribution: options.attribution || cfg.attribution,
        maxZoom: options.maxZoom || cfg.maxZoom || 18,
        maxNativeZoom: cfg.maxZoom || 18,
        crossOrigin: true
      });
    }
  };

  global.BWKOfflineTiles = BWKOfflineTiles;
})(typeof window !== 'undefined' ? window : this);
