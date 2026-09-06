import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });
const screencap = n => { try { writeFileSync(n, execFileSync(ADB, ['exec-out','screencap','-p'], { maxBuffer: 64*1024*1024 })); return n; } catch (e) { return 'FAIL ' + e.message; } };

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const file = f => ev(readFileSync(f, 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const stage = s => ev(`(()=>{__NAV_AFTER__.stage=${JSON.stringify(s)};return 1})()`);
const mark = () => ev(`(()=>{__NAV_AFTER__.__m=__NAV_AFTER__.events.length;return __NAV_AFTER__.__m})()`);
const since = () => ev(`(()=>__NAV_AFTER__.events.slice(__NAV_AFTER__.__m).filter(e=>/start$|end$|easeTo|flyTo/.test(e.op)).map(e=>({op:e.op,origin:e.origin,src:e.originalEventType,mode:e.follow&&e.follow.cameraMode,z:e.args&&e.args.zoom,d:e.args&&e.args.duration})))()`);
const log = []; const rec = (l, d) => { log.push({ label: l, at: new Date().toISOString(), data: d }); console.log('· ' + l + ' → ' + JSON.stringify(d)); };

try {
  rec('başlangıç', await file('follow.js'));
  // HUD kontrollerinin sönmesini bekle (auto-hide 3.5 sn)
  await wait(5000);
  rec('HUD söndükten sonra', await file('follow.js'));

  for (const [i, sw] of [['1', ['700','900','700','1900','600']], ['2', ['500','1500','1300','1500','600']]].entries ? [['1', ['700','900','700','1900','600']], ['2', ['500','1500','1300','1500','600']]] : []) {
    await stage('userpan-' + i); await mark();
    adb('shell', 'input', 'swipe', ...sw);
    await wait(350);
    rec(`pan ${i} — hareket sırasında/hemen sonra`, await file('follow.js'));
    await wait(900);
    rec(`pan ${i} — olaylar`, await since());
    rec(`pan ${i} — 1.3 sn sonra`, await file('follow.js'));
    screencap(`full-user-pan-${i}-after.png`);
    // ORTALA ile kanonik dönüş
    await stage('userpan-recenter-' + i); await mark();
    rec(`pan ${i} — ORTALA`, await file('recenter.js'));
    await wait(2500);
    rec(`pan ${i} — ortala sonrası`, await file('follow.js'));
  }
  writeFileSync('userpan-after.json', JSON.stringify(log, null, 1));
  const t = await file('export-trace.js');
  writeFileSync('trace-after-userpan.json', JSON.stringify(t, null, 1));
} finally { ws.close(); }
