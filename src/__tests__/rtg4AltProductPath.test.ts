/**
 * RTG4 ALT — ÜRÜN YOLU BÜTÜNLÜĞÜ.
 *
 * ALT bir OPTİMİZASYON KANITIDIR; ürün yoluna girerken tek kural şudur:
 * **yarım ya da uyumsuz kanıt asla tüketilmez.** Bu dosya o kuralı kilitler:
 *   · manifest ALT iddia ediyorsa iddia TAM olmalı (yoksa manifest reddedilir),
 *   · dilim kimliği graf sürümüne SIKI bağlı (landmark seti · ölçek · düğüm sayısı),
 *   · ALT baytı graf bütçesine KARIŞTIRILMAZ (ayrı sayaç),
 *   · ALT istenmedikçe dilim indirilmez (kısa rota bedel ödemez),
 *   · ikinci residency/route otoritesi kurulmaz.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateTurkeyGraphManifest } from '../platform/navigation/map/graph/turkeyGraphManifest';

const RESIDENCY = resolve(__dirname, '../platform/navigation/map/graph/graphResidencyRuntime.ts');
const ROUTING = resolve(__dirname, '../platform/offlineRoutingService.ts');
const WORKER = resolve(__dirname, '../platform/navigation/NavigationCompute.worker.ts');

const HEX = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64);

/** ALT taşıyabilen en yalın geçerli manifest (RTG3 şeması: portal/bileşen istemez). */
function baseManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    datasetId: 'osm-tr-test',
    country: 'TR',
    source: 'test',
    sourceTimestamp: '2026-09-08T00:00:00.000Z',
    buildTimestamp: '2026-09-08T00:00:00.000Z',
    policyVersion: 'test-policy',
    graphFormat: 'RTG3',
    regions: [
      { regionId: 'r-1', bbox: [30, 40, 31, 41], graphFile: 'regions/r-1.rtg3',
        sha256: HEX(1), byteSize: 1024, nodeCount: 10, edgeCount: 12,
        neighbors: ['r-2'], sourceHash: HEX(9) },
      { regionId: 'r-2', bbox: [31, 40, 32, 41], graphFile: 'regions/r-2.rtg3',
        sha256: HEX(2), byteSize: 2048, nodeCount: 20, edgeCount: 24,
        neighbors: ['r-1'], sourceHash: HEX(9) },
    ],
  };
}

function altSet(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    landmarkSetId: 'set-abc',
    landmarkCount: 8,
    scaleM: 50,
    unreachableBucket: 65535,
    metric: 'ONEWAY_ONLY_BASE_COST_M',
    selection: 'BACKBONE_CONSTRAINED_FARTHEST_POINT_REACHABILITY_VERIFIED',
    buildTimestamp: '2026-09-08T00:00:00.000Z',
    landmarks: Array.from({ length: 8 }, (_v, i) => ({
      index: i, nodeId: String(1000 + i), lat: 39 + i * 0.1, lon: 32 + i * 0.1,
    })),
    ...over,
  };
}

/** Dilim baytı TEK doğru değerdir: 24 B başlık + düğüm × landmark × 4 B. */
function altSlice(nodeCount: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    file: 'regions/r.alt',
    sha256: HEX(3),
    byteSize: 24 + nodeCount * 8 * 4,
    landmarkSetId: 'set-abc',
    landmarkCount: 8,
    scaleM: 50,
    unreachableBucket: 65535,
    nodeCount,
    encoding: 'UINT16_LE_PER_NODE_LANDMARK_PAIR',
    ...over,
  };
}

function withAlt(
  setOver: Record<string, unknown> = {}, sliceOver: Record<string, unknown> = {},
): Record<string, unknown> {
  const manifest = baseManifest();
  manifest.altLandmarkSet = altSet(setOver);
  manifest.regions = (manifest.regions as Record<string, unknown>[]).map((region) => ({
    ...region,
    alt: altSlice(region.nodeCount as number, sliceOver),
  }));
  return manifest;
}

