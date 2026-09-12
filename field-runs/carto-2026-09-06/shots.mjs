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
const say=(l,d)=>console.log('· '+l+' -> '+String(JSON.stringify(d)).slice(0,220));
try{
  // ayar mağazasını bağla
  const fs=await import('node:fs');
  say('attach', await ev(fs.readFileSync('attach.js','utf8')));
  const setTheme=t=>ev("__navSetTheme('"+t+"')");
  for (const tema of ['day','night']) {
    await ev(`__theme('${tema}')`); await wait(3500);
    // MINI
    const closeBtn = await ev(`(()=>{const b=document.querySelector('[aria-label="Haritayı kapat"]');if(b){b.click();return 'kapatildi'}return 'zaten mini'})()`);
    await wait(4000);
    say(`MINI ${tema}`, await ev(`(()=>{const m=__MAP_STORE__.getState().mapInstance;return {stil:m.getStyle().name,zoom:+m.getZoom().toFixed(1),yuzey:m.getContainer().offsetHeight<350?'MINI':'FULL'}})()`));
    cap(`after-MINI-${tema.toUpperCase()}.png`);
    // FULL
    await ev(`(()=>{const b=document.querySelector('button[title="Tam ekran"]');if(b)b.click();return !!b})()`);
    await wait(6000);
    say(`FULL ${tema}`, await ev(`(()=>{const m=__MAP_STORE__.getState().mapInstance;return {stil:m.getStyle().name,zoom:+m.getZoom().toFixed(1),yuzey:m.getContainer().offsetHeight<350?'MINI':'FULL'}})()`));
    cap(`after-FULL-${tema.toUpperCase()}.png`);
  }
  await setTheme('day');
  console.log('4 kare alindi');
} finally { ws.close(); }
