/* ============================================================================
 * BWK SOS · sos-auth.js
 * Membuat SOS tidak pernah lagi terhalang layar login.
 *
 * MASALAH ASLI (ops.js):
 *   window._sosPublish = function(lat,lng,name){
 *     var u=user(); if(!u||!u.google){ toastx('Masuk dengan Google diperlukan...'); return; }
 *   ...
 * Baris itu melakukan `return` SEBELUM apa pun disimpan. Artinya pendaki yang
 * sesinya kedaluwarsa, memakai HP pinjaman, atau belum pernah login TIDAK BISA
 * mengirim SOS sama sekali — bahkan tidak masuk antrean offline.
 *
 * SOLUSI: Supabase Anonymous Sign-in.
 *   - Klien otomatis membuat sesi anonim bila belum ada sesi.
 *   - Server TIDAK perlu diubah: verifySupabaseUser() tetap menerima token itu,
 *     user.id tetap UUID valid, jadi validasi /^[0-9a-f-]{36}$/ tetap lolos.
 *   - Rate limit per user.id tetap berlaku, jadi tidak membuka pintu spam.
 *   - Bila pengguna nanti login Google, sesi anonim bisa di-link (linkIdentity).
 *
 * PRASYARAT SATU KALI (Supabase Dashboard):
 *   Authentication -> Providers -> Anonymous Sign-ins -> Enable
 *   Authentication -> Rate Limits -> atur "Anonymous sign-ins" (mis. 30/jam/IP)
 *
 * API:
 *   BWKSosAuth.token()          -> Promise<string>  (buat sesi anonim bila perlu)
 *   BWKSosAuth.ensureSession()  -> Promise<{ok, mode, error}>
 *   BWKSosAuth.mode()           -> 'google' | 'anon' | 'none'
 *   BWKSosAuth.displayName()    -> nama untuk ditampilkan di alarm penerima
 * ==========================================================================*/
(function () {
  'use strict';

  var NAME_KEY = 'bwkSosName';
  var MODE_KEY = 'bwkSosAuthMode';
  var _inflight = null;

  function client() {
    try {
      if (typeof window._sbClient === 'function') return window._sbClient();
    } catch (e) {}
    return null;
  }

  function readMode() {
    try { return localStorage.getItem(MODE_KEY) || 'none'; } catch (e) { return 'none'; }
  }

  function writeMode(m) {
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  }

  function currentSession() {
    var c = client();
    if (!c || !c.auth) return Promise.resolve(null);
    return c.auth.getSession()
      .then(function (r) { return (r && r.data && r.data.session) || null; })
      .catch(function () { return null; });
  }

  // Membuat sesi anonim. Aman dipanggil berkali-kali: dijaga oleh _inflight.
  function signInAnon() {
    var c = client();
    if (!c || !c.auth || typeof c.auth.signInAnonymously !== 'function') {
      return Promise.resolve({ ok: false, error: 'anon-unsupported' });
    }
    if (_inflight) return _inflight;
    _inflight = c.auth.signInAnonymously()
      .then(function (r) {
        _inflight = null;
        if (r && r.error) return { ok: false, error: String(r.error.message || r.error) };
        writeMode('anon');
        return { ok: true, mode: 'anon' };
      })
      .catch(function (e) {
        _inflight = null;
        return { ok: false, error: String((e && e.message) || e) };
      });
    return _inflight;
  }

  function ensureSession() {
    return currentSession().then(function (s) {
      if (s && s.access_token) {
        var isAnon = !!(s.user && (s.user.is_anonymous === true ||
          (s.user.app_metadata && s.user.app_metadata.provider === 'anonymous')));
        writeMode(isAnon ? 'anon' : 'google');
        return { ok: true, mode: isAnon ? 'anon' : 'google' };
      }
      return signInAnon();
    });
  }

  function token() {
    return ensureSession().then(function () {
      return currentSession().then(function (s) {
        return (s && s.access_token) || '';
      });
    });
  }

  // Nama yang muncul di alarm penerima. Untuk sesi anonim, pengguna boleh
  // mengisi nama sendiri; kalau kosong dipakai label netral.
  function displayName() {
    try {
      var manual = (localStorage.getItem(NAME_KEY) || '').trim();
      if (manual) return manual.slice(0, 60);
      var raw = localStorage.getItem('bwkUser');
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.name) return String(o.name).slice(0, 60);
      }
    } catch (e) {}
    return 'Pendaki';
  }

  function setDisplayName(v) {
    try { localStorage.setItem(NAME_KEY, String(v == null ? '' : v).trim().slice(0, 60)); } catch (e) {}
  }

  // Bila pengguna login Google setelah sempat anonim, catat perubahan mode.
  try {
    var c0 = client();
    if (c0 && c0.auth && typeof c0.auth.onAuthStateChange === 'function') {
      c0.auth.onAuthStateChange(function (_evt, session) {
        if (!session) { writeMode('none'); return; }
        var isAnon = !!(session.user && session.user.is_anonymous === true);
        writeMode(isAnon ? 'anon' : 'google');
      });
    }
  } catch (e) {}

  window.BWKSosAuth = {
    token: token,
    ensureSession: ensureSession,
    mode: readMode,
    displayName: displayName,
    setDisplayName: setDisplayName
  };

  // JANGAN membuat sesi anonim saat load: sesi anon memicu onAuthStateChange dan
  // dulu sempat dianggap "login" oleh index.html (masuk tanpa Google). Sesi anonim
  // kini dibuat malas — hanya saat jalur SOS benar-benar membutuhkannya (openSOS
  // di index.html memanggil ensureSession, dan token() tetap bisa membuatnya).
  // Di sini hanya menyegarkan catatan mode BILA sesi memang sudah ada.
  window.addEventListener('load', function () {
    setTimeout(function () {
      currentSession().then(function (s) {
        if (s && s.access_token) {
          var isAnon = !!(s.user && (s.user.is_anonymous === true ||
            (s.user.app_metadata && s.user.app_metadata.provider === 'anonymous')));
          writeMode(isAnon ? 'anon' : 'google');
        }
      });
    }, 4000);
  });
})();
