// Proxy BMKG: gempa terkini + prakiraan cuaca (data pemerintah, BMKG)
// Serverless function di Vercel (folder /api otomatis terdeteksi). Node 18+ punya fetch global.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate");

  const out = { debug: { tried: [] } };

  // 1) GEMPA TERKINI - endpoint terbuka BMKG, tanpa API key
  try {
    const rg = await fetch("https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json");
    out.debug.gempaStatus = rg.status;
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

  // 2) PRAKIRAAN CUACA - coba beberapa kode wilayah (adm4) sampai ada data.
  //    Area Gunung Bawakaraeng: Kec. Tinggimoncong, Kab. Gowa (73.06.04.*).
  const candidates = [];
  const q = req.query && req.query.adm4;
  if (q) candidates.push(q);
  if (process.env.BMKG_ADM4) candidates.push(process.env.BMKG_ADM4);
  candidates.push("73.06.04.1001"); // Malino (kota)
  candidates.push("73.06.04.1010"); // Pattapang (dekat jalur pendakian)
  candidates.push("73.06.04.2003"); // Buluttana

  for (const code of candidates) {
    const info = { adm4: code };
    try {
      const rc = await fetch(
        "https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=" + encodeURIComponent(code)
      );
      info.status = rc.status;
      if (rc.ok) {
        const jc = await rc.json();
        const d0 = jc && jc.data && jc.data[0];
        const lok = (jc && jc.lokasi) || (d0 && d0.lokasi) || {};
        info.dataLen = jc && jc.data ? jc.data.length : 0;
        let first = null;
        try { first = d0.cuaca[0][0]; } catch (e) {}
        if (!first) { try { first = d0.cuaca[0]; } catch (e) {} }
        if (first && (first.t != null || first.weather_desc)) {
          out.cuaca = {
            desc: first.weather_desc,
            image: first.image,
            temp: first.t,
            humidity: first.hu,
            wind: first.ws,
            area: lok.desa || lok.kecamatan || lok.kotkab || "Kawasan Bawakaraeng",
            waktu: first.local_datetime,
            adm4: code,
          };
          info.ok = true;
          out.debug.tried.push(info);
          break;
        }
      }
    } catch (e) {
      info.error = String(e);
    }
    out.debug.tried.push(info);
  }

  res.status(200).json(out);
}
