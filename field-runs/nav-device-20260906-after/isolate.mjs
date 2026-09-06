import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB='C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const t0=await (await fetch('http://127.0.0.1:9222/json')).json();
const ws=new WebSocket(t0.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pend.get(m.id)?.(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true})).result?.result?.value;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const shot=n=>{writeFileSync(n, execFileSync(ADB,['exec-out','screencap','-p'],{maxBuffer:64*1024*1024}));return n;};
const set=(l,p,v)=>ev(`(()=>{try{__MAP_STORE__.getState().mapInstance.setPaintProperty(${JSON.stringify(l)},${JSON.stringify(p)},${JSON.stringify(v)});return 'ok'}catch(e){return 'HATA '+e.message}})()`);
const LAYERS=['car-route-shadow','car-route-glow-sel','car-route-casing','car-route-flow','car-route-alt-fill'];
try{
  // hepsini kapat, sadece cekirdek kalsin
  for(const l of LAYERS) await set(l,'line-opacity',0);
  await set('selected-route-layer','line-opacity',1);
  await wait(2500); shot('iso-core-only.png');
  // cekirdegi de kapat
  await set('selected-route-layer','line-opacity',0);
  await wait(2500); shot('iso-nothing.png');
  // cekirdegi SAF KIRMIZI duz renk yap (gradient'i ez)
  await set('selected-route-layer','line-opacity',1);
  await set('selected-route-layer','line-gradient',null);
  await set('selected-route-layer','line-color','#FF0000');
  await wait(2500); shot('iso-core-red.png');
  console.log('3 kare alindi');
} finally { ws.close(); }
