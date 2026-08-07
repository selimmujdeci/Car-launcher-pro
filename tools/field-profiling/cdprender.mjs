/**
 * cdprender.mjs — React commit/DOM mutasyon oranını ölçer ve
 * boşa render'ı KANITLAR: render var mı, DOM değişiyor mu?
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 20);

const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
ws.addEventListener('error', (e) => { console.error('WS:', e.message ?? e); process.exit(1); });

const PROBE = `
(() => {
  if (window.__rndProbe) return; window.__rndProbe = true;
  const S = { mut: 0, mutRecs: 0, longTasks: 0, longMs: 0, hookRenders: 0 };
  try {
    const mo = new MutationObserver((recs) => { S.mut++; S.mutRecs += recs.length; });
    const start = () => { if (document.body) mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); else setTimeout(start, 50); };
    start();
  } catch {}
  try {
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { S.longTasks++; S.longMs += e.duration; } });
    po.observe({ entryTypes: ['longtask'] });
  } catch {}
  // React DevTools hook: commit sayısı
  try {
    const H = { renderers: new Map(), supportsFiber: true, inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
      onCommitFiberRoot() { S.hookRenders++; }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {} };
    if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: H, configurable: true });
  } catch {}
  window.__rndStats = () => JSON.stringify(S);
})();
`;

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await send('Page.reload', {});
    console.error(`${durSec} sn ölçülüyor...`);
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const r = await send('Runtime.evaluate', { expression: 'window.__rndStats ? __rndStats() : "YOK"', returnByValue: true });
    if (r.result.value === 'YOK') { console.log('probe yok'); process.exit(0); }
    const s = JSON.parse(r.result.value);
    console.log(`\n=== ${durSec} sn — RENDER / DOM ===`);
    console.log(`React commit (devtools hook) : ${s.hookRenders}   (${(s.hookRenders / durSec).toFixed(1)}/sn)`);
    console.log(`DOM mutasyon partisi         : ${s.mut}   (${(s.mut / durSec).toFixed(1)}/sn)`);
    console.log(`DOM mutasyon kaydı           : ${s.mutRecs}`);
    console.log(`Long task (>50ms)            : ${s.longTasks}  toplam ${Math.round(s.longMs)} ms  (${((s.longMs / (durSec * 1000)) * 100).toFixed(1)}% wall)`);
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
