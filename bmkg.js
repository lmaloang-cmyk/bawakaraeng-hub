/**
 * bmkg.js — Integrasi Cuaca & Gempa BMKG
 *
 * Sumber data resmi BMKG:
 *   - Cuaca:     https://data.bmkg.go.id/prakiraan-cuaca
 *   - Gempa:     https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json
 *   - Gempa Terasa: https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json
 *
 * Fitur:
 *   - Fetch cuaca 34 provinsi (3 hari)
 *   - Fetch gempa terkini (magnitude, kedalaman, koordinat)
 *   - Fetch gempa yang terasa
 *   - Cache hasil di IndexedDB untuk performa offline
 *   - Fallback ke Open-Meteo jika BMKG down
 */
(function(global) {
  'use strict';

  // === Koordinat Gunung Bawakaraeng ===
  var BWK_COORDS = { lat: -2.6944, lng: 114.9389 };
  var BWK_ELEVATION = 2571; // meter di atas permukaan laut

  // === Database IndexedDB untuk caching ===
  var DB_NAME = 'bwk-bmkg-db';
  var DB_VERSION = 1;
  var STORE = 'bmkg-cache';
  var CACHE_TTL = 30 * 60 * 1000; // 30 menit

  function openDb() {
    return new Promise(function(resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function(e) { resolve(e.target.result); };
      req.onerror = function(e) { reject(e.target.error); };
    });
  }

  function cacheGet(db, key) {
    return new Promise(function(resolve) {
      if (!db) { resolve(null); return; }
      try {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { resolve(null); };
      } catch(e) { resolve(null); }
    });
  }

  function cachePut(db, key, data) {
    return new Promise(function(resolve) {
      if (!db) { resolve(); return; }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key: key, data: data, ts: Date.now() });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
      } catch(e) { resolve(); }
    });
  }

  function cacheDel(db, key) {
    return new Promise(function(resolve) {
      if (!db) { resolve(); return; }
      try {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { resolve(); };
      } catch(e) { resolve(); }
    });
  }

  // === Fetch dengan cache ===
  function fetchWithCache(key, fetchFn, ttl) {
    ttl = ttl || CACHE_TTL;
    return openDb().then(function(db) {
      return cacheGet(db, key).then(function(cached) {
        if (cached && (Date.now() - cached.ts) < ttl) {
          return cached.data;
        }
        return fetchFn().then(function(data) {
          cachePut(db, key, data);
          return data;
        });
      });
    });
  }

  // === Parse BMKG cuaca ===
  function parseCuaca(data) {
    if (!data || !data.prakiraanCuaca) return null;
    var result = [];
    data.prakiraanCuaca.forEach(function(prov) {
      var item = {
        provinsi: prov.lokasi ? prov.lokasi.provinsi : prov.nama,
        kota: prov.lokasi ? prov.lokasi.kabkot : '',
        forecasts: []
      };
      if (prov.jadwal && prov.jadwal.prakiraan) {
        prov.jadwal.prakiraan.forEach(function(h) {
          item.forecasts.push({
            waktu: h.waktu,
            cuaca: h.cuaca,
            suhu: h.suhu,
            kelembapan: h.kelembapan,
            angin: h.kecepatan_angin ? h.kecepatan_angin + ' km/j' : ''
          });
        });
      }
      if (item.forecasts.length > 0) result.push(item);
    });
    return result;
  }

  // === Parse BMKG gempa ===
  function parseGempa(data) {
    if (!data || !data.Infogempa || !data.Infogempa.gempa) return null;
    var g = data.Infogempa.gempa;
    return {
      datetime: g.dateTime || g.Waktu,
      tanggal: g.Tanggal,
      jam: g.Jam,
      magnitude: parseFloat(g.Magnitudo) || 0,
      kedalaman: g.Kedalaman,
      koordinat: g.Koordinat,
      lintang: parseFloat(g.Coordinat_Lintang) || 0,
      bujur: parseFloat(g.Coordinat_Bujur) || 0,
      wilayah: g.Wilayah,
      potensi: g.Potensi || '',
      dirasakan: g.Dirasakan || ''
    };
  }

  // === Fetch cuaca BMKG ===
  function fetchCuacaBmkg() {
    return fetch('https://data.bmkg.go.id/prakiraan-cuaca', {
      signal: AbortSignal.timeout(10000)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(parseCuaca);
  }

  // === Fetch gempa BMKG ===
  function fetchGempaBmkg() {
    return fetch('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json', {
      signal: AbortSignal.timeout(10000)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(parseGempa);
  }

  // === Fetch gempa terasa ===
  function fetchGempaTerasa() {
    return fetch('https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json', {
      signal: AbortSignal.timeout(10000)
    }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(parseGempa);
  }

  // === Open-Meteo fallback untuk cuaca gunung ===
  function fetchOpenMeteo(lat, lng) {
    var url = 'https://api.open-meteo.com/v1/forecast?' +
      'latitude=' + lat +
      '&longitude=' + lng +
      '&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max' +
      '&timezone=Asia%2FMakassar' +
      '&forecast_days=7';
    return fetch(url, { signal: AbortSignal.timeout(10000) }).then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // === Decode Open-Meteo weather code ===
  function decodeWeatherCode(code) {
    var codes = {
      0: { desc: 'Cerah', icon: '☀️' },
      1: { desc: 'Cerah Berawan', icon: '🌤️' },
      2: { desc: 'Berawan Sebagian', icon: '⛅' },
      3: { desc: 'Berawan', icon: '☁️' },
      45: { desc: 'Berkabut', icon: '🌫️' },
      48: { desc: 'Berkabut Tebal', icon: '🌫️' },
      51: { desc: 'Gerimis Ringan', icon: '🌦️' },
      53: { desc: 'Gerimis', icon: '🌦️' },
      55: { desc: 'Gerimis Lebat', icon: '🌧️' },
      61: { desc: 'Hujan Ringan', icon: '🌧️' },
      63: { desc: 'Hujan', icon: '🌧️' },
      65: { desc: 'Hujan Lebat', icon: '🌧️' },
      71: { desc: 'Salju Ringan', icon: '🌨️' },
      73: { desc: 'Salju', icon: '🌨️' },
      75: { desc: 'Salju Lebat', icon: '❄️' },
      80: { desc: 'Hujan Deras Sesekali', icon: '🌦️' },
      81: { desc: 'Hujan Deras', icon: '🌧️' },
      82: { desc: 'Hujan Sangat Deras', icon: '⛈️' },
      95: { desc: 'Petir', icon: '⛈️' },
      96: { desc: 'Petir + Hujan Es', icon: '⛈️' },
      99: { desc: 'Petir + Hujan Es Besar', icon: '⛈️' }
    };
    return codes[code] || { desc: 'Tidak Dikenal', icon: '❓' };
  }

  // === Decode BMKG cuaca code ===
  function decodeBmkgCuaca(code) {
    var codes = {
      'Cerah': { icon: '☀️' },
      'Cerah Berawan': { icon: '🌤️' },
      'Berawan': { icon: '☁️' },
      'Hujan Ringan': { icon: '🌦️' },
      'Hujan': { icon: '🌧️' },
      'Hujan Deras': { icon: '⛈️' },
      'Badai': { icon: '⛈️' },
      'Kabut': { icon: '🌫️' },
      'Bagian Utara': { icon: '☀️' },
      'Bagian Selatan': { icon: '🌧️' }
    };
    return codes[code] || { icon: '❓' };
  }

  // === BWKBmkg API ===
  var BWKBmkg = {
    coords: BWK_COORDS,

    /**
     * Ambil cuaca terkini dari BMKG (cache 30 menit)
     * Returns: Array of { provinsi, kota, forecasts[] }
     */
    cuaca: function() {
      return fetchWithCache('bmkg-cuaca', fetchCuacaBmkg);
    },

    /**
     * Ambil gempa terkini dari BMKG (cache 10 menit)
     * Returns: Object { datetime, magnitude, kedalaman, koordinat, wilayah, potensi }
     */
    gempa: function() {
      return fetchWithCache('bmkg-gempa', fetchGempaBmkg, 10 * 60 * 1000);
    },

    /**
     * Ambil gempa yang terasa (cache 10 menit)
     * Returns: Array of gempa yang dirasakan
     */
    gempaTerasa: function() {
      return fetchWithCache('bmkg-gempa-terasa', fetchGempaTerasa, 10 * 60 * 1000);
    },

    /**
     * Ambil prakiraan cuaca gunung Bawakaraeng dari Open-Meteo
     * (tanpa API key, gratis, akurat untuk koordinat Indonesia)
     * Returns: Object dengan hourly & daily forecast
     */
    cuacaGunung: function() {
      return fetchOpenMeteo(BWK_COORDS.lat, BWK_COORDS.lng);
    },

    /**
     * Ambil cuaca Bawakaraeng (BMKG dulu, fallback Open-Meteo)
     * Returns: { source, data }
     */
    cuacaBwk: function() {
      return this.cuaca().then(function(data) {
        if (data && data.length > 0) {
          return { source: 'bmkg', data: data };
        }
        throw new Error('BMKG empty');
      }).catch(function() {
        return this.cuacaGunung().then(function(data) {
          return { source: 'open-meteo', data: data };
        });
      }.bind(this));
    },

    /**
     * Format cuaca gunung untuk tampilan UI
     */
    formatCuacaGunung: function() {
      return this.cuacaGunung().then(function(data) {
        var now = new Date();
        var localTz = 'Asia/Makassar';
        var currentIdx = 0;

        // Cari index jam sekarang
        var hours = data.hourly.time || [];
        for (var i = 0; i < hours.length; i++) {
          if (new Date(hours[i]) >= now) { currentIdx = i; break; }
        }

        // Data saat ini
        var temp = data.hourly.temperature_2m[currentIdx];
        var feelsLike = data.hourly.apparent_temperature[currentIdx];
        var humidity = data.hourly.relative_humidity_2m[currentIdx];
        var wind = data.hourly.wind_speed_10m[currentIdx];
        var windDir = data.hourly.wind_direction_10m[currentIdx];
        var precipProb = data.hourly.precipitation_probability[currentIdx];
        var precip = data.hourly.precipitation[currentIdx];
        var weatherCode = data.hourly.weather_code[currentIdx];
        var weather = decodeWeatherCode(weatherCode);

        // Data hari ini (daily)
        var todayIdx = 0;
        var todayMax = data.daily.temperature_2m_max[todayIdx];
        var todayMin = data.daily.temperature_2m_min[todayIdx];
        var todayPrecip = data.daily.precipitation_sum[todayIdx];
        var todayWeather = decodeWeatherCode(data.daily.weather_code[todayIdx]);

        // 3 hari ke depan
        var forecast = [];
        for (var i = 1; i <= 3 && i < data.daily.time.length; i++) {
          var d = new Date(data.daily.time[i]);
          var w = decodeWeatherCode(data.daily.weather_code[i]);
          forecast.push({
            date: d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }),
            max: Math.round(data.daily.temperature_2m_max[i]),
            min: Math.round(data.daily.temperature_2m_min[i]),
            precip: data.daily.precipitation_probability_max[i],
            weather: w.desc,
            icon: w.icon
          });
        }

        return {
          location: 'Gunung Bawakaraeng (' + BWK_ELEVATION + ' mdpl)',
          temp: Math.round(temp),
          feelsLike: Math.round(feelsLike),
          humidity: humidity,
          wind: Math.round(wind),
          windDir: windDir,
          precipProb: precipProb,
          precip: precip,
          condition: weather.desc,
          icon: weather.icon,
          today: {
            max: Math.round(todayMax),
            min: Math.round(todayMin),
            precip: todayPrecip,
            condition: todayWeather.desc,
            icon: todayWeather.icon
          },
          forecast: forecast,
          timestamp: now.toLocaleString('id-ID')
        };
      }).catch(function(e) {
        return { error: e.message };
      });
    },

    /**
     * Format gempa untuk tampilan UI
     */
    formatGempa: function() {
      return this.gempa().then(function(data) {
        if (!data) return { error: 'Data gempa tidak tersedia' };
        return {
          datetime: data.datetime,
          magnitude: data.magnitude,
          depth: data.kedalaman,
          location: data.wilayah,
          coords: data.koordinat,
          potential: data.potensi,
          felt: data.dirasakan,
          icon: data.magnitude >= 5 ? '🔴' : data.magnitude >= 3 ? '🟡' : '🟢'
        };
      }).catch(function(e) {
        return { error: e.message };
      });
    },

    /**
     * Ambil semua data (cuaca + gempa) sekaligus
     */
    all: function() {
      return Promise.all([
        this.formatCuacaGunung(),
        this.formatGempa()
      ]).then(function(results) {
        return {
          cuaca: results[0],
          gempa: results[1]
        };
      });
    },

    /**
     * Hapus cache (paksa refresh)
     */
    clearCache: function() {
      return openDb().then(function(db) {
        if (!db) return;
        var keys = ['bmkg-cuaca', 'bmkg-gempa', 'bmkg-gempa-terasa'];
        keys.forEach(function(k) { cacheDel(db, k); });
      });
    },

    // Konstanta
    COORDS: BWK_COORDS,
    ELEVATION: BWK_ELEVATION,
    CACHE_TTL: CACHE_TTL
  };

  global.BWKBmkg = BWKBmkg;
})(typeof window !== 'undefined' ? window : this);
