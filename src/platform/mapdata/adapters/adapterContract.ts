/**
 * adapterContract.ts — MAP DATA PLATFORM · F2 · KAYNAK ADAPTÖR SÖZLEŞMESİ (SAF).
 *
 * SAF: I/O YOK · timer YOK · ağ YOK · global durum YOK · React YOK ·
 * `Date.now`/`performance.now` YOK. Ağ/dosya erişimi **çağıranın** işidir;
 * adaptör yalnız HAM KAYIT → `MapSourceObservation` dönüşümüdür.
 *
 * ── NEDEN SAF ─────────────────────────────────────────────────────────────
 * Aynı adaptör hem çevrimdışı fixture'la (test) hem canlı çekimle (araç dışı
 * veri hattı) çalışmalı. Ağı içeri alan adaptör test edilemez ve cihazda
 * öngörülemez maliyet üretir. Bu yüzden dönüşüm ile taşıma AYRILIR.
 *
 * ── REDDEDİLEN KAYIT KAYBOLMAZ ────────────────────────────────────────────
 * Normalizasyon başarısızsa sessizce atılmaz: `rejection` gerekçesiyle döner.
 * "Kaç kayıt neden düştü" sorusunun cevabı olmadan veri hattı denetlenemez.
 */

import type { EpochMs, MapDatasetRelease, MapDataSourceId, MapFeatureKind } from '../mapDataSource';
import type { MapSourceObservation } from '../mapDataObservation';

/** Bir kaydın neden gözleme dönüştürülemediği. Serbest metin YOK. */
export type AdapterRejectReason =
  /** Kaynak nesne kimliği yok/boş — köken taşınamaz. */
  | 'MISSING_SOURCE_ID'
  /** Geometri yok veya yapısal olarak geçersiz. */
  | 'INVALID_GEOMETRY'
  /** Kayıt bu adaptörün türüne ait değil. */
  | 'UNSUPPORTED_TYPE'
  /** Kayıt hiçbir kullanılabilir alan taşımıyor. */
  | 'EMPTY_RECORD';

export const ADAPTER_REJECT_REASONS: readonly AdapterRejectReason[] = [
  'MISSING_SOURCE_ID', 'INVALID_GEOMETRY', 'UNSUPPORTED_TYPE', 'EMPTY_RECORD',
] as const;

export interface AdapterRejection {
  readonly reason: AdapterRejectReason;
  /** Elde edilebildiyse kaynak kimliği (izlenebilirlik). */
  readonly sourceFeatureId: string | null;
}

/** Adaptörün ihtiyaç duyduğu DIŞ bağlam — saat ve sürüm dışarıdan gelir. */
export interface AdapterContext {
  readonly release: MapDatasetRelease;
  /** Tazelik hesabı için "şimdi". Adaptör saati KENDİ okumaz. */
  readonly nowEpochMs: EpochMs;
}

export interface AdapterResult {
  readonly observation: MapSourceObservation | null;
  readonly rejection: AdapterRejection | null;
}

export interface MapSourceAdapter<TRaw> {
  readonly sourceId: MapDataSourceId;
  readonly kind: MapFeatureKind;
  normalize(raw: TRaw, ctx: AdapterContext): AdapterResult;
}

export function accepted(observation: MapSourceObservation): AdapterResult {
  return { observation, rejection: null };
}

export function rejected(reason: AdapterRejectReason, sourceFeatureId: string | null): AdapterResult {
  return { observation: null, rejection: { reason, sourceFeatureId } };
}

/** Toplu normalizasyon özeti — "kaç kayıt neden düştü" denetlenebilsin. */
export interface AdapterBatchResult {
  readonly observations: readonly MapSourceObservation[];
  readonly rejections: readonly AdapterRejection[];
  readonly rejectionCounts: Readonly<Record<AdapterRejectReason, number>>;
}

export function normalizeBatch<TRaw>(
  adapter: MapSourceAdapter<TRaw>,
  raws: readonly TRaw[],
  ctx: AdapterContext,
): AdapterBatchResult {
  const observations: MapSourceObservation[] = [];
  const rejections: AdapterRejection[] = [];
  const counts: Record<AdapterRejectReason, number> = {
    MISSING_SOURCE_ID: 0, INVALID_GEOMETRY: 0, UNSUPPORTED_TYPE: 0, EMPTY_RECORD: 0,
  };
  for (const raw of raws ?? []) {
    const r = adapter.normalize(raw, ctx);
    if (r.observation) observations.push(r.observation);
    if (r.rejection) {
      rejections.push(r.rejection);
      counts[r.rejection.reason] += 1;
    }
  }
  return { observations, rejections, rejectionCounts: counts };
}

/* ── ISO 8601 → epoch ms (saf, fail-closed) ──────────────────────────────── */

/**
 * ISO damgasını epoch ms'e çevirir. `Date.now()` OKUMAZ — yalnız verilen
 * metni ayrıştırır. Geçersiz/boş girdi `null` döner; **bugüne düşülmez**.
 */
export function parseIsoEpochMs(iso: unknown): EpochMs | null {
  if (typeof iso !== 'string' || iso.length === 0) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
