import { writeFileSync } from 'node:fs';
const t0 = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(t0.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = []; const rec = (l, d) => { log.push({ l, d }); console.log('· ' + l + ' → ' + JSON.stringify(d)); };

try {
  // Gözlemciyi (yoksa) kur — ve KÖR OLMADIĞINI kanıtla
  rec('gözlemci', await ev(`(() => {
    if (!window.__THERMAL_WATCH__) {
      const w = window.__THERMAL_WATCH__ = { hits: [], started: Date.now() };
      const scan = () => { for (const el of document.querySelectorAll('*')) { if (el.children.length) continue;
        const t = (el.textContent || '').trim(); if (t === 'Termal Koruma' && !el.__seen) { el.__seen = true; w.hits.push({ at: Date.now() }); } } };
      scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }); w.hits.length = 0;
    }
    return { mevcutSayac: __THERMAL_WATCH__.hits.length };
  })()`));

  rec('AYARLAR aç', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='AYARLAR');if(!b)return {error:'AYARLAR yok'};b.click();return 'ok'})()`));
  await wait(2500);
  rec('EKRAN sekmesi', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='EKRAN');if(!b)return {error:'EKRAN yok', butonlar:[...document.querySelectorAll('button')].map(x=>x.innerText.trim()).filter(Boolean).slice(0,30)};b.click();return 'ok'})()`));
  await wait(2000);

  rec('parlaklık slider', await ev(`(()=>{
    const inputs=[...document.querySelectorAll('input[type=range]')];
    return inputs.map((i,ix)=>({ix, value:i.value, min:i.min, max:i.max, label:(i.closest('div')?.innerText||'').replace(/\s+/g,' ').slice(0,60)}));
  })()`));

  const before = await ev('__THERMAL_WATCH__.hits.length');
  rec('slider %100 (KULLANICI yolu)', await ev(`(()=>{
    const inputs=[...document.querySelectorAll('input[type=range]')];
    const el = inputs.find(i => /Parlakl/i.test((i.closest('div')?.innerText)||'')) || inputs[0];
    if(!el) return {error:'slider yok'};
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, '100');
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return { yazilan: el.value };
  })()`));
  await wait(1500);
  const after = await ev('__THERMAL_WATCH__.hits.length');
  rec('KULLANICI yolu toast farkı', { once: before, sonra: after, fark: after - before });
  rec('ekrandaki uyarı metni', await ev(`(()=>{const t=document.body.innerText;const i=t.indexOf('Termal Koruma');return i<0?null:t.slice(i,i+120).replace(/\s+/g,' ')})()`));

  // geri dön
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='GERİ');if(b)b.click();return 'ok'})()`);
  writeFileSync('thermal-usercap-probe.json', JSON.stringify(log, null, 1));
} finally { ws.close(); }
