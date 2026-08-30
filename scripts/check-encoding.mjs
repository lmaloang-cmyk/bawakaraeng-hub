#!/usr/bin/env node
// Pemindai encoding untuk repo Bawakaraeng Hub.
//
// Latar belakang: sw.js pernah tersimpan sebagai UTF-16LE. Browser mendekode
// skrip service worker sebagai UTF-8, jadi berkas itu GAGAL PARSE dan service
// worker tidak pernah terpasang sama sekali. Tidak ada pesan error yang terlihat
// di halaman -- registrasi hanya gagal diam-diam.
//
// Jalankan dari akar repo:  node scripts/check-encoding.mjs .

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const root = process.argv[2] || '.'
const SKIP = new Set(['node_modules', '.git', 'images', 'screenshots', 'guide-assets', 'history'])
const TEXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.sql', '.md', '.txt', '.yml', '.yaml'])

const problems = []
const warnings = []
let scanned = 0

function walk(dir) {
	let entries
	try { entries = readdirSync(dir) } catch { return }
	for (const name of entries) {
		if (SKIP.has(name) || name.startsWith('.')) continue
		const full = join(dir, name)
		let st
		try { st = statSync(full) } catch { continue }
		if (st.isDirectory()) { walk(full); continue }
		if (!TEXT.has(extname(name))) continue
		check(full, name)
	}
}

function check(path, name) {
	let buf
	try { buf = readFileSync(path) } catch { return }
	scanned++
	if (buf.length < 2) return

	const b0 = buf[0], b1 = buf[1], b2 = buf[2]

	// UTF-16LE / UTF-16BE BOM -- fatal untuk berkas yang dieksekusi browser
	if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
		problems.push(`${path}: BOM UTF-16 -- browser mendekode sebagai UTF-8, berkas ini akan gagal parse`)
		return
	}

	// UTF-16 tanpa BOM: banyak byte NUL di antara karakter ASCII
	const probe = buf.subarray(0, Math.min(buf.length, 2048))
	let nul = 0
	for (const b of probe) if (b === 0x00) nul++
	if (nul > probe.length * 0.2) {
		problems.push(`${path}: banyak byte NUL (${nul}/${probe.length}) -- kemungkinan UTF-16 tanpa BOM`)
		return
	}

	// BOM UTF-8: tidak fatal, tetapi merusak JSON.parse dan bisa mengacaukan skrip
	if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
		const level = extname(name) === '.json' ? problems : warnings
		level.push(`${path}: BOM UTF-8 -- buang (JSON.parse gagal, skrip bisa bermasalah)`)
	}

	// CRLF pada berkas yang dieksekusi: tidak fatal, hanya bikin diff berisik
	if (buf.includes(0x0d) && ['.js', '.mjs', '.css'].includes(extname(name))) {
		warnings.push(`${path}: akhir baris CRLF -- sebaiknya LF`)
	}
}

walk(root)

console.log(`\nMemindai ${scanned} berkas teks di ${root}\n`)

if (problems.length) {
	console.log('MASALAH:')
	for (const p of problems) console.log('  x  ' + p)
	console.log('')
}
if (warnings.length) {
	console.log('PERINGATAN:')
	for (const w of warnings) console.log('  !  ' + w)
	console.log('')
}
if (!problems.length && !warnings.length) console.log('Bersih: semua berkas teks UTF-8 tanpa BOM.\n')

if (problems.length) {
	console.log('Cara memperbaiki berkas UTF-16:')
	console.log("  iconv -f UTF-16LE -t UTF-8 sw.js | tr -d '\\r' > sw.tmp && mv sw.tmp sw.js")
	console.log('  node --check sw.js\n')
}

process.exit(problems.length ? 1 : 0)
