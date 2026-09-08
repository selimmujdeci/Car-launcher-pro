import type { RoutingGraphView } from './rtg2Reader';
import { buildViaWayIndex, RTG3_VIA_WAY_FLAG } from './rtg2Reader';

export const TURKEY_GRAPH_MANIFEST_SCHEMA = 2;

export interface TurkeyGraphComponentArtifact {
  readonly schemaVersion: 1;
  readonly file: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly indexFile: string;
  readonly indexSha256: string;
  readonly indexByteSize: number;
  readonly indexEncoding: 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX';
  readonly count: number;
  readonly directedLinkCount: number;
  readonly portalComponentIds: readonly string[];
}

export interface TurkeyGraphPortalV2 {
  readonly portalId: string;
  readonly portalNodeId: string;
  readonly sourceRegionId: string;
  readonly destinationRegionId: string;
  readonly sourceComponentId: string;
  readonly destinationComponentId: string;
  readonly traversalDirection: 'FORWARD' | 'REVERSE';
  readonly accessRole: 1 | 2;
  readonly incidentEdgeId: string;
  readonly sourceNodeId: string;
  readonly destinationNodeId: string;
  readonly provenance: 'OSM_DIRECTED_EDGE_TILE_CROSSING';
  readonly sourceHash: string;
}

export type TurkeyGraphNeighborClassification = 'ROUTABLE' | 'NON_ROUTABLE' | 'INVALID' | 'AMBIGUOUS';

export interface TurkeyGraphNeighborAudit {
  readonly total: number;
  readonly ROUTABLE: number;
  readonly NON_ROUTABLE: number;
  readonly INVALID: number;
  readonly AMBIGUOUS: number;
  readonly links: readonly { readonly sourceRegionId: string; readonly destinationRegionId: string; readonly classification: TurkeyGraphNeighborClassification }[];
}

export interface TurkeyGraphRegion {
  readonly regionId: string;
  readonly bbox: readonly [number, number, number, number];
  readonly graphFile: string;
  readonly sha256: string;
  readonly byteSize: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly neighbors: readonly string[];
  readonly sourceHash: string;
  readonly components?: TurkeyGraphComponentArtifact;
}

export interface TurkeyGraphManifest {
  readonly schemaVersion: 1 | 2;
  readonly datasetId: string;
  readonly country: 'TR';
  readonly source: string;
  readonly sourceTimestamp: string;
  readonly buildTimestamp: string;
  readonly policyVersion: string;
  readonly graphFormat: 'RTG3' | 'RTG4';
  readonly portalSchemaVersion?: 2;
  readonly portals?: readonly TurkeyGraphPortalV2[];
  readonly neighborAudit?: TurkeyGraphNeighborAudit;
  readonly regions: readonly TurkeyGraphRegion[];
}

