// Proxy BMKG: gempa terkini + prakiraan cuaca (data pemerintah, BMKG)
// Dijalankan sebagai serverless function di Vercel (folder /api otomatis terdeteksi).
// Node 18+ sudah punya fetch global.

export default async function handler(req, res) {
  // Izinkan diakses dari aplikasi (CORS)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate");

  const out = {};

  // 1) GEMPA TERKINI - endpoint terbuka BMKG, tanpa API key
  try {
    const rg = await fetch(
      "https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json"
    );
    if (rg.ok) {
      const jg = await rg.json();
      const g = jg && jg.Infogempa && jg.Infogempa.gempa;
      if (g) {
        out.gempa = {
          mag: g.Magnitude,
          wilayah: g.Wilayah,
          waktu: (g.Tanggal || "") + " " + (g.Jam || ""),
          kedalaman: g.Kedalaman,
          koordinat: g.Coordinates,
        };
      }
    }
  } catch (e) {
    out.gempaError = String(e);
  }

  // 2) PRAKIRAAN CUACA - API publik BMKG berbasis kode wilayah (adm4 / Kemendagri)
  //    Ganti default di bawah dengan kode desa/kelurahan terdekat Gunung Bawakaraeng
  //    (wilayah Kab. Gowa, Kec. Tinggimoncong / Tombolo Pao). Bisa juga lewat ?adm4=...
  const adm4 =
    (req.query && req.query.adm4) || process.env.BMKG_ADM4 || "73.06.09.2001";
  try {
    const rc = await fetch(
      "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=" +
        encodeURIComponent(adm4)
    );
    if (rc.ok) {
      const jc = await rc.json();
      const lok = (jc && jc.lokasi) || {};
      // Struktur: data[0].cuaca = array-of-array (per periode). Ambil entri pertama.
      let first = null;
      try {
        first = jc.data[0].cuaca[0][0];
      } catch (e) {}
      if (first) {
        out.cuaca = {
          desc: first.weather_desc,
          temp: first.t,
          humidity: first.hu,
          wind: first.ws,
          area: lok.desa || lok.kecamatan || lok.kotkab || "Kawasan Bawakaraeng",
          waktu: first.local_datetime,
        };
      }
    }
  } catch (e) {
    out.cuacaError = String(e);
  }

  res.status(200).json(out);
}
