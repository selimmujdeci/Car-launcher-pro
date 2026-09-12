import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRoutingGraph, RTG3_MAGIC, edgeAccessRole, edgeRoadClass, turnIsAllowed,
} from '../platform/navigation/map/graph/rtg2Reader';

function fixture(): ArrayBuffer {
  const b = new ArrayBuffer(16 + 3 * 16 + 2 * 28 + 16);
  const v = new DataView(b); let o = 0;
  v.setUint32(o, RTG3_MAGIC, true); o += 4;
  v.setUint32(o, 3, true); o += 4;
  v.setUint32(o, 2, true); o += 4;
  v.setUint32(o, 1, true); o += 4;
  for (const [lat, lon] of [[36.9,34.8],[36.91,34.81],[36.92,34.82]]) {
    v.setFloat32(o, lat, true); v.setFloat32(o + 4, lon, true); o += 16;
  }
  for (const [from,to,way,cls,access] of [[0,1,10,7,1],[1,2,11,9,2]]) {
    v.setUint32(o, from, true); v.setUint32(o+4, to, true); v.setUint32(o+8, 100, true);
    v.setBigUint64(o+12, BigInt(way), true); v.setUint8(o+20, cls); v.setUint8(o+21, access);
    v.setUint8(o+22, 1); v.setUint8(o+23, 1); v.setInt8(o+24, 1); o += 28;
  }
  v.setUint32(o,0,true);v.setUint32(o+4,1,true);v.setUint32(o+8,1,true);v.setUint8(o+12,1);
  return b;
}

describe('RTG3 reader', () => {
  it('reads extended edge truth and turn restrictions', () => {
    const r = parseRoutingGraph(fixture());
    expect(r.outcome).toBe('OK'); const g = r.view!;
    expect(g.version).toBe(3);
    expect(edgeRoadClass(g, 0)).toBe(7);
    expect(edgeAccessRole(g, 1)).toBe(2);
    expect(g.edgeStructure[0]).toBe(1);
    expect(g.edgeLayer[0]).toBe(1);
    expect(turnIsAllowed(g, 0, 1, 1)).toBe(false);
  });

  it('fails closed on truncated RTG3', () => {
    expect(parseRoutingGraph(fixture().slice(0, -1)).outcome).toBe('TRUNCATED');
  });

  it('applies only-turn semantics and rejects unknown metadata enums', () => {
    const only = fixture();
    const restrictionOffset = 16 + 3 * 16 + 2 * 28;
    new DataView(only).setUint8(restrictionOffset + 12, 5);
    const parsed = parseRoutingGraph(only).view!;
    expect(turnIsAllowed(parsed, 0, 1, 1)).toBe(true);
    expect(turnIsAllowed(parsed, 0, 0, 1)).toBe(false);

    const invalid = fixture();
    new DataView(invalid).setUint8(16 + 3 * 16 + 21, 0);
    expect(parseRoutingGraph(invalid).outcome).toBe('INVALID');
  });

  it('parses all three real full-drivable AOI artifacts', () => {
    for (const name of ['tarsus', 'mersin', 'erdemli']) {
      const b = readFileSync(resolve(`field-runs/routing-graph-v3-20260907/${name}-full.rtg3`));
      const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const r = parseRoutingGraph(ab);
      expect(r.outcome, name).toBe('OK');
      expect(r.view?.version).toBe(3);
      expect(r.view?.edgeCount).toBeGreaterThan(0);
    }
  });

  it('keeps RTG3 access and turn admission inside the canonical worker route authority', () => {
    const worker = readFileSync(resolve('src/platform/navigation/NavigationCompute.worker.ts'), 'utf8');
    expect(worker).toContain('turnIsAllowed(view, previousEdge, ordinal, cur)');
    expect(worker).toContain('accessRole === 2 && to !== goalIdx');
    expect(worker).toContain('accessRole !== 1 && accessRole !== 2');
    expect(worker.match(/function _aStar\(/g)).toHaveLength(1);
  });
});
