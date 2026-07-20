import { bodyWithin, rateLimit, secureApi, verifySupabaseUser } from '../lib/security.js';

// Lensa Bawakaraeng: in-app species identification (Google Lens alternative) via Gemini vision.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { prefix: 'idf-ip', limit: 20, windowMs: 10 * 60_000 })) return;
  if (!bodyWithin(req, 1_600_000)) return res.status(413).json({ error: 'Foto terlalu besar' });

  const user = await verifySupabaseUser(req);
  if (!user) return res.status(401).json({ error: 'Login diperlukan', code: 'LOGIN' });
  if (!rateLimit(req, res, { prefix: 'idf-user', id: user.id, limit: 15, windowMs: 10 * 60_000 })) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI belum dikonfigurasi', code: 'NO_KEY' });

  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Format foto tidak didukung (pakai JPG/PNG/WebP)' });
  const mime = m[1];
  const b64 = m[2];
  if (b64.length > 2_100_000) return res.status(413).json({ error: 'Foto terlalu besar' });

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const system = 'Anda adalah ahli biologi lapangan untuk kawasan Gunung Bawakaraeng, Sulawesi Selatan. Tugas Anda mengidentifikasi kemungkinan spesies flora, fauna, atau jenis batuan dari foto yang diberikan pendaki. Fitur ini HANYA untuk flora, fauna, dan batuan. Jika foto jelas bukan salah satu dari itu (misalnya wajah manusia, layar/monitor, tulisan, kendaraan, atau makanan olahan), set name ke string kosong, category ke "Lainnya", confidence ke "Rendah", dan pada description jelaskan singkat bahwa Lensa hanya mengenali flora, fauna, dan batuan. Jawab HANYA dalam format JSON valid tanpa teks lain. Bahasa Indonesia yang ringkas dan tenang. Jika tidak yakin, beri tingkat keyakinan rendah dan beberapa kemungkinan pada alternates. Jangan mengarang. Selalu ingatkan bahwa hasil hanyalah perkiraan yang perlu verifikasi ahli/petugas, terutama sebelum menyentuh, memberi makan, atau mengonsumsi.';
  const prompt = 'Identifikasi kemungkinan spesies pada foto ini. Balas HANYA JSON dengan kunci berikut: name (nama umum Bahasa Indonesia), scientific (nama ilmiah bila ada), category (salah satu: Flora, Fauna, Batuan, Lainnya), confidence (Tinggi, Sedang, atau Rendah), description (2-3 kalimat ciri utama & habitat di Bawakaraeng), danger (peringatan bila beracun/berbisa/dilindungi/berbahaya, string kosong bila tidak ada), tips (saran pengamatan aman singkat), alternates (array maksimal 3 nama alternatif bila ragu). Jangan tambahkan teks di luar JSON.';

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
      }),
      signal: AbortSignal.timeout(20_000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const gmsg = String((data && data.error && data.error.message) || '').slice(0, 200);
      return res.status(502).json({ error: gmsg ? ('Gemini menolak: ' + gmsg) : 'AI tidak tersedia', code: 'UPSTREAM' });
    }
    const cand = data && data.candidates && data.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    // Only join the real answer parts; skip Gemini "thinking" parts that break JSON parsing.
    let text = Array.isArray(parts)
      ? parts.filter(function (p) { return p && p.thought !== true; }).map(function (p) { return (p && p.text) || ''; }).join('').trim()
      : '';
    if (!text && Array.isArray(parts)) {
      text = parts.map(function (p) { return (p && p.text) || ''; }).join('').trim();
    }
    const out = parseSpeciesJson(text);
    if (!out || typeof out !== 'object') {
      const fr = (cand && cand.finishReason) || '';
      const snip = (text || '').slice(0, 100);
      return res.status(502).json({ error: 'Jawaban AI tidak terbaca' + (fr ? (' [' + fr + ']') : '') + (snip ? (': ' + snip) : ''), code: 'PARSE' });
    }
    const clip = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; };
    const result = {
      name: clip(out.name, 80),
      scientific: clip(out.scientific, 120),
      category: clip(out.category, 40),
      confidence: clip(out.confidence, 20),
      description: clip(out.description, 600),
      danger: clip(out.danger, 300),
      tips: clip(out.tips, 300),
      alternates: Array.isArray(out.alternates) ? out.alternates.slice(0, 3).map(function (a) { return clip(a, 80); }).filter(Boolean) : [],
      source: 'Gemini Vision \u00b7 perkiraan'
    };
    if (!result.name) result.name = 'Belum bisa dipastikan';
    return res.status(200).json(result);
  } catch (e) {
    const msg = (e && e.name === 'TimeoutError') ? 'AI terlalu lama merespons' : 'AI cloud gagal dihubungi';
    return res.status(502).json({ error: msg, code: 'NET' });
  }
}

// Robust parser for Gemini's answer: tolerant to markdown fences, thinking
// preambles, smart quotes, trailing commas, and raw newlines inside strings.
function tryJson(s) {
  try { const o = JSON.parse(s); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
}

function looseSpeciesFields(text) {
  const get = function (key) {
    const m = text.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim() : '';
  };
  const name = get('name');
  const scientific = get('scientific');
  if (!name && !scientific) return null;
  return {
    name: name,
    scientific: scientific,
    category: get('category'),
    confidence: get('confidence'),
    description: get('description'),
    danger: get('danger'),
    tips: get('tips'),
    alternates: []
  };
}

function parseSpeciesJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  // Strategy 1: parse the whole text as-is.
  const direct = tryJson(t);
  if (direct) return direct;
  // Strategy 2: slice from the first { to the last } and try progressive cleanups.
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const s = t.slice(first, last + 1);
    const quotesFixed = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
    const commasFixed = quotesFixed.replace(/,\s*([}\]])/g, '$1');
    const newlinesFixed = commasFixed.replace(/[\r\n\t]+/g, ' ');
    const variants = [s, quotesFixed, commasFixed, newlinesFixed];
    for (let i = 0; i < variants.length; i++) {
      const v = tryJson(variants[i]);
      if (v) return v;
    }
  }
  // Strategy 3: loose per-field extraction so a valid-but-slightly-broken answer still shows.
  return looseSpeciesFields(t);
}
