// Basit tek-dosya APK sunucu — cloudflared quick tunnel ile birlikte kullanılır.
// Doğru content-type ile APK indirme sağlar.
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

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/' + fname || req.url.startsWith('/download')) {
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Content-Length': size,
    });
    fs.createReadStream(APK).pipe(res);
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`APK sunucu hazır: http://localhost:${PORT}/  (${fname}, ${(size/1048576).toFixed(1)} MB)`);
});
