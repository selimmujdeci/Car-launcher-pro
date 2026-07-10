/**
 * discoveryDashboardModel — Discovery Dashboard SAF görünüm mantığı (PR-DISC-3).
 *
 * KAPSAM: yalnız OKUMA + türetme. Discovery/capture/queue mantığını DEĞİŞTİRMEZ; yalnız
 * DiscoveryCaptureService.getObservations() çıktısını (SALT-OKUNUR) UI için özet/filtre/
 * arama/rozet/virtualization-penceresine dönüştürür. React/DOM importu YOK → doğrudan
 * test edilebilir (Clean Architecture: view-model logic view'dan ayrı).
 */

import type { DiscoveryObservation } from '../../platform/obd/discovery';
import type { LearningDiscoveryAnnotation } from '../../platform/vehicleLearningIntegrationService';

/**
 * Bir gözlemin öğrenme anotasyonunu çözen fonksiyon (salt-okunur). Dashboard, integration
 * service'ten türetilmiş `${source}:${pidOrDid}` haritasını sağlar. Sağlanmazsa öğrenme
 * filtreleri fail-soft tümünü döndürür (mevcut davranış bozulmaz).
 */
export type AnnotationResolver = (o: DiscoveryObservation) => LearningDiscoveryAnnotation | null;

/* ── Rozetler ─────────────────────────────────────────────────────────────── */

export type DiscoveryBadge = 'NEW' | 'KNOWN' | 'DUPLICATE' | 'UNSUPPORTED';

/** Bir gözlemin rozetleri (öncelik sırasıyla). Bir kayıt birden çok rozet taşıyabilir. */
export function observationBadges(o: DiscoveryObservation): DiscoveryBadge[] {
  const badges: DiscoveryBadge[] = [];
  badges.push(o.status === 'new' ? 'NEW' : 'KNOWN');
  if (o.seenCount > 1) badges.push('DUPLICATE');
  if (!o.record.supported) badges.push('UNSUPPORTED');
  return badges;
}

/* ── Özet kartları ────────────────────────────────────────────────────────── */

export interface DiscoverySummary {
  newPid:    number;
  newDid:    number;
  total:     number;
  duplicate: number;
  known:     number;
  /** En son gözlem zamanı (ms) — hiç yoksa null. */
  lastAt:    number | null;
}

export function computeSummary(observations: readonly DiscoveryObservation[]): DiscoverySummary {
  let newPid = 0, newDid = 0, duplicate = 0, known = 0, lastAt = 0;
  for (const o of observations) {
    if (o.status === 'known') known++;
    else if (o.record.discoverySource === 'PID') newPid++;
    else newDid++;
    if (o.seenCount > 1) duplicate++;
    if (o.lastAt > lastAt) lastAt = o.lastAt;
  }
  return { newPid, newDid, total: observations.length, duplicate, known, lastAt: lastAt || null };
}

/* ── Filtre ───────────────────────────────────────────────────────────────── */

/** Mevcut keşif filtreleri + P2-5 öğrenme filtreleri (strong/candidate/manual/conflict). */
export type DiscoveryFilter =
  | 'all' | 'pid' | 'did' | 'new' | 'duplicate' | 'known'
  | 'strong' | 'candidate' | 'manual' | 'conflict';

/** Bir öğrenme filtresi mi (annotation gerektirir). */
export function isLearningFilter(filter: DiscoveryFilter): boolean {
  return filter === 'strong' || filter === 'candidate' || filter === 'manual' || filter === 'conflict';
}

