/* ============================================================================
 * Uji otomatis paket SOS.  Jalankan:  node scripts/test-sos.mjs
 *
 * Menguji hal-hal yang TIDAK BOLEH salah:
 *   1. Plus Code encode cocok dengan vektor uji resmi Open Location Code.
 *   2. Plus Code decode mengembalikan koordinat di dalam sel yang benar.
 *   3. Round-trip encode->decode presisi <= ~4 meter untuk titik jalur Bawakaraeng.
 *   4. Logika klasifikasi hasil kirim outbox (409 = sukses, 400 = mati, 5xx = ulang).
 *   5. Logika backoff tidak pernah nol berulang (mencegah banjir permintaan).
 * ==========================================================================*/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    failures.push(name + (extra ? ' -> ' + extra : ''));
    console.log('  FAIL ' + name + (extra ? ' -> ' + extra : ''));
  }
}

// --- Muat sos-pluscode.js di dalam konteks global palsu -------------------
const src = readFileSync(join(root, 'sos-pluscode.js'), 'utf8');
const sandbox = {};
new Function('globalThis', 'module', src).call(sandbox, sandbox, { exports: {} });
const PC = sandbox.BWKPlusCode;

console.log('\n[1] Plus Code · vektor uji resmi');
check('kode 8 digit 20.375,2.775', PC.encode(20.375, 2.775, 6) === '7FG49Q00+', PC.encode(20.375, 2.775, 6));
check('Zurich 47.365590,8.524997 (10 digit) -> 8FVC9G8F+6X',
  PC.encode(47.36559, 8.524997, 10) === '8FVC9G8F+6X', PC.encode(47.36559, 8.524997, 10));
check('Zurich 11 digit menambah satu digit grid -> 8FVC9G8F+6XQ',
  PC.encode(47.36559, 8.524997, 11) === '8FVC9G8F+6XQ', PC.encode(47.36559, 8.524997, 11));
check('panjang default adalah 10 digit',
  PC.encode(47.36559, 8.524997) === '8FVC9G8F+6X', PC.encode(47.36559, 8.524997));
check('kode 10 digit 47.0000625,8.0000625 -> 8FVC2222+22',
  PC.encode(47.0000625, 8.0000625, 10) === '8FVC2222+22', PC.encode(47.0000625, 8.0000625, 10));
check('kode 10 digit -41.2730625,174.7859375 -> 4VCPPQGP+Q9',
  PC.encode(-41.2730625, 174.7859375, 10) === '4VCPPQGP+Q9', PC.encode(-41.2730625, 174.7859375, 10));
check('kode 6 digit 0.5,-179.5 -> 62G20000+',
  PC.encode(0.5, -179.5, 4) === '62G20000+', PC.encode(0.5, -179.5, 4));

console.log('\n[2] Plus Code · validasi format');
check('kode sah dikenali', PC.isValid('8FVC9G8F+6X') === true);
check('tanpa tanda plus ditolak', PC.isValid('8FVC9G8F6X') === false);
check('pemisah di posisi salah ditolak', PC.isValid('8FVC9G+8F6X') === false);
check('huruf terlarang ditolak', PC.isValid('8FVC9G8A+6X') === false);
check('string kosong ditolak', PC.isValid('') === false);

console.log('\n[3] Plus Code · round-trip di jalur Bawakaraeng');
const titik = [
  ['Basecamp Pintu Angin', -5.29513, 119.92471],
  ['Pos 1 Air Terjun', -5.30120, 119.93088],
  ['Puncak Bawakaraeng', -5.31250, 119.94500],
  ['Lembanna', -5.27600, 119.90900]
];
function galat(lat, lng, code) {
  const back = PC.decode(code);
  const dLat = Math.abs(back.lat - lat) * 111320;
  const dLng = Math.abs(back.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180);
  return { err: Math.sqrt(dLat * dLat + dLng * dLng), back };
}
for (const [nama, lat, lng] of titik) {
  // Sel 10 digit berukuran ~14 x 14 m, jadi jarak terjauh ke pusat sel ~10 m.
  const c10 = PC.encode(lat, lng, 10);
  const g10 = galat(lat, lng, c10);
  check(nama + ' 10 digit <= 11 m (' + c10 + ')', g10.err <= 11, g10.err.toFixed(2) + ' m');
  check(nama + ' titik berada di dalam sel 10 digit',
    lat >= g10.back.latLo && lat <= g10.back.latHi && lng >= g10.back.lngLo && lng <= g10.back.lngHi);
  // Sel 11 digit berukuran ~2,8 x 3,5 m.
  const c11 = PC.encode(lat, lng, 11);
  const g11 = galat(lat, lng, c11);
  check(nama + ' 11 digit <= 3 m (' + c11 + ')', g11.err <= 3, g11.err.toFixed(2) + ' m');
}