export function validateTurkeyGraphManifest(value: unknown): TurkeyGraphManifest | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<TurkeyGraphManifest>;
  if ((m.schemaVersion !== 1 && m.schemaVersion !== TURKEY_GRAPH_MANIFEST_SCHEMA) || m.country !== 'TR' ||
      (m.graphFormat !== 'RTG3' && m.graphFormat !== 'RTG4') || !Array.isArray(m.regions) || !m.regions.length) return null;
  if ((m.schemaVersion === 1) !== (m.graphFormat === 'RTG3')) return null;
  const ids = new Set(m.regions.map((r) => r.regionId));
  if (ids.size !== m.regions.length) return null;
  for (const r of m.regions) {
    if (!r.regionId || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.graphFile ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || r.byteSize <= 0 || r.nodeCount <= 0 ||
        r.edgeCount <= 0 || !Array.isArray(r.neighbors)) return null;
    if (r.neighbors.some((id: string) => !ids.has(id))) return null;
    for (const neighbor of r.neighbors) {
      const other = m.regions.find((candidate) => candidate.regionId === neighbor);
      if (!other?.neighbors.includes(r.regionId)) return null;
    }
  }
  if (m.schemaVersion === 2) {
    if (m.portalSchemaVersion !== 2 || !Array.isArray(m.portals) || !m.neighborAudit || !Array.isArray(m.neighborAudit.links)) return null;
    const componentsByRegion = new Map<string, Set<string>>();
    for (const region of m.regions) {
      const components = region.components;
      if (!components || components.schemaVersion !== 1 || !components.file || !/^[a-f0-9]{64}$/.test(components.sha256) ||
          !components.indexFile || !/^[a-f0-9]{64}$/.test(components.indexSha256) || components.indexByteSize !== region.nodeCount * 4 ||
          components.indexEncoding !== 'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX' ||
          components.byteSize <= 0 || components.count <= 0 || components.directedLinkCount < 0 || !Array.isArray(components.portalComponentIds)) return null;
      const idsForRegion = new Set<string>();
      for (const id of components.portalComponentIds) {
        if (typeof id !== 'string' || !id.startsWith(`${region.regionId}:`) || idsForRegion.has(id)) return null;
        idsForRegion.add(id);
      }
      componentsByRegion.set(region.regionId, idsForRegion);
    }
    const portalIds = new Set<string>();
    const portalSemantics = new Map<string, string>();
    const portalPairs = new Set<string>();
    for (const portal of m.portals) {
      if (!/^p2:[a-f0-9]{64}$/.test(portal.portalId) || portalIds.has(portal.portalId) ||
          !ids.has(portal.sourceRegionId) || !ids.has(portal.destinationRegionId) || portal.sourceRegionId === portal.destinationRegionId ||
          !componentsByRegion.get(portal.sourceRegionId)?.has(portal.sourceComponentId) ||
          !componentsByRegion.get(portal.destinationRegionId)?.has(portal.destinationComponentId) ||
          (portal.traversalDirection !== 'FORWARD' && portal.traversalDirection !== 'REVERSE') ||
          (portal.accessRole !== 1 && portal.accessRole !== 2) || !portal.portalNodeId || !portal.incidentEdgeId ||
          !portal.sourceNodeId || !portal.destinationNodeId || portal.provenance !== 'OSM_DIRECTED_EDGE_TILE_CROSSING' ||
          !/^[a-f0-9]{64}$/.test(portal.sourceHash)) return null;
      portalIds.add(portal.portalId);
      const semanticKey = `${portal.sourceRegionId}>${portal.destinationRegionId}:${portal.incidentEdgeId}:${portal.traversalDirection}`;
      const semanticValue = `${portal.sourceComponentId}:${portal.destinationComponentId}:${portal.accessRole}:${portal.portalNodeId}`;
      const previous = portalSemantics.get(semanticKey);
      if (previous !== undefined && previous !== semanticValue) return null;
      portalSemantics.set(semanticKey, semanticValue);
      if (portal.accessRole === 1) portalPairs.add([portal.sourceRegionId, portal.destinationRegionId].sort().join('|'));
    }
    const audit = m.neighborAudit;
    if (!Number.isInteger(audit.total) || audit.total !== audit.links.length ||
        audit.ROUTABLE + audit.NON_ROUTABLE + audit.INVALID + audit.AMBIGUOUS !== audit.total) return null;
    const auditedPairs = new Set<string>();
    const counts: Record<TurkeyGraphNeighborClassification, number> = { ROUTABLE:0, NON_ROUTABLE:0, INVALID:0, AMBIGUOUS:0 };
    for (const link of audit.links) {
      if (!ids.has(link.sourceRegionId) || !ids.has(link.destinationRegionId) || link.sourceRegionId >= link.destinationRegionId ||
          !Object.hasOwn(counts, link.classification)) return null;
      const pair = `${link.sourceRegionId}|${link.destinationRegionId}`;
      if (auditedPairs.has(pair) || (link.classification === 'ROUTABLE') !== portalPairs.has(pair)) return null;
      auditedPairs.add(pair); counts[link.classification]++;
    }
    if (counts.ROUTABLE !== audit.ROUTABLE || counts.NON_ROUTABLE !== audit.NON_ROUTABLE ||
        counts.INVALID !== audit.INVALID || counts.AMBIGUOUS !== audit.AMBIGUOUS) return null;
    for (const region of m.regions) {
      const expected = new Set<string>();
      for (const pair of portalPairs) {
        const [a, b] = pair.split('|');
        if (a === region.regionId) expected.add(b); else if (b === region.regionId) expected.add(a);
      }
      if (region.neighbors.length !== expected.size || region.neighbors.some((id: string) => !expected.has(id))) return null;
    }
  }
  return m as TurkeyGraphManifest;
}

