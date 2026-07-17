import { bodyWithin, cleanText, rateLimit, secureApi, verifySupabaseUser } from '../lib/security.js';

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
  if (!key) return res.status(503).json({ error: 'AI cloud belum dikonfigurasi', code: 'NO_KEY' });

  const body = req.body || {};
  const raw = typeof body.image === 'string' ? body.image : '';
  const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'Format foto tidak valid' });
  const mime = m[1];
  const b64 = m[2];
  if (b64.length > 2_100_000) return res.status(413).json({ error: 'Foto terlalu besar' });

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const system = 'Anda ahli biologi lapangan untuk kawasan Gunung Bawakaraeng, Sulawesi Selatan. Dari foto, identifikasi kemungkinan flora atau fauna. Jawab dalam Bahasa Indonesia. Jika foto bukan makhluk hidup atau tidak jelas, katakan jujur dan beri confidence Rendah. Jangan mengarang. Utamakan spesies yang realistis untuk ekosistem pegunungan tropis Sulawesi. Selalu ingatkan bahwa hasil adalah perkiraan dan perlu verifikasi ahli sebelum menyentuh atau mengonsumsi.';
  const prompt = 'Identifikasi objek utama pada foto ini. Kembalikan HANYA JSON dengan field: name (nama umum Indonesia), scientific (nama ilmiah bila mungkin, jika tidak ""), category (salah satu: "Flora","Fauna","Jamur","Serangga","Tidak yakin"), confidence (salah satu: "Tinggi","Sedang","Rendah"), description (2-3 kalimat ringkas), danger (peringatan bahaya/berbisa/dilindungi bila ada, jika tidak ada ""), tips (saran pengamatan aman singkat), alternates (array maksimal 2 kemungkinan lain berupa string, boleh []).';

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' }
      }),
      signal: AbortSignal.timeout(20_000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: 'AI tidak tersedia' });
    const parts = data?.candidates?.[0]?.content?.parts;
    let txt = Array.isArray(parts) ? parts.map(p => p.text || '').join('').trim() : '';
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch {
      const mm = txt.match(/\{[\s\S]*\}/);
      if (mm) { try { parsed = JSON.parse(mm[0]); } catch {} }
    }
    if (!parsed || typeof parsed !== 'object') return res.status(502).json({ error: 'Hasil AI tidak terbaca' });
    const out = {
      name: cleanText(parsed.name, 80) || 'Tidak yakin',
      scientific: cleanText(parsed.scientific, 80),
      category: cleanText(parsed.category, 20) || 'Tidak yakin',
      confidence: cleanText(parsed.confidence, 10) || 'Rendah',
      description: cleanText(parsed.description, 400),
      danger: cleanText(parsed.danger, 200),
      tips: cleanText(parsed.tips, 200),
      alternates: Array.isArray(parsed.alternates) ? parsed.alternates.slice(0, 2).map(x => cleanText(x, 60)).filter(Boolean) : [],
      source: 'Gemini Vision · akun terverifikasi'
    };
    return res.status(200).json(out);
  } catch {
    return res.status(502).json({ error: 'AI gagal dihubungi' });
  }
}
