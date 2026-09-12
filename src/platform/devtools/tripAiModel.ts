/**
 * tripAiModel.ts — TRIP AI motorlarının SAF gözlem modeli (CAROS LAB).
 *
 * İki motoru ürün yolunda ZİNCİRLER ve çıktısını **maskeli** özete çevirir:
 *   `computeCorridorCandidates` (koridor) → `generateRecommendations` (öneri)
 *
 * ── GİZLİLİK (gözlemlenebilirlik kuralı 6 — pazarlıksız) ───────────────
 * POI **adı · adresi · koordinatı · kimliği** çıktıya GEÇMEZ. Kayıtlı yerler
 * kullanıcı verisidir ve LAB dışa aktarımına girerse sızar. Dışarı yalnız
 * ADET · MESAFE · SAPMA · SKOR · KATEGORİ · GEREKÇE KODU verilir.
 *
 * ── DÜRÜSTLÜK ──────────────────────────────────────────────────────────
 * "Rota yok" · "POI yok" · "POI deposu okunamadı" ÜÇ AYRI durumdur ve
 * hiçbiri diğerinin yerine geçmez. Hesap yapılmadıysa sonuç `null`dır —
 * "0 aday bulundu" DEĞİL.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · global durum YOK · React YOK.
 */

import {
  computeCorridorCandidates, type CorridorCandidate,
} from '../trip/tripCorridorEngine';
import {
  generateRecommendations,
  type PoiCategory, type ReasonCode, type RecommendationLevel,
} from '../trip/tripRecommendationEngine';
import type { TripAiRawInputs } from './tripAiSources';

/** Ekrana çıkan tek satır — POI kimliği/adı/koordinatı YOK. */
export interface TripAiRow {
  /** Sıra numarası (1'den) — poiId TAŞINMAZ. */
  readonly rank: number;
  readonly category: PoiCategory;
  readonly level: RecommendationLevel;
  /** 0..1 */
  readonly score: number;
  readonly distanceToRouteM: number;
  readonly estimatedDetourM: number;
  /** 0..1 — rota boyunca nerede. */
  readonly routeProgress: number;
  readonly reasonCodes: readonly ReasonCode[];
}

export type TripAiState =
  /** Hiç hesaplanmadı — kullanıcı düğmeye basmadı. */
  | 'NOT_RUN'
  /** Aktif rota yok → koridor tanımsız. */
  | 'NO_ROUTE'
  /** POI deposu OKUNAMADI (0 kayıt DEĞİL). */
  | 'POI_STORE_UNREADABLE'
  /** Rota var, depo okundu ama hiç kayıtlı yer yok. */
  | 'NO_POI'
  /** Hesap koştu, koridorda aday çıkmadı — bu bir ÖLÇÜMDÜR. */
  | 'NO_CANDIDATE'
  /** Hesap koştu, aday var. */
  | 'OK';

export interface TripAiSummary {
  readonly state: TripAiState;
  /** Rota geometrisindeki nokta sayısı — `null` = rota yok. */
  readonly pathPointCount: number | null;
  /** Motorlara beslenen POI adedi — `null` = depo okunamadı. */
  readonly poiCount: number | null;
  /** Koridor içinde kalan aday adedi — `null` = hesap koşmadı. */
  readonly candidateCount: number | null;
  /** Öneri motorunun ürettiği satır adedi — `null` = hesap koşmadı. */
  readonly recommendationCount: number | null;
  /** Kullanılan koridor yarı-genişliği (m). */
  readonly corridorM: number;
  readonly rows: readonly TripAiRow[];
}

export const EMPTY_TRIP_AI_SUMMARY: TripAiSummary = Object.freeze({
  state: 'NOT_RUN',
  pathPointCount: null,
  poiCount: null,
  candidateCount: null,
  recommendationCount: null,
  corridorM: 0,
  rows: Object.freeze([]) as readonly TripAiRow[],
});

export const TRIP_AI_STATE_LABEL: Readonly<Record<TripAiState, string>> = {
  NOT_RUN:             'HESAPLANMADI',
  NO_ROUTE:            'AKTİF ROTA YOK',
  POI_STORE_UNREADABLE: 'POI DEPOSU OKUNAMADI',
  NO_POI:              'KAYITLI YER YOK',
  NO_CANDIDATE:        'KORİDORDA ADAY YOK (ölçüldü)',
  OK:                  'ADAY BULUNDU',
} as const;

export const TRIP_AI_LEVEL_LABEL: Readonly<Record<RecommendationLevel, string>> = {
  high: 'YÜKSEK', medium: 'ORTA', low: 'DÜŞÜK',
} as const;

/**
 * Motor zincirini koşturur ve MASKELİ özet üretir.
 *
 * Girdideki `StoredLocation` nesneleri çıktıya HİÇBİR biçimde taşınmaz:
 * `Recommendation.poiId` bile dışarı verilmez (kimlik, arama metninden
 * türetilmiş olabilir).
 */
export function buildTripAiSummary(
  inputs: TripAiRawInputs,
  corridorM: number,
  maxCandidates: number,
): TripAiSummary {
  const pathPointCount = inputs.geometry ? inputs.geometry.length : null;
  const poiCount = inputs.poiStoreReadable ? inputs.pois.length : null;

  if (!inputs.poiStoreReadable) {
    return {
      ...EMPTY_TRIP_AI_SUMMARY,
      state: 'POI_STORE_UNREADABLE',
      pathPointCount, poiCount: null, corridorM,
    };
  }
  if (!inputs.geometry) {
    return {
      ...EMPTY_TRIP_AI_SUMMARY,
      state: 'NO_ROUTE', pathPointCount: null, poiCount, corridorM,
    };
  }
  if (inputs.pois.length === 0) {
    return {
      ...EMPTY_TRIP_AI_SUMMARY,
      state: 'NO_POI', pathPointCount, poiCount: 0, corridorM,
    };
  }

  const candidates: CorridorCandidate[] = computeCorridorCandidates(
    inputs.geometry, inputs.pois, corridorM, maxCandidates,
  );
  const recs = generateRecommendations(candidates);

  const rows: TripAiRow[] = recs.map((r, i) => ({
    rank: i + 1,
    category: r.category,
    level: r.recommendationLevel,
    score: r.score,
    distanceToRouteM: r.distanceToRoute,
    estimatedDetourM: r.estimatedDetour,
    routeProgress: r.routeProgress,
    reasonCodes: r.reasonCodes,
  }));

  return {
    state: candidates.length === 0 ? 'NO_CANDIDATE' : 'OK',
    pathPointCount,
    poiCount,
    candidateCount: candidates.length,
    recommendationCount: recs.length,
    corridorM,
    rows,
  };
}