export interface RegionalRouteCorridor {
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  readonly requiredRegionIds: readonly string[];
}

/** Manifest komşuluk grafında en kısa bounded corridor'u seçer; coğrafi boşlukta fail-closed döner. */
export function selectRegionalRouteCorridor(
  manifest: TurkeyGraphManifest,
  origin: readonly [number, number],
  destination: readonly [number, number],
  maxRegions = 3,
): RegionalRouteCorridor | null {
  const contains = (bbox: readonly [number,number,number,number], point: readonly [number,number]) =>
    point[1] >= bbox[0] && point[1] <= bbox[2] && point[0] >= bbox[1] && point[0] <= bbox[3];
  const originRegion = manifest.regions.find((region) => contains(region.bbox, origin));
  const destinationRegion = manifest.regions.find((region) => contains(region.bbox, destination));
  if (!originRegion || !destinationRegion || maxRegions < 1) return null;
  const queue: string[][] = [[originRegion.regionId]];
  const visited = new Set<string>([originRegion.regionId]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === destinationRegion.regionId) {
      return { originRegionId:originRegion.regionId, destinationRegionId:destinationRegion.regionId, requiredRegionIds:path };
    }
    if (path.length >= maxRegions) continue;
    const region = manifest.regions.find((candidate) => candidate.regionId === current);
    for (const neighbor of region?.neighbors ?? []) if (!visited.has(neighbor)) {
      visited.add(neighbor); queue.push([...path, neighbor]);
    }
  }
  return null;
}

/** Pencere-yerel indeks ile bölge-yerel indeks arasındaki KESİN çeviri tablosu. */
export const REGION_WINDOW_NO_LOCAL = 0xffffffff;

/**
 * Bir residency penceresinin kimlik haritası.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Birleştirilmiş görünümdeki düğüm/kenar sıra numaraları PENCEREYE özgüdür:
 * aynı yol, [A,B,C] penceresinde başka, [B,C,D] penceresinde başka bir ordinal
 * alır. Bounded on-demand A* pencere kaydırdığında canlı arama durumunu
 * taşımak zorundadır; bunu her seferinde kararlı kimlik (OSM id) üzerinden
 * yapmak lineer taramadır ve ölçekte imkânsızdır.
 *
 * Bu tablo çeviriyi O(1) yapar: `pencere ordinal → (bölge, bölge-yerel indeks)`
 * ve tersi. Bölge-yerel indeks pencereden BAĞIMSIZDIR (bölge dosyası aynı
 * baytlardır, SHA ile doğrulanır) — bu yüzden iki pencere arasındaki ortak
 * bölgeler üzerinden çeviri KESİNDİR, tahmin içermez.
 */
export interface RegionWindowIdentity {
  readonly regionIds: readonly string[];
  /** Bölge yuvası → (bölge-yerel düğüm → pencere ordinali). */
  readonly nodeLocalToMerged: readonly Uint32Array[];
  /** Bölge yuvası → (bölge-yerel kenar → pencere ordinali). */
  readonly edgeLocalToMerged: readonly Uint32Array[];
  /** Bölge yuvası → (pencere ordinali → bölge-yerel düğüm | NO_LOCAL). */
  readonly nodeMergedToLocal: readonly Uint32Array[];
  /** Bölge yuvası → (pencere ordinali → bölge-yerel kenar | NO_LOCAL). */
  readonly edgeMergedToLocal: readonly Uint32Array[];
}

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

/* ══════════════════════════════════════════════════════════════════════════
   BOUNDED ON-DEMAND ARAMA ZARFI (RTG4)

   ── PORTAL KORİDORU ROTA DEĞİLDİR ────────────────────────────────────────
   Aşağıdaki zarf yalnız BUDAMA KANITIDIR: hangi bölgelerin sırayla belleğe
   alınacağını söyler. Kullanıcının süreceği yol, her zaman kanonik kenar
   durumlu A*'ın ürettiği kenar dizisidir. Portal dizisi ASLA rota olarak
   yayınlanmaz (bu dosya geometri üretmez — üretemez de).
   ══════════════════════════════════════════════════════════════════════════ */

