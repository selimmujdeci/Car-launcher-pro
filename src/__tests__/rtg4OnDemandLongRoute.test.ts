/**
 * RTG4 — SINIRLI SAKİNLİKLE TALEP ÜZERİNE UZUN ROTA.
 *
 * Bu dosya, koridoru tek seferde belleğe SIĞMAYAN bir rotanın kanonik kenar
 * durumlu A* ile çözülebildiğini ve her adımda residency bütçesinin korunduğunu
 * kilitler. Kilitlenen davranışlar:
 *   · pencere sırası yönlü Portal v2 kanıtından gelir (koridor rota DEĞİLDİR),
 *   · aynı mantıksal arama pencereler arasında DEVAM eder (dikiş yok),
 *   · `previousEdge` ve via-way durumu sınırdan sağ çıkar,
 *   · tahliye edilmiş bölgeye ait rota parçası yine de yeniden kurulabilir,
 *   · her arıza fail-closed'dır — UYDURMA rota üretilmez.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  RTG4_MAGIC, parseRoutingGraph, remapViaWayMask, stableDirectedEdgeId,
  RTG3_VIA_WAY_FLAG, RTG3_VIA_WAY_FINAL, viaWayStep,
  type RoutingGraphView,
} from '../platform/navigation/map/graph/rtg2Reader';
import {
  planCrossRegionSearchEnvelope, mergeRegionalGraphWindow, validateTurkeyGraphManifest,
  REGION_WINDOW_NO_LOCAL,
} from '../platform/navigation/map/graph/turkeyGraphManifest';
import {
  acquireRegionWindow, releaseRegionWindow, getGraphResidencySnapshot,
  _resetGraphResidencyForTest,
  REGIONAL_GRAPH_MAX_BYTES, REGIONAL_GRAPH_MAX_RESIDENT,
} from '../platform/navigation/map/graph/graphResidencyRuntime';

/* ══════════════════════════════════════════════════════════════════════════
   FİKSTÜR — doğrusal bölge zinciri, komşu bölgeler ORTAK OSM düğümü paylaşır
   ══════════════════════════════════════════════════════════════════════════ */

const HEX64 = (seed: number) => seed.toString(16).padStart(2, '0').repeat(32).slice(0, 64);

interface RegionFixture {
  regionId: string;
  bytes: ArrayBuffer;
  view: RoutingGraphView;
  nodeIds: bigint[];
  lat: number[];
  lon: number[];
  bbox: [number, number, number, number];
}

