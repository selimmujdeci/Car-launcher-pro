/** Shared, fail-closed OSM drivable-road policy for the RTG builder. */
export const ROUTABLE_HIGHWAYS = Object.freeze([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street', 'service', 'road',
]);
export const DEFAULT_GRAPH_CLASSES = Object.freeze([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'unclassified', 'residential', 'living_street',
]);
export const EXCLUDED_HIGHWAYS = Object.freeze([
  'footway', 'pedestrian', 'path', 'cycleway', 'bridleway', 'steps',
  'corridor', 'platform', 'raceway', 'proposed', 'construction',
]);
const DENY = new Set(['no', 'private', 'agricultural', 'forestry', 'emergency', 'construction']);
const ALLOW = new Set(['yes', 'permissive', 'destination', 'customers', 'delivery']);

function normalized(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }

/**
 * Returns null for a non-routable way, otherwise its storage class and role.
 * `DESTINATION_ACCESS_ONLY` is intentionally explicit; RTG2 currently cannot
 * encode this role, so the builder must not silently promote it to transit.
 */
export function classifyDrivableWay(tags = {}, requested = null) {
  const highway = normalized(tags.highway);
  if (!highway || EXCLUDED_HIGHWAYS.includes(highway)) return null;
  if (requested && !requested.has(highway)) return null;
  if (!ROUTABLE_HIGHWAYS.includes(highway)) return null;
  const restrictions = ['access', 'motor_vehicle', 'motorcar', 'vehicle']
    .map((k) => normalized(tags[k])).filter(Boolean);
  if (restrictions.some((v) => DENY.has(v))) return null;
  const explicitAllow = restrictions.some((v) => ALLOW.has(v));
  if (highway === 'service') {
    const service = normalized(tags.service);
    if (service === 'driveway' || service === 'parking_aisle' || service === 'drive-through'
      || service === 'yard' || service === 'emergency_access') {
      return explicitAllow ? { highway, role: 'DESTINATION_ACCESS_ONLY' } : null;
    }
    return { highway, role: 'ROUTABLE_PUBLIC' };
  }
  return { highway, role: 'ROUTABLE_PUBLIC' };
}

export function onewaySemantics(value, highway) {
  const v = normalized(value);
  if (v === 'yes' || v === 'true' || v === '1') return { oneway: true, reversed: false };
  if (v === '-1' || v === 'reverse') return { oneway: true, reversed: true };
  if (v === 'no' || v === 'false' || v === '0') return { oneway: false, reversed: false };
  return { oneway: highway === 'motorway' || highway.endsWith('_link'), reversed: false };
}
