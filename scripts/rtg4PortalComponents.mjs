import { createHash } from 'node:crypto';

export const COMPONENT_SCHEMA_VERSION = 1;
export const PORTAL_SCHEMA_VERSION = 2;

const stableEdgeId = (nodeIds, edge) =>
  `${edge.wayId}:${nodeIds[edge.from]}:${nodeIds[edge.to]}:${edge.direction}`;

const regionForCoordinate = (coord, prefix, tile) =>
  `${prefix}-${Math.floor(coord[1] / tile)}-${Math.floor(coord[0] / tile)}`;

const cardinalNeighbors = (a, b) => {
  const pa = a.split('-'), pb = b.split('-');
  const ax = Number(pa.at(-2)), ay = Number(pa.at(-1));
  const bx = Number(pb.at(-2)), by = Number(pb.at(-1));
  return Number.isInteger(ax) && Number.isInteger(ay) && Number.isInteger(bx) && Number.isInteger(by) &&
    Math.abs(ax - bx) + Math.abs(ay - by) === 1;
};

const addArc = (heads, to, next, from, destination, cursor) => {
  to[cursor] = destination;
  next[cursor] = heads[from];
  heads[from] = cursor;
};

/**
 * Region-local SCC authority. Ordinary-access arcs determine SCC membership;
 * destination-only arcs remain labelled condensation edges and can therefore
 * never silently become ordinary transit connectivity.
 */
export function buildDirectedComponents({ regionId, nodeIds, edges }) {
  const nodeCount = nodeIds.length;
  let ordinaryArcCount = 0;
  for (const edge of edges) if (edge.accessRole === 1) ordinaryArcCount += edge.direction === 0 ? 2 : 1;

  const heads = new Int32Array(nodeCount).fill(-1);
  const reverseHeads = new Int32Array(nodeCount).fill(-1);
  const to = new Int32Array(ordinaryArcCount);
  const next = new Int32Array(ordinaryArcCount);
  const reverseTo = new Int32Array(ordinaryArcCount);
  const reverseNext = new Int32Array(ordinaryArcCount);
  let cursor = 0;
  for (const edge of edges) {
    if (edge.accessRole !== 1) continue;
    addArc(heads, to, next, edge.from, edge.to, cursor);
    addArc(reverseHeads, reverseTo, reverseNext, edge.to, edge.from, cursor++);
    if (edge.direction === 0) {
      addArc(heads, to, next, edge.to, edge.from, cursor);
      addArc(reverseHeads, reverseTo, reverseNext, edge.from, edge.to, cursor++);
    }
  }

  const seen = new Uint8Array(nodeCount);
  const order = new Int32Array(nodeCount);
  const stackNode = new Int32Array(nodeCount);
  const stackArc = new Int32Array(nodeCount);
  let orderLength = 0;
  for (let root = 0; root < nodeCount; root++) {
    if (seen[root]) continue;
    let depth = 0;
    seen[root] = 1;
    stackNode[0] = root;
    stackArc[0] = heads[root];
    while (depth >= 0) {
      const arc = stackArc[depth];
      if (arc < 0) {
        order[orderLength++] = stackNode[depth--];
        continue;
      }
      stackArc[depth] = next[arc];
      const destination = to[arc];
      if (!seen[destination]) {
        seen[destination] = 1;
        depth++;
        stackNode[depth] = destination;
        stackArc[depth] = heads[destination];
      }
    }
  }

  const componentIndex = new Int32Array(nodeCount).fill(-1);
  const representatives = [];
  const flood = new Int32Array(nodeCount);
  for (let oi = orderLength - 1; oi >= 0; oi--) {
    const root = order[oi];
    if (componentIndex[root] >= 0) continue;
    const index = representatives.length;
    let minimum = nodeIds[root];
    let length = 1;
    flood[0] = root;
    componentIndex[root] = index;
    for (let cursor = 0; cursor < length; cursor++) {
      const node = flood[cursor];
      if (nodeIds[node] < minimum) minimum = nodeIds[node];
      for (let arc = reverseHeads[node]; arc >= 0; arc = reverseNext[arc]) {
        const destination = reverseTo[arc];
        if (componentIndex[destination] >= 0) continue;
        componentIndex[destination] = index;
        flood[length++] = destination;
      }
    }
    representatives.push(minimum);
  }

  const componentIds = representatives.map(nodeId => `${regionId}:${nodeId}`);
  if (new Set(componentIds).size !== componentIds.length) throw new Error(`RTG4_COMPONENT_ID_COLLISION:${regionId}`);
  const linkMap = new Map();
  const recordLink = (edge, from, destination) => {
    const sourceComponentId = componentIds[componentIndex[from]];
    const destinationComponentId = componentIds[componentIndex[destination]];
    if (sourceComponentId === destinationComponentId && edge.accessRole === 1) return;
    const key = `${sourceComponentId}>${destinationComponentId}:${edge.accessRole}`;
    linkMap.set(key, { sourceComponentId, destinationComponentId, accessRole: edge.accessRole });
  };
  for (const edge of edges) {
    recordLink(edge, edge.from, edge.to);
    if (edge.direction === 0) recordLink(edge, edge.to, edge.from);
  }
  const links = [...linkMap.values()].sort((a, b) =>
    a.sourceComponentId.localeCompare(b.sourceComponentId) ||
    a.destinationComponentId.localeCompare(b.destinationComponentId) || a.accessRole - b.accessRole);
  return {
    schemaVersion: COMPONENT_SCHEMA_VERSION,
    regionId,
    componentIds,
    representativeNodeIds: representatives.map(String),
    componentIndex,
    links,
  };
}

