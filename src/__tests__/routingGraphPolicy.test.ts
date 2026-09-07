import { describe, expect, it } from 'vitest';

// @ts-expect-error build-time .mjs policy intentionally has no runtime app dependency.
const policy = await import('../../scripts/routingGraphPolicy.mjs');

describe('RTG v2 drivable road policy', () => {
  it('includes local public roads and excludes pedestrian ways', () => {
    expect(policy.classifyDrivableWay({ highway: 'residential' }, new Set(policy.DEFAULT_GRAPH_CLASSES))).toEqual({ highway: 'residential', role: 'ROUTABLE_PUBLIC' });
    expect(policy.classifyDrivableWay({ highway: 'footway' }, new Set(policy.DEFAULT_GRAPH_CLASSES))).toBeNull();
  });

  it('fails closed for private roads and driveway without explicit public permission', () => {
    expect(policy.classifyDrivableWay({ highway: 'service', service: 'driveway' }, new Set(policy.ROUTABLE_HIGHWAYS))).toBeNull();
    expect(policy.classifyDrivableWay({ highway: 'service', service: 'driveway', access: 'permissive' }, new Set(policy.ROUTABLE_HIGHWAYS))).toEqual({ highway: 'service', role: 'DESTINATION_ACCESS_ONLY' });
    expect(policy.classifyDrivableWay({ highway: 'residential', access: 'private' }, new Set(policy.DEFAULT_GRAPH_CLASSES))).toBeNull();
  });

  it('preserves explicit and implied one-way semantics', () => {
    expect(policy.onewaySemantics('-1', 'residential')).toEqual({ oneway: true, reversed: true });
    expect(policy.onewaySemantics(undefined, 'motorway')).toEqual({ oneway: true, reversed: false });
    expect(policy.onewaySemantics(undefined, 'residential')).toEqual({ oneway: false, reversed: false });
  });
});
