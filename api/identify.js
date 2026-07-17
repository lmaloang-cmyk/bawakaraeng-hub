import { bodyWithin, rateLimit, secureApi, verifySupabaseUser } from '../lib/security.js';

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

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const system = 'Anda adalah ahli biologi lapangan untuk kawasan Gunung Bawakaraeng, Sulawesi Selatan. Tugas Anda mengidentifikasi kemungkinan spesies flora atau fauna dari foto yang diberikan pendaki. Jawab HANYA dalam format JSON valid tanpa teks lain. Bahasa Indonesia yang ringkas dan tenang. Jika tidak yakin, katakan tingkat keyakinan rendah dan berikan beberapa kemungkinan pada alternates. Jangan mengarang. Jika foto bukan makhluk hidup atau tidak jelas, set name ke string kosong dan jelaskan pada description. Selalu ingatkan bahwa hasil hanyalah perkiraan yang perlu verifikasi ahli/petugas, terutama sebelum menyentuh, memberi makan, atau mengonsumsi.';
  const prompt = 'Identifikasi kemungkinan spesies pada foto ini. Balas HANYA JSON dengan kunci berikut: name (nama umum Bahasa Indonesia), scientific (nama ilmiah bila ada), category (salah satu: Flora, Fauna, Jejak, Lainnya), confidence (Tinggi, Sedang, atau Rendah), description (2-3 kalimat ciri utama & habitat di Bawakaraeng), danger (peringatan bila beracun/berbisa/dilindungi/berbahaya, string kosong bila tidak ada), tips (saran pengamatan aman singkat), alternates (array maksimal 3 nama alternatif bila ragu). Jangan tambahkan teks di luar JSON.';

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
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    let text = Array.isArray(parts) ? parts.map(function (p) { return p.text || ''; }).join('\n').trim() : '';
    let out = null;
    try { out = JSON.parse(text); } catch (e1) {
      const mm = text.match(/\{[\s\S]*\}/);
      if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} }
    }
    if (!out || typeof out !== 'object') {
      const fr = (data && data.candidates && data.candidates[0] && data.candidates[0].finishReason) || '';
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
