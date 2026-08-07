/**
 * cdpmetrics.mjs — Performance.getMetrics ile Script/Style/Layout/Task ayrıştırması.
 * İki örnek arasındaki DELTA gerçek CPU dağılımını verir.
 */
const wsUrl = process.argv[2];
const durSec = Number(process.argv[3] || 20);

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => {
  const mid = ++id; pending.set(mid, { res, rej });
  ws.send(JSON.stringify({ id: mid, method: m, params: p }));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
});
ws.addEventListener('error', (e) => { console.error('WS:', e.message ?? e); process.exit(1); });

const toMap = (arr) => Object.fromEntries(arr.map((m) => [m.name, m.value]));

ws.addEventListener('open', async () => {
  try {
    await send('Performance.enable');
    const a = toMap((await send('Performance.getMetrics')).metrics);
    console.error(`${durSec} sn ölçülüyor...`);
    await new Promise((r) => setTimeout(r, durSec * 1000));
    const b = toMap((await send('Performance.getMetrics')).metrics);

    const d = (k) => (b[k] ?? 0) - (a[k] ?? 0);
    const wall = durSec;
    const pct = (s) => ((s / wall) * 100).toFixed(1).padStart(6) + '%';

    console.log(`\n=== ${durSec} sn RENDERER ANA THREAD AYRIŞTIRMASI ===`);
    console.log(`TaskDuration        ${d('TaskDuration').toFixed(2).padStart(7)} s   ${pct(d('TaskDuration'))}  (ana thread toplam meşguliyet)`);
    console.log(`  ScriptDuration    ${d('ScriptDuration').toFixed(2).padStart(7)} s   ${pct(d('ScriptDuration'))}  (JS)`);
    console.log(`  RecalcStyleDur.   ${d('RecalcStyleDuration').toFixed(2).padStart(7)} s   ${pct(d('RecalcStyleDuration'))}  (stil yeniden hesap)`);
    console.log(`  LayoutDuration    ${d('LayoutDuration').toFixed(2).padStart(7)} s   ${pct(d('LayoutDuration'))}  (yerleşim)`);
    console.log(`  DevToolsCmdDur.   ${d('DevToolsCommandDuration').toFixed(2).padStart(7)} s   ${pct(d('DevToolsCommandDuration'))}  (ölçüm maliyeti)`);
    console.log(`\nSAYIMLAR (${durSec} sn):`);
    console.log(`  RecalcStyleCount  ${String(d('RecalcStyleCount')).padStart(8)}   (${(d('RecalcStyleCount') / wall).toFixed(1)}/sn)`);
    console.log(`  LayoutCount       ${String(d('LayoutCount')).padStart(8)}   (${(d('LayoutCount') / wall).toFixed(1)}/sn)`);
    console.log(`  Frames            ${String(d('Frames')).padStart(8)}   (${(d('Frames') / wall).toFixed(1)}/sn)`);
    console.log(`  Nodes / Documents ${String(b['Nodes'] ?? '?').padStart(8)} / ${b['Documents'] ?? '?'}`);
    console.log(`  JSEventListeners  ${String(b['JSEventListeners'] ?? '?').padStart(8)}`);
    console.log(`  LayoutObjects     ${String(b['LayoutObjects'] ?? '?').padStart(8)}`);
    console.log(`  JSHeapUsedSize    ${((b['JSHeapUsedSize'] ?? 0) / 1048576).toFixed(1).padStart(8)} MB`);
    ws.close(); process.exit(0);
  } catch (e) { console.error('hata:', e.message); process.exit(1); }
});
