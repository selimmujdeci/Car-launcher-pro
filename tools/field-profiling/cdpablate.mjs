/**
 * cdpablate.mjs — ELEME DENEYİ: bir timer/rAF adayını runtime'da susturup
 * React commit oranı + long task yükünün düşüp düşmediğini AYNI sayfa yüklemesinde ölçer.
 *
 * Kullanım: node cdpablate.mjs <ws-url> "<kill-regex>" [settleSec] [windowSec]
 *   kill-regex : callback KAYNAK METNİNDE aranır (ör. "updateVehicleState")
 *                "-" verilirse hiçbir şey susturulmaz (saf taban ölçümü)
 *
 * ⚠️ Yalnız ÖLÇÜM içindir — kalıcı bir değişiklik yapmaz, sayfa yenilenince biter.
 */
const wsUrl = process.argv[2];
const killPat = process.argv[3] ?? '-';
const settleSec = Number(process.argv[4] ?? 20);
const winSec = Number(process.argv[5] ?? 20);

const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
ws.addEventListener('error', (e) => { console.error('WS:', e.message ?? e); process.exit(1); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 30000 });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 250));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `
(() => {
  if (window.__abl) return; window.__abl = true;
  const S = { commits: 0, fibers: 0, longN: 0, longMs: 0, t0: performance.now() };
  const timers = new Map();   // handle -> {src, delay}
  const rafSrc = new Map();   // src -> count
  let killRe = null;
  let killedTimers = 0, killedRaf = 0;

  const oSI = window.setInterval, oCI = window.clearInterval, oRaf = window.requestAnimationFrame;
  window.setInterval = function (fn, d, ...a) {
    let src = ''; try { src = String(fn).replace(/\\s+/g, ' ').slice(0, 160); } catch {}
    const h = oSI.call(window, fn, d, ...a);
    timers.set(h, { src, delay: d | 0 });
    return h;
  };
  window.clearInterval = function (h) { timers.delete(h); return oCI.call(window, h); };
  window.requestAnimationFrame = function (fn) {
    let src = ''; try { src = String(fn).replace(/\\s+/g, ' ').slice(0, 160); } catch {}
    rafSrc.set(src, (rafSrc.get(src) ?? 0) + 1);
    if (killRe && killRe.test(src)) { killedRaf++; return 0; }   // callback'i DÜŞÜR
    return oRaf.call(window, fn);
  };

  try {
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { S.longN++; S.longMs += e.duration; } });
    po.observe({ entryTypes: ['longtask'] });
  } catch {}

  const H = { renderers: new Map(), supportsFiber: true,
    inject(r) { const i = this.renderers.size + 1; this.renderers.set(i, r); return i; },
    onCommitFiberRoot(_r, root) {
      S.commits++;
      try { let c = 0; const w = (f, d) => { if (!f || d > 60 || c > 4000) return; c++; w(f.child, d + 1); w(f.sibling, d); }; w(root.current, 0); if (c > S.fibers) S.fibers = c; } catch {}
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {} };
  try { Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: H, configurable: true }); } catch {}

  window.__ablReset = () => { S.commits = 0; S.fibers = 0; S.longN = 0; S.longMs = 0; S.t0 = performance.now(); return 1; };
  window.__ablStats = () => JSON.stringify({ ...S, wall: Math.round(performance.now() - S.t0), killedTimers, killedRaf, liveTimers: timers.size });
  window.__ablKill = (pat) => {
    killRe = new RegExp(pat);
    let n = 0;
    for (const [h, m] of [...timers.entries()]) { if (killRe.test(m.src)) { oCI.call(window, h); timers.delete(h); n++; } }
    killedTimers += n;
    return JSON.stringify({ clearedIntervals: n });
  };
  window.__ablList = () => JSON.stringify({
    intervals: [...timers.values()].sort((a, b) => a.delay - b.delay).slice(0, 30),
    rafs: [...rafSrc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([s, n]) => ({ n, src: s })),
  });
})();
`;

const fmt = (o, label) => {
  const s = JSON.parse(o);
  const sec = s.wall / 1000;
  return `${label.padEnd(22)} commit ${String(s.commits).padStart(3)} (${(s.commits / sec).toFixed(2)}/sn) · ` +
    `max fiber ${String(s.fibers).padStart(4)} · longtask ${String(s.longN).padStart(3)} = ` +
    `${String(Math.round(s.longMs)).padStart(5)} ms (${((s.longMs / s.wall) * 100).toFixed(0)}% wall) · ` +
    `canlı timer ${s.liveTimers}`;
};

ws.addEventListener('open', async () => {
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    await send('Page.reload', {});
    console.error(`boot + ${settleSec} sn oturma bekleniyor...`);
    await sleep(settleSec * 1000);

    await ev('__ablReset()');
    await sleep(winSec * 1000);
    const before = await ev('__ablStats()');
    console.log(fmt(before, 'TABAN'));

    if (killPat !== '-') {
      const k = await ev(`__ablKill(${JSON.stringify(killPat)})`);
      console.log(`\nSUSTURULDU: /${killPat}/  →  ${k}`);
      await ev('__ablReset()');
      await sleep(winSec * 1000);
      const after = await ev('__ablStats()');
      console.log(fmt(after, 'SUSTURDUKTAN SONRA'));

      const b = JSON.parse(before), a = JSON.parse(after);
      const rate = (x) => x.commits / (x.wall / 1000);
      const load = (x) => (x.longMs / x.wall) * 100;
      console.log(`\nDEĞİŞİM: commit/sn ${rate(b).toFixed(2)} → ${rate(a).toFixed(2)}` +
        `  ·  long task yükü %${load(b).toFixed(0)} → %${load(a).toFixed(0)}`);
    } else {
      console.log('\n--- CANLI TIMER / rAF ENVANTERİ ---');
      const l = JSON.parse(await ev('__ablList()'));
      for (const t of l.intervals) console.log(`  ${String(t.delay).padStart(6)} ms  ${t.src.slice(0, 100)}`);
      console.log('  --- rAF ---');
      for (const r of l.rafs) console.log(`  ${String(r.n).padStart(6)}x    ${r.src.slice(0, 100)}`);
    }
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