export function filterObservations(
  observations: readonly DiscoveryObservation[],
  filter: DiscoveryFilter,
  annotationOf?: AnnotationResolver,
): DiscoveryObservation[] {
  switch (filter) {
    case 'pid':       return observations.filter((o) => o.record.discoverySource === 'PID');
    case 'did':       return observations.filter((o) => o.record.discoverySource === 'DID');
    case 'new':       return observations.filter((o) => o.status === 'new');
    case 'known':     return observations.filter((o) => o.status === 'known');
    case 'duplicate': return observations.filter((o) => o.seenCount > 1);
    // Öğrenme filtreleri — resolver yoksa fail-soft tümü (mevcut davranış korunur).
    case 'strong':    return annotationOf ? observations.filter((o) => (annotationOf(o)?.patternStatus ?? annotationOf(o)?.evidenceStatus) === 'strong') : observations.slice();
    case 'candidate': return annotationOf ? observations.filter((o) => { const a = annotationOf(o); return (a?.patternStatus ?? a?.evidenceStatus) === 'candidate'; }) : observations.slice();
    case 'manual':    return annotationOf ? observations.filter((o) => annotationOf(o)?.requiresManualReview === true) : observations.slice();
    case 'conflict':  return annotationOf ? observations.filter((o) => (annotationOf(o)?.conflictReasons.length ?? 0) > 0) : observations.slice();
    case 'all':
    default:          return observations.slice();
  }
}

/* ── Arama ────────────────────────────────────────────────────────────────── */

/** Bir gözlemin tüm aranabilir string alanlarını tek küçük-harf metne indirger. */
function searchHaystack(o: DiscoveryObservation): string {
  const r = o.record;
  return [
    r.pidOrDid, r.ecuAddress, r.request, r.rawResponse, r.mode, r.protocol,
    r.vehicleProfile, r.firmwareVersion ?? '', r.discoverySource,
    r.decodedValue !== undefined ? String(r.decodedValue) : '',
  ].join(' ').toLowerCase();
}

/** Serbest metin araması — boş sorgu tümünü döndürür; aksi halde alt-string (case-insensitive). */
export function searchObservations(
  observations: readonly DiscoveryObservation[],
  query: string,
): DiscoveryObservation[] {
  const q = query.trim().toLowerCase();
  if (!q) return observations.slice();
  return observations.filter((o) => searchHaystack(o).includes(q));
}

/** Filtre + arama zinciri (Dashboard'un görünen listesi). Öğrenme filtreleri için resolver. */
export function selectVisible(
  observations: readonly DiscoveryObservation[],
  filter: DiscoveryFilter,
  query: string,
  annotationOf?: AnnotationResolver,
): DiscoveryObservation[] {
  return searchObservations(filterObservations(observations, filter, annotationOf), query);
}

/* ── Virtualization (sanallaştırma penceresi) ─────────────────────────────── */

export interface VirtualWindowInput {
  scrollTop:      number;
  rowHeight:      number;
  viewportHeight: number;
  itemCount:      number;
  /** Görünür pencere üstüne/altına eklenen tampon satır (kaydırmada boşluk olmasın). */
  overscan?:      number;
}

export interface VirtualWindow {
  startIndex:  number;
  endIndex:    number;   // dışlayıcı (exclusive)
  offsetY:     number;   // üstteki boşluk yüksekliği (px)
  totalHeight: number;   // tüm listenin sanal yüksekliği (px)
}

/**
 * Yalnız görünür satır aralığını hesaplar (1000+ kayıtta yalnız ~ekran kadar DOM düğümü).
 * Saf/deterministik — scroll pozisyonundan görünür dilimi çıkarır.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { scrollTop, rowHeight, viewportHeight, itemCount } = input;
  const overscan = input.overscan ?? 4;
  const safeRow = rowHeight > 0 ? rowHeight : 1;
  const first = Math.floor(scrollTop / safeRow);
  const startIndex = Math.max(0, first - overscan);
  const visible = Math.ceil(viewportHeight / safeRow) + overscan * 2;
  const endIndex = Math.min(itemCount, startIndex + visible);
  return {
    startIndex,
    endIndex,
    offsetY: startIndex * safeRow,
    totalHeight: itemCount * safeRow,
  };
}
