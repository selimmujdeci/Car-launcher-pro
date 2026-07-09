/** cdp-longtask.mjs — 15sn longtask + metrik deltası (geçici) */
const probe = `(() => new Promise(res => {
  const tasks = [];
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) tasks.push(Math.round(e.duration)); });
  po.observe({ entryTypes: ['longtask'] });
  setTimeout(() => {
    po.disconnect(); tasks.sort((a,b)=>b-a);
    res(JSON.stringify({ uzunGorev: tasks.length, toplamMs: tasks.reduce((a,b)=>a+b,0), enUzun5: tasks.slice(0,5) }));
  }, 15000);
}))()`;
const targets = await (await fetch('http://localhost:9223/json')).json();
const page = targets.find(t => t.type === 'page') ?? targets[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
let m0 = null;
ws.onopen = () => { send(1, 'Performance.enable'); send(2, 'Performance.getMetrics'); };
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 2) { m0 = Object.fromEntries(msg.result.metrics.map(m => [m.name, m.value])); send(3, 'Runtime.evaluate', { expression: probe, awaitPromise: true, returnByValue: true }); }
  if (msg.id === 3) { globalThis._o = msg.result?.result?.value; send(4, 'Performance.getMetrics'); }
  if (msg.id === 4) {
    const m1 = Object.fromEntries(msg.result.metrics.map(m => [m.name, m.value]));
    const d = (k) => Math.round(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000) / 1000;
    console.log(globalThis._o);
    console.log(JSON.stringify({ scriptSn: d('ScriptDuration'), taskSn: d('TaskDuration'), layoutCount: d('LayoutCount') }));
    ws.close(); process.exit(0);
  }
};
setTimeout(() => { console.error('ZAMAN ASIMI'); process.exit(1); }, 40000);
