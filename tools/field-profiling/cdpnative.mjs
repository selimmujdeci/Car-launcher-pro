const wsUrl = process.argv[2];
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

const EXPR = `(() => {
  const isNative = (f) => { try { return /\\[native code\\]/.test(Function.prototype.toString.call(f)); } catch { return null; } };
  const out = {};
  out.Promise            = isNative(Promise);
  out['Promise.then']    = isNative(Promise.prototype.then);
  out.Symbol             = isNative(Symbol);
  out.Map                = isNative(Map);
  out.Set                = isNative(Set);
  out['Array.forEach']   = isNative(Array.prototype.forEach);
  out['Array.map']       = isNative(Array.prototype.map);
  out['Array.includes']  = isNative(Array.prototype.includes);
  out['Object.assign']   = isNative(Object.assign);
  out['String.replace']  = isNative(String.prototype.replace);
  out.queueMicrotask     = isNative(window.queueMicrotask);
  out.WeakMap            = isNative(WeakMap);
  out['Object.entries']  = isNative(Object.entries);
  out['Array.from']      = isNative(Array.from);
  out.chrome             = navigator.userAgent.match(/Chrome\\/(\\d+)/)?.[1] ?? '?';
  // mikro-benchmark: 200k Promise.resolve().then zinciri yerine 50k allocation
  const t0 = performance.now();
  let x = 0; for (let i = 0; i < 200000; i++) { x += [i].map((v) => v + 1)[0]; }
  out._benchArrayMapMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const ps = []; for (let i = 0; i < 20000; i++) ps.push(Promise.resolve(i));
  out._benchPromiseMs = Math.round(performance.now() - t1);
  return JSON.stringify(out);
})()`;

ws.addEventListener('open', async () => {
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: false });
  const o = JSON.parse(r.result.value);
  console.log('\n=== YERLEŞİK (native) Mİ, POLYFILL Mİ? ===');
  console.log('Chrome sürümü:', o.chrome);
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('_') || k === 'chrome') continue;
    console.log(`  ${k.padEnd(18)} ${v === true ? 'YERLEŞİK ✓' : v === false ? '*** POLYFILL (JS) ***' : 'bilinmiyor'}`);
  }
  console.log('\n=== MİKRO-BENCHMARK ===');
  console.log(`  200k Array.map   : ${o._benchArrayMapMs} ms`);
  console.log(`  20k Promise.res. : ${o._benchPromiseMs} ms`);
  ws.close(); process.exit(0);
});
