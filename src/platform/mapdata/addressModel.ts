/** Pure Turkey address observation/search/snap seam; no second authority. */
import type { EvidenceGrade } from '../navigation/contracts/navEvidence';
import type { LonLat } from './mapDataObservation';
import type { MapDataSourceId, MapDatasetRelease } from './mapDataSource';
import type { EdgeProximityHit } from '../navigation/map/graph/edgeSpatialIndex';

export interface AddressObservation {
  readonly sourceId: MapDataSourceId;
  readonly sourceFeatureId: string;
  readonly datasetRelease: MapDatasetRelease;
  readonly observedAtEpochMs: number;
  readonly freshness: 'CURRENT' | 'RECENT' | 'STALE' | 'UNKNOWN';
  readonly evidenceGrade: EvidenceGrade;
  readonly confidence: number | null;
  readonly attribution: string | null;
  readonly country: string | null;
  readonly province: string | null;
  readonly district: string | null;
  readonly neighbourhood: string | null;
  readonly street: string | null;
  readonly houseNumber: string | null;
  readonly postalCode: string | null;
  readonly coordinate: LonLat | null;
}

export type AddressMatchLevel = 'EXACT_ADDRESS' | 'HOUSE_NUMBER' | 'STREET' | 'NEIGHBORHOOD' | 'PLACE';
export interface AddressSearchCandidate {
  readonly observation: AddressObservation;
  readonly matchLevel: AddressMatchLevel;
  readonly normalizedQuery: string;
  readonly confidence: number;
  readonly fallback: boolean;
}

/** Search normalization only; canonical values are never rewritten. */
export function normalizeTurkishAddressText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const tr: Record<string, string> = { İ: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c' };
  return value.toLocaleLowerCase('tr-TR')
    .replace(/[İışŞğĞüÜöÖçÇ]/g, (c) => tr[c] ?? c)
    .replace(/\b(caddesi|cad\.?|cd\.?)\b/g, 'cadde')
    .replace(/\b(sokağı|sokagi|sok\.?|sk\.?)\b/g, 'sokak')
    .replace(/\b(bulvarı|bulvari|bulv\.?|blv\.?)\b/g, 'bulvar')
    .replace(/\b(mahallesi|mah\.?|mh\.?)\b/g, 'mahalle')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function addressSearchText(a: Pick<AddressObservation, 'country' | 'province' | 'district' | 'neighbourhood' | 'street' | 'houseNumber'>): string {
  return normalizeTurkishAddressText([a.country, a.province, a.district, a.neighbourhood, a.street, a.houseNumber ? `No ${a.houseNumber}` : null].filter(Boolean).join(' '));
}

export type SnapFailure = 'NO_CANDIDATE' | 'ACCESS_REJECTED' | 'NAME_CONFLICT' | 'DISTANCE_TOO_FAR' | 'LOW_CONFIDENCE';
export interface NearestDrivablePoint { readonly edgeOrdinal: number; readonly coordinate: LonLat; readonly distanceM: number; readonly confidence: number; }
export interface SnapContext { readonly address: LonLat; readonly roadNameAgreement: boolean | null; readonly maxDistanceM: number; readonly candidates: readonly EdgeProximityHit[]; readonly rejectedAccessEdgeOrdinals?: readonly number[]; }

/** Conservative resolver helper; access/topology evidence remains caller-owned. */
export function resolveNearestDrivablePoint(ctx: SnapContext): { readonly ok: true; readonly point: NearestDrivablePoint } | { readonly ok: false; readonly failure: SnapFailure } {
  if (!ctx || !Number.isFinite(ctx.maxDistanceM) || ctx.maxDistanceM <= 0) return { ok: false, failure: 'DISTANCE_TOO_FAR' };
  const rejected = new Set(ctx.rejectedAccessEdgeOrdinals ?? []);
  const candidate = ctx.candidates.filter((h) => Number.isFinite(h.perpDistM) && h.perpDistM <= ctx.maxDistanceM && !rejected.has(h.ordinal)).sort((a, b) => a.perpDistM - b.perpDistM)[0];
  if (!candidate) return { ok: false, failure: ctx.candidates.length ? 'ACCESS_REJECTED' : 'NO_CANDIDATE' };
  if (ctx.roadNameAgreement === false && candidate.perpDistM > 25) return { ok: false, failure: 'NAME_CONFLICT' };
  const confidence = Math.max(0, Math.min(1, (ctx.roadNameAgreement === true ? 0.75 : ctx.roadNameAgreement === null ? 0.5 : 0.2) * Math.max(0, 1 - candidate.perpDistM / ctx.maxDistanceM)));
  if (confidence < 0.35) return { ok: false, failure: 'LOW_CONFIDENCE' };
  return { ok: true, point: { edgeOrdinal: candidate.ordinal, coordinate: [candidate.snappedLon, candidate.snappedLat], distanceM: candidate.perpDistM, confidence } };
}
