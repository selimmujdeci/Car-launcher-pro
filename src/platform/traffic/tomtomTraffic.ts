/**
 * tomtomTraffic — TomTom Traffic API istemcisi (akış + olay + harita katmanı).
 *
 * Kullanılan uç noktalar (TomTom Traffic API):
 *  · Flow Segment Data v4 — bulunulan yolun anlık / serbest akış hızı + yol geometrisi.
 *  · Incident Details v5  — çevredeki kaza, yol çalışması, kapalı yol, sıkışıklık;
 *                            gerçek yol adları (from/to), gecikme (sn), uzunluk (m).
 *  · Flow raster tiles v4 — yolları trafiğe göre renklendiren resmî katman
 *                            (`relative0`: Google Maps benzeri yeşil→kırmızı).
 *
 * DÜRÜSTLÜK: çözücüler yanıtta OLMAYAN alanı uydurmaz — eksik hız/ad/gecikme `null`
 * kalır. Ağ/anahtar hatası "trafik akıcı" demek DEĞİLDİR; çağıran veri yok der.
 * Lisans: TomTom verisi gösterildiği her yerde "© TomTom" atfı ZORUNLUDUR.
 */
import { signalWithTimeout } from '../../utils/abortCompat';

export type TrafficLevel = 'free' | 'moderate' | 'heavy' | 'standstill';

export type IncidentKind =
  | 'accident' | 'jam' | 'roadworks' | 'road_closed' | 'lane_closed'
  | 'broken_vehicle' | 'weather' | 'danger' | 'other';

export interface TrafficRoad {
  readonly currentSpeedKmh: number;
  readonly freeFlowSpeedKmh: number;
  /** 0–1; düşük güven = az veri (TomTom kendi beyanı). */
  readonly confidence: number | null;
  readonly roadClosed: boolean;
  readonly delaySec: number;
  readonly level: TrafficLevel;
  /** Yol sınıfı (FRC0 otoyol … FRC6 yerel). */
  readonly frc: string | null;
  /** [lng, lat] — yolun gerçek geometrisi. */
  readonly coordinates: ReadonlyArray<readonly [number, number]>;
}

export interface TrafficIncident {
  readonly id: string;
  readonly kind: IncidentKind;
  readonly description: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly roadNumbers: readonly string[];
  readonly delaySec: number | null;
  readonly lengthM: number | null;
  /** TomTom magnitudeOfDelay: 0 bilinmiyor · 1 küçük · 2 orta · 3 büyük · 4 belirsiz/kapalı. */
  readonly magnitude: number;
  readonly coordinates: ReadonlyArray<readonly [number, number]>;
  /** Kullanıcıya en yakın noktasının uzaklığı (m); konum yoksa null. */
  readonly distanceM: number | null;
}

/* ── Seviye ─────────────────────────────────────────────────────────────── */

/** Anlık/serbest akış oranı → seviye (Google/TomTom relative renkleriyle uyumlu eşikler). */
export function levelFromSpeeds(current: number, freeFlow: number): TrafficLevel {
  if (!(freeFlow > 0) || !Number.isFinite(current)) return 'free';
  const r = current / freeFlow;
  if (r >= 0.75) return 'free';
  if (r >= 0.5) return 'moderate';
  if (r >= 0.25) return 'heavy';
  return 'standstill';
}

/* ── Flow Segment Data ──────────────────────────────────────────────────── */

interface RawFlow {
  flowSegmentData?: {
    frc?: string;
    currentSpeed?: number;
    freeFlowSpeed?: number;
    currentTravelTime?: number;
    freeFlowTravelTime?: number;
    confidence?: number;
    roadClosure?: boolean;
    coordinates?: { coordinate?: Array<{ latitude?: number; longitude?: number }> };
  };
}

export function parseFlowSegment(raw: unknown): TrafficRoad | null {
  const fd = (raw as RawFlow | null)?.flowSegmentData;
  if (!fd) return null;
  const cur = fd.currentSpeed;
  const free = fd.freeFlowSpeed;
  if (typeof cur !== 'number' || typeof free !== 'number' || !Number.isFinite(cur) || !Number.isFinite(free)) return null;
  const coords = (fd.coordinates?.coordinate ?? [])
    .filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    .map((c) => [c.longitude!, c.latitude!] as const);
  const closed = fd.roadClosure === true;
  const delay = typeof fd.currentTravelTime === 'number' && typeof fd.freeFlowTravelTime === 'number'
    ? Math.max(0, fd.currentTravelTime - fd.freeFlowTravelTime) : 0;
  return {
    currentSpeedKmh: cur,
    freeFlowSpeedKmh: free,
    confidence: typeof fd.confidence === 'number' ? fd.confidence : null,
    roadClosed: closed,
    delaySec: delay,
    level: closed ? 'standstill' : levelFromSpeeds(cur, free),
    frc: fd.frc ?? null,
    coordinates: coords,
  };
}

