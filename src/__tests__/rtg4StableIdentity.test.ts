import { describe, expect, it } from 'vitest';
import {
  RTG4_MAGIC, captureStableRtg3SearchState, parseRoutingGraph,
  restoreLocalRtg3SearchState, stableDirectedEdgeId, stableRestrictionId, viaWayStep,
  RTG3_VIA_WAY_FLAG, RTG3_VIA_WAY_FINAL,
} from '../platform/navigation/map/graph/rtg2Reader';

type Edge = readonly [number, number, bigint];
type Restriction = readonly [number, number, number, number, number, number, bigint];

function graph(edges: readonly Edge[], restrictions: readonly Restriction[]): ArrayBuffer {
  const size = 16 + 4 * 16 + edges.length * 28 + restrictions.length * 24;
  const buffer = new ArrayBuffer(size), view = new DataView(buffer); let o = 0;
  view.setUint32(o, RTG4_MAGIC, true); o += 4;
  view.setUint32(o, 4, true); o += 4;
  view.setUint32(o, edges.length, true); o += 4;
  view.setUint32(o, restrictions.length, true); o += 4;
  for (let i = 0; i < 4; i++) {
    view.setFloat32(o, 36 + i / 100, true); view.setFloat32(o + 4, 34 + i / 100, true);
    view.setBigUint64(o + 8, 1000n + BigInt(i), true); o += 16;
  }
  for (const [from, to, way] of edges) {
    view.setUint32(o, from, true); view.setUint32(o + 4, to, true); view.setUint32(o + 8, 100, true);
    view.setBigUint64(o + 12, way, true); view.setUint8(o + 20, 5); view.setUint8(o + 21, 1);
    view.setUint8(o + 22, 1); view.setUint8(o + 23, 0); view.setInt8(o + 24, 0); o += 28;
  }
  for (const [from, to, via, type, seq, chain, relation] of restrictions) {
    view.setUint32(o, from, true); view.setUint32(o + 4, to, true); view.setUint32(o + 8, via, true);
    view.setUint8(o + 12, type); view.setUint8(o + 13, seq); view.setUint16(o + 14, chain, true);
    view.setBigUint64(o + 16, relation, true); o += 24;
  }
  return buffer;
}

const parse = (buffer:ArrayBuffer) => {
  const result = parseRoutingGraph(buffer); expect(result.outcome, result.detail).toBe('OK'); return result.view!;
};

describe('RTG4 stable cross-region identity', () => {
  it('farklı local ordinal kullanan overlap edge kimliğini eşit üretir', () => {
    const a = parse(graph([[0,1,10n],[1,2,20n],[2,3,30n]], []));
    const b = parse(graph([[2,3,30n],[0,1,10n],[1,2,20n]], []));
    expect(stableDirectedEdgeId(a, 1)).toBe(stableDirectedEdgeId(b, 2));
    expect(stableDirectedEdgeId(a, 0)).not.toBe(stableDirectedEdgeId(a, 1));
  });

  it('relation + sequence + stable edge tuple ile via-way kimliği ordinal ve chainId değişiminden etkilenmez', () => {
    const types = [RTG3_VIA_WAY_FLAG | 1, RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | 1];
    const a = parse(graph([[0,1,10n],[1,2,20n],[2,3,30n]], [[0,1,1,types[0],0,7,900n],[1,2,2,types[1],1,7,900n]]));
    const b = parse(graph([[2,3,30n],[0,1,10n],[1,2,20n]], [[1,2,1,types[0],0,3,900n],[2,0,2,types[1],1,3,900n]]));
    expect(stableRestrictionId(a, 0)).toBe(stableRestrictionId(b, 0));
    expect(stableRestrictionId(a, 1)).toBe(stableRestrictionId(b, 1));
  });

  it('aktif via-way state eviction sonrasında exact restore edilir', () => {
    const types = [RTG3_VIA_WAY_FLAG | 1, RTG3_VIA_WAY_FLAG | RTG3_VIA_WAY_FINAL | 1];
    const a = parse(graph([[0,1,10n],[1,2,20n],[2,3,30n]], [[0,1,1,types[0],0,7,900n],[1,2,2,types[1],1,7,900n]]));
    const b = parse(graph([[2,3,30n],[0,1,10n],[1,2,20n]], [[1,2,1,types[0],0,3,900n],[2,0,2,types[1],1,3,900n]]));
    const armed = viaWayStep(a, -1, 0, 0, 0);
    const onVia = viaWayStep(a, 0, armed, 1, 1);
    const stable = captureStableRtg3SearchState(a, 2, 1, onVia);
    expect(stable).not.toBeNull();
    expect(restoreLocalRtg3SearchState(b, stable!)).toEqual({ node:2, previousEdge:2, viaWayMask:onVia });
  });

  it('eski RTG3 stable-state operation ve eşlenemeyen edge için fail-closed döner', () => {
    const bytes = graph([[0,1,10n]], []);
    new DataView(bytes).setUint32(0, 0x33475452, true);
    const oldView = parse(bytes);
    expect(captureStableRtg3SearchState(oldView, 1, 0, 0)).toBeNull();
    const view = parse(graph([[0,1,10n]], []));
    expect(restoreLocalRtg3SearchState(view, { nodeId:1001n, previousEdgeId:'missing', activeRestrictionIds:[] })).toBeNull();
  });

  it('RTG4 relation kimliği eksikse parser grafı reddeder', () => {
    const bad = graph([[0,1,10n]], [[0,0,1,1,0,0,0n]]);
    expect(parseRoutingGraph(bad).outcome).toBe('INVALID');
  });
});
