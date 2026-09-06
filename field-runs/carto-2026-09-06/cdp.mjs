import { writeFileSync, readFileSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
try {
  const mode = process.argv[2];
  if (mode === 'shot') {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.argv[3], Buffer.from(r.result.data, 'base64'));
    console.log('saved ' + process.argv[3]);
  } else if (mode === 'eval') {
    const r = await send('Runtime.evaluate', { expression: process.argv[3], awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
  } else {
    const expression = readFileSync(mode, 'utf8');
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const out = r.result?.result?.value ?? r.result;
    if (process.argv[3]) { writeFileSync(process.argv[3], JSON.stringify(out, null, 1)); console.log('saved ' + process.argv[3] + ' (' + JSON.stringify(out).length + ' bytes)'); }
    else console.log(JSON.stringify(out, null, 1));
  }
} finally { ws.close(); }
