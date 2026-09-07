import type { RoutingGraphView } from './rtg2Reader';

export const TURKEY_GRAPH_MANIFEST_SCHEMA = 1;

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
}

export interface TurkeyGraphManifest {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly country: 'TR';
  readonly source: string;
  readonly sourceTimestamp: string;
  readonly buildTimestamp: string;
  readonly policyVersion: string;
  readonly graphFormat: 'RTG3';
  readonly regions: readonly TurkeyGraphRegion[];
}

export function validateTurkeyGraphManifest(value: unknown): TurkeyGraphManifest | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Partial<TurkeyGraphManifest>;
  if (m.schemaVersion !== TURKEY_GRAPH_MANIFEST_SCHEMA || m.country !== 'TR' ||
      m.graphFormat !== 'RTG3' || !Array.isArray(m.regions) || !m.regions.length) return null;
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
  return m as TurkeyGraphManifest;
}

/** Stable OSM node kimliğiyle overlap düğümlerini birleştirir; ikinci authority değildir. */
export function mergeRegionalGraphViews(views: readonly RoutingGraphView[]): RoutingGraphView | null {
  if (!views.length || views.some((v) => v.version !== 3)) return null;
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
  const restrictions: Array<[number,number,number,number]> = [];
  views.forEach((view, vi) => { for (let i=0;i<view.restrictionCount;i++) restrictions.push([edgeRemaps[vi][view.restrictionFromEdge[i]],edgeRemaps[vi][view.restrictionToEdge[i]],remaps[vi][view.restrictionViaNode[i]],view.restrictionType[i]]); });
  return {
    version:3,nodeCount:nodeLat.length,edgeCount:edges.length,parsedBytes:views.reduce((n,v)=>n+v.parsedBytes,0),trailingBytes:0,
    nodeLat:Float32Array.from(nodeLat),nodeLon:Float32Array.from(nodeLon),nodeSourceId:BigUint64Array.from(nodeIds),
    edgeFrom:Uint32Array.from(edges.map(e=>e.from)),edgeTo:Uint32Array.from(edges.map(e=>e.to)),edgeCostM:Uint32Array.from(edges.map(e=>e.cost)),
    edgeFlags:Uint8Array.from(edges.map(e=>(e.dir?1:0)|((e.cls&7)<<1))),edgeRoadClassV3:Uint8Array.from(edges.map(e=>e.cls)),
    edgeAccessRole:Uint8Array.from(edges.map(e=>e.access)),edgeDirection:Uint8Array.from(edges.map(e=>e.dir)),edgeStructure:Uint8Array.from(edges.map(e=>e.structure)),edgeLayer:Int8Array.from(edges.map(e=>e.layer)),edgeSourceWayId:BigUint64Array.from(edges.map(e=>e.way)),
    restrictionCount:restrictions.length,restrictionFromEdge:Uint32Array.from(restrictions.map(r=>r[0])),restrictionToEdge:Uint32Array.from(restrictions.map(r=>r[1])),restrictionViaNode:Uint32Array.from(restrictions.map(r=>r[2])),restrictionType:Uint8Array.from(restrictions.map(r=>r[3])),
  };
}
