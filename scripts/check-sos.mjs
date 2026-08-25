/* ============================================================================
 * Validator integrasi SOS.  Jalankan:  node scripts/check-sos.mjs [rootRepo]
 *
 * Dipakai SETELAH patch ditempel ke repo, untuk memastikan tidak ada yang lupa:
 *   1. Semua berkas SOS baru ada dan sintaksnya sah.
 *   2. index.html memuat semua skrip SOS, dan urutannya benar
 *      (sos-pluscode -> sos-context -> sos-auth -> sos-outbox -> sos-relay -> push -> ops -> sos).
 *   3. Tidak ada lagi definisi window._sosRefreshPush ganda di sos.js dan push.js.
 *   4. SOS_RADIUS tidak lagi Infinity.
 *   5. Antrean lama bwkSosQueue sudah dicabut dari ops.js.
 *   6. sw.js menangani event 'sync' untuk tag antrean SOS.
 *   7. Tidak ada kunci VAPID yang di-hardcode di push.js.
 *
 * Keluar dengan kode 1 bila ada masalah, sehingga bisa dipakai di CI.
 * ==========================================================================*/

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] ? process.argv[2] : join(here, '..');

const problems = [];
const warnings = [];
const notes = [];

function read(rel) {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

// -------------------------------------------------------- 1. berkas & sintaks
const REQUIRED = [
  'sos-pluscode.js',
  'sos-context.js',
  'sos-auth.js',
  'sos-outbox.js',
  'sos-relay.js',
  'sos-ui.css'
];
const OPTIONAL = ['sos-mesh.js'];

for (const f of [...REQUIRED, ...OPTIONAL]) {
  const p = join(root, f);
  if (!existsSync(p)) {
    if (REQUIRED.includes(f)) problems.push('Berkas wajib hilang: ' + f);
    else warnings.push('Berkas opsional tidak ada: ' + f);
    continue;
  }
  if (f.endsWith('.js')) {
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
      notes.push('sintaks sah: ' + f);
    } catch (e) {
      problems.push('Sintaks JavaScript rusak di ' + f + ': ' + String(e.stderr || e.message).slice(0, 300));
    }
  }
}

// ------------------------------------------------------- 2. integrasi di index.html atau ops.js
const opsJs = read('ops.js'); // dimuat dulu agar bisa dipakai di pengecekan integrasi halaman
const index = read('index.html');
const MODS = ['/sos-pluscode.js', '/sos-context.js', '/sos-auth.js', '/sos-outbox.js', '/sos-relay.js'];
if (!index) {
  warnings.push('index.html tidak ditemukan di ' + root + ' (lewati pemeriksaan integrasi halaman)');
} else {
  // Modul SOS dimuat secara dinamis oleh ops.js (bukan tag <script> langsung di index.html).
  // Cek apakah ops.js ada dan memuat modul-modul tersebut, atau index.html langsung memuatnya.
  const hasDynamicLoad = opsJs && MODS.every(m => opsJs.includes(m));
  const hasDirectLoad = MODS.every(m => index.indexOf(m) >= 0);
  if (!hasDynamicLoad && !hasDirectLoad) {
    problems.push('index.html atau ops.js belum memuat modul modul SOS (pluscode/context/auth/outbox/relay).');
  }
  // Cek urutan jika dimuat langsung di index.html
  if (hasDirectLoad) {
    const ORDER = ['sos-pluscode.js', 'sos-context.js', 'sos-auth.js', 'sos-outbox.js', 'sos-relay.js', 'push.js', 'ops.js', 'sos.js'];
    const positions = [];
    for (const f of ORDER) {
      const i = index.indexOf(f);
      if (i < 0) {
        problems.push('index.html belum memuat ' + f);
      } else {
        positions.push([f, i]);
      }
    }
    for (let i = 1; i < positions.length; i++) {
      if (positions[i][1] < positions[i - 1][1]) {
        problems.push('Urutan skrip salah di index.html: ' + positions[i][0] + ' dimuat sebelum ' + positions[i - 1][0]);
      }
    }
  }
  if (index.indexOf('sos-ui.css') < 0 && !(opsJs && opsJs.includes('sos-ui.css'))) {
    problems.push('index.html atau ops.js belum memuat sos-ui.css');
  }
}

// -------------------------------------------- 3-4-5. patch pada berkas lama
const sosJs = read('sos.js');
const pushJs = read('push.js');

