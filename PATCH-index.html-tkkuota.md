# Patch `index.html` — blok `tkkuota` (penyelaras kuota kirim)

Blok kelima untuk pipeline pelacakan inline. Menimpa `_tkPost` dan `_tkFlushQueue` milik blok `tkantre`.

## Kenapa perlu

Blok `tkantre` menahan klien di **5 kiriman/menit**:

```js
var MAKS_PER_MENIT = 5;
var JEDA_MIN_MS = 11000;
```

Sementara perekam sudah memakai kuota itu habis sendiri: `TK_MIN_INTERVAL_MS = 12000` → 1 titik / 12 detik = tepat 5/menit. Jadi setiap kali `_tkFlushQueue` bangun, `riwayat` sudah penuh dan `_tkPost` membalas `'retry'` **sebelum sampai ke `fetch`**. Karena `q.shift()` hanya jalan saat `'ok'` atau `'gone'`, titiknya tetap di tempat.

Akibatnya: **selama pelacakan aktif, antrean secara matematis tidak bisa terkuras.** Gejala di lapangan — angka antrean bertahan di 2 dan tidak pernah turun.

Setelah PR #5, server mengizinkan 20 kiriman/menit per pengguna (`RATE_UPDATE` di `api/tracking.js`), jadi plafon klien 5/menit itu sekarang murni penghambat diri sendiri.

## Yang diperbaiki

| Perilaku | `tkantre` | `tkkuota` |
|---|---|---|
| Kuota klien | 5 / menit | **15 / menit** (server 20) |
| Jeda minimum antar kiriman | 11.000 ms | **2.500 ms** |
| Titik terkuras per siklus | 1 | **3**, berjeda |
| Siklus penguras | 20 detik | **10 detik** |
| `sesiMati` | hanya di memori | **disimpan di `localStorage`** |
| Penghapusan dari antrean | timpa salinan lama | **baca ulang, lalu buang yang cocok** |
| Kuras berbarengan | mungkin dobel kirim | **dijaga bendera `sibuk`** |

Dua perbaikan terakhir memperbaiki bug nyata di `tkantre`: pada jalur 404, `buangSesi()` menulis ulang antrean, lalu `_tkFlushQueue` menimpanya dengan salinan lama — titik yang sudah dibuang bisa hidup kembali. Titik baru yang masuk antrean saat `fetch` sedang berjalan juga bisa hilang tertimpa.

Jeda dingin 429 dan pembuangan sesi 404 dipertahankan — dua-duanya sudah benar.

## Cara pasang

1. Buka `index.html` di GitHub → tombol pensil (**Edit**).
2. Tekan **`Ctrl`+`End`** (atau geser sampai paling bawah). Baris terakhir berkas ini adalah `</script>`.
3. Tempel seluruh blok di bawah ini **tepat di atas `</script>` terakhir**, di bawah blok `PENGATUR ANTREAN & KUOTA KIRIM POSISI`.
4. Commit langsung ke `main` (atau lewat PR, terserah).

**Jangan** menempelkannya di tengah berkas, dan jangan mengganti blok `tkantre` — blok ini dirancang untuk menimpanya saat dijalankan, bukan menggantikannya di berkas.

## Bloknya

