/**
 * regionalGraphMerge — bölgesel RTG3/RTG4 görünüm BİRLEŞTİRİCİSİ.
 *
 * ── NEDEN AYRI DOSYA (#1218) ─────────────────────────────────────────────
 * `mergeRegionalGraphWindow` kararlı OSM kimliklerini `BigUint64Array` ile
 * okur ve BigInt LİTERALİ (`0n`) kullanır. BigInt bir SÖZDİZİMİ özelliğidir;
 * polyfill EDİLEMEZ. Bu kod `turkeyGraphManifest` içinde kaldığı sürece,
 * `map/store` → `mapStoreSources` → `graphResidencyRuntime` statik zinciriyle
 * `plugin-legacy`nin ES2015 startup chunk'ının import grafına giriyordu.
 *
 * Ölçülen build'de yalnız TREE-SHAKING sayesinde çıktıya düşmemişti. Bu bir
 * SINIR değil, KAZADIR: tek bir yeni referans onu geri sokar ve eski head
 * unit boot edemez. Bu yüzden kod, kazaya değil MODÜL SINIRINA bağlandı.
 *
 * Yükleme `rtg2ParseLoader` ile aynı desendedir: yalnız gerçekten bölgesel
 * graf birleştirileceği anda `import()` ile gelir.
 *
 * OTORİTE DEĞİŞMEDİ: birleştirme mantığı, kimlik tabloları ve fail-closed
 * davranış birebir taşındı; tek bir `0n` bile `Number`a düşürülmedi.
 */

import { buildViaWayIndex, RTG3_VIA_WAY_FLAG, type RoutingGraphView } from './rtg2Reader';
import { REGION_WINDOW_NO_LOCAL, type RegionWindowIdentity } from './turkeyGraphManifest';

export interface MergedRegionWindow {
  readonly view: RoutingGraphView;
  readonly identity: RegionWindowIdentity;
}

/** Stable OSM node kimliğiyle overlap düğümlerini birleştirir; ikinci authority değildir. */
export function mergeRegionalGraphViews(views: readonly RoutingGraphView[]): RoutingGraphView | null {
  return mergeRegionalGraphWindow(views, views.map((_, i) => `#${i}`))?.view ?? null;
}

/**
 * `mergeRegionalGraphViews` ile AYNI birleştirme — ek olarak pencere kimlik
 * tablosunu da yayınlar. İkinci bir birleştirici YOKTUR; eski imza bunun ince
 * bir sarmalayıcısıdır.
 */