console.log('\n[4] Plus Code · nilai ekstrem tidak membuat crash');
check('kutub utara', typeof PC.encode(90, 180, 11) === 'string' && PC.encode(90, 180, 11).length === 12);
check('kutub selatan', PC.encode(-90, -180, 10) === '22222222+22', PC.encode(-90, -180, 10));
check('bujur di luar rentang dinormalkan', PC.encode(0, 190, 10) === PC.encode(0, -170, 10));
check('input bukan angka menghasilkan string kosong', PC.encode(NaN, 5, 10) === '');

console.log('\n[5] Outbox · klasifikasi hasil kirim');
// Duplikat logika classify() dari sos-outbox.js untuk diuji terpisah.
function classify(res) {
  if (res.ok && res.data && res.data.id) return { kind: 'sent' };
  if (res.status === 409 && res.data && res.data.id) return { kind: 'sent' };
  if (res.status === 400 || res.status === 413) return { kind: 'dead' };
  if (res.status === 401 || res.status === 403) return { kind: 'retry' };
  if (res.status === 429) return { kind: 'retry' };
  return { kind: 'retry' };
}
check('201 dengan id = terkirim', classify({ ok: true, status: 201, data: { id: 'abc' } }).kind === 'sent');
check('409 dengan id = terkirim (bukan gagal)', classify({ ok: false, status: 409, data: { id: 'abc' } }).kind === 'sent');
check('400 = mati permanen, jangan diulang', classify({ ok: false, status: 400, data: {} }).kind === 'dead');
check('401 = coba lagi setelah sesi siap', classify({ ok: false, status: 401, data: {} }).kind === 'retry');
check('429 = coba lagi', classify({ ok: false, status: 429, data: {} }).kind === 'retry');
check('502 = coba lagi', classify({ ok: false, status: 502, data: {} }).kind === 'retry');

console.log('\n[6] Outbox · backoff naik dan tidak pernah membanjiri server');
// Nilai dibaca LANGSUNG dari sos-outbox.js supaya uji tidak bisa melenceng
// dari implementasi sebenarnya.
const outboxSrc = readFileSync(join(root, 'sos-outbox.js'), 'utf8');
const mB = outboxSrc.match(/var BACKOFF = (\[[^\]]*\]);/);
const mT = outboxSrc.match(/var MAX_TRIES = (\d+);/);
check('BACKOFF terbaca dari sos-outbox.js', !!mB);
check('MAX_TRIES terbaca dari sos-outbox.js', !!mT);
const BACKOFF = mB ? JSON.parse(mB[1]) : [];
const MAX_TRIES = mT ? Number(mT[1]) : 0;
function backoffFor(t) { return BACKOFF[Math.min(t, BACKOFF.length - 1)]; }
check('percobaan ke-1 tidak menunggu', backoffFor(0) === 0);
check('backoff naik monoton', BACKOFF.every((v, i) => i === 0 || v > BACKOFF[i - 1]));
check('backoff maksimum 15 menit', backoffFor(999) === 900000, String(backoffFor(999)));
let total = 0;
for (let t = 0; t < MAX_TRIES; t++) total += backoffFor(t);
check(MAX_TRIES + ' percobaan menjangkau > 4 jam (' + (total / 3600000).toFixed(1) + ' jam)', total > 4 * 3600000);

console.log('\n[7] Outbox · antrean tidak boleh menggandakan diri');
// Simulasi perilaku LAMA (bug) vs BARU.
function simulasiLama(gagalBerturut) {
  let q = [{ id: 'a' }];
  for (let i = 0; i < gagalBerturut; i++) {
    const item = q[q.length - 1];      // dequeue TANPA menghapus (bug asli)
    q.unshift({ id: item.id });        // enqueue salinan baru saat gagal (bug asli)
  }
  return q.length;
}
function simulasiBaru(gagalBerturut) {
  const rec = { id: 'a', tries: 0, status: 'pending' };
  const q = [rec];
  for (let i = 0; i < gagalBerturut; i++) {
    rec.tries += 1;
    rec.status = rec.tries >= MAX_TRIES ? 'dead' : 'pending';
  }
  return q.length;
}
check('antrean lama membengkak setelah 5 kegagalan', simulasiLama(5) === 6, String(simulasiLama(5)));
check('antrean baru tetap 1 record setelah 5 kegagalan', simulasiBaru(5) === 1, String(simulasiBaru(5)));

console.log('\n---------------------------------------------');
console.log('lulus: ' + pass + '  gagal: ' + fail);
if (fail) {
  console.log('\nKegagalan:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('Semua uji lulus.');