export interface CrossRegionSearchEnvelope {
  readonly originRegionId: string;
  readonly destinationRegionId: string;
  /** Yönlü Portal v2 kanıtıyla seçilmiş sıralı bölge koridoru. */
  readonly corridorRegionIds: readonly string[];
  /** Ardışık, örtüşen residency pencereleri (her biri ≤ `maxResidentRegions`). */
  readonly windows: readonly (readonly string[])[];
  /**
   * `windows[i]` → `windows[i+1]` geçişinde AŞILAN sınır: kaynak bölge, hedef
   * bölge ve o yönde geçiş veren portal düğümlerinin kararlı OSM kimlikleri.
   * A* bu düğümlere ulaştığında pencerenin kaydırılması GEREKTİĞİNİ bilir.
   */
  readonly transitions: readonly {
    readonly fromRegionId: string;
    readonly toRegionId: string;
    readonly portalNodeIds: readonly string[];
  }[];
  readonly maxResidentRegions: number;
}

/**
 * Uçtan uca bölge koridorunu ve residency penceresi dizisini planlar.
 *
 * ── NEDEN BÖLGE DÜZEYİ YETMEZ (ÖLÇÜLDÜ) ──────────────────────────────────
 * Bölge komşuluk grafında en kısa yol KARAYOLUYLA geçilebilir olmak zorunda
 * değildir. İstanbul→Ankara için bölge düzeyi en kısa koridor
 * `tr-57-82 → tr-57-81 → tr-58-81` seçiyordu; bu dizi Marmara'yı kesiyor ve
 * Avrupa yakasından o sınıra ulaşan yol YOK. Arama 757 bin durum açıp
 * tükeniyordu: koridor "komşu" olduğu hâlde rota imkânsızdı.
 *
 * ── BU YÜZDEN BİLEŞEN DÜZEYİ ─────────────────────────────────────────────
 * Arama yönlü Portal v2 kayıtları üzerinde BİLEŞENDEN BİLEŞENE yürür. Bir
 * bölgeye hangi güçlü bağlı bileşenden GİRİLDİYSE, o bölgeden ancak AYNI
 * bileşene ait bir portalla ÇIKILABİLİR. Bileşen içi karşılıklı erişilebilirlik
 * tanım gereği garantidir; böylece koridor artık "komşuluk" değil GERÇEK
 * SÜRÜLEBİLİRLİK kanıtı taşır.
 *
 * Bölge içi bileşen-arası (condensation) bağlar bu planlamada KULLANILMAZ —
 * onlar manifestte değil ayrı artefakttadır. Sonuç bilinçli olarak TUTUCUdur:
 * bulunan koridor sürülebilir; bulunamazsa uydurulmaz, fail-closed edilir.
 *
 * `selectRegionalRouteCorridor` KALDIRILMADI: koridor tavana sığdığında
 * kullanılan tek-pencere yolu ve davranışı DEĞİŞMEDİ.
 */
