import { writeFileSync } from 'node:fs';
const t0 = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(t0.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = []; const rec = (l, d) => { log.push({ l, d }); console.log('· ' + l + ' → ' + JSON.stringify(d).slice(0, 380)); };
try {
  rec('AYARLAR', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='AYARLAR');b&&b.click();return !!b})()`));
  await wait(3500);
  rec('slider kartları', await ev(`(()=>[...document.querySelectorAll('[data-editable="settings.slider"]')].map(d=>d.innerText.replace(/\s+/g,' ').slice(0,40)))()`));
  const before = await ev('__THERMAL_WATCH__.hits.length');
  rec('%100 iste — React onChange doğrudan', await ev(`(()=>{
    const card=[...document.querySelectorAll('[data-editable="settings.slider"]')].find(d=>/Parlakl/i.test(d.innerText));
    if(!card) return {error:'kart yok', kartlar:[...document.querySelectorAll('[data-editable="settings.slider"]')].length};
    // React fiber üzerinden bileşenin onChange prop'unu bul (ürünün KENDİ yolu)
    const fk=Object.keys(card).find(k=>k.startsWith('__reactFiber'));
    if(!fk) return {error:'fiber yok'};
    let f=card[fk], onChange=null, guard=0;
    while(f && guard++<40){ if(f.memoizedProps && typeof f.memoizedProps.onChange==='function' && typeof f.memoizedProps.value==='number' && /Parlakl/i.test(String(f.memoizedProps.label||''))){ onChange=f.memoizedProps.onChange; break;} f=f.return; }
    if(!onChange) return {error:'onChange bulunamadı'};
    onChange(100);
    return {cagrildi:true};
  })()`));
  await wait(1600);
  const after = await ev('__THERMAL_WATCH__.hits.length');
  rec('KULLANICI yolu toast farkı', { once: before, sonra: after, fark: after - before });
  rec('ekrandaki uyarı', await ev(`(()=>{const t=document.body.innerText;const i=t.indexOf('Termal Koruma');return i<0?null:t.slice(i,i+140).replace(/\s+/g,' ')})()`));
  rec('sistem parlaklığı (0-255)', await ev(`'okuma adb ile'`));
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='GERİ');b&&b.click();return 1})()`);
  writeFileSync('thermal-usercap-probe.json', JSON.stringify(log, null, 1));
} finally { ws.close(); }
