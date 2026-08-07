/** labscreens.mjs — Belirli LAB ekranlarını aç, içeriğini dök, geri dön. */
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

const ROOT = `(()=>{let best=null,bd=-1;document.querySelectorAll('div').forEach(d=>{const it=d.innerText||'';if(!it.includes('FAZ A ·'))return;let depth=0,n=d;while(n){n=n.parentElement;depth++;}if(bd<0||depth<bd){bd=depth;best=d;}});window.__labRoot=best;return best?'OK':'YOK';})()`;
const TXT = `(()=>{const r=window.__labRoot;return r?(r.innerText||'').replace(/\\n{3,}/g,'\\n\\n').trim():'(LAB KAPALI)';})()`;
const click = (label) => `(()=>{const r=window.__labRoot;if(!r)return 'ROOT YOK';const L=${JSON.stringify(label)};
  const norm=(s)=>(s||'').replace(/\\s+/g,' ').trim().toLocaleUpperCase('tr');
  let el=null,best=1e9;
  r.querySelectorAll('div,span,button,li,a,h1,h2,h3').forEach(x=>{const it=x.innerText;if(!it)return;
    if(norm(it)===norm(L)||norm(it).startsWith(norm(L)+' ')){const n=x.querySelectorAll('*').length;if(n<best){best=n;el=x;}}});
  if(!el)return 'YOK';
  for(const t of ['pointerdown','mousedown','mouseup','click'])el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true}));
  return 'OK';})()`;

const TARGETS = [
  ['İLETİŞİM', 'OTURUM DENETÇİSİ'],
  ['YAPAY ZEKÂ', 'MAVİ KONSOLU'],
  ['ÇALIŞMA ZAMANI', 'KANIT GÖRÜNTÜLEYİCİ'],
];

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable');
    for (const [tab, card] of TARGETS) {
      await ev(ROOT);
      const t1 = await ev(click(tab)); await sleep(900);
      await ev(ROOT);
      const t2 = await ev(click(card)); await sleep(9000);
      await ev(ROOT);
      const txt = await ev(TXT);
      console.log(`\n${'='.repeat(76)}\n>>> ${tab} → ${card}   [tab:${t1} kart:${t2}]\n${'='.repeat(76)}`);
      console.log(String(txt).slice(0, 4200));
      // geri
      await ev(click('GERİ')); await sleep(700);
      await ev(ROOT);
    }
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