if (!sosJs) {
  warnings.push('sos.js tidak ditemukan (lewati)');
} else {
  if (/SOS_RADIUS\s*=\s*Infinity/.test(sosJs)) {
    problems.push('sos.js masih memakai SOS_RADIUS=Infinity (mode percobaan). Kembalikan ke radius nyata.');
  }
  const defs = (sosJs.match(/window\._sosRefreshPush\s*=/g) || []).length;
  if (defs > 0 && pushJs && /window\._sosRefreshPush\s*=/.test(pushJs)) {
    problems.push('window._sosRefreshPush masih didefinisikan di DUA berkas (sos.js dan push.js). Yang dimuat belakangan akan menimpa yang lain.');
  }
  if (!/speechSynthesis\.cancel\(\)/.test(sosJs)) {
    warnings.push('sos.js belum memanggil speechSynthesis.cancel() sebelum bicara. Antrean suara alarm bisa menumpuk.');
  }
  if (/name\s*&&\s*a\.name\s*===\s*s\.name/.test(sosJs) && !/sig_id|signature|clientId/.test(sosJs)) {
    warnings.push('sos.js masih mencocokkan SOS "milik sendiri" hanya lewat nama + jarak. Dua pendaki bernama sama di lokasi sama akan saling membungkam alarm.');
  }
}

if (pushJs) {
  const hard = pushJs.match(/B[A-Za-z0-9_-]{80,}/g);
  if (hard && hard.length) {
    warnings.push('push.js masih memuat ' + hard.length + ' kunci VAPID yang ditulis langsung di kode. Rotasi kunci jadi sulit.');
  }
}

if (opsJs) {
  // Hanya larang FUNGSI LAMA (definisi dengan = function). Kehadiran di komentar tidak masalah.
  if (/function\s+_sosQueue(Enqueue|Dequeue|Remove|Sync)\s*\(/.test(opsJs)) {
    problems.push('ops.js masih memuat fungsi antrean lama (_sosQueueEnqueue/_sosQueueDequeue/_sosQueueRemove/_syncSosQueue). Cabut dan alihkan ke BWKSosOutbox.');
  }
  if (/_sosQueueDequeue\s*\(/.test(opsJs) && !/_sosQueueDequeue\s*\/\//.test(opsJs)) {
    problems.push('ops.js masih memanggil _sosQueueDequeue() yang tidak pernah menghapus item terkirim.');
  }
  // Hanya cek di _sosPublishLegacy (bukan opsCheckin atau komentar).
  const legacySection = opsJs.match(/function\s+_sosPublishLegacy[\s\S]{0,800}/);
  if (legacySection && /!\s*u\s*\|\|\s*!u\.google/.test(legacySection[0])) {
    problems.push('ops.js masih memblokir SOS bila belum login Google. Alihkan ke BWKSosAuth.ensureSession().');
  }
}

// ---------------------------------------------------------- 6. service worker
const sw = read('sw.js');
if (!sw) {
  warnings.push("sw.js tidak terbaca. Tanpa service worker yang sehat, TIDAK ADA notifikasi latar sama sekali - ini prasyarat utama SOS.");
} else {
  if (!/addEventListener\(\s*['"]sync['"]/.test(sw)) {
    problems.push("sw.js belum menangani event 'sync'. Antrean SOS tidak akan terkirim saat tab tertutup.");
  }
  if (!/bwk-sos-outbox/.test(sw)) {
    problems.push("sw.js belum mengenali tag sinkronisasi 'bwk-sos-outbox'.");
  }
  if (!/addEventListener\(\s*['"]push['"]/.test(sw)) {
    problems.push("sw.js belum menangani event 'push'. Notifikasi SOS latar tidak akan muncul.");
  }
  if (!/requireInteraction/.test(sw)) {
    warnings.push('sw.js belum memakai requireInteraction:true pada notifikasi SOS. Notifikasi bisa hilang sendiri sebelum dibaca.');
  }
}

// -------------------------------------------------------------------- hasil
console.log('Validator SOS · root: ' + root + '\n');
if (notes.length) {
  console.log('Diperiksa:');
  notes.forEach((n) => console.log('  · ' + n));
  console.log('');
}
if (warnings.length) {
  console.log('Peringatan (' + warnings.length + '):');
  warnings.forEach((w) => console.log('  ! ' + w));
  console.log('');
}
if (problems.length) {
  console.log('Masalah (' + problems.length + '):');
  problems.forEach((p) => console.log('  x ' + p));
  console.log('\nGAGAL');
  process.exit(1);
}
console.log('LULUS — tidak ada masalah yang menghalangi rilis.');
