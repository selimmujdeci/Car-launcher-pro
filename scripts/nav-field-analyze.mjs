/**
 * nav-field-analyze.mjs — NAV-CORE-P0 saha kaydından P0-1..P0-5 metriklerini çıkarır.
 *
 * KULLANIM
 *   node scripts/nav-field-analyze.mjs field-runs/nav-P0-1-....jsonl
 *
 * İLKE: ölçülemeyen metrik "NOT_MEASURED" döner. Varsayılan/uydurma değer YOK.
 * Kabul ölçütleri `docs/NAVIGATION_CORE_RELIABILITY_P0_REPORT.md` §16'dan gelir.
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('kullanım: node scripts/nav-field-analyze.mjs <kayit.jsonl>'); process.exit(2); }

const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const meta = JSON.parse(lines[0])._meta ? JSON.parse(lines[0]) : null;
const S = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
               .filter(x => x && !x._meta);

if (S.length === 0) { console.error('kayıt boş.'); process.exit(2); }

const NM = 'NOT_MEASURED';
const f1 = (v) => (v == null || !Number.isFinite(v) ? NM : v.toFixed(1));
const pct = (a, b) => (b === 0 ? NM : ((a / b) * 100).toFixed(1) + '%');

console.log('═'.repeat(72));
console.log(`NAV-CORE-P0 SAHA ANALİZİ — ${meta?.label ?? '?'}`);
console.log(`kayıt: ${file}`);
console.log(`örnek: ${S.length}  ·  süre: ${((S.at(-1).tWall - S[0].tWall) / 1000).toFixed(0)} s`);
console.log('═'.repeat(72));

/* ── Sürüş gerçekten oldu mu? ─────────────────────────────────────────────── */
const moving = S.filter(s => (s.veh.speedKmh ?? 0) > 5);
const maxSpeed = Math.max(...S.map(s => s.veh.speedKmh ?? 0));
const navActive = S.filter(s => s.nav.isNavigating);
console.log('\n── ÖN KOŞUL ──');
console.log(`  hareket örneği (>5 km/h) : ${moving.length} / ${S.length}  (${pct(moving.length, S.length)})`);
console.log(`  en yüksek hız            : ${f1(maxSpeed)} km/h`);
console.log(`  navigasyon aktif örneği  : ${navActive.length}`);
if (moving.length === 0) {
  console.log('\n  ⚠️  ARAÇ HİÇ HAREKET ETMEDİ → bu kayıt SAHA KANITI DEĞİLDİR.');
}

/* ── P0-1 · Yeniden rota ──────────────────────────────────────────────────── */
console.log('\n── P0-1 · YENİDEN ROTA ──');
// Sapma zinciri: ilk SUSPECTED → ilk CONFIRMED
let firstSusp = null, firstConf = null;
for (const s of S) {
  if (firstSusp === null && s.offRoute.state === 'SUSPECTED_OFF_ROUTE') firstSusp = s;
  if (firstConf === null && s.offRoute.state === 'CONFIRMED_OFF_ROUTE') { firstConf = s; break; }
}
const detectMs = (firstSusp && firstConf) ? firstConf.tWall - firstSusp.tWall : null;
// Ledger'ın kendi ölçümleri (en güvenilir kaynak)
const withLat = S.filter(s => s.req.detectToFirstInstrMs != null);
const lastLat = withLat.at(-1);
console.log(`  ilk şüphe → doğrulama    : ${detectMs == null ? NM : (detectMs / 1000).toFixed(1) + ' s'}`);
console.log(`  sapma → rota uygulandı   : ${lastLat?.req.detectToCommitMs == null ? NM : (lastLat.req.detectToCommitMs / 1000).toFixed(1) + ' s'}`);
console.log(`  sapma → ilk yeni talimat : ${lastLat?.req.detectToFirstInstrMs == null ? NM : (lastLat.req.detectToFirstInstrMs / 1000).toFixed(1) + ' s'}   [KABUL ≤ 12 s]`);
console.log(`  istek → yanıt (ağ)       : ${lastLat?.req.requestToResponseMs == null ? NM : (lastLat.req.requestToResponseMs / 1000).toFixed(1) + ' s'}`);
const last = S.at(-1);
console.log(`  uygulanan rota / bayat reddi / bastırılan : ${last.req.committed} / ${last.req.staleRejected} / ${last.req.suppressed}`);
const p01 = lastLat?.req.detectToFirstInstrMs;
console.log(`  ➜ P0-1: ${p01 == null ? 'NOT_RUN (sapma yaşanmadı)' : (p01 <= 12000 ? 'PASS' : 'FAIL')}`);

