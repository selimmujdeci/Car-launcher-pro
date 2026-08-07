/**
 * cdpprof.mjs — CDP üzerinden CPU sampling profili al ve self-time'a göre sırala.
 * Bağımlılık YOK (Node 22+ yerleşik WebSocket).
 *
 * Kullanım: node cdpprof.mjs <ws-url> <süreSaniye>
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 12);

if (!wsUrl) { console.error('ws url gerekli'); process.exit(1); }

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

ws.addEventListener('message', (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }
});

ws.addEventListener('error', (e) => { console.error('WS hata:', e.message ?? e); process.exit(1); });

ws.addEventListener('open', async () => {
  try {
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 200 }); // 200 µs
    await send('Profiler.start');
    console.error(`profil ${durSec} sn toplanıyor...`);
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const { profile } = await send('Profiler.stop');
    report(profile);
    ws.close();
    process.exit(0);
  } catch (e) {
    console.error('hata:', e.message);
    process.exit(1);
  }
});

function report(profile) {
  const byId = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);

  // self-time: her örneğin düştüğü düğüme timeDelta yaz
  const self = new Map();
  const { samples = [], timeDeltas = [] } = profile;
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const dt = timeDeltas[i] ?? 0;
    if (dt <= 0) continue;
    total += dt;
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt);
  }

  const rows = [];
  for (const [nodeId, us] of self) {
    const n = byId.get(nodeId);
    if (!n) continue;
    const cf = n.callFrame ?? {};
    const name = cf.functionName || '(anonymous)';
    const url = (cf.url || '').replace(/^https?:\/\/[^/]+/, '');
    rows.push({ name, url, line: cf.lineNumber, us });
  }
  rows.sort((a, b) => b.us - a.us);

  const totalMs = total / 1000;
  console.log(`\n=== CPU SAMPLING PROFİLİ — toplam ${totalMs.toFixed(0)} ms örneklendi ===`);
  console.log('pay%    ms      fonksiyon                              kaynak');
  for (const r of rows.slice(0, 30)) {
    const pct = (r.us / total) * 100;
    if (pct < 0.4) break;
    console.log(
      `${pct.toFixed(1).padStart(5)}  ${(r.us / 1000).toFixed(0).padStart(6)}  ` +
      `${r.name.slice(0, 38).padEnd(38)}  ${r.url.slice(-52)}:${r.line}`,
    );
  }

  // Dosya bazlı toplam
  const byFile = new Map();
  for (const r of rows) byFile.set(r.url, (byFile.get(r.url) ?? 0) + r.us);
  const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\n=== DOSYA BAZLI TOPLAM ===');
  for (const [f, us] of files) {
    const pct = (us / total) * 100;
    if (pct < 0.5) break;
    console.log(`${pct.toFixed(1).padStart(5)}%  ${(us / 1000).toFixed(0).padStart(6)} ms  ${f || '(program/gc)'}`);
  }
}