describe('RTG4 ALT — ürün yolu bütünlüğü', () => {
  it('ALT YOKKEN manifest geçerlidir (ALT opsiyoneldir, rota yine çıkar)', () => {
    const manifest = validateTurkeyGraphManifest(baseManifest());
    expect(manifest).not.toBeNull();
    expect(manifest!.altLandmarkSet).toBeUndefined();
    expect(manifest!.regions.every((region) => region.alt === undefined)).toBe(true);
  });

  it('TAM ve tutarlı ALT kanıtı kabul edilir', () => {
    const manifest = validateTurkeyGraphManifest(withAlt());
    expect(manifest).not.toBeNull();
    expect(manifest!.altLandmarkSet?.landmarkSetId).toBe('set-abc');
    expect(manifest!.regions[0].alt?.byteSize).toBe(24 + 10 * 8 * 4);
  });

  /* ── P13 · BÜTÜNLÜK KORPUSU — her biri manifestin TAMAMINI reddettirir ── */

  it('🔒 dilim VAR ama landmark seti YOK → manifest reddedilir', () => {
    const manifest = withAlt();
    delete manifest.altLandmarkSet;
    expect(validateTurkeyGraphManifest(manifest)).toBeNull();
  });

  it('🔒 landmark seti VAR ama dilim kimliği başka sete ait → reddedilir', () => {
    expect(validateTurkeyGraphManifest(withAlt({}, { landmarkSetId: 'set-other' }))).toBeNull();
  });

  it('🔒 landmark sayısı / ölçek / unreachable uyuşmazlığı → reddedilir', () => {
    expect(validateTurkeyGraphManifest(withAlt({}, { landmarkCount: 16 }))).toBeNull();
    expect(validateTurkeyGraphManifest(withAlt({}, { scaleM: 25 }))).toBeNull();
    expect(validateTurkeyGraphManifest(withAlt({}, { unreachableBucket: 4095 }))).toBeNull();
  });

  it('🔒 dilim düğüm sayısı bölge düğüm sayısıyla tutmuyorsa → reddedilir', () => {
    const manifest = withAlt();
    (manifest.regions as Record<string, unknown>[])[0].alt = altSlice(10, { nodeCount: 11 });
    expect(validateTurkeyGraphManifest(manifest)).toBeNull();
  });

  it('🔒 dilim baytı beklenen boyutta değilse → reddedilir (kırpılmış/şişmiş dosya)', () => {
    expect(validateTurkeyGraphManifest(withAlt({}, { byteSize: 999 }))).toBeNull();
  });

  it('🔒 bilinmeyen kodlama / şema / SHA biçimi → reddedilir', () => {
    expect(validateTurkeyGraphManifest(withAlt({}, { encoding: 'RAW_FLOAT64' }))).toBeNull();
    expect(validateTurkeyGraphManifest(withAlt({}, { schemaVersion: 2 }))).toBeNull();
    expect(validateTurkeyGraphManifest(withAlt({}, { sha256: 'kısa' }))).toBeNull();
  });

  it('🔒 landmark seti kendi içinde tutarsızsa → reddedilir', () => {
    expect(validateTurkeyGraphManifest(withAlt({ landmarkCount: 9 }))).toBeNull();      // liste 8
    expect(validateTurkeyGraphManifest(withAlt({ metric: 'EUCLIDEAN' }))).toBeNull();
    expect(validateTurkeyGraphManifest(withAlt({ selection: 'RANDOM' }))).toBeNull();
    const duplicated = altSet();
    (duplicated.landmarks as Record<string, unknown>[])[1].index = 0;
    expect(validateTurkeyGraphManifest(withAlt(duplicated))).toBeNull();
  });

  /* ── Çalışma zamanı sözleşmesi (kaynak kilitleri) ──────────────────────── */

  it('🔒 ALT baytı GRAF bütçesine karışmaz — ayrı sayaç, ayrı tavan yok', () => {
    const residency = readFileSync(RESIDENCY, 'utf8');
    /* Graf tavanları DEĞİŞMEDİ. */
    expect(residency).toContain('REGIONAL_GRAPH_MAX_BYTES = 64 * 1024 * 1024');
    expect(residency).toContain('REGIONAL_GRAPH_MAX_RESIDENT = 3');
    /* ALT ayrı ölçülür. */
    expect(residency).toContain('altResidentBytes');
    expect(residency).toContain('altPeakResidentBytes');
    /* Graf bütçesi kontrolü ALT baytını İÇERMEZ. */
    expect(residency).toContain('if (graphBytes > REGIONAL_GRAPH_MAX_BYTES)');
    expect(residency).not.toMatch(/graphBytes \+ alt[A-Za-z]*Bytes/);
  });

  it('🔒 ALT dilimi bölgenin ÖMRÜNE bağlıdır (tahliyede düşer, Zero-Leak)', () => {
    const residency = readFileSync(RESIDENCY, 'utf8');
    expect(residency).toContain('_altSliceCache.delete(id); _altSliceEvictions++;');
    expect(residency).toContain('_altSliceCache.clear();');
  });

  it('🔒 ALT istenmedikçe dilim İNDİRİLMEZ (kısa rota bedel ödemez)', () => {
    const residency = readFileSync(RESIDENCY, 'utf8');
    expect(residency).toContain("_altUnavailableReason = 'ALT_NOT_REQUESTED'");
    const routing = readFileSync(ROUTING, 'utf8');
    expect(routing).toContain('{ alt: altTarget !== null }');
    /* Hedef satırı yalnız ÇOK PENCERELİ rotada çözülür. */
    expect(routing).toContain('envelope.windows.length > 1');
  });

  it('🔒 dilim doğrulaması TAMDIR — kısmi veri tüketilmez', () => {
    const residency = readFileSync(RESIDENCY, 'utf8');
    for (const reason of [
      'ALT_SLICE_ABSENT', 'ALT_SIZE_MISMATCH', 'ALT_SHA_MISMATCH',
      'ALT_HEADER_MISMATCH', 'ALT_BODY_TRUNCATED', 'ALT_FETCH_FAILED',
    ]) expect(residency).toContain(reason);
  });

  it('🔒 ikinci residency/route otoritesi kurulmadı', () => {
    const residency = readFileSync(RESIDENCY, 'utf8');
    expect(residency.match(/export async function acquireRegionWindow\(/g)).toHaveLength(1);
    expect(residency.match(/export async function resolveAltTargetRow\(/g)).toHaveLength(1);
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker.match(/function routeRtg3EdgeState\(/g)).toHaveLength(1);
    /* Worker bölge/dilim İNDİRMEZ: sakinlik kararı residency authority'dedir. */
    expect(worker).not.toContain('acquireRegionWindow');
    expect(worker).not.toContain('_fetchAltSlice');
  });

  it('🔒 ALT yokken bütçe BÜYÜTÜLMEZ — fail-closed hükmü aynı kalır', () => {
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain('if (!mem || mem <= 1) return 30_000;');
    expect(worker).toContain('return 200_000;');
    /* ALT'nin yokluğu tavanı değiştiren bir dal AÇMAZ. */
    expect(worker).not.toMatch(/alt[A-Za-z]*\s*[?:][^\n]*MAX_CLOSED/);
  });

  /**
   * DAĞITIM SINIRI — ülke çapı ALT ~700 MB'tır (8 landmark). Bunu uygulama
   * paketine koymak APK'yı kullanılamaz hâle getirir. ALT dilimi, RTG4 bölge
   * grafıyla AYNI kanaldan (bölgesel, talep üzerine) gelir; ayrı bir güncelleme
   * sistemi icat EDİLMEZ. Bu kilit, dilimlerin kazara pakete girmesini yakalar.
   */
  it('🔒 nationwide ALT/RTG4 uygulama paketine GİRMEZ (bölgesel dağıtım)', () => {
    const mapsDir = resolve(__dirname, '../../public/maps');
    const entries = readdirSync(mapsDir);
    expect(entries.filter((name) => name.endsWith('.alt'))).toEqual([]);
    expect(entries.filter((name) => name.endsWith('.rtg4'))).toEqual([]);
    expect(entries.includes('regions')).toBe(false);
    /* Üretim grafı TEK parça ve DEĞİŞMEDİ. */
    expect(entries).toContain('routing-graph.bin');
    /* Depo politikası: üretilen dev artefaktlar sürüm kontrolüne girmez. */
    const gitignore = readFileSync(resolve(__dirname, '../../.gitignore'), 'utf8');
    expect(gitignore).toContain('field-runs/**/*.alt');
    expect(gitignore).toContain('field-runs/**/*.rtg4');
  });

  it('🔒 mod (ALT/GEOMETRIC) gözlemlenebilir ve kanıta bağlı', () => {
    const routing = readFileSync(ROUTING, 'utf8');
    expect(routing).toContain('getCrossRegionSearchSnapshot');
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain('altActive: session.altK > 0 && session.altWindow !== null ? 1 : 0');
    expect(worker).toContain('const altReady = multiWindow && _altEvidenceIsUsable(msg);');
  });
});