/* ── P0-2 · Varış ─────────────────────────────────────────────────────────── */
console.log('\n── P0-2 · VARIŞ ──');
const arrived = S.find(s => s.nav.status === 'ARRIVED');
const idleAfter = arrived ? S.find(s => s.tWall > arrived.tWall && s.nav.status === 'IDLE') : null;
console.log(`  ARRIVED gözlendi         : ${arrived ? 'EVET (' + new Date(arrived.tWall).toLocaleTimeString() + ')' : 'HAYIR'}`);
console.log(`  otomatik IDLE'a döndü    : ${idleAfter ? 'EVET (' + ((idleAfter.tWall - arrived.tWall) / 1000).toFixed(1) + ' s sonra)' : (arrived ? 'HAYIR' : NM)}`);
// Son 100 m düşük hız penceresi
const near = S.filter(s => s.nav.distanceM != null && s.nav.distanceM < 100);
const nearSlow = near.filter(s => (s.veh.speedKmh ?? 0) < 10);
console.log(`  son 100 m örneği         : ${near.length}  (bunların ${nearSlow.length}'i <10 km/h)`);
console.log(`  ➜ P0-2: ${arrived ? (idleAfter ? 'PASS' : 'FIX_REQUIRED (ARRIVED var, IDLE yok)') : (near.length > 0 ? 'FAIL (hedefe varıldı, ARRIVED YOK)' : 'NOT_RUN (hedefe varılmadı)')}`);

/* ── P0-3 · Map matching ──────────────────────────────────────────────────── */
console.log('\n── P0-3 · MAP MATCHING ──');
const navMoving = S.filter(s => s.nav.isNavigating && (s.veh.speedKmh ?? 0) > 5 && s.match.state);
const matched = navMoving.filter(s => s.match.state === 'MATCHED');
const offNet = navMoving.filter(s => s.match.state === 'OFF_NETWORK');
const lat = navMoving.map(s => s.match.lateralM).filter(v => v != null).sort((a, b) => a - b);
const med = lat.length ? lat[Math.floor(lat.length / 2)] : null;
const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : null;
console.log(`  değerlendirilen örnek    : ${navMoving.length}`);
console.log(`  MATCHED oranı            : ${pct(matched.length, navMoving.length)}   [KABUL ≥ 95%]`);
console.log(`  OFF_NETWORK oranı        : ${pct(offNet.length, navMoving.length)}`);
console.log(`  yanal mesafe medyan/p95  : ${med == null ? NM : med.toFixed(1) + ' m'} / ${p95 == null ? NM : p95.toFixed(1) + ' m'}   [KABUL medyan < 15 m]`);
const jumps = navMoving.filter(s => s.match.reasons?.includes('JUMP_REJECTED')).length;
console.log(`  JUMP_REJECTED örneği     : ${jumps}`);
const p03ok = navMoving.length >= 30 && matched.length / navMoving.length >= 0.95 && med != null && med < 15;
console.log(`  ➜ P0-3: ${navMoving.length < 30 ? 'NOT_RUN (yeterli sürüş örneği yok)' : (p03ok ? 'PASS' : 'FIX_REQUIRED')}`);