export function collectSeamEvidence({ regionId, regionPrefix, tileSize, coords, nodeIds, edges, componentIndex, componentIds }) {
  const evidence = [];
  const record = (edge, from, to, traversalDirection) => {
    const sourceRegionId = regionForCoordinate(coords[from], regionPrefix, tileSize);
    const destinationRegionId = regionForCoordinate(coords[to], regionPrefix, tileSize);
    /* Bir köşeyi yalnız geometrik olarak paylaşan diagonal tile'lar portal
       değildir. Gerçek graph edge'i bile olsa aradaki sınır sırası bu formatta
       kanıtlanamaz; bu faz onu uydurmak yerine kapsam dışı bırakır. */
    if (sourceRegionId === destinationRegionId || !cardinalNeighbors(sourceRegionId, destinationRegionId)) return;
    evidence.push({
      observedRegionId: regionId,
      sourceRegionId,
      destinationRegionId,
      portalNodeId: String(nodeIds[to]),
      sourceNodeId: String(nodeIds[from]),
      destinationNodeId: String(nodeIds[to]),
      localSourceComponentId: componentIds[componentIndex[from]],
      localDestinationComponentId: componentIds[componentIndex[to]],
      incidentEdgeId: stableEdgeId(nodeIds, edge),
      traversalDirection,
      accessRole: edge.accessRole,
    });
  };
  for (const edge of edges) {
    record(edge, edge.from, edge.to, 'FORWARD');
    if (edge.direction === 0) record(edge, edge.to, edge.from, 'REVERSE');
  }
  evidence.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return evidence;
}

