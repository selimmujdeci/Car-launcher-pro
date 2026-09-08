import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRoutingGraph, turnIsAllowed, viaWayStep,
  RTG3_MAGIC, RTG3_VIA_WAY_FLAG, RTG3_VIA_WAY_FINAL, RTG3_MAX_VIA_WAY_SLOTS_PER_EDGE,
  type RoutingGraphView,
} from '../platform/navigation/map/graph/rtg2Reader';

/* ══════════════════════════════════════════════════════════════════════════
   Via-way dönüş kısıtı — kenar dizisi semantiği.

   Test grafı (tümü çift yönlü, ROUTABLE_PUBLIC):

        e3            e0            e1            e2
     4 ─────┐      0 ─────▶ 1 ─────▶ 2 ─────▶ 3
            └──────────────┘   └──── e4 ────┘

   Kısıt: from way(e0) → via way(e1) → to way(e2).
   `no_*`   → e0·e1·e2 dizisi TAMAMLANAMAZ.
   `only_*` → e0'dan sonra e1, e1'den sonra e2 ZORUNLU.
   ══════════════════════════════════════════════════════════════════════════ */

const NODES: ReadonlyArray<readonly [number, number]> = [
  [36.90, 34.80], [36.91, 34.81], [36.92, 34.82], [36.93, 34.83], [36.915, 34.79],
];
/** `[from, to, wayId, direction]` — sıra kenar ordinalini belirler. */
const EDGES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 100, 0],   // e0 · from way
  [1, 2, 200, 1],   // e1 · via way — TEK YÖN (U dönüşüyle kaçış kapalı)
  [2, 3, 300, 0],   // e2 · to way
  [1, 4, 400, 0],   // e3 · 1 numaralı kavşakta alternatif
  [2, 4, 500, 0],   // e4 · 2 numaralı kavşakta alternatif
  [4, 3, 600, 0],   // e5 · meşru alternatif rotanın son ayağı
];
const E_FROM = 0, E_VIA = 1, E_TO = 2, E_ALT1 = 3, E_ALT2 = 4;

interface RestrictionRecord {
  fromEdge: number; toEdge: number; viaNode: number;
  type: number; chainSeq?: number; chainId?: number;
}

function build(restrictions: readonly RestrictionRecord[]): ArrayBuffer {
  const buffer = new ArrayBuffer(16 + NODES.length * 16 + EDGES.length * 28 + restrictions.length * 16);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint32(offset, RTG3_MAGIC, true); offset += 4;
  view.setUint32(offset, NODES.length, true); offset += 4;
  view.setUint32(offset, EDGES.length, true); offset += 4;
  view.setUint32(offset, restrictions.length, true); offset += 4;
  NODES.forEach(([lat, lon], index) => {
    view.setFloat32(offset, lat, true);
    view.setFloat32(offset + 4, lon, true);
    view.setBigUint64(offset + 8, BigInt(1_000 + index), true);
    offset += 16;
  });
  for (const [from, to, wayId, direction] of EDGES) {
    view.setUint32(offset, from, true);
    view.setUint32(offset + 4, to, true);
    view.setUint32(offset + 8, 100, true);
    view.setBigUint64(offset + 12, BigInt(wayId), true);
    view.setUint8(offset + 20, 5);   // tertiary
    view.setUint8(offset + 21, 1);   // ROUTABLE_PUBLIC
    view.setUint8(offset + 22, direction);
    view.setUint8(offset + 23, 0);
    view.setInt8(offset + 24, 0);
    offset += 28;
  }
  for (const record of restrictions) {
    view.setUint32(offset, record.fromEdge, true);
    view.setUint32(offset + 4, record.toEdge, true);
    view.setUint32(offset + 8, record.viaNode, true);
    view.setUint8(offset + 12, record.type);
    view.setUint8(offset + 13, record.chainSeq ?? 0);
    view.setUint16(offset + 14, record.chainId ?? 0, true);
    offset += 16;
  }
  return buffer;
}

