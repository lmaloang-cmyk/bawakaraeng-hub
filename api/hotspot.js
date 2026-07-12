// Proxy TITIK PANAS / HOTSPOT KEBAKARAN di sekitar Gunung Bawakaraeng.
//
// Sumber default: NASA FIRMS (VIIRS) - gratis, terdokumentasi, dipakai juga
// oleh SIPONGI-KLHK. Butuh MAP_KEY gratis dari https://firms.modaps.eosdis.nasa.gov/api/
// Set sebagai environment variable FIRMS_MAP_KEY di Vercel.
//
// CATATAN: Untuk sumber resmi Indonesia, endpoint SIPONGI/KLHK bisa
// menggantikan blok fetch di bawah (formatnya GeoJSON/JSON) setelah akses diperoleh.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate");

  const key = process.env.FIRMS_MAP_KEY;

  // bbox = west,south,east,north (kotak sekitar Gunung Bawakaraeng)
  const bbox = (req.query && req.query.bbox) || "119.80,-5.45,120.10,-5.15";
  const days = (req.query && req.query.days) || "3";

  if (!key) {
    res.status(200).json({
      hotspots: [],
      note: "FIRMS_MAP_KEY belum di-set. Daftar gratis di firms.modaps.eosdis.nasa.gov lalu simpan sebagai environment variable.",
    });
    return;
  }

  try {
    const url =
      "https://firms.modaps.eosdis.nasa.gov/api/area/csv/" +
      key +
      "/VIIRS_SNPP_NRT/" +
      bbox +
      "/" +
      days;
    const r = await fetch(url);
    const txt = await r.text();
    const lines = txt.trim().split("\n");
    if (lines.length < 2) {
      res.status(200).json({ hotspots: [] });
      return;
    }
    const header = lines.shift().split(",");
    const iLat = header.indexOf("latitude");
    const iLng = header.indexOf("longitude");
    const iDate = header.indexOf("acq_date");
    const iConf = header.indexOf("confidence");
    const hotspots = lines
      .filter(Boolean)
      .map(function (l) {
        const c = l.split(",");
        return {
          lat: parseFloat(c[iLat]),
          lng: parseFloat(c[iLng]),
          date: c[iDate],
          conf: c[iConf],
        };
      })
      .filter(function (h) {
        return !isNaN(h.lat) && !isNaN(h.lng);
      });
    res.status(200).json({ hotspots });
  } catch (e) {
    res.status(500).json({ error: String(e), hotspots: [] });
  }
}
