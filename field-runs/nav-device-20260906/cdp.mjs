import { writeFileSync, readFileSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once:true}));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m=JSON.parse(e.data); if(m.id) {pending.get(m.id)?.(m); pending.delete(m.id);} });
const send = (method,params={}) => new Promise(r => { const n=++id; pending.set(n,r); ws.send(JSON.stringify({id:n,method,params})); });
try {
 if(process.argv[2] === 'shot') { const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(process.argv[3],Buffer.from(r.result.data,'base64')); }
 else { const expression=readFileSync(process.argv[2],'utf8'); const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); console.log(JSON.stringify(r.result,null,2)); }
} finally {ws.close();}