/* ── P0-4 · Yakın manevralar ──────────────────────────────────────────────── */
console.log('\n── P0-4 · YAKIN MANEVRALAR ──');
const withRoute = S.filter(s => s.nav.isNavigating && s.route.steps > 0);
const srcCount = {};
for (const s of withRoute) srcCount[s.route.distSource] = (srcCount[s.route.distSource] ?? 0) + 1;
const along = srcCount['ALONG_ROUTE'] ?? 0;
console.log(`  mesafe kaynağı dağılımı  : ${JSON.stringify(srcCount)}`);
console.log(`  YOL-BOYU oranı           : ${pct(along, withRoute.length)}   [KABUL ≥ 95%]`);
const unres = withRoute.filter(s => s.route.anchorsUnresolved > 0).length;
console.log(`  çapa çözülemeyen örnek   : ${unres}   [KABUL 0]`);
// Adım geri gitti mi?
let regress = 0;
for (let i = 1; i < withRoute.length; i++) {
  if (withRoute[i].route.serverUsed === withRoute[i - 1].route.serverUsed &&
      withRoute[i].route.stepIdx < withRoute[i - 1].route.stepIdx) regress++;
}
console.log(`  adım GERİ gitti          : ${regress} kez   [KABUL 0]`);
const p04ok = withRoute.length >= 30 && along / withRoute.length >= 0.95 && unres === 0 && regress === 0;
console.log(`  ➜ P0-4: ${withRoute.length < 30 ? 'NOT_RUN' : (p04ok ? 'PASS' : 'FIX_REQUIRED')}`);

/* ── P0-5 · Düşük hız trafik ──────────────────────────────────────────────── */
console.log('\n── P0-5 · DÜŞÜK HIZ TRAFİK ──');
const slow = S.filter(s => s.nav.isNavigating && (s.veh.speedKmh ?? 0) <= 10);
const slowFirst = slow[0], slowLast = slow.at(-1);
const reroutesInSlow = (slowFirst && slowLast) ? slowLast.req.committed - slowFirst.req.committed : null;
console.log(`  düşük hız örneği         : ${slow.length}`);
console.log(`  bu sırada YENİ rota      : ${reroutesInSlow == null ? NM : reroutesInSlow}   [KABUL 0 — gereksiz reroute yok]`);
const etas = slow.map(s => s.nav.etaS).filter(v => v != null);
let etaJump = 0;
for (let i = 1; i < etas.length; i++) if (Math.abs(etas[i] - etas[i - 1]) > 120) etaJump++;
console.log(`  ETA sıçraması (>2 dk)    : ${etas.length ? etaJump : NM}`);
const p05ok = slow.length >= 20 && reroutesInSlow === 0;
console.log(`  ➜ P0-5: ${slow.length < 20 ? 'NOT_RUN' : (p05ok ? 'PASS' : 'FIX_REQUIRED')}`);

/* ── Sağlayıcı / dürüstlük ────────────────────────────────────────────────── */
console.log('\n── SAĞLAYICI & DÜRÜSTLÜK ──');
console.log(`  yerel OSRM durumu        : ${last.provider.localState}`);
console.log(`  yoklama / atlanan        : ${last.provider.probeCount} / ${last.provider.skippedCount}   [KABUL yoklama = 1]`);
console.log(`  son kaynak               : ${last.provider.lastSource}`);
console.log(`  düz hat kullanımı        : ${last.provider.straightLineCount}`);
console.log(`  rota doğrulama hükmü     : ${last.route.validation ?? NM}`);
console.log(`  gerçek şerit verili adım : ${last.route.lanesSteps} / ${last.route.steps}`);
console.log(`  dönel kavşak / çıkışlı   : ${last.route.roundaboutSteps} / ${last.route.roundaboutWithExit}`);