export function buildPortalV2({ regions, legacyNeighborPairs, seamEvidence }) {
  const regionIds = new Set(regions.map(region => region.regionId));
  const componentSets = new Map(regions.map(region => [region.regionId, new Set(region.componentIds)]));
  const observations = new Map();
  const evidenceByKey = new Map();
  for (const item of seamEvidence) {
    const key = `${item.sourceRegionId}>${item.destinationRegionId}:${item.incidentEdgeId}:${item.traversalDirection}`;
    const list = evidenceByKey.get(key) ?? [];
    list.push(item);
    evidenceByKey.set(key, list);
    const byRegion = observations.get(key) ?? new Map();
    const previous = byRegion.get(item.observedRegionId);
    const value = `${item.localSourceComponentId}|${item.localDestinationComponentId}|${item.accessRole}|${item.portalNodeId}`;
    if (previous && previous !== value) byRegion.set(item.observedRegionId, 'CONFLICT');
    else byRegion.set(item.observedRegionId, value);
    observations.set(key, byRegion);
  }

  const portals = [];
  const invalidPairs = new Set();
  const ambiguousPairs = new Set();
  for (const [key, byRegion] of observations) {
    const evidence = evidenceByKey.get(key) ?? [];
    const first = evidence[0];
    if (!first) continue;
    const pair = [first.sourceRegionId, first.destinationRegionId].sort().join('|');
    if (!regionIds.has(first.sourceRegionId) || !regionIds.has(first.destinationRegionId)) {
      invalidPairs.add(pair);
      continue;
    }
    if (byRegion.get(first.sourceRegionId) === 'CONFLICT' || byRegion.get(first.destinationRegionId) === 'CONFLICT') {
      ambiguousPairs.add(pair);
      continue;
    }
    const sourceObservation = evidence.find(item => item.observedRegionId === first.sourceRegionId);
    const destinationObservation = evidence.find(item => item.observedRegionId === first.destinationRegionId);
    if (!sourceObservation || !destinationObservation) {
      ambiguousPairs.add(pair);
      continue;
    }
    const sourceComponentId = sourceObservation.localSourceComponentId;
    const destinationComponentId = destinationObservation.localDestinationComponentId;
    if (!componentSets.get(first.sourceRegionId)?.has(sourceComponentId) ||
        !componentSets.get(first.destinationRegionId)?.has(destinationComponentId)) {
      invalidPairs.add(pair);
      continue;
    }
    const identitySource = `${first.sourceRegionId}>${first.destinationRegionId}:${first.portalNodeId}:${first.incidentEdgeId}:${first.traversalDirection}`;
    const portalId = `p2:${createHash('sha256').update(identitySource).digest('hex')}`;
    portals.push({
      portalId,
      portalNodeId: first.portalNodeId,
      sourceRegionId: first.sourceRegionId,
      destinationRegionId: first.destinationRegionId,
      sourceComponentId,
      destinationComponentId,
      traversalDirection: first.traversalDirection,
      accessRole: first.accessRole,
      incidentEdgeId: first.incidentEdgeId,
      sourceNodeId: first.sourceNodeId,
      destinationNodeId: first.destinationNodeId,
      provenance: 'OSM_DIRECTED_EDGE_TILE_CROSSING',
    });
  }
  portals.sort((a, b) => a.portalId.localeCompare(b.portalId));
  if (new Set(portals.map(portal => portal.portalId)).size !== portals.length) throw new Error('RTG4_PORTAL_ID_COLLISION');

  /* Destination-only crossing kanıttır fakat corridor transit authority'si
     değildir. Yalnız ordinary-access portal bir neighbor link'i ROUTABLE yapar. */
  const routablePairs = new Set(portals.filter(portal => portal.accessRole === 1)
    .map(portal => [portal.sourceRegionId, portal.destinationRegionId].sort().join('|')));
  const links = legacyNeighborPairs.map(([a, b]) => {
    const pair = [a, b].sort().join('|');
    const classification = invalidPairs.has(pair) ? 'INVALID' : ambiguousPairs.has(pair) ? 'AMBIGUOUS' :
      routablePairs.has(pair) ? 'ROUTABLE' : 'NON_ROUTABLE';
    return { sourceRegionId: a, destinationRegionId: b, classification };
  }).sort((a, b) => a.sourceRegionId.localeCompare(b.sourceRegionId) || a.destinationRegionId.localeCompare(b.destinationRegionId));
  return { portals, links };
}
