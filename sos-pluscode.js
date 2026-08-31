/* ============================================================================
 * BWK SOS · sos-pluscode.js
 * Open Location Code (Plus Codes) — implementasi mandiri, 100% offline, 0 dependensi.
 * Referensi algoritma: https://github.com/google/open-location-code (Apache-2.0)
 *
 * KENAPA PENTING UNTUK SOS:
 * Koordinat desimal "-5.276000, 119.909000" hampir mustahil dibacakan lewat HT
 * atau ditulis ulang tanpa salah. Plus Code "6P6XPWF5+JJ" hanya 11 karakter,
 * memakai alfabet yang sengaja menghindari huruf mirip angka, dan tetap
 * menunjuk kotak selebar ~14 meter.
 *
 * CATATAN TEKNIS PENTING — kenapa memakai bilangan bulat:
 * Versi pertama modul ini memakai aritmetika desimal (bagi 20, bagi 5, bagi 4).
 * Uji otomatis menemukan koordinat seperti Lembanna (-5.276, 119.909) yang jatuh
 * PERSIS di batas sel: galat pembulatan float membuat satu digit meleset satu
 * sel, yaitu ~14 meter di lapangan. Untuk pencarian orang hilang itu tidak bisa
 * ditoleransi. Karena itu seluruh perhitungan di bawah memakai bilangan bulat:
 *   lintang dikalikan 25.000.000 (8000 x 5^5)
 *   bujur  dikalikan  8.192.000 (8000 x 4^5)
 * Semua nilai tempat tetap bilangan bulat sampai digit terakhir, jadi tidak ada
 * pembulatan yang bisa menggeser hasil. Ini pendekatan yang sama dengan
 * implementasi resmi Google.
 *
 * API:
 *   BWKPlusCode.encode(lat, lng, length)  -> "6P6XPWF5+JJ"   (default 10 digit)
 *   BWKPlusCode.decode(code)              -> { lat, lng, latLo, lngLo, latHi, lngHi, length }
 *   BWKPlusCode.isValid(code)             -> boolean
 *   BWKPlusCode.spoken(code)              -> "6 P 6 X P W F 5 plus J J"
 * ==========================================================================*/