/* NAV v3 . F8 . F3-F7 KANIT OZETI - SIRF GOZLEMDIR, esik/PASS-FAIL ICAT ETMEZ.
 * F3-F7 kalibrasyon sayilari henuz saha olcumuyle belirlenmedi (kutuk #1232 vd.);
 * burada yalniz kayittaki SON ve TOPLAM deger basilir. Ilke ihlali denetimi
 * (replayFieldTrace, src/platform/devtools/navFieldTraceReplay.ts) AYRI ve
 * TEK otoritedir - burada YENIDEN UYGULANMAZ (ikinci kural motoru yok). */
console.log('');
console.log('-- NAV v3 . F3-F7 KANIT OZETI (F8) --');
if (last.ceh) {
  console.log(`  CEH son durum            : ${last.ceh.state}  .  belirsiz=${last.ceh.ambiguous}  .  bagli alan=${JSON.stringify(last.ceh.boundDomains)}`);
} else {
  console.log(`  CEH son durum            : ${NM} (bu kayitta hic olculmedi)`);
}
if (last.graph) {
  console.log(`  Graf sakinligi           : ${last.graph.state}  .  ${last.graph.nodeCount ?? NM} dugum / ${last.graph.edgeCount ?? NM} kenar`);
} else {
  console.log(`  Graf sakinligi           : ${NM}`);
}
if (last.roadCorridor) {
  const truncSamples = S.filter(s => s.roadCorridor?.lastCorridorTruncated === true).length;
  console.log(`  Koridor son hukum        : ${last.roadCorridor.lastCorridorOutcome ?? NM}  .  KESILDI gorulen ornek: ${truncSamples}`);
} else {
  console.log(`  Koridor son hukum        : ${NM}`);
}
if (last.enforcement) {
  const e = last.enforcement;
  console.log(`  Denetim eslestirme (toplam) : bagli=${e.matchedToEdge} . belirsiz=${e.ambiguousEdge} . kapsam disi=${e.outsideCoverage} . olculmedi=${e.notMeasured}`);
} else {
  console.log(`  Denetim eslestirme       : ${NM}`);
}
if (last.shadow) {
  console.log(`  Golge fark orani         : ${last.shadow.divergenceRatio == null ? NM : (last.shadow.divergenceRatio * 100).toFixed(1) + '%'}  .  cutover=${last.shadow.cutoverState}`);
} else {
  console.log(`  Golge fark orani         : ${NM}`);
}
if (last.rationale) {
  console.log(`  Rota gerekcesi (son)     : ${last.rationale.lastFactor ?? NM}  .  toplam karar=${last.rationale.decisions}  .  en buyuk takas=${last.rationale.maxDurationPenaltyS == null ? NM : last.rationale.maxDurationPenaltyS + ' s'}`);
  const unknownCount = S.filter(s => s.rationale?.lastFactor === 'UNKNOWN').length;
  if (unknownCount > 0) {
    console.log(`  UYARI: "aciklanamadi" (UNKNOWN) ${unknownCount} ornekte gorundu - #1271 kabul olcutu bunun SIFIR olmasidir.`);
  }
} else {
  console.log(`  Rota gerekcesi           : ${NM}`);
}
if (last.perf) {
  console.log(`  Sicak-yol maliyeti       : eslestirme p95=${last.perf.mapMatchP95Ms ?? NM} ms  .  tick p95=${last.perf.progressP95Ms ?? NM} ms`);
} else {
  console.log(`  Sicak-yol maliyeti       : ${NM}`);
}
console.log('  Ilke denetimi (ambiguous/truncated/direction/rationale tutarliligi)');
console.log("  ICIN: disa aktarilan trace'i replayFieldTrace()e verin (vitest, TEK otorite).");

console.log('\n' + '═'.repeat(72));
console.log('NOT: "NOT_RUN" = o senaryo bu kayıtta YAŞANMADI. Kanıtsız PASS yazılmaz.');
console.log('═'.repeat(72));
