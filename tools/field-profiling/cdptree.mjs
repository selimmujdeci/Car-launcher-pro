/**
 * cdptree.mjs — CDP CPU profili al, ağır düğümlerin ATA ZİNCİRİNİ çıkar.
 * Amaç: React render'ını KİMİN tetiklediğini isimlendirmek.
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 12);

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method, params }));
});

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
});
ws.addEventListener('error', (e) => { console.error('WS:', e.message ?? e); process.exit(1); });

ws.addEventListener('open', async () => {
  await send('Profiler.enable');
  await send('Profiler.setSamplingInterval', { interval: 200 });
  await send('Profiler.start');
  console.error(`profil ${durSec} sn...`);
  await new Promise((r) => setTimeout(r, durSec * 1000));
  const { profile } = await send('Profiler.stop');
  analyse(profile);
  ws.close(); process.exit(0);
});

function analyse(profile) {
  const byId = new Map();
  const parent = new Map();
  for (const n of profile.nodes) {
    byId.set(n.id, n);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }

  // self time
  const self = new Map();
  let total = 0;
  const { samples = [], timeDeltas = [] } = profile;
  for (let i = 0; i < samples.length; i++) {
    const dt = timeDeltas[i] ?? 0;
    if (dt <= 0) continue;
    total += dt;
    self.set(samples[i], (self.get(samples[i]) ?? 0) + dt);
  }

  // total (inclusive) time: self'i yukarı doğru yay
  const incl = new Map();
  for (const [nid, us] of self) {
    let cur = nid;
    const seen = new Set();
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      incl.set(cur, (incl.get(cur) ?? 0) + us);
      cur = parent.get(cur);
    }
  }

  const fname = (n) => {
    const cf = n?.callFrame ?? {};
    const f = cf.functionName || '(anon)';
    const u = (cf.url || '').replace(/^https?:\/\/[^/]+/, '').split('/').pop() || '';
    return `${f} @${u}:${cf.lineNumber}`;
  };

  // 1) En ağır ATA çağrıları: inclusive'i yüksek ama root'a yakın düğümler
  console.log(`\n=== INCLUSIVE (çağrı zinciri toplamı) — toplam ${(total/1000).toFixed(0)} ms ===`);
  const rows = [...incl.entries()]
    .map(([nid, us]) => ({ nid, us, n: byId.get(nid) }))
    .filter((r) => r.n && (r.n.callFrame?.functionName || '').length > 0)
    .sort((a, b) => b.us - a.us);

  const seenName = new Set();
  let printed = 0;
  for (const r of rows) {
    const label = fname(r.n);
    if (seenName.has(label)) continue;
    seenName.add(label);
    const pct = (r.us / total) * 100;
    if (pct < 1) break;
    console.log(`${pct.toFixed(1).padStart(5)}%  ${(r.us/1000).toFixed(0).padStart(6)} ms  ${label}`);
    if (++printed > 28) break;
  }

  // 2) React render'ının ATA ZİNCİRİ — createElement/jsx düğümlerinin kökleri
  console.log('\n=== REACT RENDER TETİKLEYİCİLERİ (jsx/createElement ata zinciri) ===');
  const trig = new Map();
  for (const [nid, us] of self) {
    const n = byId.get(nid);
    const f = n?.callFrame?.functionName ?? '';
    if (!/createElement|jsx/i.test(f)) continue;
    // uygulama kodundan gelen ilk atayı bul
    let cur = parent.get(nid);
    const chain = [];
    let guard = 0;
    while (cur !== undefined && guard++ < 60) {
      const pn = byId.get(cur);
      const u = pn?.callFrame?.url ?? '';
      const pf = pn?.callFrame?.functionName ?? '';
      if (pf && !/vendor-react/.test(u)) chain.push(fname(pn));
      cur = parent.get(cur);
    }
    const key = chain.slice(0, 3).reverse().join('  ←  ') || '(kök bulunamadı)';
    trig.set(key, (trig.get(key) ?? 0) + us);
  }
  const tr = [...trig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [k, us] of tr) {
    console.log(`${((us/total)*100).toFixed(1).padStart(5)}%  ${(us/1000).toFixed(0).padStart(5)} ms  ${k}`);
  }
}