```js
// ===== PENYELARAS KUOTA KIRIM POSISI (tkkuota) =====
// Tempel PALING BAWAH di index.html, tepat di atas </script> terakhir,
// di bawah blok "PENGATUR ANTREAN & KUOTA KIRIM POSISI".
//
// Yang diperbaiki:
//  - Blok sebelumnya menahan klien di 5 kiriman/menit, padahal perekam sudah
//    memakai 5/menit sendiri (1 titik / 12 detik). Penguras antrean selalu
//    ditolak 'retry' sebelum sampai fetch, jadi antrean tidak pernah terkuras
//    selama pelacakan aktif. Server kini mengizinkan 20/menit.
//  - sesiMati hanya di memori, jadi titik milik sesi mati dicoba lagi setiap
//    kali halaman dimuat ulang.
//  - Penghapusan titik menimpa antrean dengan salinan lama, sehingga titik yang
//    sudah dibuang bisa hidup kembali dan titik baru bisa hilang.
(function () {
  if (window.__tkKuotaFix) return;
  window.__tkKuotaFix = true;

  var KEY = (typeof TK_QUEUE_KEY === 'string') ? TK_QUEUE_KEY : 'bwkTrackingQueueInline';
  var KEY_MATI = 'bwkTkSesiMati';
  var MAKS_PER_MENIT = 15;              // server: 20 per menit per pengguna
  var JEDA_MIN_MS = 2500;               // sebelumnya 11000
  var DINGIN_MS = 70000;
  var UMUR_MAKS_MS = 4 * 3600 * 1000;
  var KURAS_PER_SIKLUS = 3;
  var SIKLUS_MS = 10000;

  var riwayat = [];
  var dinginSampai = 0;
  var sibuk = false;

  function baca() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function tulis(l) {
    try { localStorage.setItem(KEY, JSON.stringify(l.slice(-50))); } catch (e) {}
  }
  function tunggu(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }
  function jam(t) {
    var d = t ? new Date(t) : new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  // Daftar sesi mati kini bertahan sesudah muat ulang.
  function bacaMati() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY_MATI) || '{}');
      var now = Date.now(), sisa = {};
      Object.keys(o).forEach(function (k) {
        if (now - o[k] < UMUR_MAKS_MS) sisa[k] = o[k];
      });
      return sisa;
    } catch (e) { return {}; }
  }
  function tandaiMati(sid) {
    var m = bacaMati();
    m[sid] = Date.now();
    try { localStorage.setItem(KEY_MATI, JSON.stringify(m)); } catch (e) {}
  }

  function chip() {
    var d = document.getElementById('tkStatusChip');
    if (d) return d;
    d = document.createElement('div');
    d.id = 'tkStatusChip';
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;' +
      'z-index:9998;max-width:92vw;padding:9px 15px;border-radius:18px;' +
      'font:600 12px/1.35 system-ui,-apple-system,sans-serif;color:#fff;' +
      'background:#1f2937;box-shadow:0 6px 18px rgba(0,0,0,.28);display:none;' +
      'text-align:center;pointer-events:none;';
    document.body.appendChild(d);
    return d;
  }
  function stat(txt, jenis) {
    var d = chip();
    if (!txt) { d.style.display = 'none'; return; }
    d.textContent = txt;
    d.style.background = (jenis === 'bad') ? '#b91c1c' : (jenis === 'warn' ? '#b45309' : '#065f46');
    d.style.display = 'block';
  }
  function pendek(t) {
    if (!t) return '';
    try { var o = JSON.parse(t); if (o && o.error) return String(o.error); } catch (e) {}
    return String(t).slice(0, 90);
  }

  function samaTitik(a, b) {
    return !!a && !!b &&
      a.session_id === b.session_id &&
      a._tkQ === b._tkQ &&
      a.lat === b.lat &&
      a.lng === b.lng;
  }

  function bersihkan(q) {
    var now = Date.now();
    var mati = bacaMati();
    var sebelum = q.length;
    var sisa = q.filter(function (p) {
      if (!p || !p.session_id) return false;
      if (mati[p.session_id]) return false;
      if (!p._tkQ) { p._tkQ = now; return true; }
      return (now - p._tkQ) < UMUR_MAKS_MS;
    });
    if (sisa.length !== sebelum) {
      console.log('[tracking] antrean dibersihkan:', sebelum, '->', sisa.length);
    }
    return sisa;
  }

  // Baca ulang dari localStorage sebelum membuang, supaya titik yang masuk
  // antrean saat fetch sedang berjalan tidak ikut tertimpa dan hilang.
  function buangTitik(titik) {
    var q = baca();
    for (var j = 0; j < q.length; j++) {
      if (samaTitik(q[j], titik)) { q.splice(j, 1); break; }
    }
    tulis(bersihkan(q));
  }

  function buangSesi(sid) {
    var q = baca();
    var sisa = q.filter(function (p) { return !p || p.session_id !== sid; });
    var dibuang = q.length - sisa.length;
    tulis(sisa);
    if (dibuang > 0) {
      console.warn('[tracking] sesi', sid, 'mati, membuang', dibuang, 'titik antrean');
      stat('Sesi lama berakhir, ' + dibuang + ' titik antrean dibuang', 'warn');
    }
    return dibuang;
  }

  window._tkPost = async function (payload) {
    var sid = payload && payload.session_id ? String(payload.session_id) : '';
    var now = Date.now();

    if (sid && bacaMati()[sid]) return 'gone';

    if (now < dinginSampai) {
      stat('Menunggu kuota server, ' + Math.ceil((dinginSampai - now) / 1000) + ' detik lagi', 'warn');
      return 'retry';
    }

    riwayat = riwayat.filter(function (t) { return now - t < 60000; });
    if (riwayat.length >= MAKS_PER_MENIT) {
      stat('Kuota kirim penuh, titik diantre', 'warn');
      return 'retry';
    }
    if (riwayat.length && (now - riwayat[riwayat.length - 1]) < JEDA_MIN_MS) {
      return 'retry';
    }

    var url = '/api/tracking?act=positions';
    var body = JSON.stringify(payload);
    var r = null;
    riwayat.push(now);

    try {
      r = await fetch(url, { method: 'POST', headers: _tkHeaders(), body: body });
    } catch (e) {
      stat('Jaringan gagal, titik diantre', 'bad');
      return 'retry';
    }

    if (r.status === 401 && typeof _tkRefreshToken === 'function') {
      try { await _tkRefreshToken(true); } catch (e) {}
      try {
        r = await fetch(url, { method: 'POST', headers: _tkHeaders(), body: body });
      } catch (e) { return 'retry'; }
    }

    if (r.status === 429) {
      dinginSampai = Date.now() + DINGIN_MS;
      stat('Kuota server penuh, jeda 70 detik', 'warn');
      console.warn('[tracking] 429, jeda sampai', jam(dinginSampai));
      return 'retry';
    }

    if (r.status === 404) {
      if (sid) { tandaiMati(sid); buangSesi(sid); }
      else stat('HTTP 404, sesi tidak ada di server', 'bad');
      return 'gone';
    }

    if (!r.ok) {
      var teks = '';
      try { teks = await r.text(); } catch (e) {}
      stat('Gagal kirim: HTTP ' + r.status + ' - ' + pendek(teks), 'bad');
      console.warn('[tracking] kirim gagal:', r.status, teks);
      return 'retry';
    }

    var d = null;
    try { d = await r.json(); } catch (e) {}
    if (d && d.ok) {
      var sisaQ = baca().length;
      var akur = (payload && payload.accuracy) ? ' akurasi ' + Math.round(payload.accuracy) + ' m' : '';
      stat('Terkirim ' + jam() + akur + (sisaQ ? ' - antrean ' + sisaQ : ''), 'ok');
      return 'ok';
    }

    stat('Server menolak: ' + pendek(JSON.stringify(d)), 'bad');
    return 'retry';
  };

  // Kuras beberapa titik per siklus, berjeda supaya tidak menabrak JEDA_MIN_MS
  // sendiri. Bendera sibuk mencegah dua kuras berjalan bersamaan (blok tkantre
  // masih punya setInterval sendiri yang memanggil window._tkFlushQueue).
  window._tkFlushQueue = async function () {
    if (sibuk) return;
    sibuk = true;
    var terkirim = 0;
    try {
      for (var i = 0; i < KURAS_PER_SIKLUS; i++) {
        var q = bersihkan(baca());
        tulis(q);
        if (!q.length) break;

        var titik = q[0];
        var out = 'retry';
        try { out = await window._tkPost(titik); } catch (e) { out = 'retry'; }

        if (out === 'ok' || out === 'gone') {
          buangTitik(titik);
          if (out === 'ok') terkirim++;
        } else {
          break; // kuota penuh, jaringan mati, atau server menolak
        }

        if (i < KURAS_PER_SIKLUS - 1) await tunggu(JEDA_MIN_MS + 100);
      }

      if (terkirim && !baca().length) {
        stat('Antrean bersih, ' + terkirim + ' titik tertunda terkirim', 'ok');
      }
    } finally {
      sibuk = false;
    }
  };

  setInterval(function () {
    try { window._tkFlushQueue(); } catch (e) {}
  }, SIKLUS_MS);

  tulis(bersihkan(baca()));
  console.log('[tracking] penyelaras kuota aktif, tunggakan:', baca().length,
    '| maks/menit:', MAKS_PER_MENIT, '| jeda min:', JEDA_MIN_MS + 'ms');
})();
```