/** `from → via → to` zinciri; `base` 1..7 temel kısıt türü. */
const chain = (base: number): RestrictionRecord[] => [
  { fromEdge: E_FROM, toEdge: E_VIA, viaNode: 1, type: RTG3_VIA_WAY_FLAG | base, chainSeq: 0, chainId: 7 },
  { fromEdge: E_VIA, toEdge: E_TO, viaNode: 2, type: RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | base, chainSeq: 1, chainId: 7 },
];

const parsed = (restrictions: readonly RestrictionRecord[]): RoutingGraphView => {
  const result = parseRoutingGraph(build(restrictions));
  expect(result.outcome, result.detail).toBe('OK');
  return result.view!;
};

/** Zincire baştan girer ve via kenarındaki maskeyi döndürür. */
function armChain(view: RoutingGraphView): number {
  const onFrom = viaWayStep(view, -1, 0, 0, E_FROM);
  expect(onFrom).toBeGreaterThan(0);
  const onVia = viaWayStep(view, E_FROM, onFrom, 1, E_VIA);
  expect(onVia).toBeGreaterThan(0);
  return onVia;
}

describe('RTG3 via-way dönüş kısıtı', () => {
  it('no_* zincirinin tamamlanmasını reddeder, alternatifleri serbest bırakır', () => {
    const view = parsed(chain(1));            // no_left_turn
    expect(view.viaWay?.chainCount).toBe(1);
    const onVia = armChain(view);
    expect(viaWayStep(view, E_VIA, onVia, 2, E_TO)).toBe(-1);      // yasak dizi
    expect(viaWayStep(view, E_VIA, onVia, 2, E_ALT2)).toBeGreaterThanOrEqual(0);
    /* Ara kavşakta alternatif ASLA bloklanmaz: yasak olan yalnız TAM dizidir. */
    const onFrom = viaWayStep(view, -1, 0, 0, E_FROM);
    expect(viaWayStep(view, E_FROM, onFrom, 1, E_ALT1)).toBeGreaterThanOrEqual(0);
  });

  it('zincire girilmemişse aynı via kenarından geçiş serbesttir', () => {
    const view = parsed(chain(1));
    /* Sürücü `from` yolundan GELMEDİ → kısıt YOK. */
    const unrelated = viaWayStep(view, -1, 0, 1, E_VIA);
    expect(unrelated).toBe(0);
    expect(viaWayStep(view, E_VIA, unrelated, 2, E_TO)).toBe(0);
  });

  it('only_* zincirinde yalnız izin verilen devam kabul edilir', () => {
    const view = parsed(chain(5));            // only_left_turn
    const onFrom = viaWayStep(view, -1, 0, 0, E_FROM);
    expect(viaWayStep(view, E_FROM, onFrom, 1, E_ALT1)).toBe(-1);   // zorunlu devam dışı
    const onVia = viaWayStep(view, E_FROM, onFrom, 1, E_VIA);
    expect(onVia).toBeGreaterThan(0);
    expect(viaWayStep(view, E_VIA, onVia, 2, E_ALT2)).toBe(-1);
    expect(viaWayStep(view, E_VIA, onVia, 2, E_TO)).toBeGreaterThanOrEqual(0);
  });

  it('via-node sorgusu via-way kayıtlarını YORUMLAMAZ', () => {
    const view = parsed(chain(1));
    /* Tek kavşak bakışı bir via-way kısıtını yanıtlayamaz; `turnIsAllowed`
       bu kayıtları görmezden gelmeli, yoksa meşru dönüşü bloklar. */
    expect(turnIsAllowed(view, E_FROM, E_VIA, 1)).toBe(true);
    expect(turnIsAllowed(view, E_VIA, E_TO, 2)).toBe(true);
  });

  it('via-node ve via-way kısıtları aynı grafta birlikte çalışır', () => {
    const view = parsed([
      { fromEdge: E_FROM, toEdge: E_ALT1, viaNode: 1, type: 1 },   // klasik via-node
      ...chain(1),
    ]);
    expect(view.restrictionCount).toBe(3);
    expect(view.viaWay?.chainCount).toBe(1);
    expect(turnIsAllowed(view, E_FROM, E_ALT1, 1)).toBe(false);     // via-node hâlâ geçerli
    const onVia = armChain(view);
    expect(viaWayStep(view, E_VIA, onVia, 2, E_TO)).toBe(-1);
  });

  it('via-way kaydı olmayan RTG3 grafta maske DAİMA 0 kalır (davranış paritesi)', () => {
    const view = parsed([{ fromEdge: E_FROM, toEdge: E_VIA, viaNode: 1, type: 4 }]);
    expect(view.viaWay).toBeNull();
    expect(viaWayStep(view, -1, 0, 0, E_FROM)).toBe(0);
    expect(viaWayStep(view, E_FROM, 0, 1, E_VIA)).toBe(0);
  });

  describe('fail-closed zincir doğrulaması', () => {
    const invalid = (restrictions: readonly RestrictionRecord[], reason: string) => {
      const result = parseRoutingGraph(build(restrictions));
      expect(result.outcome, reason).toBe('INVALID');
      expect(result.view).toBeNull();
    };

    it('halka sırası boşluklu zinciri reddeder', () => {
      const broken = chain(1);
      broken[1].chainSeq = 2;
      invalid(broken, 'chainSeq boşluğu');
    });

    it('son halka işareti yanlış zinciri reddeder', () => {
      const broken = chain(1);
      broken[1].type &= ~RTG3_VIA_WAY_FINAL;
      invalid(broken, 'FINAL işareti yok');
    });

    it('bitişik olmayan halkaları reddeder', () => {
      const broken = chain(1);
      broken[1].fromEdge = E_ALT1;      // önceki halkanın `to` kenarı DEĞİL
      invalid(broken, 'zincir kopuk');
    });

    it('temel türü geçersiz via-way kaydını reddeder', () => {
      invalid([{ fromEdge: E_FROM, toEdge: E_VIA, viaNode: 1, type: RTG3_VIA_WAY_FLAG, chainSeq: 0, chainId: 1 }], 'temel tür 0');
    });

    it('kenar başına yuva tavanını aşan grafı reddeder', () => {
      const records: RestrictionRecord[] = [];
      for (let i = 0; i <= RTG3_MAX_VIA_WAY_SLOTS_PER_EDGE; i++) {
        records.push({ fromEdge: E_FROM, toEdge: E_VIA, viaNode: 1, type: RTG3_VIA_WAY_FLAG | 1, chainSeq: 0, chainId: 100 + i });
        records.push({ fromEdge: E_VIA, toEdge: E_TO, viaNode: 2, type: RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | 1, chainSeq: 1, chainId: 100 + i });
      }
      invalid(records, 'yuva tavanı');
    });
  });

  it('eski okuyucu sözleşmesi: via-way tür baytı 1..7 aralığının DIŞINDADIR', () => {
    /* Eski sürüm 1..7 dışını `INVALID` sayıp grafı tümden reddeder → yeni
       artefakt eski uygulamada "kısıt görülmeden" sürülemez (fail-closed). */
    for (const base of [1, 2, 3, 4, 5, 6, 7]) {
      expect(RTG3_VIA_WAY_FLAG | base).toBeGreaterThan(7);
      expect((RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | base)).toBeGreaterThan(7);
    }
  });
});