/** Bölge grafı: 4 düğüm, 3 çift yönlü kenar; son düğüm SONRAKİ bölgeyle ortak. */
function buildRegionBytes(index: number): { bytes: ArrayBuffer; nodeIds: bigint[]; lat: number[]; lon: number[] } {
  const nodeIds = [0, 1, 2, 3].map((j) => BigInt(1000 + index * 3 + j));
  const lat = [0, 1, 2, 3].map(() => 40);
  const lon = [0, 1, 2, 3].map((j) => 30 + index * 0.3 + j * 0.1);
  const edges = [[0, 1], [1, 2], [2, 3]];
  const size = 16 + nodeIds.length * 16 + edges.length * 28;
  const buffer = new ArrayBuffer(size), view = new DataView(buffer);
  let o = 0;
  view.setUint32(o, RTG4_MAGIC, true); o += 4;
  view.setUint32(o, nodeIds.length, true); o += 4;
  view.setUint32(o, edges.length, true); o += 4;
  view.setUint32(o, 0, true); o += 4;                       // restrictionCount
  for (let i = 0; i < nodeIds.length; i++) {
    view.setFloat32(o, lat[i], true); view.setFloat32(o + 4, lon[i], true);
    view.setBigUint64(o + 8, nodeIds[i], true); o += 16;
  }
  for (const [from, to] of edges) {
    view.setUint32(o, from, true); view.setUint32(o + 4, to, true);
    view.setUint32(o + 8, 1000, true);                      // costM
    view.setBigUint64(o + 12, BigInt(9000 + index * 10 + from), true);   // wayId
    view.setUint8(o + 20, 3);                               // roadClass primary
    view.setUint8(o + 21, 1);                               // accessRole ordinary
    view.setUint8(o + 22, 0);                               // direction: çift yönlü
    view.setUint8(o + 23, 0); view.setInt8(o + 24, 0); o += 28;
  }
  return { bytes: buffer, nodeIds, lat, lon };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildCorridorFixture(regionCount: number) {
  const regions: RegionFixture[] = [];
  for (let i = 0; i < regionCount; i++) {
    const { bytes, nodeIds, lat, lon } = buildRegionBytes(i);
    const parsed = parseRoutingGraph(bytes);
    expect(parsed.outcome, parsed.detail).toBe('OK');
    regions.push({
      regionId: `tr-40-${String(i).padStart(2, '0')}`,
      bytes, view: parsed.view!, nodeIds, lat, lon,
      bbox: [lon[0] - 0.05, 39.5, lon[3] + 0.05, 40.5],
    });
  }

  const portals: Record<string, unknown>[] = [];
  for (let i = 0; i + 1 < regionCount; i++) {
    const source = regions[i], destination = regions[i + 1];
    const incidentEdgeId = stableDirectedEdgeId(source.view, 2)!;
    for (const direction of ['FORWARD', 'REVERSE'] as const) {
      const forward = direction === 'FORWARD';
      portals.push({
        portalId: `p2:${(i * 2 + (forward ? 0 : 1)).toString(16).padStart(64, '0')}`,
        portalNodeId: String(forward ? destination.nodeIds[0] : source.nodeIds[2]),
        sourceRegionId: forward ? source.regionId : destination.regionId,
        destinationRegionId: forward ? destination.regionId : source.regionId,
        sourceComponentId: `${forward ? source.regionId : destination.regionId}:${forward ? source.nodeIds[0] : destination.nodeIds[0]}`,
        destinationComponentId: `${forward ? destination.regionId : source.regionId}:${forward ? destination.nodeIds[0] : source.nodeIds[0]}`,
        traversalDirection: direction,
        accessRole: 1,
        incidentEdgeId,
        sourceNodeId: String(forward ? source.nodeIds[2] : destination.nodeIds[1]),
        destinationNodeId: String(forward ? destination.nodeIds[0] : source.nodeIds[2]),
        provenance: 'OSM_DIRECTED_EDGE_TILE_CROSSING',
        sourceHash: HEX64(1),
      });
    }
  }

  const manifest = {
    schemaVersion: 2, datasetId: 'fixture-rtg4', country: 'TR', source: 'fixture',
    sourceTimestamp: '2026-09-08T00:00:00Z', buildTimestamp: '2026-09-08T00:00:00Z',
    policyVersion: 'test', graphFormat: 'RTG4', portalSchemaVersion: 2, portals,
    neighborAudit: {
      total: regionCount - 1, ROUTABLE: regionCount - 1, NON_ROUTABLE: 0, INVALID: 0, AMBIGUOUS: 0,
      links: regions.slice(0, -1).map((region, i) => ({
        sourceRegionId: region.regionId, destinationRegionId: regions[i + 1].regionId,
        classification: 'ROUTABLE' as const,
      })),
    },
    regions: await Promise.all(regions.map(async (region, i) => ({
      regionId: region.regionId, bbox: region.bbox,
      graphFile: `regions/${region.regionId}.rtg4`,
      sha256: await sha256Hex(region.bytes),
      byteSize: region.bytes.byteLength,
      nodeCount: region.view.nodeCount, edgeCount: region.view.edgeCount,
      neighbors: [regions[i - 1]?.regionId, regions[i + 1]?.regionId].filter(Boolean) as string[],
      sourceHash: HEX64(1),
      components: {
        schemaVersion: 1 as const,
        file: `regions/${region.regionId}.components.json`, sha256: HEX64(2),
        byteSize: 128,
        indexFile: `regions/${region.regionId}.component-index.bin`, indexSha256: HEX64(3),
        indexByteSize: region.view.nodeCount * 4,
        indexEncoding: 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX' as const,
        count: 1, directedLinkCount: 0,
        portalComponentIds: [`${region.regionId}:${region.nodeIds[0]}`],
      },
    }))),
  };

  const byFile = new Map(regions.map((region) => [`regions/${region.regionId}.rtg4`, region.bytes]));
  return { regions, manifest, byFile };
}

/* ══════════════════════════════════════════════════════════════════════════
   TESTLER
   ══════════════════════════════════════════════════════════════════════════ */

describe('RTG4 bounded on-demand uzun rota', () => {
  let fixture: Awaited<ReturnType<typeof buildCorridorFixture>>;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    fixture = await buildCorridorFixture(8);
    _resetGraphResidencyForTest();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const key = String(input).replace(/^.*\/(regions\/[^/]+)$/, '$1');
      const bytes = fixture.byFile.get(key);
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(bytes);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    releaseRegionWindow();
    _resetGraphResidencyForTest();
  });

  it('fikstür manifesti kanonik doğrulayıcıdan geçer', () => {
    expect(validateTurkeyGraphManifest(fixture.manifest)).not.toBeNull();
  });

  /* ── P2 · ARAMA ZARFI ──────────────────────────────────────────────── */

  it('yönlü portal kanıtı uçtan uca koridoru ve örtüşen pencereleri üretir', () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    const origin: [number, number] = [40, fixture.regions[0].lon[0]];
    const destination: [number, number] = [40, fixture.regions[7].lon[3]];
    const envelope = planCrossRegionSearchEnvelope(manifest, origin, destination, 3)!;
    expect(envelope).not.toBeNull();
    expect(envelope.corridorRegionIds).toEqual(fixture.regions.map((r) => r.regionId));
    /* 8 bölge · 3'lük pencere → 6 pencere, her biri bir öncekiyle 2 bölge paylaşır. */
    expect(envelope.windows).toHaveLength(6);
    expect(envelope.windows[0]).toEqual(envelope.corridorRegionIds.slice(0, 3));
    for (let i = 1; i < envelope.windows.length; i++) {
      expect(envelope.windows[i].slice(0, 2)).toEqual(envelope.windows[i - 1].slice(1));
    }
    expect(envelope.transitions).toHaveLength(5);
    /* 🔒 Tetik pencerenin ÖNCÜ sınırında DEĞİL, bir SONRAKİ karo sınırındadır.
       Öncü sınırı hedeflemek sezgisel hedefi ~2,5 karo öteye taşıyor ve pencere
       başına taranan alanı büyütüyordu (ölçüldü: uzun rotada %30–65 fazla
       durum). Gereken graf zaten yerleşiktir → ek yükleme YOK. */
    expect(envelope.transitions[0].fromRegionId).toBe(envelope.windows[0][1]);
    expect(envelope.transitions[0].toRegionId).toBe(envelope.windows[0][2]);
    expect(envelope.transitions[0].portalNodeIds.length).toBeGreaterThan(0);
    /* Koridor alt sınırı: her geçişten sonra kalan yol alt sınırı AZALMALI
       (monoton) ve son geçişte hedefe uzaklığa inmeli. */
    for (let i = 1; i < envelope.transitions.length; i++) {
      expect(envelope.transitions[i].remainingLowerBoundM)
        .toBeLessThanOrEqual(envelope.transitions[i - 1].remainingLowerBoundM);
    }
    expect(envelope.transitions[0].boundaryBox).toHaveLength(4);
  });

  it('kapsam dışı hedef ve kanıtsız yön için fail-closed döner', () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    expect(planCrossRegionSearchEnvelope(manifest, [40, 30], [0, 0], 3)).toBeNull();
    expect(planCrossRegionSearchEnvelope(manifest, [40, 30], [40, 30], 0)).toBeNull();
  });

  it('portal koridoru rota geometrisi TAŞIMAZ (rota otoritesi değildir)', () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    const envelope = planCrossRegionSearchEnvelope(
      manifest, [40, fixture.regions[0].lon[0]], [40, fixture.regions[7].lon[3]], 3)!;
    const serialised = JSON.stringify(envelope);
    expect(serialised).not.toContain('geometry');
    expect(serialised).not.toContain('distanceM');
  });

  /* ── P4 · PENCERE KİMLİĞİ ──────────────────────────────────────────── */

  it('pencere kimlik tablosu bölge-yerel indeksi iki yönde KESİN eşler', () => {
    const window = mergeRegionalGraphWindow(
      fixture.regions.slice(0, 3).map((r) => r.view),
      fixture.regions.slice(0, 3).map((r) => r.regionId))!;
    expect(window).not.toBeNull();
    for (let slot = 0; slot < 3; slot++) {
      const view = fixture.regions[slot].view;
      for (let local = 0; local < view.nodeCount; local++) {
        const merged = window.identity.nodeLocalToMerged[slot][local];
        expect(window.identity.nodeMergedToLocal[slot][merged]).toBe(local);
        expect(window.view.nodeSourceId[merged]).toBe(view.nodeSourceId[local]);
      }
      for (let local = 0; local < view.edgeCount; local++) {
        const merged = window.identity.edgeLocalToMerged[slot][local];
        expect(window.identity.edgeMergedToLocal[slot][merged]).toBe(local);
      }
    }
  });

  it('örtüşen düğüm iki pencerede AYNI kararlı kimliğe çözülür', () => {
    const first = mergeRegionalGraphWindow(
      fixture.regions.slice(0, 3).map((r) => r.view),
      fixture.regions.slice(0, 3).map((r) => r.regionId))!;
    const second = mergeRegionalGraphWindow(
      fixture.regions.slice(1, 4).map((r) => r.view),
      fixture.regions.slice(1, 4).map((r) => r.regionId))!;
    /* R1 ilk pencerede yuva 1, ikincisinde yuva 0'dır; ordinal farklı olsa da
       bölge-yerel indeks üzerinden çeviri aynı OSM düğümüne varmalıdır. */
    for (let local = 0; local < fixture.regions[1].view.nodeCount; local++) {
      const a = first.identity.nodeLocalToMerged[1][local];
      const b = second.identity.nodeLocalToMerged[0][local];
      expect(first.view.nodeSourceId[a]).toBe(second.view.nodeSourceId[b]);
    }
  });

  it('pencerede olmayan bölge için merged→local NO_LOCAL kalır (sahte 0 yok)', () => {
    const window = mergeRegionalGraphWindow(
      [fixture.regions[0].view, fixture.regions[1].view],
      [fixture.regions[0].regionId, fixture.regions[1].regionId])!;
    /* R1'in ilk düğümü R0 ile ORTAKTIR; R0'ın son düğümü de aynıdır. Ama R1'in
       son düğümü R0'da YOKTUR → o pencere ordinali R0 yuvasında NO_LOCAL. */
    const onlyInSecond = window.identity.nodeLocalToMerged[1][3];
    expect(window.identity.nodeMergedToLocal[0][onlyInSecond]).toBe(REGION_WINDOW_NO_LOCAL);
  });

  /* ── P6 · BÜTÇE ────────────────────────────────────────────────────── */

  it('pencere sakinliği 3 bölge / 64 MiB tavanını aşamaz', async () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    const ok = await acquireRegionWindow(manifest, fixture.regions.slice(0, 3).map((r) => r.regionId), '/fixture');
    expect(ok).not.toBeNull();
    const snapshot = getGraphResidencySnapshot();
    expect(snapshot.residentRegions).toHaveLength(3);
    expect(snapshot.residentRegions.length).toBeLessThanOrEqual(REGIONAL_GRAPH_MAX_RESIDENT);
    expect(snapshot.residentGraphBytes).toBeLessThanOrEqual(REGIONAL_GRAPH_MAX_BYTES);

    const tooMany = await acquireRegionWindow(manifest, fixture.regions.slice(0, 4).map((r) => r.regionId), '/fixture');
    expect(tooMany).toBeNull();
    expect(getGraphResidencySnapshot().windowFailClosedReason).toBe('WINDOW_REGION_BUDGET');
  });

  it('sabitler DEĞİŞMEDİ — uzun rota tavanı yükselterek çözülmez', () => {
    expect(REGIONAL_GRAPH_MAX_RESIDENT).toBe(3);
    expect(REGIONAL_GRAPH_MAX_BYTES).toBe(64 * 1024 * 1024);
    /* Arama tavanı da yükseltilmedi: ülke korpusu bütçeyi BÜYÜTEREK değil,
       aramayı KÜÇÜLTEREK çözüldü. Cihaz kademeleri aynen duruyor. */
    const worker = readFileSync(
      resolve(__dirname, '../../src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    expect(worker).toContain('if (!mem || mem <= 1) return 30_000;');
    expect(worker).toContain('if (mem <= 2)         return 50_000;');
    expect(worker).toContain('if (mem <= 4)         return 100_000;');
    expect(worker).toContain('return 200_000;');
  });

  /* ── P3/P7 · TALEP ÜZERİNE YÜKLEME VE TAHLİYE ──────────────────────── */

  it('pencere kayarken KALAN bölge yeniden indirilmez, ÇIKAN bölge tahliye edilir', async () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    const ids = fixture.regions.map((r) => r.regionId);
    const first = await acquireRegionWindow(manifest, ids.slice(0, 3), '/fixture');
    expect(first?.loadedRegionIds).toEqual(ids.slice(0, 3));
    expect(first?.evictedRegionIds).toEqual([]);

    const second = await acquireRegionWindow(manifest, ids.slice(1, 4), '/fixture');
    expect(second?.loadedRegionIds).toEqual([ids[3]]);      // yalnız YENİ bölge indirildi
    expect(second?.evictedRegionIds).toEqual([ids[0]]);     // pencereden çıkan tahliye edildi

    const snapshot = getGraphResidencySnapshot();
    expect(snapshot.residentRegions).toEqual(ids.slice(1, 4));
    expect(snapshot.onDemandRegionLoads).toBe(4);
    expect(snapshot.regionEvictions).toBe(1);
  });

  it('eksik bölge dosyası rota UYDURMAZ — fail-closed', async () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    fixture.byFile.delete(`regions/${fixture.regions[1].regionId}.rtg4`);
    const result = await acquireRegionWindow(manifest, fixture.regions.slice(0, 3).map((r) => r.regionId), '/fixture');
    expect(result).toBeNull();
    expect(getGraphResidencySnapshot().windowFailClosedReason).toBe('WINDOW_REGION_LOAD');
  });

  it('SHA uyuşmazlığı fail-closed edilir', async () => {
    const manifest = validateTurkeyGraphManifest(fixture.manifest)!;
    const key = `regions/${fixture.regions[1].regionId}.rtg4`;
    const corrupted = fixture.byFile.get(key)!.slice(0);
    new Uint8Array(corrupted)[40] ^= 0xff;                   // içeriği boz (boyut AYNI kalır)
    fixture.byFile.set(key, corrupted);
    const result = await acquireRegionWindow(manifest, fixture.regions.slice(0, 3).map((r) => r.regionId), '/fixture');
    expect(result).toBeNull();
    expect(getGraphResidencySnapshot().windowFailClosedReason).toBe('WINDOW_REGION_LOAD');
    expect(getGraphResidencySnapshot().state).toBe('CORRUPT');
  });

  /* ── P8 · VIA-WAY DURUMU SINIRDAN SAĞ ÇIKAR ────────────────────────── */

  it('via-way maskesi pencere değişiminde YENİ yuva sırasına KESİN taşınır', () => {
    const types = [RTG3_VIA_WAY_FLAG | 1, RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | 1];
    const chain = (order: readonly number[], chainId: number): RoutingGraphView => {
      const edges = order.map((i) => [i, i + 1, BigInt(10 + i)] as const);
      const size = 16 + 4 * 16 + edges.length * 28 + 2 * 24;
      const buffer = new ArrayBuffer(size), view = new DataView(buffer); let o = 0;
      view.setUint32(o, RTG4_MAGIC, true); o += 4;
      view.setUint32(o, 4, true); o += 4;
      view.setUint32(o, edges.length, true); o += 4;
      view.setUint32(o, 2, true); o += 4;
      for (let i = 0; i < 4; i++) {
        view.setFloat32(o, 40, true); view.setFloat32(o + 4, 30 + i / 10, true);
        view.setBigUint64(o + 8, BigInt(2000 + i), true); o += 16;
      }
      for (const [from, to, way] of edges) {
        view.setUint32(o, from, true); view.setUint32(o + 4, to, true); view.setUint32(o + 8, 100, true);
        view.setBigUint64(o + 12, way, true); view.setUint8(o + 20, 3); view.setUint8(o + 21, 1);
        view.setUint8(o + 22, 1); view.setUint8(o + 23, 0); view.setInt8(o + 24, 0); o += 28;
      }
      const slotOf = (localFrom: number) => order.indexOf(localFrom);
      for (const [seq, from] of [[0, 0], [1, 1]] as const) {
        view.setUint32(o, slotOf(from), true);
        view.setUint32(o + 4, slotOf(from + 1), true);
        view.setUint32(o + 8, from + 1, true);
        view.setUint8(o + 12, types[seq]); view.setUint8(o + 13, seq);
        view.setUint16(o + 14, chainId, true);
        view.setBigUint64(o + 16, 900n, true); o += 24;
      }
      const parsed = parseRoutingGraph(buffer);
      expect(parsed.outcome, parsed.detail).toBe('OK');
      return parsed.view!;
    };

    const a = chain([0, 1, 2], 7);
    const b = chain([2, 0, 1], 3);          // aynı zincir, FARKLI ordinal düzeni
    const edgeOf = (viewA: RoutingGraphView, viewB: RoutingGraphView) => (edge: number) => {
      const id = stableDirectedEdgeId(viewA, edge);
      for (let i = 0; i < viewB.edgeCount; i++) if (stableDirectedEdgeId(viewB, i) === id) return i;
      return -1;
    };
    const nodeOf = (viewA: RoutingGraphView, viewB: RoutingGraphView) => (node: number) => {
      for (let i = 0; i < viewB.nodeCount; i++) if (viewB.nodeSourceId[i] === viewA.nodeSourceId[node]) return i;
      return -1;
    };

    const armed = viaWayStep(a, -1, 0, 0, 0);
    const active = viaWayStep(a, 0, armed, 1, 1);
    expect(active).toBeGreaterThan(0);
    const targetEdge = edgeOf(a, b)(1);
    const moved = remapViaWayMask(a, 1, active, b, targetEdge, edgeOf(a, b), nodeOf(a, b));
    expect(moved).not.toBeNull();
    /* Taşınan maske hedef pencerede AYNI kısıtı ifade etmeli: aynı devam
       kenarı `only_*` zorunluluğunu orada da uygulamalı. */
    const forbiddenHere = viaWayStep(a, 1, active, 2, 2);
    const forbiddenThere = viaWayStep(b, targetEdge, moved!, nodeOf(a, b)(2), edgeOf(a, b)(2));
    expect(forbiddenThere).toBe(forbiddenHere);
  });

  it('hedef pencerede karşılığı olmayan via-way durumu fail-closed olur', () => {
    const window = mergeRegionalGraphWindow(
      fixture.regions.slice(0, 2).map((r) => r.view),
      fixture.regions.slice(0, 2).map((r) => r.regionId))!;
    /* Fikstürde via-way kaydı YOKTUR; sıfırdan farklı bir maske asla
       "sorun değil" diye 0a düşürülmez — kaynak durumu tutarsızdır. */
    expect(remapViaWayMask(window.view, 0, 1, window.view, 0, (e) => e, (n) => n)).toBeNull();
    expect(remapViaWayMask(window.view, 0, 0, window.view, 0, (e) => e, (n) => n)).toBe(0);
  });

  /* ── P1 · TEK ROTA OTORİTESİ ───────────────────────────────────────── */

  it('🔒 kanonik A* TEK kalır — ikinci router/ikinci residency otoritesi yok', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    expect(worker.match(/function routeRtg3EdgeState\(/g)).toHaveLength(1);
    expect(worker).toContain('HEURISTIC_WEIGHT = 1.2');
    /* Uzun rota AYNI fonksiyondan geçer; ayrı bir uzun-rota araması yoktur. */
    expect(worker).toContain('routeRtg3EdgeState(graph, startIdx, goalIdx, session)');
    /* Worker bölge indirmez: sakinlik kararı residency authority'dedir. */
    expect(worker).not.toContain('acquireRegionWindow');

    const residency = readFileSync(
      resolve(root, 'src/platform/navigation/map/graph/graphResidencyRuntime.ts'), 'utf8');
    expect(residency).toContain('REGIONAL_GRAPH_MAX_RESIDENT = 3');
    expect(residency).toContain('REGIONAL_GRAPH_MAX_BYTES = 64 * 1024 * 1024');
  });

  it('🔒 arama uzayı azaltımı: koridor alt sınırı TEK sezgiseldir', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    /* Sezgisel tek yerde hesaplanır; ikinci bir "yakınlık tahmini" kurulamaz. */
    expect(worker.match(/function _crossRegionHeuristicM\(/g)).toHaveLength(1);
    expect(worker).toContain('distanceToBoxM(lat, lon, boxes[i])');
    /* Kuş uçuşuyla MAKSİMUM alınırsa gradyan kaybolur (ölçüldü) — geri gelmesin. */
    expect(worker).not.toContain('Math.max(direct, distanceToBoxM');
  });

  /**
   * KİLİT GÜNCELLENDİ (kaldırılmadı) — eski kilit "ürün ağırlığı 1,2 kalır"
   * diyordu. ÖLÇÜLDÜ: 1,2 ile ürün bütçesinde (200 000) ülke korpusunun BEŞ
   * uzun rotası `CROSS_REGION_CLOSED_LIMIT` ile DÜŞÜYORDU
   * (`field-runs/rtg4-device-budget-20260908`). Yani eski kilit, cihazda
   * çalışmayan bir davranışı koruyordu. Yeni kilit doğru ayrımı korur:
   * BÖLGE İÇİ (tek pencere) rota birebir eski davranıştır; uzun rota profili
   * ölçülmüş sabitlerden gelir ve arama TAVANI yükseltilmez.
   */
  it('🔒 uzun rota profili: tek pencerede 1,2 · çok pencerede ölçülmüş sabitler', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    /* Bölge içi rota sezgiseli DEĞİŞMEDİ. */
    expect(worker).toContain('HEURISTIC_WEIGHT = 1.2');
    expect(worker).toContain('if (!multiWindow) return HEURISTIC_WEIGHT;');
    /* Uzun rota profili tek yerde tanımlıdır (dağınık sihirli sayı yok). */
    expect(worker).toContain('const CORRIDOR_BASE_WEIGHT = 1.6;');
    expect(worker).toContain('const CORRIDOR_CLASS_LIMIT = 4;');
    /* Tırmanma eşiği SABİT DEĞİL, bütçenin pencere başına payıdır: 20 pencerelik
       koridorda sabit eşik çok geç kalıyordu (ölçüldü). */
    expect(worker).toContain('const CORRIDOR_ESCALATE_WINDOW_SHARE = 2;');
    expect(worker).toContain('budget / (CORRIDOR_ESCALATE_WINDOW_SHARE * windowCount)');
    /* Tek pencerede mekanizmalar KAPALIDIR (parite ölçüldü: 686/335/9345 durum). */
    expect(worker).toContain('(multiWindow ? (altReady ? ALT_CORRIDOR_CLASS_LIMIT : CORRIDOR_CLASS_LIMIT) : 0)');
    expect(worker).toContain('(multiWindow ? _corridorEscalateAfter(budget, Number(msg.windowCount ?? 0)) : 0)');
  });

  /**
   * Katman mekanizması bir BUDAMA değildir. Sert budama ölçüldü ve koridoru
   * KOPARDI (sınıf ≤4: 83 793 durumda `EXHAUSTED`). Bu yüzden düşük sınıf
   * kenar ELENMEZ, yalnız `f` sıralamasında geriye alınır → rota kaybı yok.
   */
  it('🔒 omurga katmanı SIRALAMADIR, budama DEĞİLDİR (rota kaybı olamaz)', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    /* Katman yalnız önceliğe eklenir. */
    expect(worker).toContain('priority + _corridorTier(session, view, ordinal');
    expect(worker).toContain('* session.tierOffsetM,');
    /* Sınıfa bakıp komşuyu ATLAYAN bir eleme YOK. */
    expect(worker).not.toMatch(/edgeRoadClass\(view, ordinal\) > session\.classLimit[\s\S]{0,120}continue;/);
    /* Ofset SONSUZ değildir: sonsuz ofset hedef metropolünü boğuyordu (ölçüldü). */
    expect(worker).toContain('const CORRIDOR_TIER_OFFSET_M = 150_000;');
    expect(worker).not.toContain('CORRIDOR_TIER_OFFSET_M = 1e9');
  });

  /** Tırmanma pencere yereldir: bir penceredeki arazi cezası sonrakine taşınmaz. */
  it('🔒 bütçe-farkında ağırlık tırmanması her pencerede TABANA döner', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    expect(worker).toContain('session.weight = isFinal ? session.finalWeight : session.baseWeight;');
    expect(worker).toContain('session.weight < session.escalateMaxWeight');
    expect(worker).toContain('const CORRIDOR_ESCALATE_MAX_WEIGHT = 4;');
  });

  it('🔒 yeniden kurma arşivi KOMPAKT ve TAVANLIDIR (sınırsız büyüme yok)', () => {
    const root = resolve(__dirname, '../..');
    const worker = readFileSync(resolve(root, 'src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    /* Koordinat graf ile AYNI hassasiyette: çift hassasiyet bilgi taşımaz, bayt yer. */
    expect(worker).toContain('lon:    Float32Array;');
    expect(worker).toContain('cost:   Uint32Array;');
    /* Kararlı kimlik denetim için saklanır (P10). */
    expect(worker).toContain('nodeId: BigUint64Array;');
    expect(worker).toContain('wayId:  BigUint64Array;');
    /* Tavan aşılırsa rota UYDURULMAZ. */
    expect(worker).toContain('CROSS_REGION_RECONSTRUCTION_BUDGET');
    expect(worker).toContain('if (a.count >= a.capacity) return -1;');
  });

  it('🔒 üretim RTG2 grafı bu fazda DEĞİŞMEDİ', () => {
    const bytes = readFileSync(resolve(__dirname, '../../public/maps/routing-graph.bin'));
    expect(bytes.byteLength).toBe(7_651_542);
  });
});
