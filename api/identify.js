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
  const openaiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  const openaiKey2 = process.env.AI2_API_KEY;
  if (!key && !openaiKey && !openaiKey2) return res.status(503).json({ error: 'AI belum dikonfigurasi', code: 'NO_KEY' });

  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Format foto tidak didukung (pakai JPG/PNG/WebP)' });
  const mime = m[1];
  const b64 = m[2];
  if (b64.length > 2_100_000) return res.status(413).json({ error: 'Foto terlalu besar' });

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const modelFallback = process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.0-flash';
  const system = 'Anda adalah ahli biologi lapangan untuk kawasan Gunung Bawakaraeng, Sulawesi Selatan. Tugas Anda mengidentifikasi kemungkinan spesies flora, fauna, atau jenis batuan dari foto yang diberikan pendaki. Fitur ini HANYA untuk flora, fauna, dan batuan. Jika foto jelas bukan salah satu dari itu (misalnya wajah manusia, layar/monitor, tulisan, kendaraan, atau makanan olahan), set name ke string kosong, category ke "Lainnya", confidence ke "Rendah", dan pada description jelaskan singkat bahwa Lensa hanya mengenali flora, fauna, dan batuan. Jawab HANYA dalam format JSON valid tanpa teks lain. Bahasa Indonesia yang ringkas dan tenang. Jika tidak yakin, beri tingkat keyakinan rendah dan beberapa kemungkinan pada alternates. Jangan mengarang. Selalu ingatkan bahwa hasil hanyalah perkiraan yang perlu verifikasi ahli/petugas, terutama sebelum menyentuh, memberi makan, atau mengonsumsi.';
  const prompt = 'Identifikasi kemungkinan spesies pada foto ini. Balas HANYA JSON dengan kunci berikut: name (nama umum Bahasa Indonesia), scientific (nama ilmiah bila ada), category (salah satu: Flora, Fauna, Batuan, Lainnya), confidence (Tinggi, Sedang, atau Rendah), description (2-3 kalimat ciri utama & habitat di Bawakaraeng), danger (peringatan bila beracun/berbisa/dilindungi/berbahaya, string kosong bila tidak ada), tips (saran pengamatan aman singkat), alternates (array maksimal 3 nama alternatif bila ragu). Jangan tambahkan teks di luar JSON.';

  try {
    const genBody = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    });
    // Coba model utama, lalu model cadangan bila Gemini sibuk/overload (502/503/429/high demand).
    const preferOpenAI = (!!openaiKey || !!openaiKey2) && String(process.env.AI_PROVIDER || '').toLowerCase() === 'openai';
    const models = (!key || preferOpenAI) ? [] : ((modelFallback && modelFallback !== model) ? [model, modelFallback] : [model, model]);
    const sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
    const isRetryable = function (status, msg) { return status === 429 || status === 500 || status === 502 || status === 503 || /overload|high demand|unavailable|temporar|try again/i.test(msg || ''); };
    let data = null, okResp = false, firstErr = '';
    for (let i = 0; i < models.length; i++) {
      if (i > 0) await sleep(700);
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(models[i]) + ':generateContent';
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: genBody,
          signal: AbortSignal.timeout(9_000)
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) { data = d; okResp = true; break; }
        const gmsg = String((d && d.error && d.error.message) || '').slice(0, 200);
        if (!firstErr) firstErr = gmsg;
        if (!isRetryable(r.status, gmsg)) {
          return res.status(502).json({ error: gmsg ? ('Gemini menolak: ' + gmsg) : 'AI tidak tersedia', code: 'UPSTREAM' });
        }
      } catch (e2) {
        if (!firstErr) firstErr = (e2 && e2.name === 'TimeoutError') ? 'AI terlalu lama merespons' : 'AI cloud gagal dihubungi';
      }
    }
    let out = null, usedProvider = '', geminiErr = '';
    if (okResp) {
      const cand = data && data.candidates && data.candidates[0];
      const parts = cand && cand.content && cand.content.parts;
      // Only join the real answer parts; skip Gemini "thinking" parts that break JSON parsing.
      let text = Array.isArray(parts)
        ? parts.filter(function (p) { return p && p.thought !== true; }).map(function (p) { return (p && p.text) || ''; }).join('').trim()
        : '';
      if (!text && Array.isArray(parts)) {
        text = parts.map(function (p) { return (p && p.text) || ''; }).join('').trim();
      }
      const g = parseSpeciesJson(text);
      if (g && typeof g === 'object') { out = g; usedProvider = 'Gemini Vision'; }
    }
    if (!out && key && !preferOpenAI) geminiErr = firstErr || (okResp ? 'jawaban tak terbaca' : 'gagal');
    // Lapis cadangan OpenAI-compatible (Groq, OpenRouter, dll) + diagnostik per-lapis.
    const compatDiag = [];
    const runCompat = async function (cfg, label) {
      if (out && typeof out === 'object') return;
      const rc = await askCompatible(cfg, system, prompt, mime, b64);
      if (rc && rc.out) { out = rc.out; usedProvider = rc.provider; }
      else { compatDiag.push(label + ': ' + ((rc && rc.error) || 'gagal')); if (!firstErr && rc && rc.error) firstErr = rc.error; }
    };
    if (openaiKey) await runCompat({ key: openaiKey, base: process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL, model: process.env.OPENAI_MODEL || process.env.AI_MODEL }, 'Lapis2');
    else compatDiag.push('Lapis2: belum diisi (AI_API_KEY)');
    if (openaiKey2) await runCompat({ key: openaiKey2, base: process.env.AI2_BASE_URL, model: process.env.AI2_MODEL }, 'Lapis3');
    else compatDiag.push('Lapis3: belum diisi (AI2_API_KEY)');
    // Bila OpenAI diprioritaskan tapi gagal, jatuhkan ke Gemini sebagai cadangan.
    if ((!out || typeof out !== 'object') && preferOpenAI && key) {
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: genBody, signal: AbortSignal.timeout(9_000) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          const cand = d && d.candidates && d.candidates[0];
          const parts = cand && cand.content && cand.content.parts;
          let text = Array.isArray(parts) ? parts.filter(function (p) { return p && p.thought !== true; }).map(function (p) { return (p && p.text) || ''; }).join('').trim() : '';
          if (!text && Array.isArray(parts)) text = parts.map(function (p) { return (p && p.text) || ''; }).join('').trim();
          const g2 = parseSpeciesJson(text);
          if (g2 && typeof g2 === 'object') { out = g2; usedProvider = 'Gemini Vision'; }
        } else {
          geminiErr = String((d && d.error && d.error.message) || 'gagal').slice(0, 200);
          if (!firstErr) firstErr = geminiErr;
        }
      } catch (eg) {
        geminiErr = (eg && eg.name === 'TimeoutError') ? 'Gemini terlalu lama merespons' : 'Gemini gagal dihubungi';
        if (!firstErr) firstErr = geminiErr;
      }
    }
    if (!out || typeof out !== 'object') {
      const diag = [];
      if (!key) diag.push('Gemini: belum diisi (GEMINI_API_KEY)');
      else if (geminiErr) diag.push('Gemini: ' + geminiErr);
      for (let di = 0; di < compatDiag.length; di++) diag.push(compatDiag[di]);
      const detail = diag.length ? diag.join(' \u2022 ') : (firstErr || 'Semua layanan AI sedang sibuk');
      return res.status(503).json({ error: detail.slice(0, 340), code: 'BUSY' });
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
      source: (usedProvider || 'Gemini Vision') + ' \u00b7 perkiraan'
    };
    if (!result.name) result.name = 'Belum bisa dipastikan';
    return res.status(200).json(result);
  } catch (e) {
    const msg = (e && e.name === 'TimeoutError') ? 'AI terlalu lama merespons' : 'AI cloud gagal dihubungi';
    return res.status(502).json({ error: msg, code: 'NET' });
  }
}