export function mergeRegionalGraphWindow(
  views: readonly RoutingGraphView[], regionIds: readonly string[],
): MergedRegionWindow | null {
  if (!views.length || views.length !== regionIds.length) return null;
  if (views.some((v) => v.version < 3 || v.version !== views[0].version)) return null;
  const sourceToNode = new Map<bigint, number>();
  const nodeLat: number[] = [], nodeLon: number[] = [], nodeIds: bigint[] = [];
  const remaps: number[][] = [];
  for (const view of views) {
    const remap: number[] = [];
    for (let i = 0; i < view.nodeCount; i++) {
      const sourceId = view.nodeSourceId[i];
      if (sourceId === 0n) return null;
      let target = sourceToNode.get(sourceId);
      if (target === undefined) {
        target = nodeLat.length; sourceToNode.set(sourceId, target);
        nodeLat.push(view.nodeLat[i]); nodeLon.push(view.nodeLon[i]); nodeIds.push(sourceId);
      }
      remap[i] = target;
    }
    remaps.push(remap);
  }
  const edges: Array<{ from:number;to:number;cost:number;way:bigint;cls:number;access:number;dir:number;structure:number;layer:number }> = [];
  const edgeKeys = new Map<string, number>();
  const edgeRemaps: number[][] = [];
  views.forEach((view, vi) => {
    const map: number[] = [];
    for (let i = 0; i < view.edgeCount; i++) {
      const from = remaps[vi][view.edgeFrom[i]], to = remaps[vi][view.edgeTo[i]];
      const key = `${view.edgeSourceWayId[i]}:${nodeIds[from]}:${nodeIds[to]}:${view.edgeDirection[i]}`;
      let target = edgeKeys.get(key);
      if (target === undefined) {
        target = edges.length; edgeKeys.set(key, target);
        edges.push({ from, to, cost:view.edgeCostM[i], way:view.edgeSourceWayId[i], cls:view.edgeRoadClassV3[i], access:view.edgeAccessRole[i], dir:view.edgeDirection[i], structure:view.edgeStructure[i], layer:view.edgeLayer[i] });
      }
      map[i] = target;
    }
    edgeRemaps.push(map);
  });
  /* Kısıtlar: via-node kayıtları doğrudan yeniden eşlenir. Via-way ZİNCİRLERİ
     bölge-yerel `chainId` taşır; birleşmede yeniden numaralanır ve aynı ilişki
     iki örtüşen bölgede göründüğünde İÇERİĞE göre tekilleştirilir (aksi hâlde
     aynı kısıt iki yuva tüketir ve kenar tavanına gereksiz baskı yapar). */
  const restrictions: Array<[number,number,number,number,bigint]> = [];
  const chainIdOf: number[] = [];
  const chainSeqOf: number[] = [];
  const chainSignatures = new Map<string, number>();
  views.forEach((view, vi) => {
    const chainRecords = new Map<number, number[]>();
    for (let i = 0; i < view.restrictionCount; i++) {
      if ((view.restrictionType[i] & RTG3_VIA_WAY_FLAG) !== 0) {
        const bucket = chainRecords.get(view.restrictionChainId[i]);
        if (bucket) bucket.push(i); else chainRecords.set(view.restrictionChainId[i], [i]);
        continue;
      }
      restrictions.push([edgeRemaps[vi][view.restrictionFromEdge[i]], edgeRemaps[vi][view.restrictionToEdge[i]], remaps[vi][view.restrictionViaNode[i]], view.restrictionType[i], view.restrictionRelationId?.[i] ?? 0n]);
      chainIdOf.push(0); chainSeqOf.push(0);
    }
    for (const records of chainRecords.values()) {
      const ordered = records.sort((a, b) => view.restrictionChainSeq[a] - view.restrictionChainSeq[b]);
      const links = ordered.map((i) => [edgeRemaps[vi][view.restrictionFromEdge[i]], edgeRemaps[vi][view.restrictionToEdge[i]], remaps[vi][view.restrictionViaNode[i]], view.restrictionType[i], view.restrictionRelationId?.[i] ?? 0n] as const);
      const signature = links.map((l) => l.join(':')).join('|');
      if (chainSignatures.has(signature)) continue;
      const chainId = chainSignatures.size + 1;
      chainSignatures.set(signature, chainId);
      links.forEach((link, seq) => {
        restrictions.push([link[0], link[1], link[2], link[3], link[4]]);
        chainIdOf.push(chainId); chainSeqOf.push(seq);
      });
    }
  });
  const restrictionType = Uint8Array.from(restrictions.map((r) => r[3]));
  const restrictionFromEdge = Uint32Array.from(restrictions.map((r) => r[0]));
  const restrictionToEdge = Uint32Array.from(restrictions.map((r) => r[1]));
  const restrictionViaNode = Uint32Array.from(restrictions.map((r) => r[2]));
  const restrictionChainId = Uint32Array.from(chainIdOf);
  const restrictionChainSeq = Uint8Array.from(chainSeqOf);
  const viaWay = buildViaWayIndex(restrictionType, restrictionFromEdge, restrictionToEdge, restrictionViaNode, restrictionChainId, restrictionChainSeq, restrictions.length, edges.length);
  if (viaWay.error) return null;   // fail-closed: tutarsız zincirle rota ÜRETİLMEZ
  const nodeMergedToLocal = views.map(() => new Uint32Array(nodeLat.length).fill(REGION_WINDOW_NO_LOCAL));
  const edgeMergedToLocal = views.map(() => new Uint32Array(edges.length).fill(REGION_WINDOW_NO_LOCAL));
  views.forEach((view, vi) => {
    for (let i = 0; i < view.nodeCount; i++) nodeMergedToLocal[vi][remaps[vi][i]] = i;
    for (let i = 0; i < view.edgeCount; i++) edgeMergedToLocal[vi][edgeRemaps[vi][i]] = i;
  });
  const view: RoutingGraphView = {
    version:views[0].version,nodeCount:nodeLat.length,edgeCount:edges.length,parsedBytes:views.reduce((n,v)=>n+v.parsedBytes,0),trailingBytes:0,
    nodeLat:Float32Array.from(nodeLat),nodeLon:Float32Array.from(nodeLon),nodeSourceId:BigUint64Array.from(nodeIds),
    edgeFrom:Uint32Array.from(edges.map(e=>e.from)),edgeTo:Uint32Array.from(edges.map(e=>e.to)),edgeCostM:Uint32Array.from(edges.map(e=>e.cost)),
    edgeFlags:Uint8Array.from(edges.map(e=>(e.dir?1:0)|((e.cls&7)<<1))),edgeRoadClassV3:Uint8Array.from(edges.map(e=>e.cls)),
    edgeAccessRole:Uint8Array.from(edges.map(e=>e.access)),edgeDirection:Uint8Array.from(edges.map(e=>e.dir)),edgeStructure:Uint8Array.from(edges.map(e=>e.structure)),edgeLayer:Int8Array.from(edges.map(e=>e.layer)),edgeSourceWayId:BigUint64Array.from(edges.map(e=>e.way)),
    restrictionCount:restrictions.length,restrictionFromEdge,restrictionToEdge,restrictionViaNode,restrictionType,
    restrictionChainId,restrictionChainSeq,
    restrictionRelationId: views[0].version === 4 ? BigUint64Array.from(restrictions.map((r) => r[4])) : undefined,
    viaWay:viaWay.index,
  };
  return {
    view,
    identity: {
      regionIds: [...regionIds],
      nodeLocalToMerged: remaps.map((r) => Uint32Array.from(r)),
      edgeLocalToMerged: edgeRemaps.map((r) => Uint32Array.from(r)),
      nodeMergedToLocal, edgeMergedToLocal,
    },
  };
}
