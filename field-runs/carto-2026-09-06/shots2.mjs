import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const ADB='C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const cap=n=>{writeFileSync(n, execFileSync(ADB,['exec-out','screencap','-p'],{maxBuffer:64*1024*1024}));return n;};
const tap=(x,y)=>execFileSync(ADB,['shell','input','tap',String(x),String(y)]);
const t0=await (await fetch('http://127.0.0.1:9222/json')).json();
const ws=new WebSocket(t0.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pend=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pend.get(m.id)?.(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(r=>{const n=++id;pend.set(n,r);ws.send(JSON.stringify({id:n,method:m,params:p}));});
const ev=async x=>(await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true})).result?.result?.value;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const say=(l,d)=>console.log('· '+l+' -> '+String(JSON.stringify(d)).slice(0,200));
const click=lbl=>ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||x.title||'')===${JSON.stringify(lbl)});if(b){b.click();return 'ok'}return 'yok'})()`);
const state=()=>ev(`(()=>{const m=__MAP_STORE__.getState().mapInstance;return {stil:m.getStyle().name,zoom:+m.getZoom().toFixed(1),yuzey:m.getContainer().offsetHeight<350?'MINI':'FULL',zemin:m.getPaintProperty('background','background-color')}})()`);
try{
  say('nav bitir', await click('Navigasyonu sonlandır')); await wait(4000);
  tap(1350,610); await wait(1500);

  say('FULL NIGHT', await state()); cap('after-FULL-NIGHT.png');
  say('kapat', await click('Haritayı kapat')); await wait(5000);
  say('MINI NIGHT', await state()); cap('after-MINI-NIGHT.png');

  await ev(`__navSetTheme('day')`); await wait(6000);
  say('MINI DAY', await state()); cap('after-MINI-DAY.png');
  say('tam ekran', await ev(`(()=>{const b=document.querySelector('button[title="Tam ekran"]');if(b){b.click();return 'ok'}return 'yok'})()`)); await wait(6500);
  tap(1350,610); await wait(1200);
  say('FULL DAY', await state()); cap('after-FULL-DAY.png');
} finally { ws.close(); }
