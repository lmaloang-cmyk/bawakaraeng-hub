// AI Pendamping Bawakaraeng — Gemini dengan fallback lokal di browser.
// Simpan GEMINI_API_KEY sebagai Environment Variable di Vercel. Jangan taruh key di index.html.
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'AI cloud belum dikonfigurasi', code: 'LOCAL_FALLBACK' });

  const body = req.body || {};
  const message = String(body.message || '').trim().slice(0, 600);
  if (!message) return res.status(400).json({ error: 'Pertanyaan kosong' });
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const system = `Anda adalah AI Pendamping Bawakaraeng untuk aplikasi Reichas Chelebes. Jawab dalam Bahasa Indonesia yang ringkas, tenang, dan praktis. Fokus: keselamatan pendakian, jalur, perlengkapan, SIMAKSI, pelaporan, konservasi, flora-fauna, dan penjelasan data cuaca. Jangan mengarang status jalur, cuaca, izin, nomor telepon, atau kondisi darurat. Jika data tidak tersedia, katakan perlu verifikasi dari BMKG, petugas, atau pos registrasi. Dalam keadaan darurat arahkan pengguna ke tombol SOS aplikasi, berbagi GPS, tetap di tempat aman, dan menghubungi petugas/pos terdekat. Jangan menyatakan AI sebagai pengganti petugas atau sumber resmi.`;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: 'Konteks aplikasi saat ini: ' + JSON.stringify(context).slice(0, 1200) + '\n\nPertanyaan pengguna: ' + message }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 420, topP: 0.85 }
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Gemini tidak tersedia', detail: data && data.error && data.error.message });
    const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const answer = Array.isArray(parts) ? parts.map(p => p.text || '').join('\n').trim() : '';
    if (!answer) return res.status(502).json({ error: 'Jawaban AI kosong' });
    return res.status(200).json({ answer, source: 'Gemini · data aplikasi' });
  } catch (e) {
    return res.status(502).json({ error: 'AI cloud gagal dihubungi' });
  }
}
