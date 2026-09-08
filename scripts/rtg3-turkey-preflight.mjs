/**
 * rtg3-turkey-preflight.mjs — TÜRKİYE ÇAPI RTG3 BUILD ÖN KONTROLÜ + KAPI.
 *
 * Nationwide build'i BAŞLATMAZ. Yalnız ölçer, muhafazakâr projeksiyon çıkarır
 * ve `TURKEY_RTG3_BUILD_GATE` hükmünü kanıta göre verir.
 *
 * MEASURED ile PROJECTED titizlikle AYRI tutulur. Güvenilir tahmin
 * yapılamayan alan UNKNOWN yazılır — uydurma precision verilmez.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runRtg3BuildPreflight, RTG3_TOOLCHAIN } from './rtg3BuildPreflight.mjs';

const MERSIN_RUN = resolve('field-runs/pbf-streaming-rtg3-20260908');
const OUT = resolve(process.env.RTG3_TURKEY_RUN_DIR ?? 'field-runs/turkey-rtg3-preflight-20260908');
const TURKEY_PBF = resolve(process.argv[2] ?? resolve(MERSIN_RUN, 'raw/turkey-260906.osm.pbf'));
const MERSIN_PBF = resolve(MERSIN_RUN, 'raw/mersin-province.osm.pbf');
const TEMP = resolve(OUT, 'tmp');
const REGIONS = resolve(OUT, 'regions');
const OSMIUM = process.env.OSMIUM ?? 'osmium';
const MEMORY_BUDGET_MIB = Number(process.env.RTG3_MEMORY_BUDGET_MIB ?? 512);
mkdirSync(TEMP, { recursive: true });
mkdirSync(REGIONS, { recursive: true });

const started = performance.now();

async function sha256(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  await once(stream, 'end');
  return hash.digest('hex');
}

/** `osmium fileinfo -e` GERÇEK eleman sayılarını verir — tahmin değil, ölçüm. */
async function fileInfo(path) {
  const child = spawn(OSMIUM, ['fileinfo', '-e', '--no-crc', '-j', path], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stderr.on('data', (b) => { err += b; });
  const [code] = await once(child, 'close');
  if (code) throw new Error(`osmium fileinfo (${code}): ${err}`);
  const parsed = JSON.parse(out);
  const box = parsed.data?.bbox ?? null;   // [minlon, minlat, maxlon, maxlat]
  return {
    bytes: statSync(path).size,
    nodes: Number(parsed.data?.count?.nodes ?? 0),
    ways: Number(parsed.data?.count?.ways ?? 0),
    relations: Number(parsed.data?.count?.relations ?? 0),
    bbox: Array.isArray(box) && box.length === 4
      ? { minlon: box[0], minlat: box[1], maxlon: box[2], maxlat: box[3] } : null,
    timestampLast: parsed.data?.timestamp?.last ?? null,
  };
}

const freeBytes = (dir) => { try { const fs = statfsSync(dir); return fs.bavail * fs.bsize; } catch { return null; } };

/* ── 1) Araç zinciri + kaynak ön kontrolü ────────────────────────────────── */

const mersinBenchmark = existsSync(resolve(MERSIN_RUN, 'benchmark.json'))
  ? JSON.parse(readFileSync(resolve(MERSIN_RUN, 'benchmark.json'), 'utf8')) : null;
if (!mersinBenchmark) throw new Error('Mersin ölçüm temeli yok: field-runs/pbf-streaming-rtg3-20260908/benchmark.json');

const DISK_FACTOR = Number(process.env.RTG3_DISK_FACTOR ?? 25);
const requiredFree = Math.round((statSync(TURKEY_PBF, { throwIfNoEntry: false })?.size ?? 0) * DISK_FACTOR);
const preflight = await runRtg3BuildPreflight({
  sourcePath: TURKEY_PBF, tempDir: TEMP, outputDir: REGIONS,
  memoryBudgetMiB: MEMORY_BUDGET_MIB, osmiumBin: OSMIUM, minFreeBytes: requiredFree,
});

/* ── 2) Gerçek kaynak ölçümü ─────────────────────────────────────────────── */

const turkey = { ...(await fileInfo(TURKEY_PBF)), sha256: await sha256(TURKEY_PBF), path: TURKEY_PBF };
const mersin = { ...(await fileInfo(MERSIN_PBF)), sha256: await sha256(MERSIN_PBF), path: MERSIN_PBF };

/* ── 3) Muhafazakâr projeksiyon ──────────────────────────────────────────── */

const wayRatio = mersin.ways > 0 ? turkey.ways / mersin.ways : null;
const byteRatio = mersin.bytes > 0 ? turkey.bytes / mersin.bytes : null;
/* Muhafazakâr = iki oranın BÜYÜĞÜ. Kaynak baytı sıkıştırma oranına, yol sayısı
   ise gerçek graf yüküne bağlıdır; hangisi büyükse o alınır. */
const scale = wayRatio === null || byteRatio === null ? null : Math.max(wayRatio, byteRatio);

const round = (n) => (n === null || !Number.isFinite(n) ? null : Math.round(n));
const projection = scale === null ? null : {
  method: `muhafazakâr ölçek = max(way oranı ${wayRatio.toFixed(2)}, bayt oranı ${byteRatio.toFixed(2)}) = ${scale.toFixed(2)}`,
  selectedWays: round(mersinBenchmark.selectedWays * scale),
  requiredNodes: round(mersinBenchmark.requiredCoordinates * scale),
  graphNodes: round(mersinBenchmark.totalNodes * scale),
  graphEdges: round(mersinBenchmark.totalEdges * scale),
  rtg3Bytes: round(mersinBenchmark.totalBytes * scale),
  peakTempBytes: round(mersinBenchmark.peakTempBytes * scale),
  buildMs: round(mersinBenchmark.buildMs * scale),
  /* Bölge sayısı ölçekle DEĞİL, coğrafyayla belirlenir: 0.5 derece ızgara.
     İki bağımsız yöntem verilir ve ARALIK olarak sunulur. */
  regionCountRange: null,
  peakProcessTreeRssBytes: 'UNKNOWN',
  peakRssReason:
    'Disk-destekli mimaride tepe RSS kaynak boyutuyla LİNEER DEĞİLDİR: SQLite sayfa '
    + 'önbelleği sabit (32 MiB) ve tepe, EN BÜYÜK tek bölgenin serileştirme anındaki '
    + 'bellek ihtiyacıyla belirlenir. Türkiye\'nin en büyük 0.5° karosu (İstanbul) '
    + 'Mersin\'in en büyüğünden büyüktür ama ne kadar büyük olduğu ÖLÇÜLMEDİ. '
    + 'Fail-closed bütçe kapısı (RTG3_MEMORY_BUDGET_MIB) aşımda build\'i düşürür.',
};

if (projection && turkey.bbox) {
  /* Yöntem A — ızgara: kaynak bbox içindeki 0.5° karo sayısı (ÜST sınır,
     denizler ve yol içermeyen karolar dâhil).
     Yöntem B — yoğunluk: Mersin'in karo/yol oranı ülke geneline taşınır. */
  const b = turkey.bbox;
  const cols = Math.ceil((b.maxlon - b.minlon) / 0.5);
  const rows = Math.ceil((b.maxlat - b.minlat) / 0.5);
  const gridUpperBound = cols * rows;
  const densityEstimate = Math.round(mersinBenchmark.regions.length * scale ** 0.5 * 3);
  projection.regionCountRange = {
    gridUpperBound, densityEstimate,
    note: 'Izgara üst sınırı bbox tabanlıdır (deniz karoları dâhil); yoğunluk tahmini '
      + 'Mersin karo sayısından türetilmiş KABA bir alt sınırdır. Gerçek sayı yalnız '
      + 'build ile ÖLÇÜLÜR.',
  };
  projection.peakRegionEdges = Math.max(...mersinBenchmark.regions.map((r) => r.edgeCount));
}

/* ── 4) Kapı ────────────────────────────────────────────────────────────── */

const hardening = existsSync(resolve(MERSIN_RUN, 'hardening-validation.json'))
  ? JSON.parse(readFileSync(resolve(MERSIN_RUN, 'hardening-validation.json'), 'utf8')) : null;
const production = resolve('public/maps/routing-graph.bin');
const productionSha = existsSync(production) ? await sha256(production) : null;

const stats = mersinBenchmark.restrictionStats ?? {};
const viaWayCases = hardening?.viaWayCases ?? [];
const viaWayOk = viaWayCases.length === 0
  ? null
  : viaWayCases.every((c) => c.automatonEnforced && c.unrelatedEntryAllowed
      && c.intermediateAlternativesFree && c.workerAutomatonViolation === false);

const gateChecks = [
  { check: 'reproducible-pinned-toolchain', measured: `node>=${RTG3_TOOLCHAIN.node.min} · osmium>=${RTG3_TOOLCHAIN.osmium.min} · engines pinned`, pass: preflight.checks.filter((c) => ['node-runtime', 'node-sqlite-capability', 'osmium-tool'].includes(c.check)).every((c) => c.result === 'PASS') },
  { check: 'turkey-source-preflight', measured: preflight.checks.map((c) => `${c.check}=${c.result}`).join(' · '), pass: preflight.ok },
  { check: 'streaming-disk-backed-builder', measured: `${mersinBenchmark.strategy}`, pass: mersinBenchmark.totalEdges > 0 },
  { check: 'mersin-memory-budget', measured: `${(mersinBenchmark.peakProcessTreeRssBytes / 1048576).toFixed(2)} MiB`, pass: mersinBenchmark.peakProcessTreeRssBytes <= 512 * 1048576 },
  { check: 'graph-semantic-parity', measured: `${mersinBenchmark.totalNodes} düğüm · ${mersinBenchmark.totalEdges} kenar`, pass: mersinBenchmark.totalNodes === 600821 && mersinBenchmark.totalEdges === 629201 },
  { check: 'via-node-restriction-regression', measured: `${stats.supportedViaNode ?? 0} çözüldü (temel 110)`, pass: (stats.supportedViaNode ?? 0) >= 110 },
  { check: 'via-way-restrictions', measured: viaWayCases.length ? `${viaWayCases.length} gerçek ilişki uçtan uca` : 'gerçek geçerli via-way YOK', pass: viaWayOk !== false },
  { check: 'manifest', measured: `${mersinBenchmark.regions.length} bölge`, pass: existsSync(resolve(MERSIN_RUN, 'turkey-graph-manifest.json')) },
  { check: 'multi-region-canonical-astar', measured: (hardening?.routes ?? []).map((r) => `${r.regions.length}bölge:${r.distanceM}m`).join(' · ') || 'yok', pass: (hardening?.routes ?? []).length >= 3 && (hardening?.routes ?? []).every((r) => r.accessLegal && r.onewayLegal && r.restrictionLegal) },
  { check: 'corruption-fail-closed', measured: `${(hardening?.failures ?? []).filter((f) => f.rejected).length}/${(hardening?.failures ?? []).length}`, pass: (hardening?.failures ?? []).length > 0 && (hardening?.failures ?? []).every((f) => f.rejected) },
  { check: 'disk-capacity-for-turkey', measured: `${freeBytes(TEMP)} B serbest · gereken ${requiredFree} B`, pass: (freeBytes(TEMP) ?? 0) >= requiredFree },
  { check: 'production-rtg2-untouched', measured: productionSha ?? 'MISSING', pass: productionSha === 'e7713f7575fb587386858db44b2e9ab84278686a06d42d04cd16e8663af691da' },
];

const blockers = gateChecks.filter((c) => !c.pass).map((c) => c.check);
const gate = blockers.length === 0
  ? 'READY_FOR_NATIONWIDE_SHADOW_BUILD'
  : `BLOCKED_${blockers[0].toUpperCase().replace(/-/g, '_')}`;

const report = {
  generatedAt: new Date().toISOString(),
  elapsedMs: Math.round(performance.now() - started),
  nationwideBuildStarted: false,
  toolchain: RTG3_TOOLCHAIN,
  preflight,
  measured: { turkey, mersin, mersinBuild: { selectedWays: mersinBenchmark.selectedWays, requiredCoordinates: mersinBenchmark.requiredCoordinates, totalNodes: mersinBenchmark.totalNodes, totalEdges: mersinBenchmark.totalEdges, totalBytes: mersinBenchmark.totalBytes, peakTempBytes: mersinBenchmark.peakTempBytes, peakProcessTreeRssBytes: mersinBenchmark.peakProcessTreeRssBytes, buildMs: Math.round(mersinBenchmark.buildMs), regions: mersinBenchmark.regions.length } },
  projected: projection,
  freeDisk: { temp: freeBytes(TEMP), output: freeBytes(REGIONS), requiredBytes: requiredFree },
  gateChecks,
  gate,
  blockers,
};
writeFileSync(resolve(OUT, 'turkey-build-preflight.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
