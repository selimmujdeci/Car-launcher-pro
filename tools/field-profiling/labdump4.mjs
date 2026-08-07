/** labdump4.mjs — LAB kabuğuna HAPSEDİLMİŞ gezinme + tam döküm. */
const wsUrl = process.argv[2];
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
ws.addEventListener('error', (e) => { console.error('WS:', e.message ?? e); process.exit(1); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, timeout: 25000 });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception?.description ?? '').slice(0, 250));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LAB kökü: 'FAZ A ·' içeren EN KÜÇÜK div
const ROOT = `(()=>{
  let best=null,bn=1e9;
  document.querySelectorAll('div').forEach(d=>{
    const it=d.innerText||'';
    if(it.includes('FAZ A ·') && it.includes('KAPAT') && it.includes('ÇALIŞMA ZAMANI')){
      const n=d.querySelectorAll('*').length; if(n<bn){bn=n;best=d;}
    }
  });
  window.__labRoot=best;
  return best ? 'ROOT OK ('+bn+' düğüm)' : 'ROOT YOK';
})()`;

const LABTXT = `(()=>{const r=window.__labRoot;return r? (r.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim() : '(LAB KAPALI)';})()`;

const clickIn = (label) => `(()=>{
  const r=window.__labRoot; if(!r) return 'ROOT YOK';
  const L=${JSON.stringify(label)};
  const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim().toLocaleUpperCase('tr');
  let el=null,best=1e9;
  r.querySelectorAll('div,span,button,li,a').forEach(x=>{
    const it=x.innerText; if(!it) return;
    if(norm(it)===norm(L)){ const n=x.querySelectorAll('*').length; if(n<best){best=n;el=x;} }
  });
  if(!el) return 'YOK';
  for(const t of ['pointerdown','mousedown','mouseup','click']) el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true}));
  return 'OK';
})()`;

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable');
    console.log(await ev(ROOT));
    const tabs = ['ARAÇ', 'İLETİŞİM', 'ÇALIŞMA ZAMANI', 'YAPAY ZEKÂ', 'GELİŞTİRİCİ'];
    for (const t of tabs) {
      const res = await ev(clickIn(t));
      await sleep(1200);
      await ev(ROOT);
      const txt = await ev(LABTXT);
      console.log(`\n${'#'.repeat(74)}\n## KATEGORİ: ${t}  [${res}]\n${'#'.repeat(74)}`);
      console.log(String(txt).slice(0, 5000));
    }
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
