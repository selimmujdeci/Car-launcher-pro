/**
 * cdptimers.mjs — Boot'tan ÖNCE setInterval/setTimeout/rAF'ı sarmalar,
 * sonra sayfayı yeniler ve N saniye boyunca ateşleme sayısı + toplam süreyi ölçer.
 * Amaç: "hangi timer CPU yakıyor" sorusunu TAHMİNSİZ yanıtlamak.
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 30);

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

const PROBE = `
(() => {
  if (window.__probeInstalled) return;
  window.__probeInstalled = true;
  const stats = new Map();   // key -> {kind, delay, src, fires, ms, registered}
  const live  = new Map();   // handle -> key
  let seq = 0;

  function keyFor(kind, delay, fn) {
    let src = '';
    try { src = String(fn).replace(/\\s+/g, ' ').slice(0, 110); } catch { src = '?'; }
    let stack = '';
    try { stack = (new Error().stack || '').split('\\n').slice(2, 5).join(' | ').replace(/https?:\\/\\/[^/]+/g, ''); } catch {}
    return kind + '#' + delay + '#' + src + '#' + stack;
  }

  const oSetInterval = window.setInterval;
  const oClearInterval = window.clearInterval;
  const oRaf = window.requestAnimationFrame;

  window.setInterval = function (fn, delay, ...rest) {
    const k = keyFor('interval', delay, fn);
    if (!stats.has(k)) stats.set(k, { kind: 'interval', delay, key: k, fires: 0, ms: 0, registered: 0 });
    stats.get(k).registered++;
    const wrapped = function (...a) {
      const t0 = performance.now();
      try { return fn.apply(this, a); }
      finally { const s = stats.get(k); s.fires++; s.ms += performance.now() - t0; }
    };
    const h = oSetInterval.call(window, wrapped, delay, ...rest);
    live.set(h, k);
    return h;
  };
  window.clearInterval = function (h) { live.delete(h); return oClearInterval.call(window, h); };

  let rafDepth = 0;
  window.requestAnimationFrame = function (fn) {
    return oRaf.call(window, function (ts) {
      const k = 'raf#0#' + (String(fn).replace(/\\s+/g, ' ').slice(0, 110)) + '#';
      if (!stats.has(k)) stats.set(k, { kind: 'raf', delay: 0, key: k, fires: 0, ms: 0, registered: 0 });
      const t0 = performance.now();
      try { return fn(ts); }
      finally { const s = stats.get(k); s.fires++; s.ms += performance.now() - t0; }
    });
  };

  window.__timerStats = function () {
    const out = [...stats.values()]
      .filter((s) => s.fires > 0)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 25)
      .map((s) => ({ kind: s.kind, delay: s.delay, fires: s.fires, ms: Math.round(s.ms), live: [...live.values()].filter((k) => k === s.key).length, key: s.key }));
    return JSON.stringify(out);
  };
  window.__liveIntervals = function () { return live.size; };
})();
`;

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    console.error('probe kuruldu, sayfa yenileniyor...');
    await send('Page.reload', { ignoreCache: false });
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const res = await send('Runtime.evaluate', { expression: 'window.__timerStats ? __timerStats() : "PROBE YOK"', returnByValue: true });
    const live = await send('Runtime.evaluate', { expression: 'window.__liveIntervals ? __liveIntervals() : -1', returnByValue: true });
    const raw = res.result.value;
    console.log('\n=== CANLI setInterval SAYISI:', live.result.value, '===');
    if (raw === 'PROBE YOK') { console.log(raw); process.exit(0); }
    const rows = JSON.parse(raw);
    console.log(`\n=== ${durSec} sn'de EN ÇOK CPU YAKAN TIMER/rAF ===`);
    console.log('  ms   ateşleme  Hz     tip      delay  kaynak');
    for (const r of rows) {
      const hz = (r.fires / durSec).toFixed(1);
      const [, , src, stack] = r.key.split('#');
      console.log(`${String(r.ms).padStart(5)}  ${String(r.fires).padStart(7)}  ${hz.padStart(5)}  ${r.kind.padEnd(8)} ${String(r.delay).padStart(6)}  ${src.slice(0, 90)}`);
      if (stack) console.log(`${' '.repeat(38)}↳ ${stack.slice(0, 150)}`);
    }
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
