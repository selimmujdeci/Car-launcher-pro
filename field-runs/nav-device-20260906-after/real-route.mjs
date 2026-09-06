import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB='C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const cap=n=>{writeFileSync(n, execFileSync(ADB,['exec-out','screencap','-p'],{maxBuffer:64*1024*1024}));return n;};
const t0=await (await fetch('http://127.0.0.1:9222/json')).json();
const ws=new WebSocket(t0.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pend.get(m.id)?.(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true})).result?.result?.value;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const say=(l,d)=>console.log('· '+l+' -> '+String(JSON.stringify(d)).slice(0,300));
try{
  say('FULL ac', await ev(`(()=>{const b=document.querySelector('button[title="Tam ekran"]');if(b){b.click();return 'acildi'}return 'zaten FULL'})()`));
  await wait(6000);
  say('ekrana dokun', await ev(`(()=>{const c=document.querySelector('.maplibregl-canvas');if(c){const r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.width/2,clientY:r.height/2}));return 'dokunuldu'}return 'canvas yok'})()`));
  await wait(1500);
  say('kisayollar', await ev(`(()=>[...document.querySelectorAll('button')].map(b=>b.innerText.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,18))()`));
  say('EV tikla', await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^EV\b/i.test(b.innerText.trim()));if(!b)return {yok:true};b.click();return 'tiklandi'})()`));
  await wait(11000);
  say('durum', await ev(`(()=>{const m=__MAP_STORE__.getState().mapInstance;const s=m.getStyle();const src=s.sources['selected-route-source'];
    const d=src&&src.data;const n=d&&d.geometry?d.geometry.coordinates.length:0;
    const L=(id)=>{const l=s.layers.find(x=>x.id===id);return l?{op:(l.paint||{})['line-opacity'],renk:(l.paint||{})['line-color']}:null};
    return {rotaNokta:n, zoom:+m.getZoom().toFixed(2), rozet:document.body.innerText.replace(/\s+/g,' ').slice(0,150),
      cekirdek:L('selected-route-layer'), kilif:L('car-route-casing'), flow:L('car-route-flow')}})()`));
  await wait(1500);
  console.log('ekran: ' + cap('route-real.png'));
} finally { ws.close(); }
