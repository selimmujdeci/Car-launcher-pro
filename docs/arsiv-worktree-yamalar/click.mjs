const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const t = list.find((x) => x.title === 'Caros Pro' && x.webSocketDebuggerUrl);
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const call = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
await call('Runtime.enable', {});
const r = await call('Runtime.evaluate', { expression: `
  (() => {
    const b = Array.from(document.querySelectorAll('button')).find(x =>
      /Tanı Gönder/i.test((x.getAttribute('aria-label')||x.getAttribute('title')||x.textContent||'')));
    if (!b) return 'düğme yok';
    b.click();
    return 'tıklandı · visibilityState=' + document.visibilityState;
  })()`, returnByValue: true });
console.log(r?.result?.value ?? JSON.stringify(r));
process.exit(0);
