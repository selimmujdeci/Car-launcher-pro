/**
 * cdpsched.mjs — setTimeout / MessageChannel / microtask scheduler trafiğini ölçer.
 * Timer'lar elendikten sonra kalan tek aday: React scheduler'ı besleyen kanal.
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 30);

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
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
  if (window.__schedProbe) return;
  window.__schedProbe = true;
  const S = { timeouts: new Map(), portPosts: 0, portMs: 0, rafCount: 0 };

  const oST = window.setTimeout;
  window.setTimeout = function (fn, delay, ...rest) {
    const d = delay | 0;
    let src = ''; let stack = '';
    try { src = String(fn).replace(/\\s+/g, ' ').slice(0, 100); } catch {}
    try { stack = (new Error().stack || '').split('\\n').slice(2, 4).join(' | ').replace(/https?:\\/\\/[^/]+/g, ''); } catch {}
    const k = d + '#' + src + '#' + stack;
    if (!S.timeouts.has(k)) S.timeouts.set(k, { d, src, stack, n: 0, ms: 0 });
    const rec = S.timeouts.get(k);
    const wrapped = function (...a) {
      const t0 = performance.now();
      try { return typeof fn === 'function' ? fn.apply(this, a) : undefined; }
      finally { rec.n++; rec.ms += performance.now() - t0; }
    };
    return oST.call(window, wrapped, delay, ...rest);
  };

  if (typeof MessagePort !== 'undefined' && MessagePort.prototype.postMessage) {
    const oPost = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (...a) { S.portPosts++; return oPost.apply(this, a); };
  }

  const oRaf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (fn) {
    S.rafCount++;
    return oRaf.call(window, fn);
  };

  window.__schedStats = function () {
    const rows = [...S.timeouts.values()].sort((a, b) => b.ms - a.ms).slice(0, 14);
    return JSON.stringify({ portPosts: S.portPosts, rafCount: S.rafCount, rows });
  };
})();
`;

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    console.error('scheduler probe kuruldu, yenileniyor...');
    await send('Page.reload', {});
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const r = await send('Runtime.evaluate', { expression: 'window.__schedStats ? __schedStats() : "YOK"', returnByValue: true });
    if (r.result.value === 'YOK') { console.log('probe kurulmadı'); process.exit(0); }
    const { portPosts, rafCount, rows } = JSON.parse(r.result.value);
    console.log(`\n=== ${durSec} sn — SCHEDULER KANALLARI ===`);
    console.log(`MessagePort.postMessage : ${portPosts}  (${(portPosts / durSec).toFixed(1)}/sn)`);
    console.log(`requestAnimationFrame   : ${rafCount}  (${(rafCount / durSec).toFixed(1)}/sn)`);
    console.log(`\n=== EN ÇOK CPU YAKAN setTimeout ===`);
    console.log('   ms   çağrı   /sn   delay  kaynak');
    for (const x of rows) {
      console.log(`${String(Math.round(x.ms)).padStart(5)}  ${String(x.n).padStart(6)}  ${(x.n / durSec).toFixed(1).padStart(5)}  ${String(x.d).padStart(5)}  ${x.src.slice(0, 88)}`);
      if (x.stack) console.log(`${' '.repeat(30)}↳ ${x.stack.slice(0, 145)}`);
    }
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
