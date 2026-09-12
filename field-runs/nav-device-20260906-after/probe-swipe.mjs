import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const t0 = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(t0.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
const size = await ev('({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})');
console.log('viewport:', JSON.stringify(size));
const cases = [
  ['dikey  orta',      ['700','900','700','1900','600']],
  ['yatay  orta',      ['400','1350','1000','1350','600']],
  ['yatay  üst-orta',  ['400','800','1000','800','600']],
  ['yatay  yavaş',     ['400','1350','1000','1350','1200']],
  ['çapraz orta',      ['500','1000','1000','1800','700']],
];
const out = [];
for (const [name, sw] of cases) {
  await ev('(()=>{__NAV_AFTER__.__p=__NAV_AFTER__.events.length;return 1})()');
  adb('shell', 'input', 'swipe', ...sw);
  await wait(900);
  const evs = await ev(`(()=>__NAV_AFTER__.events.slice(__NAV_AFTER__.__p).filter(e=>/start$|end$/.test(e.op)).map(e=>e.op+':'+e.origin))()`);
  const el = await ev(`(()=>{const e=document.elementFromPoint(${Math.round(+sw[0]/ (size.dpr||1))}, ${Math.round(+sw[1]/(size.dpr||1))}); return e? (e.tagName+'.'+String(e.className).slice(0,60)) : null})()`);
  const f = await ev('(()=>__navFollow())()');
  console.log(name.padEnd(18), '| olay:', (evs||[]).join(',') || '(yok)', '| mod:', f && f.cameraMode, '| başlangıç elemanı:', el);
  out.push({ name, swipe: sw, events: evs, mode: f && f.cameraMode, element: el });
  await wait(600);
}
writeFileSync('probe-swipe.json', JSON.stringify({ viewport: size, cases: out }, null, 1));
ws.close();
