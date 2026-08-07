/**
 * cdpcommit.mjs — Her React commit'inde yığın izi + süre yakalar.
 * "Hangi kod render tetikliyor" sorusunu TAHMİNSİZ yanıtlar.
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
  if (window.__cmProbe) return; window.__cmProbe = true;
  const commits = [];
  const tasks = [];
  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) tasks.push({ ms: Math.round(e.duration), t: Math.round(e.startTime) });
    });
    po.observe({ entryTypes: ['longtask'] });
  } catch {}
  const H = {
    renderers: new Map(), supportsFiber: true,
    inject(r) { const i = this.renderers.size + 1; this.renderers.set(i, r); return i; },
    onCommitFiberRoot(rid, root) {
      let stack = '';
      try { stack = (new Error().stack || '').split('\\n').slice(1, 9).map(s => s.trim()).join(' | ').replace(/https?:\\/\\/[^/]+/g, ''); } catch {}
      let count = 0;
      try {
        // fiber ağacındaki güncellenmiş düğüm sayısını kabaca say
        const walk = (f, d) => { if (!f || d > 60 || count > 4000) return; count++; walk(f.child, d + 1); walk(f.sibling, d); };
        walk(root.current, 0);
      } catch {}
      commits.push({ t: Math.round(performance.now()), fibers: count, stack });
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
  };
  try { Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: H, configurable: true }); } catch {}
  window.__cmStats = () => JSON.stringify({ commits: commits.slice(-40), tasks: tasks.slice(-40) });
})();
`;

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await send('Page.reload', {});
    console.error(`${durSec} sn...`);
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const r = await send('Runtime.evaluate', { expression: 'window.__cmStats ? __cmStats() : "YOK"', returnByValue: true });
    if (r.result.value === 'YOK') { console.log('probe yok'); process.exit(0); }
    const { commits, tasks } = JSON.parse(r.result.value);
    console.log(`\n=== SON ${commits.length} REACT COMMIT ===`);
    const byStack = new Map();
    for (const c of commits) {
      const k = c.stack || '(yığın yok)';
      if (!byStack.has(k)) byStack.set(k, { n: 0, fibers: 0 });
      const o = byStack.get(k); o.n++; o.fibers = Math.max(o.fibers, c.fibers);
    }
    for (const [k, o] of [...byStack.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) {
      console.log(`\n  ${o.n} commit · ağaç ~${o.fibers} fiber`);
      console.log(`  ${k.slice(0, 500)}`);
    }
    console.log(`\n=== SON ${tasks.length} LONG TASK ===`);
    const big = tasks.sort((a, b) => b.ms - a.ms).slice(0, 12);
    console.log('  ' + big.map((t) => `${t.ms}ms`).join(', '));
    const sum = tasks.reduce((a, t) => a + t.ms, 0);
    console.log(`  toplam ${sum} ms / ${durSec * 1000} ms wall = ${((sum / (durSec * 1000)) * 100).toFixed(0)}%`);
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
