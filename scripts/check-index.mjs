#!/usr/bin/env node
/**
 * check-index.mjs — Penjaga kualitas index.html
 * Paket perbaikan hasil audit 23 Agustus 2026.
 *
 * Memeriksa:
 *   1. Sisa marker konflik merge (<<<<<<<, =======, >>>>>>>)
 *   2. Sintaks seluruh <script> inline (node --check)
 *   3. Definisi/panggilan fungsi yang terduplikasi
 *   4. Pemanggilan _addTileLayer('x') dengan key yang tidak ada di TILE_SOURCES
 *   5. Referensi file lokal (src/href) yang tidak ada di repo
 *
 * Jalankan:  node scripts/check-index.mjs [file.html ...]
 * Keluar dengan kode 1 bila ada temuan fatal — cocok untuk CI.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const targets = process.argv.slice(2);
const files = targets.length ? targets : ['index.html', 'dont-panic.html', 'PANDUAN.html'].filter(f => existsSync(f));

let fatal = 0;
let warn = 0;

const red = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const green = s => `\x1b[32m${s}\x1b[0m`;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkConflictMarkers(name, html) {
  const re = /^(<{7}|={7}|>{7})/gm;
  let m, found = [];
  while ((m = re.exec(html))) found.push(lineOf(html, m.index));
  if (found.length) {
    fatal++;
    console.log(red(`  ✗ Sisa marker konflik merge pada baris: ${found.join(', ')}`));
  } else {
    console.log(green('  ✓ Tidak ada marker konflik merge'));
  }
}

function extractInlineScripts(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
    out.push({ code: m[2], startLine: lineOf(html, m.index), isModule: /type\s*=\s*["']module/i.test(attrs) });
  }
  return out;
}

function checkSyntax(name, html) {
  const scripts = extractInlineScripts(html);
  if (!scripts.length) { console.log('  · Tidak ada <script> inline'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'bwk-check-'));
  let bad = 0;
  scripts.forEach((s, i) => {
    const file = join(dir, `inline-${i}.${s.isModule ? 'mjs' : 'js'}`);
    writeFileSync(file, s.code, 'utf8');
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      bad++;
      fatal++;
      const msg = String(err.stderr || err.message).split('\n').slice(0, 6).join('\n      ');
      console.log(red(`  ✗ Syntax error pada <script> yang dimulai di baris ${s.startLine}:`));
      console.log('      ' + msg);
    }
  });
  if (!bad) console.log(green(`  ✓ ${scripts.length} blok <script> inline lolos pemeriksaan sintaks`));
}

function checkDuplicateFunctions(name, html) {
  const re = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*function\s*\()/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(html))) {
    const fn = m[1] || m[2];
    if (!fn) continue;
    if (!seen.has(fn)) seen.set(fn, []);
    seen.get(fn).push(lineOf(html, m.index));
  }
  const dups = [...seen.entries()].filter(([, lines]) => lines.length > 1);
  if (dups.length) {
    warn++;
    console.log(yellow('  ⚠ Fungsi didefinisikan lebih dari sekali (cek apakah sisa merge):'));
    dups.slice(0, 15).forEach(([fn, lines]) => console.log(`      ${fn}() → baris ${lines.join(', ')}`));
    if (dups.length > 15) console.log(`      … dan ${dups.length - 15} lainnya`);
  } else {
    console.log(green('  ✓ Tidak ada definisi fungsi ganda'));
  }
}

function checkTileSources(name, html) {
  const block = html.match(/TILE_SOURCES\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!block) { console.log('  · TILE_SOURCES tidak ditemukan, lewati'); return; }
  const keys = [...block[1].matchAll(/^\s{0,8}([A-Za-z_$][\w$]*)\s*:\s*\{/gm)].map(m => m[1]);
  const used = [...html.matchAll(/_addTileLayer\(\s*['"]([^'"]+)['"]/g)]
    .map(m => ({ key: m[1], line: lineOf(html, m.index) }));
  const bad = used.filter(u => !keys.includes(u.key));
  if (bad.length) {
    fatal++;
    console.log(red('  ✗ _addTileLayer() memakai layer yang tidak ada di TILE_SOURCES:'));
    bad.forEach(b => console.log(`      '${b.key}' pada baris ${b.line} (tersedia: ${keys.join(', ')})`));
  } else {
    console.log(green(`  ✓ Semua layer yang dipakai ada di TILE_SOURCES (${keys.join(', ') || 'kosong'})`));
  }
}

function checkLocalAssets(name, html) {
  const base = dirname(resolve(name));
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi)]
    .map(m => m[1])
    .filter(u => !/^(https?:|data:|mailto:|tel:|\/\/|javascript:)/i.test(u));
  const missing = [...new Set(refs)].filter(u => !existsSync(resolve(base, u)));
  if (missing.length) {
    warn++;
    console.log(yellow('  ⚠ File lokal yang dirujuk tapi tidak ada di repo:'));
    missing.slice(0, 20).forEach(u => console.log('      ' + u));
  } else {
    console.log(green('  ✓ Semua aset lokal yang dirujuk tersedia'));
  }
}

if (!files.length) {
  console.log('Tidak ada file HTML untuk diperiksa.');
  process.exit(0);
}

for (const f of files) {
  if (!existsSync(f)) { console.log(red(`Lewati ${f}: tidak ditemukan`)); continue; }
  const html = readFileSync(f, 'utf8');
  console.log(`\n── ${f} (${(html.length / 1024).toFixed(0)} KB)`);
  checkConflictMarkers(f, html);
  checkSyntax(f, html);
  checkDuplicateFunctions(f, html);
  checkTileSources(f, html);
  checkLocalAssets(f, html);
}

console.log(`\nRingkasan: ${fatal} masalah fatal, ${warn} peringatan.`);
process.exit(fatal ? 1 : 0);
