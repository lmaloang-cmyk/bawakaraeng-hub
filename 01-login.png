import { cleanText, rateLimit, secureApi } from '../lib/security.js';

const LIMIT = 8;

function imageUrl(photo) {
  const url = String(photo?.medium_url || photo?.url || '');
  return /^https:\/\//i.test(url) ? url : '';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  if (!secureApi(req, res, ['GET'])) return;
  if (!rateLimit(req, res, { prefix: 'species-search', limit: 30, windowMs: 10 * 60_000 })) return;

  const query = cleanText(req.query?.q, 80);
  if (query.length < 2) return res.status(400).json({ error: 'Gunakan minimal 2 karakter.', results: [] });

  try {
    const upstream = 'https://api.inaturalist.org/v1/taxa?q=' + encodeURIComponent(query) + '&per_page=' + LIMIT;
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return res.status(502).json({ error: 'Sumber spesies sedang tidak tersedia.', results: [] });

    const data = await response.json();
    const seen = new Set();
    const results = (Array.isArray(data?.results) ? data.results : [])
      .filter(item => item && item.name && !seen.has(item.id) && (seen.add(item.id), true))
      .slice(0, LIMIT)
      .map(item => ({
        id: Number(item.id) || 0,
        name: cleanText(item.preferred_common_name || item.english_common_name || item.name, 100),
        scientific: cleanText(item.name, 120),
        rank: cleanText(item.rank, 30),
        category: cleanText(item.iconic_taxon_name || 'Organisme', 40),
        photo: imageUrl(item.default_photo),
        source: 'iNaturalist'
      }));

    return res.status(200).json({ results });
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? 'Pencarian terlalu lama. Coba lagi.' : 'Pencarian spesies tidak tersedia.';
    return res.status(502).json({ error: message, results: [] });
  }
}
