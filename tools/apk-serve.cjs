// Basit tek-dosya APK sunucu — cloudflared quick tunnel ile birlikte kullanılır.
// Doğru content-type ile APK indirme sağlar.
//
// ── #534 · RANGE / RESUME DESTEĞİ (saha 2026-08-11) ────────────────────────
// SORUN: "indirme bir süre sonra kesiliyor" — ve kesilince BAŞTAN başlıyordu.
// KÖK: sunucu `Range` başlığını YOK SAYIYOR, her istekte `200` + tüm dosyayı
// gönderiyordu. Yavaş bir tünelde 77 MB'lık indirme kopunca tarayıcı devam
// edemiyor, sıfırdan indiriyordu → pratikte hiç bitmiyor.
// ÇÖZÜM: `Accept-Ranges: bytes` ilan et, `Range` gelirse `206 Partial Content`
// + `Content-Range` ile YALNIZ istenen aralığı gönder. Tarayıcı/indirme yöneticisi
// kaldığı yerden devam eder.
const http = require('http');
const fs = require('fs');
const path = require('path');

const APK = process.argv[2];
const PORT = parseInt(process.argv[3] || '8787', 10);

if (!APK || !fs.existsSync(APK)) {
  console.error('APK bulunamadı:', APK);
  process.exit(1);
}

const fname = path.basename(APK);
const size = fs.statSync(APK).size;

/** `bytes=START-END` ayrıştırır. Geçersiz/desteklenmeyen biçimde `null` döner. */
function parseRange(header) {
  if (!header || typeof header !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;                       // çoklu aralık desteklenmez → tam gövde
  const hasStart = m[1] !== '';
  const hasEnd = m[2] !== '';
  if (!hasStart && !hasEnd) return null;
  let start;
  let end;
  if (hasStart) {
    start = parseInt(m[1], 10);
    end = hasEnd ? parseInt(m[2], 10) : size - 1;
  } else {
    // "bytes=-N" → son N bayt
    const suffix = parseInt(m[2], 10);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return { unsatisfiable: true };
  return { start, end: Math.min(end, size - 1) };
}

const server = http.createServer((req, res) => {
  const isApkPath = req.url === '/' || req.url === '/' + fname || req.url.startsWith('/download');
  if (!isApkPath) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const common = {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${fname}"`,
    // Resume'un ön koşulu: istemci bunu görmeden Range denemez.
    'Accept-Ranges': 'bytes',
  };

  // HEAD: gövde göndermeden boyut/yetenek bildir (indirme yöneticileri bunu sorar).
  if (req.method === 'HEAD') {
    res.writeHead(200, { ...common, 'Content-Length': size });
    res.end();
    return;
  }

  const range = parseRange(req.headers.range);

  if (range && range.unsatisfiable) {
    res.writeHead(416, { ...common, 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }

  if (range) {
    const chunk = range.end - range.start + 1;
    res.writeHead(206, {
      ...common,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': chunk,
    });
    const s = fs.createReadStream(APK, { start: range.start, end: range.end });
    s.on('error', () => res.destroy());
    s.pipe(res);
    console.log(`  ↳ 206 ${range.start}-${range.end} (${(chunk / 1048576).toFixed(1)} MB)`);
    return;
  }

  res.writeHead(200, { ...common, 'Content-Length': size });
  const s = fs.createReadStream(APK);
  s.on('error', () => res.destroy());
  s.pipe(res);
  console.log('  ↳ 200 tam gövde');
});

server.listen(PORT, () => {
  console.log(`APK sunucu hazır: http://localhost:${PORT}/  (${fname}, ${(size / 1048576).toFixed(1)} MB)`);
  console.log('Range/resume: AÇIK — kopan indirme kaldığı yerden devam eder.');
});
