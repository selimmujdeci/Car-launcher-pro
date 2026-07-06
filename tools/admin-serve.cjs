// dist/ statik sunucu + SPA rewrite (admin paneli tüneli için).
// /admin/*  -> dist/admin.html   ·   diğer bilinmeyen yollar -> dist/index.html
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const PORT = parseInt(process.argv[2] || '8090', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.map': 'application/json', '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  // Gerçek dosya var mı?
  const asFile = path.join(DIST, urlPath);
  if (asFile.startsWith(DIST) && fs.existsSync(asFile) && fs.statSync(asFile).isFile()) {
    return sendFile(res, asFile);
  }
  // SPA fallback: admin yolları admin.html, diğerleri index.html
  const fallback = urlPath.startsWith('/admin')
    ? path.join(DIST, 'admin.html')
    : path.join(DIST, 'index.html');
  if (fs.existsSync(fallback)) return sendFile(res, fallback);
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`admin-serve hazır: http://127.0.0.1:${PORT}/admin/tani  (dist/)`);
});