export function planCrossRegionSearchEnvelope(
  manifest: TurkeyGraphManifest,
  origin: readonly [number, number],
  destination: readonly [number, number],
  maxResidentRegions: number,
): CrossRegionSearchEnvelope | null {
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.portals) || maxResidentRegions < 1) return null;
  const contains = (bbox: readonly [number, number, number, number], point: readonly [number, number]) =>
    point[1] >= bbox[0] && point[1] <= bbox[2] && point[0] >= bbox[1] && point[0] <= bbox[3];
  const originRegion = manifest.regions.find((region) => contains(region.bbox, origin));
  const destinationRegion = manifest.regions.find((region) => contains(region.bbox, destination));
  if (!originRegion || !destinationRegion) return null;

  if (originRegion.regionId === destinationRegion.regionId) {
    return {
      originRegionId: originRegion.regionId, destinationRegionId: destinationRegion.regionId,
      corridorRegionIds: [originRegion.regionId], windows: [[originRegion.regionId]],
      transitions: [], maxResidentRegions,
    };
  }

  /* Yönlü bileşen komşuluğu — YALNIZ olağan erişim. Destination-only geçiş bir
     sınır KANITIdır ama transit koridor yetkisi DEĞİLDİR; onu koridora almak
     servis yolunu ülke geçişi yapmak olurdu. */
  const arcs = new Map<string, { component: string; portal: TurkeyGraphPortalV2 }[]>();
  for (const portal of manifest.portals) {
    if (portal.accessRole !== 1) continue;
    const bucket = arcs.get(portal.sourceComponentId);
    const arc = { component: portal.destinationComponentId, portal };
    if (bucket) bucket.push(arc); else arcs.set(portal.sourceComponentId, [arc]);
  }
  const regionOfComponent = (componentId: string) => componentId.slice(0, componentId.indexOf(':'));

  /* Başlangıç bileşeni bilinmiyor (bileşen indeksi ayrı artefakttadır), bu
     yüzden köken bölgesinin TÜM bileşenleri kaynak alınır. İzin genişliği
     yalnız İLK adımdadır; sonraki her adım bileşen sürekliliğine tabidir. */
  const sources = (originRegion.components?.portalComponentIds ?? [])
    .filter((id) => arcs.has(id));
  if (!sources.length) return null;

  const previous = new Map<string, { component: string; portal: TurkeyGraphPortalV2 }>();
  const seen = new Set<string>(sources);
  const queue = [...sources];
  let goal: string | null = null;
  for (let cursor = 0; cursor < queue.length && goal === null; cursor++) {
    const current = queue[cursor];
    for (const arc of arcs.get(current) ?? []) {
      if (seen.has(arc.component)) continue;
      seen.add(arc.component);
      previous.set(arc.component, { component: current, portal: arc.portal });
      if (regionOfComponent(arc.component) === destinationRegion.regionId) { goal = arc.component; break; }
      queue.push(arc.component);
    }
  }
  if (goal === null) return null;                 // fail-closed: sürülebilir kanıt yok

  const componentPath: string[] = [goal];
  while (!sources.includes(componentPath[0])) {
    const step = previous.get(componentPath[0]);
    if (!step) return null;
    componentPath.unshift(step.component);
  }
  const corridorRegionIds = componentPath.map(regionOfComponent);
  if (new Set(corridorRegionIds).size !== corridorRegionIds.length) return null;   // tekrar eden bölge → fail-closed

  /* Pencereler ardışık ve ÖRTÜŞENDİR: [R0,R1,R2] → [R1,R2,R3] … Böylece her
     kaydırmada iki bölge yerinde kalır; canlı arama durumunun büyük kısmı
     kararlı kimliğe düşmeden, bölge-yerel indeksle KESİN olarak taşınır. */
  const windows: string[][] = [];
  if (corridorRegionIds.length <= maxResidentRegions) windows.push([...corridorRegionIds]);
  else for (let i = 0; i + maxResidentRegions <= corridorRegionIds.length; i++) {
    windows.push(corridorRegionIds.slice(i, i + maxResidentRegions));
  }

  /* Geçiş kanıtı SEÇİLEN bileşen çiftine aittir: aynı bölge çiftinde başka
     bileşenlere giden portallar bu koridorun sınırı DEĞİLDİR. */
  const nodesForPair = (from: string, to: string): string[] => {
    const nodes = new Set<string>();
    for (const portal of manifest.portals ?? []) {
      if (portal.accessRole !== 1) continue;
      if (portal.sourceComponentId !== from || portal.destinationComponentId !== to) continue;
      nodes.add(portal.sourceNodeId);
    }
    return [...nodes];
  };
  const transitions = windows.slice(0, -1).map((_window, i) => {
    const step = i + maxResidentRegions - 1;      // pencerenin ÖNCÜ bölgesi
    return {
      fromRegionId: corridorRegionIds[step],
      toRegionId: corridorRegionIds[step + 1],
      portalNodeIds: nodesForPair(componentPath[step], componentPath[step + 1]),
    };
  });
  if (transitions.some((t) => t.portalNodeIds.length === 0)) return null;   // fail-closed

  return {
    originRegionId: originRegion.regionId,
    destinationRegionId: destinationRegion.regionId,
    corridorRegionIds, windows, transitions, maxResidentRegions,
  };
}
