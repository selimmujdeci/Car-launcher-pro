import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRoutingGraph } from '../platform/navigation/map/graph/rtg2Reader';
import { buildGraphAdjacency, outgoingRange } from '../platform/navigation/map/graph/graphAdjacency';
import {
  mergeRegionalGraphViews, validateTurkeyGraphManifest,
} from '../platform/navigation/map/graph/turkeyGraphManifest';
import {
  _resetGraphResidencyForTest, acquireRegionalRoutingGraph, getGraphResidencySnapshot,
} from '../platform/navigation/map/graph/graphResidencyRuntime';

const base = resolve('field-runs/turkey-regional-rtg3-20260908');
const manifest = JSON.parse(readFileSync(resolve(base, 'turkey-graph-manifest.json'), 'utf8'));
const bytes = (file: string) => readFileSync(resolve(base, file));
const arrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

afterEach(() => { vi.unstubAllGlobals(); _resetGraphResidencyForTest(); });

describe('Turkey regional RTG3 platform', () => {
  it('validates reciprocal deterministic neighbors and rejects broken relationship', () => {
    expect(validateTurkeyGraphManifest(manifest)?.regions).toHaveLength(2);
    const broken = structuredClone(manifest);
    broken.regions[1].neighbors = [];
    expect(validateTurkeyGraphManifest(broken)).toBeNull();
  });

  it('merges real neighboring partitions by stable OSM node identity', () => {
    const views = manifest.regions.map((r: { graphFile: string }) =>
      parseRoutingGraph(arrayBuffer(bytes(r.graphFile))).view!);
    const merged = mergeRegionalGraphViews(views)!;
    expect(merged.version).toBe(3);
    expect(merged.nodeCount).toBeLessThan(views[0].nodeCount + views[1].nodeCount);
    expect([...merged.nodeSourceId].every((id) => id !== 0n)).toBe(true);
    const adjacency = buildGraphAdjacency(merged);
    const seen = new Uint8Array(merged.nodeCount); const queue = [0]; seen[0] = 1;
    while (queue.length) { const node = queue.shift()!; const r = outgoingRange(adjacency, node); for (let i=r.start;i<r.end;i++) { const to=adjacency.targetNode[i]; if(!seen[to]) { seen[to]=1; queue.push(to); } } }
    expect(seen.some((value) => value === 1)).toBe(true);
  });

  it('loads real regions through canonical residency and fails closed on SHA mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const name = url.split('/').at(-1)!;
      return new Response(bytes(name));
    }));
    const ids = manifest.regions.map((r: { regionId: string }) => r.regionId);
    const merged = await acquireRegionalRoutingGraph(manifest, ids, '/fixture');
    expect(merged?.version).toBe(3);
    expect(getGraphResidencySnapshot().residentRegions).toEqual(ids);

    _resetGraphResidencyForTest();
    const corrupt = structuredClone(manifest); corrupt.regions[0].sha256 = '0'.repeat(64);
    expect(await acquireRegionalRoutingGraph(corrupt, ids, '/fixture')).toBeNull();
    expect(getGraphResidencySnapshot().state).toBe('CORRUPT');
  });
});
