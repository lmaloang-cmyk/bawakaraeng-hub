import { bodyWithin, cleanText, rateLimit, secureApi, verifySupabaseUser } from '../lib/security.js';

const MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash'
].filter(Boolean);

const SYSTEM = 'Kamu ahli biologi lapangan Gunung Bawakaraeng, Sulawesi Selatan. Identifikasi kemungkinan spesies flora, fauna, atau batuan dari foto. HANYA flora, fauna, batuan. Jika foto bukan itu, name="", category="Lainnya", confidence="Rendah", description="Lensa hanya mengenali flora, fauna, dan batuan.". Balas HANYA JSON valid tanpa teks lain. Jika ragu, beri confidence rendah dan alternates maksimal 3. Ingatkan hasil hanya perkiraan, perlu verifikasi ahli/petugas.';
const PROMPT = 'Identifikasi kemungkinan spesies pada foto. Balas HANYA JSON: name (umum Indonesia), scientific (ilmiah bila ada), category (Flora/Fauna/Batuan/Lainnya), confidence (Tinggi/Sedang/Rendah), description (2-3 kalimat), danger (peringatan, kosong bila tidak), tips (saran aman), alternates (array max 3). Jangan tambahkan teks di luar JSON.';

async function callGemini(key, model, body, timeoutMs) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function identifyWithFallback(key, modelBody, timeoutMs) {
  let lastErr = null;
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      const r = await callGemini(key, model, modelBody, timeoutMs);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        lastErr = data?.error?.message || `HTTP ${r.status}`;
        continue;
      }
      const parts = data?.candidates?.[0]?.content?.parts;
      let text = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
      text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      let out = null;
      try { out = JSON.parse(text); } catch {
        const mm = text.match(/\{[\s\S]*\}/);
        if (mm) { try { out = JSON.parse(mm[0]); } catch {} }
      }
      if (!out || typeof out !== 'object') {
        lastErr = 'Jawaban tidak terbaca';
        continue;
      }
      return { ok: true, out, model };
    } catch (e) {
      lastErr = e?.name === 'TimeoutError' ? 'Timeout' : (e.message || 'Network error');
    }
  }
  return { ok: false, error: lastErr || 'AI tidak tersedia' };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!secureApi(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { prefix: 'idf-ip', limit: 20, windowMs: 10 * 60_000 })) return;
  if (!bodyWithin(req, 1_600_000)) return res.status(413).json({ error: 'Foto terlalu besar', code: 'PARSE' });

  const user = await verifySupabaseUser(req);
  if (!user) return res.status(401).json({ error: 'Login diperlukan', code: 'LOGIN' });
  if (!rateLimit(req, res, { prefix: 'idf-user', id: user.id, limit: 15, windowMs: 10 * 60_000 })) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI belum dikonfigurasi', code: 'NO_KEY' });

  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  const m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Format foto tidak didukung (pakai JPG/PNG/WebP)', code: 'PARSE' });
  const mime = m[1];
  const b64 = m[2];
  if (b64.length > 2_100_000) return res.status(413).json({ error: 'Foto terlalu besar', code: 'PARSE' });

  const modelBody = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
  };

  const result = await identifyWithFallback(key, modelBody, 12_000);
  if (!result.ok) {
    return res.status(502).json({ error: result.error, code: 'UPSTREAM', modelsTried: MODELS.length });
  }

  const clip = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const out = result.out;
  const answer = {
    name: clip(out.name, 80) || 'Belum bisa dipastikan',
    scientific: clip(out.scientific, 120),
    category: clip(out.category, 40),
    confidence: clip(out.confidence, 20),
    description: clip(out.description, 600),
    danger: clip(out.danger, 300),
    tips: clip(out.tips, 300),
    alternates: Array.isArray(out.alternates) ? out.alternates.slice(0, 3).map(a => clip(a, 80)).filter(Boolean) : [],
    source: 'Gemini Vision · ' + result.model
  };
  return res.status(200).json(answer);
}