describe('RTG3 via-way — kanonik worker uygulaması', () => {
  it('kısıtsız grafta en kısa yolu bulur, kısıtlı grafta meşru alternatife geçer', async () => {
    const posted: Array<{ type: string; requestId?: string; geometry?: [number, number][]; reason?: string }> = [];
    const workerSelf = {
      navigator: { deviceMemory: 8 },
      postMessage: (message: typeof posted[number]) => posted.push(message),
      close: () => {},
      onmessage: null as ((event: MessageEvent) => void) | null,
    };
    Object.assign(globalThis, { self: workerSelf });
    await import('../platform/navigation/NavigationCompute.worker');

    const nodePath = (geometry: readonly [number, number][]) =>
      geometry.map(([lon, lat]) => NODES.findIndex((n) => Math.abs(n[0] - lat) < 1e-4 && Math.abs(n[1] - lon) < 1e-4)).join(',');

    async function route(view: RoutingGraphView, id: string) {
      posted.length = 0;
      workerSelf.onmessage!({ data: { type: 'INSTALL_REGIONAL_GRAPH', requestId: `i-${id}`, graphView: view } } as MessageEvent);
      expect(posted.some((m) => m.type === 'GRAPH_INSTALLED'), `install ${id}`).toBe(true);
      posted.length = 0;
      workerSelf.onmessage!({ data: { type: 'COMPUTE_ROUTE', requestId: id, fromLat: NODES[0][0], fromLon: NODES[0][1], toLat: NODES[3][0], toLon: NODES[3][1] } } as MessageEvent);
      for (let i = 0; i < 300 && !posted.some((m) => m.requestId === id); i++) await new Promise((r) => setTimeout(r, 2));
      return posted.find((m) => m.requestId === id);
    }

    /* Kontrol: kısıt YOKKEN en kısa yol 0·1·2·3'tür. */
    const free = await route(parsed([]), 'free');
    expect(free?.type).toBe('ROUTE_RESULT');
    expect(nodePath(free!.geometry!)).toBe('0,1,2,3');

    /* Kısıt VARKEN aynı dizi kullanılamaz; meşru alternatif 0·1·4·3'tür. */
    const restricted = await route(parsed(chain(1)), 'restricted');
    expect(restricted?.type).toBe('ROUTE_RESULT');
    const path = nodePath(restricted!.geometry!);
    expect(path, 'yasak via-way dizisi rotada').not.toContain('0,1,2,3');
    expect(path).toBe('0,1,4,3');
    /* NOT (bilinen, BU TURDA GİDERİLMEYEN borç): kanonik A*'ta U dönüşü
       cezası YOKTUR. Via yolu çift yönlü olsaydı sürücü via kenarında U
       dönüşü yapıp otomatı sıfırlayarak aynı manevrayı yapabilirdi
       (`0,1,2,1,2,3`). Bu kaçış via-NODE kısıtlarında da BUGÜN vardır —
       via-way desteğinin getirdiği bir gerileme DEĞİLDİR. Bu test via
       yolunu tek yön yaparak kaçışı kapatır ve gerçek alternatifi kilitler. */
  });
});