// Penyedia OpenAI-compatible (Groq / OpenRouter / OpenAI / dll) sebagai lapis cadangan.
async function askCompatible(cfg, system, prompt, mime, b64) {
  const key = cfg && cfg.key;
  if (!key) return { error: '' };
  const aiBase = (cfg.base || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const isOfficialOpenAI = /api\.openai\.com/i.test(aiBase);
  const model = cfg.model ||
    (/groq\.com/i.test(aiBase) ? 'meta-llama/llama-4-scout-17b-16e-instruct'
      : /openrouter/i.test(aiBase) ? 'meta-llama/llama-3.2-11b-vision-instruct:free'
        : 'gpt-4o-mini');
  const payload = {
    model: model,
    temperature: 0.2,
    max_tokens: 800,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [ { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } } ] }
    ]
  };
  if (isOfficialOpenAI) payload.response_format = { type: 'json_object' };
  const body = JSON.stringify(payload);
  const sleep = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  const isRetryable = function (status, msg) { return status === 429 || status === 500 || status === 502 || status === 503 || /overload|high demand|unavailable|temporar|try again/i.test(msg || ''); };
  let rsp = null, d = {}, firstErr = '';
  try {
    for (let i = 0; i < 2; i++) {
      rsp = await fetch(aiBase + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'HTTP-Referer': 'https://bawakaraeng-hub.vercel.app', 'X-Title': 'Bawakaraeng Hub' },
        body: body,
        signal: AbortSignal.timeout(15_000)
      });
      d = await rsp.json().catch(() => ({}));
      if (rsp.ok) break;
      const emsg = String((d && d.error && d.error.message) || '');
      if (!firstErr) firstErr = emsg.slice(0, 200);
      if (!isRetryable(rsp.status, emsg) || i === 1) break;
      const wm = emsg.match(/try again in ([\d.]+)\s*s/i);
      const ws = wm ? Math.min(3000, Math.ceil(parseFloat(wm[1]) * 1000) + 200) : 1200;
      await sleep(ws);
    }
  } catch (e) {
    return { error: (e && e.name === 'TimeoutError') ? 'AI terlalu lama merespons' : 'AI gagal dihubungi' };
  }
  if (rsp && rsp.ok) {
    const text = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    const parsed = parseSpeciesJson((text || '').trim());
    if (parsed && typeof parsed === 'object') {
      return { out: parsed, provider: isOfficialOpenAI ? 'OpenAI Vision' : ('AI Vision \u00b7 ' + model) };
    }
    return { error: 'Jawaban AI tidak terbaca' };
  }
  return { error: firstErr || 'AI tidak tersedia' };
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
