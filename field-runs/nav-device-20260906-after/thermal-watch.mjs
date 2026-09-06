import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB = 'C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();

const t0 = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(t0.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = { device: {}, steps: [] };
const rec = (l, d) => { out.steps.push({ label: l, at: new Date().toISOString(), data: d }); console.log('· ' + l + ' → ' + JSON.stringify(d)); };

const thermal = () => {
  const d = adb('shell', 'dumpsys', 'thermalservice');
  const status = (d.match(/Thermal Status:\s*(\d+)/) || [])[1];
  const skin = (d.match(/mValue=([\d.]+),\s*mType=3,\s*mName=SKIN,\s*mStatus=(\d+)/) || []).slice(1);
  return { status: status ? +status : null, skinC: skin[0] ? +skin[0] : null, skinStatus: skin[1] ? +skin[1] : null };
};
const sysBright = () => { try { return +adb('shell', 'settings', 'get', 'system', 'screen_brightness'); } catch { return null; } };

try {
  out.device.thermalBefore = thermal();
  out.device.sysBrightnessBefore = sysBright();
  rec('cihaz termal / parlaklık', { ...out.device.thermalBefore, sysBrightness: out.device.sysBrightnessBefore });

  // ── Toast gözlemcisi: DOM'a düşen her "Termal Koruma" kaydedilir ──
  rec('gözlemci', await ev(`(() => {
    if (window.__THERMAL_WATCH__) return 'already';
    const w = window.__THERMAL_WATCH__ = { hits: [], started: Date.now() };
    const scan = () => {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (t === 'Termal Koruma' && !el.__seen) { el.__seen = true; w.hits.push({ at: Date.now(), rel: Date.now() - w.started }); }
      }
    };
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    w.baseline = w.hits.length; w.hits.length = 0;
    return { baselineToastVarken: w.baseline };
  })()`));

  // ── Termal kapın GERÇEKTEN aktif olduğunu kanıtla: KULLANICI yolu uyarmalı ──
  rec('kap sondası (kullanıcı yolu)', await ev(`(async () => {
    const url = performance.getEntriesByType('resource').map(r => r.name).find(n => /\/systemSettingsService-/.test(n));
    let mod = null;
    if (url) { try { mod = await import(url); } catch {} }
    if (!mod) {
      const js = performance.getEntriesByType('resource').map(r => r.name).filter(n => /\/assets\/.*\.js$/.test(n) && !/vendor-/.test(n));
      for (const u of js) { try { const m = await import(u); if (typeof m.setBrightness === 'function' && typeof m.setBrightnessAuto === 'function') { mod = m; break; } } catch {} }
    }
    if (!mod) return { error: 'systemSettingsService bulunamadı' };
    window.__sys = mod;
    const before = __THERMAL_WATCH__.hits.length;
    mod.setBrightness(100);
    await new Promise(r => setTimeout(r, 600));
    return { kullaniciCagrisiSonrasiToast: __THERMAL_WATCH__.hits.length - before };
  })()`));

  const MIN = 6;
  console.log(`\n… ${MIN} dakika gözlem (otomasyon tick'i 60 sn) …`);
  for (let i = 1; i <= MIN; i++) {
    await wait(60_000);
    const h = await ev('__THERMAL_WATCH__.hits.length');
    const th = thermal();
    console.log(`  ${i}. dk → toplam "Termal Koruma" toast: ${h} | thermalStatus=${th.status} skin=${th.skinC}`);
    out.steps.push({ label: `dk ${i}`, toasts: h, thermal: th, sysBrightness: sysBright() });
  }
  out.device.thermalAfter = thermal();
  out.device.sysBrightnessAfter = sysBright();
  out.result = await ev('({toplamToast: __THERMAL_WATCH__.hits.length, kayitlar: __THERMAL_WATCH__.hits})');
  rec('SONUÇ', { ...out.result, sysBrightnessAfter: out.device.sysBrightnessAfter, thermalAfter: out.device.thermalAfter });
  writeFileSync('thermal-toast-after.json', JSON.stringify(out, null, 1));
} finally { ws.close(); }