/* ── Incident Details v5 ────────────────────────────────────────────────── */

const ICON_KIND: Record<number, IncidentKind> = {
  1: 'accident', 2: 'weather', 3: 'danger', 4: 'weather', 5: 'weather', 6: 'jam',
  7: 'lane_closed', 8: 'road_closed', 9: 'roadworks', 10: 'weather', 11: 'weather', 14: 'broken_vehicle',
};

interface RawIncident {
  id?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    id?: string;
    iconCategory?: number;
    magnitudeOfDelay?: number;
    events?: Array<{ description?: string }>;
    from?: string;
    to?: string;
    length?: number;
    delay?: number;
    roadNumbers?: string[];
  };
}

function toCoords(geom: RawIncident['geometry']): Array<readonly [number, number]> {
  const c = geom?.coordinates;
  if (!Array.isArray(c)) return [];
  if (geom?.type === 'Point' && c.length >= 2 && typeof c[0] === 'number') return [[c[0] as number, c[1] as number]];
  return (c as unknown[])
    .filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
    .map((p) => [p[0], p[1]] as const);
}

/** İki nokta arası büyük çember mesafesi (m). */
export function haversineM(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Olayları çözer; kullanıcıya uzaklık ekler, gecikme (büyük önce) + uzaklığa göre sıralar.
 * `origin` [lng, lat].
 */
export function parseIncidents(raw: unknown, origin: readonly [number, number] | null, limit = 12): TrafficIncident[] {
  const arr = (raw as { incidents?: RawIncident[] } | null)?.incidents;
  if (!Array.isArray(arr)) return [];
  const out: TrafficIncident[] = [];
  for (const it of arr) {
    const p = it.properties ?? {};
    const coords = toCoords(it.geometry);
    if (coords.length === 0) continue;
    const distanceM = origin ? Math.min(...coords.map((c) => haversineM(origin, c))) : null;
    out.push({
      id: String(p.id ?? it.id ?? `${coords[0]![0].toFixed(5)},${coords[0]![1].toFixed(5)}`),
      kind: ICON_KIND[p.iconCategory ?? -1] ?? 'other',
      description: p.events?.map((e) => e.description).filter(Boolean).join(' · ') || null,
      from: p.from ?? null,
      to: p.to ?? null,
      roadNumbers: Array.isArray(p.roadNumbers) ? p.roadNumbers.filter((r) => typeof r === 'string') : [],
      delaySec: typeof p.delay === 'number' ? p.delay : null,
      lengthM: typeof p.length === 'number' ? p.length : null,
      magnitude: typeof p.magnitudeOfDelay === 'number' ? p.magnitudeOfDelay : 0,
      coordinates: coords,
      distanceM,
    });
  }
  out.sort((a, b) => (b.delaySec ?? -1) - (a.delaySec ?? -1) || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  return out.slice(0, limit);
}

/* ── İstek kurucuları ───────────────────────────────────────────────────── */

const BASE = 'https://api.tomtom.com/traffic';

export function flowTileUrl(key: string): string {
  return `${BASE}/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256`;
}

export function flowSegmentUrl(key: string, lat: number, lng: number): string {
  return `${BASE}/services/4/flowSegmentData/relative0/12/json?key=${encodeURIComponent(key)}&point=${lat},${lng}&unit=KMPH`;
}

const INCIDENT_FIELDS =
  '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},from,to,length,delay,roadNumbers}}}';

export function incidentsUrl(key: string, lat: number, lng: number, radiusDeg = 0.06): string {
  const bbox = [lng - radiusDeg, lat - radiusDeg, lng + radiusDeg, lat + radiusDeg].map((v) => v.toFixed(5)).join(',');
  return `${BASE}/services/5/incidentDetails?key=${encodeURIComponent(key)}&bbox=${bbox}` +
    `&fields=${encodeURIComponent(INCIDENT_FIELDS)}&language=tr-TR&timeValidityFilter=present`;
}

/* ── Ağ ─────────────────────────────────────────────────────────────────── */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchRoad(key: string, lat: number, lng: number, f: Fetch = fetch): Promise<TrafficRoad | null> {
  const res = await f(flowSegmentUrl(key, lat, lng), { signal: signalWithTimeout(8000) });
  if (!res.ok) throw new Error(`TomTom flow HTTP ${res.status}`);
  return parseFlowSegment(await res.json());
}

export async function fetchIncidents(key: string, lat: number, lng: number, f: Fetch = fetch): Promise<TrafficIncident[]> {
  const res = await f(incidentsUrl(key, lat, lng), { signal: signalWithTimeout(8000) });
  if (!res.ok) throw new Error(`TomTom incidents HTTP ${res.status}`);
  return parseIncidents(await res.json(), [lng, lat]);
}
