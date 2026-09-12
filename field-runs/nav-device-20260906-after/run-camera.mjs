import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB_PATH = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const screencap = name => { try { const buf = execFileSync(ADB_PATH, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(name, buf); return name; } catch (e) { return 'screencap FAIL: ' + e.message; } };
const ADB = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' });

const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
const file = f => ev(readFileSync(f, 'utf8'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const stage = s => ev(`(()=>{__NAV_AFTER__.stage=${JSON.stringify(s)};return __NAV_AFTER__.stage})()`);
const shot = async n => screencap(n);
const log = []; const rec = (l, d) => { log.push({ label: l, at: new Date().toISOString(), data: d }); console.log('· ' + l + ' → ' + JSON.stringify(d).slice(0, 300)); };

try {
  rec('attach', await file('attach.js'));
  rec('install-trace', await file('install-trace.js'));
  await ev(`__navSetTheme('day')`); await wait(2000);

  // FULL ekrana geç
  await stage('cam-open-full');
  rec('open FULL', await file('open-full.js'));
  await wait(5000);
  rec('FULL hazır', await file('follow.js'));

  // ── 1) Sürüş girişi: TEK kamera komutu mu? ──
  await stage('cam-driving-entry');
  rec('sürüş modu AÇ', await file('driving-on.js'));
  await wait(3500);
  rec('giriş sonrası', await file('follow.js'));
  await shot('full-driving-after.png');
  rec('giriş kamera komutları', await ev(`(()=>{const e=__NAV_AFTER__.events.slice(__NAV_AFTER__.__camMark);
    const cam=e.filter(x=>/easeTo|jumpTo|flyTo|fitBounds/.test(x.op));
    return {toplam:cam.length, komutlar:cam.map(c=>({op:c.op,t:Math.round(c.t),zoom:c.args&&c.args.zoom,pitch:c.args&&c.args.pitch,bearing:c.args&&c.args.bearing?+Number(c.args.bearing).toFixed(2):undefined,duration:c.args&&c.args.duration,followBefore:c.followBefore&&c.followBefore.cameraMode,followAfter:c.followAfter&&c.followAfter.cameraMode})),
      duplicate:(()=>{const seen=new Map();let d=0;for(const c of cam){const k=[c.op,c.args&&c.args.zoom,c.args&&c.args.pitch,c.args&&c.args.duration].join('|');const p=seen.get(k);if(p!==undefined&&c.t-p<400)d++;seen.set(k,c.t);}return d;})(),
      panningOlaylari:e.filter(x=>/start$|end$/.test(x.op)).map(x=>({op:x.op,origin:x.origin,mode:x.follow&&x.follow.cameraMode}))};})()`));

  // ── 2) Programatik animasyon FOLLOWING'i bozdu mu? ──
  rec('programatik → USER_PANNING sayısı', await ev(`(()=>{const e=__NAV_AFTER__.events;
    const prog=e.filter(x=>/start$/.test(x.op)&&x.origin==='PROGRAMMATIC');
    return {programatikOlay:prog.length, kullaniciSayilan:prog.filter(x=>x.follow&&x.follow.cameraMode==='USER_PANNING').length,
      ornekler:prog.slice(0,8).map(x=>({op:x.op,mode:x.follow&&x.follow.cameraMode}))};})()`));

  // ── 3) GERÇEK parmak pan ──
  await ev(`(()=>{__NAV_AFTER__.__panMark=__NAV_AFTER__.events.length;return 1})()`);
  await stage('cam-real-finger-pan');
  adb('shell', 'input', 'swipe', '610', '1600', '610', '1050', '450');
  await wait(400);
  const mid = await file('follow.js'); rec('parmak pan (hemen sonra)', mid);
  await wait(1200);
  rec('parmak pan (1.6 sn sonra)', await file('follow.js'));
  rec('pan olayları', await ev(`(()=>{const e=__NAV_AFTER__.events.slice(__NAV_AFTER__.__panMark);
    return e.filter(x=>/start$|end$/.test(x.op)).map(x=>({op:x.op,origin:x.origin,src:x.originalEventType,mode:x.follow&&x.follow.cameraMode}));})()`));
  await shot('full-user-pan-after.png');

  // ── 4) Ortala → FOLLOWING'e dönüş ──
  await stage('cam-recenter');
  rec('ORTALA', await file('recenter.js'));
  await wait(2500);
  rec('ortala sonrası', await file('follow.js'));
  await shot('full-recenter-after.png');

  // ── 5) Otomatik dönüş (elleme, bekle) ──
  await stage('cam-auto-return');
  adb('shell', 'input', 'swipe', '610', '1200', '610', '1650', '450');
  await wait(1000);
  rec('otomatik dönüş öncesi', await file('follow.js'));
  await wait(12000);
  rec('otomatik dönüş sonrası (12 sn)', await file('follow.js'));

  writeFileSync('camera-after.json', JSON.stringify(log, null, 1));
  const trace = await file('export-trace.js');
  writeFileSync('trace-after-camera.json', JSON.stringify(trace, null, 1));
  console.log('\nolay sayısı: ' + (trace.events?.length ?? '?'));
} finally { ws.close(); }