(function (root) {
  'use strict';

  var ALPHABET = '23456789CFGHJMPQRVWX';
  var BASE = 20;
  var SEPARATOR = '+';
  var SEPARATOR_POSITION = 8;
  var PADDING = '0';
  var PAIR_CODE_LENGTH = 10;
  var GRID_CODE_LENGTH = 5;
  var MAX_DIGIT_COUNT = PAIR_CODE_LENGTH + GRID_CODE_LENGTH; // 15
  var GRID_ROWS = 5;
  var GRID_COLUMNS = 4;
  var LATITUDE_MAX = 90;
  var LONGITUDE_MAX = 180;

  // Pengali agar seluruh perhitungan berjalan di ranah bilangan bulat.
  var LAT_MULTIPLIER = 8000 * Math.pow(GRID_ROWS, GRID_CODE_LENGTH);    // 25.000.000
  var LNG_MULTIPLIER = 8000 * Math.pow(GRID_COLUMNS, GRID_CODE_LENGTH); //  8.192.000
  // Nilai tempat digit paling signifikan.
  var LAT_MSP = LAT_MULTIPLIER * BASE * BASE; // 10.000.000.000
  var LNG_MSP = LNG_MULTIPLIER * BASE * BASE; //  3.276.800.000

  function clipLatitude(lat) {
    return Math.min(LATITUDE_MAX, Math.max(-LATITUDE_MAX, lat));
  }

  function normalizeLongitude(lng) {
    while (lng < -LONGITUDE_MAX) lng += 360;
    while (lng >= LONGITUDE_MAX) lng -= 360;
    return lng;
  }

  // Tinggi sel lintang untuk panjang kode tertentu, dipakai agar lat = 90
  // (yang berada tepat di tepi dunia) tidak menghasilkan kode di luar rentang.
  function latitudePrecision(length) {
    if (length <= PAIR_CODE_LENGTH) {
      return Math.pow(BASE, Math.floor(length / -2 + 2));
    }
    return Math.pow(BASE, -3) / Math.pow(GRID_ROWS, length - PAIR_CODE_LENGTH);
  }

  function normalizeLength(codeLength) {
    // Default 10 digit: sel ~14 x 14 m. Sudah lebih presisi daripada GPS ponsel
    // di bawah tajuk hutan (+/- 5-20 m) dan cukup pendek untuk dibacakan lewat HT.
    var length = codeLength == null ? PAIR_CODE_LENGTH : Math.floor(codeLength);
    if (!(length > 0)) length = PAIR_CODE_LENGTH;
    if (length < 2) length = 2;
    if (length > MAX_DIGIT_COUNT) length = MAX_DIGIT_COUNT;
    // Di bawah 10 digit, hanya panjang genap yang sah.
    if (length < PAIR_CODE_LENGTH && length % 2 === 1) length -= 1;
    return length;
  }

  function encode(latitude, longitude, codeLength) {
    if (!isFinite(latitude) || !isFinite(longitude)) return '';
    var length = normalizeLength(codeLength);

    var lat = clipLatitude(Number(latitude));
    var lng = normalizeLongitude(Number(longitude));
    if (lat === LATITUDE_MAX) lat = lat - latitudePrecision(length);

    // Konversi ke bilangan bulat positif. Pembulatan pada 1e-6 unit menetralkan
    // representasi biner desimal (mis. 119.909 yang tidak eksak di float).
    var latVal = Math.floor(Math.round(lat * LAT_MULTIPLIER * 1e6) / 1e6) + LATITUDE_MAX * LAT_MULTIPLIER;
    var lngVal = Math.floor(Math.round(lng * LNG_MULTIPLIER * 1e6) / 1e6) + LONGITUDE_MAX * LNG_MULTIPLIER;

    // Selalu hitung 15 digit penuh dari digit terkecil, lalu potong sesuai
    // panjang yang diminta. Memotong = membulatkan ke sel yang lebih besar,
    // dan itu memang perilaku yang benar.
    var code = '';
    var i;
    for (i = 0; i < GRID_CODE_LENGTH; i++) {
      var row = latVal % GRID_ROWS;
      var col = lngVal % GRID_COLUMNS;
      code = ALPHABET.charAt(row * GRID_COLUMNS + col) + code;
      latVal = Math.floor(latVal / GRID_ROWS);
      lngVal = Math.floor(lngVal / GRID_COLUMNS);
    }
    for (i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
      code = ALPHABET.charAt(lngVal % BASE) + code;
      code = ALPHABET.charAt(latVal % BASE) + code;
      latVal = Math.floor(latVal / BASE);
      lngVal = Math.floor(lngVal / BASE);
    }

    code = code.substring(0, SEPARATOR_POSITION) + SEPARATOR + code.substring(SEPARATOR_POSITION);
    if (length >= SEPARATOR_POSITION) {
      // +1 memperhitungkan karakter pemisah.
      return code.substring(0, length + 1);
    }
    return code.substring(0, length) + new Array(SEPARATOR_POSITION - length + 1).join(PADDING) + SEPARATOR;
  }

  function clean(code) {
    return String(code == null ? '' : code)
      .replace(/\s+/g, '')
      .split(SEPARATOR).join('')
      .replace(/0+$/, '')
      .toUpperCase();
  }

  function isValid(code) {
    var raw = String(code == null ? '' : code).replace(/\s+/g, '').toUpperCase();
    var sepIndex = raw.indexOf(SEPARATOR);
    if (sepIndex < 0) return false;
    if (raw.indexOf(SEPARATOR, sepIndex + 1) >= 0) return false;
    if (sepIndex !== SEPARATOR_POSITION) return false;
    if (raw.length === SEPARATOR_POSITION + 1) return false;
    var digits = clean(raw);
    if (!digits.length) return false;
    for (var i = 0; i < digits.length; i++) {
      if (ALPHABET.indexOf(digits.charAt(i)) < 0) return false;
    }
    return true;
  }

  function decode(code) {
    var digits = clean(code);
    if (!digits.length) return null;
    if (digits.length > MAX_DIGIT_COUNT) digits = digits.slice(0, MAX_DIGIT_COUNT);

    // Semua nilai tempat di bawah tetap bilangan bulat sampai pembagian akhir.
    var latVal = -LATITUDE_MAX * LAT_MULTIPLIER;
    var lngVal = -LONGITUDE_MAX * LNG_MULTIPLIER;
    var latPlace = LAT_MSP;
    var lngPlace = LNG_MSP;
    var i;

    var pairEnd = Math.min(digits.length, PAIR_CODE_LENGTH);
    for (i = 0; i < pairEnd; i += 2) {
      latPlace /= BASE;
      lngPlace /= BASE;
      var la = ALPHABET.indexOf(digits.charAt(i));
      if (la < 0) return null;
      latVal += la * latPlace;
      if (i + 1 < pairEnd) {
        var lo = ALPHABET.indexOf(digits.charAt(i + 1));
        if (lo < 0) return null;
        lngVal += lo * lngPlace;
      }
    }

    for (i = PAIR_CODE_LENGTH; i < digits.length; i++) {
      latPlace /= GRID_ROWS;
      lngPlace /= GRID_COLUMNS;
      var d = ALPHABET.indexOf(digits.charAt(i));
      if (d < 0) return null;
      latVal += Math.floor(d / GRID_COLUMNS) * latPlace;
      lngVal += (d % GRID_COLUMNS) * lngPlace;
    }

    var latLo = latVal / LAT_MULTIPLIER;
    var lngLo = lngVal / LNG_MULTIPLIER;
    var latHi = (latVal + latPlace) / LAT_MULTIPLIER;
    var lngHi = (lngVal + lngPlace) / LNG_MULTIPLIER;

    return {
      latLo: latLo,
      lngLo: lngLo,
      latHi: latHi,
      lngHi: lngHi,
      lat: (latLo + latHi) / 2,
      lng: (lngLo + lngHi) / 2,
      length: digits.length
    };
  }

  // Format untuk dibacakan lewat HT / telepon.
  function spoken(code) {
    var raw = String(code == null ? '' : code).toUpperCase().replace(/\s+/g, '');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      out.push(ch === SEPARATOR ? 'plus' : ch);
    }
    return out.join(' ');
  }

  var api = {
    encode: encode,
    decode: decode,
    isValid: isValid,
    spoken: spoken,
    ALPHABET: ALPHABET
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BWKPlusCode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
