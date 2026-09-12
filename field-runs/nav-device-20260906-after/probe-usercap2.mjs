import { writeFileSync } from 'node:fs';
const t0 = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(t0.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: m, params: p })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const log = []; const rec = (l, d) => { log.push({ l, d }); console.log('· ' + l + ' → ' + JSON.stringify(d).slice(0,400)); };

try {
  // ── A) Gözlemci KÖR DEĞİL: aynı metni DOM'a düşür, sayaç artmalı ──
  rec('A · gözlemci kör mü', await ev(`(async () => {
    const w = window.__THERMAL_WATCH__;
    if (!w) return { error: 'gözlemci yok' };
    const before = w.hits.length;
    const n = document.createElement('div'); n.textContent = 'Termal Koruma';
    document.body.appendChild(n);
    await new Promise(r => setTimeout(r, 300));
    const after = w.hits.length; n.remove();
    return { once: before, sonra: after, gozlemciCalisiyor: after === before + 1 };
  })()`));

  // ── B) Ayarlar → EKRAN → Parlaklık slider'ının REACT onChange'i ──
  rec('B1 · AYARLAR', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='AYARLAR');if(!b)return {error:'yok'};b.click();return 'ok'})()`));
  await wait(3000);
  rec('B2 · sekmeler', await ev(`(()=>[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).slice(0,24))()`));
  rec('B3 · EKRAN', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='EKRAN');if(!b)return {error:'EKRAN yok'};b.click();return 'ok'})()`));
  await wait(2500);
  rec('B4 · slider kartı', await ev(`(()=>{const c=[...document.querySelectorAll('[data-editable="settings.slider"]')].map(d=>d.innerText.replace(/\s+/g,' ').slice(0,50));return c})()`));

  const before = await ev('__THERMAL_WATCH__ ? __THERMAL_WATCH__.hits.length : -1');
  rec('B5 · %100 iste (ürünün kendi onChange yolu)', await ev(`(()=>{
    const card = [...document.querySelectorAll('[data-editable="settings.slider"]')].find(d=>/Parlakl/i.test(d.innerText));
    if (!card) return { error: 'parlaklık kartı yok' };
    const walk = (el) => { const k = Object.keys(el).find(k=>k.startsWith('__reactProps')); return k ? el[k] : null; };
    const stack = [card]; const found = [];
    while (stack.length) { const el = stack.pop(); const p = walk(el);
      if (p && (p.onPointerDown || p.onMouseDown || p.onClick || p.onTouchStart)) found.push({ el, p });
      for (const c of el.children) stack.push(c); }
    if (!found.length) return { error: 'etkileşimli düğüm yok' };
    const target = found[0];
    const r = target.el.getBoundingClientRect();
    const fake = { clientX: r.left + r.width, clientY: r.top + r.height/2, currentTarget: target.el, target: target.el,
      preventDefault(){}, stopPropagation(){}, pointerId: 1, buttons: 1 };
    try { (target.p.onPointerDown || target.p.onMouseDown || target.p.onTouchStart || target.p.onClick).call(null, fake); } catch (e) { return { error: String(e) }; }
    return { tetiklendi: true, rect: { w: Math.round(r.width), h: Math.round(r.height) } };
  })()`));
  await wait(1500);
  const after = await ev('__THERMAL_WATCH__ ? __THERMAL_WATCH__.hits.length : -1');
  rec('B6 · KULLANICI yolu toast farkı', { once: before, sonra: after, fark: after - before });
  rec('B7 · ekrandaki metin', await ev(`(()=>{const t=document.body.innerText;const i=t.indexOf('Termal Koruma');return i<0?null:t.slice(i,i+130).replace(/\s+/g,' ')})()`));
  rec('B8 · store parlaklık', await ev(`(()=>window.__navSettings?__navSettings.getState().settings.brightness:null)()`));
  writeFileSync('thermal-usercap-probe.json', JSON.stringify(log, null, 1));
} finally { ws.close(); }
