import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB_PATH = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const screencap = name => { try { const buf = execFileSync(ADB_PATH, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(name, buf); return name; } catch (e) { return 'screencap FAIL: ' + e.message; } };

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('CDP: page target yok'); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails || r.result?.result?.subtype === 'error') return { __err: JSON.stringify(r.result) };
  return r.result?.result?.value ?? r.result;
};
const file = f => ev(readFileSync(f, 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const stage = s => ev(`(()=>{__NAV_AFTER__.stage=${JSON.stringify(s)};return __NAV_AFTER__.stage})()`);
const snap = () => file('snapshot.js');
const shot = async name => screencap(name);
const setTheme = t => ev(`__navSetTheme(${JSON.stringify(t)})`);
const log = [];
const rec = (label, data) => { log.push({ label, at: new Date().toISOString(), data }); console.log('· ' + label + ' → ' + JSON.stringify(data).slice(0, 260)); };

try {
  rec('attach', await file('attach.js'));
  rec('install-trace', await file('install-trace.js'));

  for (const theme of ['day', 'night']) {
    const M = theme === 'day' ? 'A' : 'C';
    await setTheme(theme); await wait(2500);
    for (let round = 1; round <= 3; round++) {
      await stage(`${M}${round}-mini-${theme}`); await wait(1200);
      rec(`${M}${round} MINI ${theme}`, await snap());
      if (round === 1) await shot(`mini-${theme}-after.png`);

      await stage(`${M}${round}-mini-to-full-${theme}`);
      rec(`${M}${round} open FULL`, await file('open-full.js'));
      await wait(5000);
      rec(`${M}${round} FULL ${theme}`, await snap());
      if (round === 1) await shot(`full-${theme}-after.png`);

      await stage(`${M}${round}-full-to-mini-${theme}`);
      rec(`${M}${round} close FULL`, await file('close-full.js'));
      await wait(4000);
      rec(`${M}${round} MINI ${theme} (dönüş)`, await snap());
    }
  }

  // MATRIX B — DAY → NIGHT → DAY (MINI yüzeyinde, ürün ayar yolu)
  await setTheme('day'); await wait(2500);
  for (let round = 1; round <= 3; round++) {
    await stage(`B${round}-day`); await wait(1500);
    rec(`B${round} DAY`, await snap());
    await stage(`B${round}-day-to-night`); await setTheme('night'); await wait(3000);
    rec(`B${round} NIGHT`, await snap());
    await stage(`B${round}-night-to-day`); await setTheme('day'); await wait(3000);
    rec(`B${round} DAY (dönüş)`, await snap());
  }

  writeFileSync('matrix-after.json', JSON.stringify(log, null, 1));
  const trace = await file('export-trace.js');
  writeFileSync('trace-after-style.json', JSON.stringify(trace, null, 1));
  console.log('\nolay sayısı: ' + (trace.events?.length ?? '?') + ' · dropped: ' + trace.dropped);
} finally { ws.close(); }