## Verifikasi sebelum commit

- `__tkKuotaFix` harus muncul **tepat 2 kali** di `index.html` (baris `if` dan baris penetapan).
- `PENYELARAS KUOTA KIRIM POSISI` harus muncul **1 kali**.
- Blok ini harus berada **sesudah** `PENGATUR ANTREAN & KUOTA KIRIM POSISI`. Urutan menentukan siapa yang menang — yang terakhir dimuat yang dipakai.
- Jangan sampai ada `</script>` ganda atau blok tertempel di dalam blok lain.

## Cara uji setelah deploy

1. Muat ulang halaman di ponsel (tarik ke bawah untuk segarkan), pastikan baterai di atas 40 %.
2. Mulai sesi **baru**. Perbaikan tidak bisa menyusul sesi lama.
3. Diamkan 2–3 menit sambil bergerak.

Yang diharapkan:

- Angka `antrean` **turun ke 0** dan bertahan di 0, tidak lagi mandek di 2.
- Kalau ada tunggakan lama, muncul pil hijau `Antrean bersih, N titik tertunda terkirim` sekali saja.
- Pil oranye `Kuota kirim penuh, titik diantre` boleh muncul sesekali saat sinyal buruk, tapi tidak boleh menetap.
- Pil oranye `Kuota server penuh, jeda 70 detik` **tidak boleh muncul lagi**. Kalau muncul, berarti 15/menit masih terlalu tinggi untuk `RATE_UPDATE` di server — kabari, turunkan ke 10.

## Sisa yang belum disentuh

Titik yang terkuras dari antrean tetap mendapat waktu yang salah: `api/tracking.js` menstempel `sent_at: new Date()` saat titik **diterima**, bukan saat direkam. Titik yang tertunda 40 detik akan tercatat 40 detik terlambat. Perbaikannya ada di sisi server (terima `recorded_at` dari klien) dan belum termasuk dalam patch ini.
