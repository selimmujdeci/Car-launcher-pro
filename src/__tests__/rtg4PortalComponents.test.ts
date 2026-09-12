import { describe, expect, it } from 'vitest';
import {
  buildDirectedComponents, buildPortalV2, collectSeamEvidence,
} from '../../scripts/rtg4PortalComponents.mjs';
import { validateTurkeyGraphManifest } from '../platform/navigation/map/graph/turkeyGraphManifest';

type Edge = { from:number; to:number; wayId:number; accessRole:number; direction:number };
const nodeIds = [100n, 200n];
const coords = [[0.25, 0.25], [0.25, 0.75]];
const pair = [['tr-test-0-0', 'tr-test-1-0']] as [string, string][];

function evidenceFor(edges: Edge[]) {
  const evidence: ReturnType<typeof collectSeamEvidence> = [];
  const regions: { regionId:string; componentIds:string[] }[] = [];
  for (const regionId of pair[0]) {
    const components = buildDirectedComponents({ regionId, nodeIds, edges });
    const local = collectSeamEvidence({ regionId, regionPrefix:'tr-test', tileSize:.5, coords, nodeIds, edges,
      componentIndex:components.componentIndex, componentIds:components.componentIds });
    evidence.push(...local);
    regions.push({ regionId, componentIds:components.componentIds });
  }
  return { evidence, regions };
}