describe('RTG3 yazma/okuma otoritesi tekliği', () => {
  it('RTG3 serileştirme TEK dosyada kalır ve builder ortak codec kullanır', () => {
    const codec = readFileSync(resolve('scripts/rtg3Codec.mjs'), 'utf8');
    expect(codec).toContain('export function serializeRtg3');
    for (const builder of ['scripts/build-pbf-streaming-rtg3.mjs', 'scripts/build-rtg3-bounded.mjs']) {
      const source = readFileSync(resolve(builder), 'utf8');
      expect(source, builder).toContain("from './rtg3Codec.mjs'");
      /* İkinci bir yazar bırakmak, aynı baytların iki yorumu demektir. */
      expect(source.includes('writeBigUInt64LE'), builder).toBe(false);
    }
  });

  it('via-way otomatı kanonik A* içinde tek yerde uygulanır', () => {
    const worker = readFileSync(resolve('src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    expect(worker).toContain('viaWayStep(view, previousEdge, viaWayMask, cur, ordinal)');
    expect(worker.match(/function routeRtg3EdgeState\(/g)).toHaveLength(1);
    expect(worker.match(/function _aStar\(/g)).toHaveLength(1);
    /* Otomat mantığı worker'a KOPYALANMAZ; okuyucudaki tek otoritede kalır. */
    expect(worker).not.toContain('slotsByEdge');
  });
});
