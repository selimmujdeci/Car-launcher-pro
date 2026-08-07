const wsUrl = process.argv[2];
const expr = process.argv[3];
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
ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable');
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 20000 });
    if (r.exceptionDetails) { console.error('JS hata:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 400)); process.exit(1); }
    const v = r.result.value;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