describe('RTG4 directed component ve Portal v2 authority', () => {
  it('one-way SCC yönünü condensation linkinde korur', () => {
    const graph = buildDirectedComponents({ regionId:'r', nodeIds, edges:[{from:0,to:1,wayId:7,accessRole:1,direction:1}] });
    expect(graph.componentIds).toHaveLength(2);
    expect(graph.links).toEqual([{sourceComponentId:'r:100',destinationComponentId:'r:200',accessRole:1}]);
  });

  it('bidirectional seam için iki yönlü, tekil portal üretir', () => {
    const { evidence, regions } = evidenceFor([{from:0,to:1,wayId:7,accessRole:1,direction:0}]);
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:[...evidence, ...evidence] });
    expect(result.portals.map(portal => `${portal.sourceRegionId}>${portal.destinationRegionId}`)).toEqual([
      'tr-test-0-0>tr-test-1-0', 'tr-test-1-0>tr-test-0-0',
    ]);
    expect(result.links[0].classification).toBe('ROUTABLE');
  });

  it('one-way A→B için ters portal üretmez', () => {
    const { evidence, regions } = evidenceFor([{from:0,to:1,wayId:7,accessRole:1,direction:1}]);
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:evidence });
    expect(result.portals).toHaveLength(1);
    expect(result.portals[0].sourceRegionId).toBe('tr-test-0-0');
    expect(result.links[0].classification).toBe('ROUTABLE');
  });

  it('one-way B→A yönünü ayrı korur', () => {
    const { evidence, regions } = evidenceFor([{from:1,to:0,wayId:7,accessRole:1,direction:1}]);
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:evidence });
    expect(result.portals).toHaveLength(1);
    expect(result.portals[0].sourceRegionId).toBe('tr-test-1-0');
  });

  it('shared node fakat crossing edge yoksa NON_ROUTABLE kalır', () => {
    const result = buildPortalV2({ regions:pair[0].map(regionId=>({regionId,componentIds:[`${regionId}:100`]})), legacyNeighborPairs:pair, seamEvidence:[] });
    expect(result.links[0].classification).toBe('NON_ROUTABLE');
  });

  it('diagonal corner crossing portal sayılmaz', () => {
    const diagonalCoords = [[0.25,0.25],[0.75,0.75]];
    const graph = buildDirectedComponents({regionId:'tr-test-0-0',nodeIds,edges:[{from:0,to:1,wayId:7,accessRole:1,direction:1}]});
    expect(collectSeamEvidence({regionId:'tr-test-0-0',regionPrefix:'tr-test',tileSize:.5,coords:diagonalCoords,nodeIds,
      edges:[{from:0,to:1,wayId:7,accessRole:1,direction:1}],componentIndex:graph.componentIndex,componentIds:graph.componentIds})).toEqual([]);
  });

  it('access-denied crossing graphta bulunmadığında portal üretmez', () => {
    const { evidence } = evidenceFor([]);
    expect(evidence).toEqual([]);
  });

  it('destination-only crossingi kanıtlar fakat transit neighbor yapmaz', () => {
    const { evidence, regions } = evidenceFor([{from:0,to:1,wayId:7,accessRole:2,direction:1}]);
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:evidence });
    expect(result.portals[0].accessRole).toBe(2);
    expect(result.links[0].classification).toBe('NON_ROUTABLE');
  });

  it('çelişen aynı-region gözlemini AMBIGUOUS sınıflandırır', () => {
    const { evidence, regions } = evidenceFor([{from:0,to:1,wayId:7,accessRole:1,direction:1}]);
    const conflicting = {...evidence[0], localSourceComponentId:'tr-test-0-0:999'};
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:[...evidence, conflicting] });
    expect(result.links[0].classification).toBe('AMBIGUOUS');
  });

  it('eksik component referansını INVALID sınıflandırır', () => {
    const { evidence, regions } = evidenceFor([{from:0,to:1,wayId:7,accessRole:1,direction:1}]);
    regions[1].componentIds = [];
    const result = buildPortalV2({ regions, legacyNeighborPairs:pair, seamEvidence:evidence });
    expect(result.links[0].classification).toBe('INVALID');
  });

  it('manifest Portal v2 referanslarını fail-closed doğrular', () => {
    const hash = 'a'.repeat(64), portalId = `p2:${'b'.repeat(64)}`;
    const component = (regionId:string, id:string) => ({schemaVersion:1,file:`regions/${regionId}.components.json`,sha256:hash,byteSize:10,indexFile:`regions/${regionId}.component-index.bin`,indexSha256:hash,indexByteSize:8,indexEncoding:'UINT32_LE_LOCAL_NODE_COMPONENT_INDEX',count:1,directedLinkCount:0,portalComponentIds:[id]});
    const manifest = {
      schemaVersion:2,datasetId:'fixture',country:'TR',source:'fixture',sourceTimestamp:'2026-01-01T00:00:00Z',buildTimestamp:'2026-01-01T00:00:00Z',policyVersion:'p',graphFormat:'RTG4',portalSchemaVersion:2,
      regions:[
        {regionId:'a',bbox:[0,0,1,1],graphFile:'regions/a.rtg4',sha256:hash,byteSize:10,nodeCount:2,edgeCount:1,neighbors:['b'],sourceHash:hash,components:component('a','a:1')},
        {regionId:'b',bbox:[0,1,1,2],graphFile:'regions/b.rtg4',sha256:hash,byteSize:10,nodeCount:2,edgeCount:1,neighbors:['a'],sourceHash:hash,components:component('b','b:2')},
      ],
      portals:[{portalId,portalNodeId:'2',sourceRegionId:'a',destinationRegionId:'b',sourceComponentId:'a:1',destinationComponentId:'b:2',traversalDirection:'FORWARD',accessRole:1,incidentEdgeId:'7:1:2:1',sourceNodeId:'1',destinationNodeId:'2',provenance:'OSM_DIRECTED_EDGE_TILE_CROSSING',sourceHash:hash}],
      neighborAudit:{total:1,ROUTABLE:1,NON_ROUTABLE:0,INVALID:0,AMBIGUOUS:0,links:[{sourceRegionId:'a',destinationRegionId:'b',classification:'ROUTABLE'}]},
    };
    expect(validateTurkeyGraphManifest(manifest)).not.toBeNull();
    const missing = structuredClone(manifest); missing.regions[1].components.portalComponentIds = [];
    expect(validateTurkeyGraphManifest(missing)).toBeNull();
    const conflict = structuredClone(manifest); conflict.portals.push({...conflict.portals[0],portalId:`p2:${'c'.repeat(64)}`,destinationComponentId:'b:999'});
    expect(validateTurkeyGraphManifest(conflict)).toBeNull();
  });
});
