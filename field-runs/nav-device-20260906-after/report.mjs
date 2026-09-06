import { readFileSync, existsSync } from 'node:fs';
const j = f => JSON.parse(readFileSync(f, 'utf8'));
const pad = (s, n) => String(s ?? '-').padEnd(n);

const L = j('matrix-after.json');
console.log('═══ MATRİS — UI semantiği ↔ MapLibre gerçeği ═══');
console.log(pad('adım', 24), pad('yüzey', 5), pad('UI', 6), pad('stil adı', 26), pad('niyet', 7), pad('arka plan', 17), pad('ana yol', 17), 'su');
let mismatch = 0;
for (const e of L) {
  const d = e.data; if (!d || !d.style) continue;
  const uiNight = d.uiDayNight === 'night';
  const nameNight = /Night/.test(d.style || '');
  const flag = uiNight !== nameNight ? '  ✗ AD SAPMASI' : '';
  if (uiNight !== nameNight) mismatch++;
  console.log(pad(e.label, 24), pad(d.surface, 5), pad(d.uiDayNight, 6), pad(d.style, 26), pad(d.tileRenderIntent, 7), pad(d.bg, 17), pad(d.roadPrimary, 17), (d.water ?? '-') + flag);
}
console.log('\nUI ↔ stil-adı sapması:', mismatch);
const rasterRows = L.filter(e => e.data && /OSM|Map$/.test(e.data.style || '') && !/Vector/.test(e.data.style || ''));
console.log('raster ("OSM Map") gözlenen anlık görüntü:', rasterRows.length);
const intents = new Set(L.filter(e => e.data && e.data.tileRenderIntent).map(e => e.data.tileRenderIntent));
console.log('görülen tileRender niyetleri:', [...intents].join(', '));

for (const [file, title] of [['trace-after-style.json', 'STİL İZİ'], ['trace-after-camera.json', 'KAMERA İZİ']]) {
  if (!existsSync(file)) continue;
  const ev = j(file).events || [];
  console.log(`\n═══ ${title} (${ev.length} olay) ═══`);
  const ops = {}; for (const e of ev) ops[e.op] = (ops[e.op] || 0) + 1;
  console.log('op:', JSON.stringify(ops));
  const st = {};
  for (const e of ev) { if (!/^(setStyle|style\.load)$/.test(e.op)) continue; st[e.stage] ??= { setStyle: 0, load: 0 }; st[e.stage][e.op === 'setStyle' ? 'setStyle' : 'load']++; }
  const stages = Object.keys(st);
  if (stages.length) {
    console.log('aşama başına setStyle / style.load:');
    for (const k of stages) console.log('  ', pad(k, 26), 'setStyle=' + st[k].setStyle, 'style.load=' + st[k].load);
  }
  const names = new Set(ev.filter(e => e.op === 'setStyle').map(e => e.args?.name).filter(Boolean));
  console.log('kurulan stil adları:', [...names].join(' | ') || '(yok)');
  const it = ev.filter(e => e.op === 'tileRender-intent');
  console.log('tileRender-intent olayı:', it.length, it.map(e => `${e.stage}:${e.before}->${e.after}`).join(', '));

  const cam = ev.filter(e => /easeTo|flyTo|fitBounds/.test(e.op));
  if (cam.length) {
    console.log(`kamera animasyon komutu: ${cam.length}`);
    const seen = new Map(); let dup = 0;
    for (const c of cam) {
      const k = [c.op, c.args?.zoom, c.args?.pitch, c.args?.duration].join('|');
      const p = seen.get(k);
      if (p !== undefined && c.t - p < 400) { dup++; console.log('   ✗ TEKRAR', k, Math.round(c.t - p) + 'ms'); }
      seen.set(k, c.t);
    }
    console.log('<400ms özdeş tekrar:', dup);
    const entry = cam.filter(c => /driving-entry/.test(c.stage));
    if (entry.length) console.log('sürüş girişi komut sayısı:', entry.length, JSON.stringify(entry.map(c => ({ op: c.op, z: c.args?.zoom, p: c.args?.pitch, d: c.args?.duration }))));
  }
  const starts = ev.filter(e => /(drag|zoom|rotate|pitch)start/.test(e.op));
  if (starts.length) {
    const byOrigin = {}; for (const e of starts) byOrigin[e.origin] = (byOrigin[e.origin] || 0) + 1;
    const bad = starts.filter(e => e.origin === 'PROGRAMMATIC' && e.follow?.cameraMode === 'USER_PANNING');
    console.log('etkileşim başlangıcı kökeni:', JSON.stringify(byOrigin), '| programatik→USER_PANNING:', bad.length);
    console.log('gerçek kullanıcı olayları:', JSON.stringify(starts.filter(e => e.origin === 'USER').map(e => ({ op: e.op, src: e.originalEventType, mode: e.follow?.cameraMode }))));
  }
}
if (existsSync('camera-after.json')) {
  console.log('\n═══ KAMERA SENARYO ADIMLARI ═══');
  for (const e of j('camera-after.json')) {
    const f = e.data?.follow ?? e.data?.after ?? null;
    if (f?.cameraMode) console.log('  ', pad(e.label, 30), f.cameraMode, '| reason=' + f.reason, '| pending=' + f.autoRecenterPending, e.data?.camera ? `| z=${e.data.camera.zoom} p=${e.data.camera.pitch} b=${e.data.camera.bearing}` : '');
  }
}
