/**
 * Traffic Route Cost — ETA Düzeltme Motoru
 *
 * routingService.ts'ten gelen ham OSRM süresini trafik verisine göre
 * düzeltir. routingService'e ASLA yazmaz — sadece okur.
 *
 * ETA zinciri (orijinal sistem bozulmaz):
 *   routingService.totalDurationSeconds   (OSRM ham)
 *   + trafficRouteCost.trafficDelaySeconds (bu modül)
 *   = adjustedSeconds                     (NavigationHUD gösterir)
 *
 * Eşik kuralı (kullanıcı rahatsızlık önleme):
 *   Alternartif rota önerisi: yalnızca ≥ 240s (4 dk) kazanç varsa.
 *   ETA gösteriminde fark: yalnızca ≥ 60s (1 dk) varsa güncellenir.
 */

import type { SegmentTrafficState, RouteCostResult } from './trafficTypes';

/* ── Sabitler ────────────────────────────────────────────────── */

/** Kavşak / durak başına ceza (saniye) — OSRM bu gecikmeler için optimize etmez */
const JUNCTION_PENALTY_SEC = 8;

/** Ceza uygulanacak minimum trafik seviyesi */
const JUNCTION_PENALTY_MIN_LEVEL = new Set(['heavy', 'standstill']);

/** ETA'nın güncellenmesi için minimum fark (saniye) */
export const ETA_UPDATE_THRESHOLD_SEC = 60;

/** Alternatif rota önerisi için minimum kazanç (saniye) */
export const ALTERNATIVE_THRESHOLD_SEC = 240;

/** Düşük güvenli segment eşiği — bu altında segment hesaba katılmaz */
const MIN_CONFIDENCE = 0.30;

/* ── Ana hesap fonksiyonu ────────────────────────────────────── */

/**
 * Rota üzerindeki segmentleri trafik verisine göre değerlendirir
 * ve düzeltilmiş ETA çıkarır.
 *
 * @param baseSeconds      OSRM'den gelen ham süre
 * @param segments         Rota segmentlerinin trafik durumu
 * @param junctionCount    Hesaplanacak kavşak sayısı (OSRM step count)
 */
export function computeRouteCost(
  baseSeconds:   number,
  segments:      SegmentTrafficState[],
  junctionCount: number,
): RouteCostResult {
  if (!Number.isFinite(baseSeconds) || baseSeconds < 0) {
    return _emptyResult(baseSeconds);
  }

  let totalDelay     = 0;
  let weightedConf   = 0;
  let validSegments  = 0;
  let junctionPenalty = 0;

  for (const seg of segments) {
    // Güven eşiğinin altındaki segmentler hesaba katılmaz
    if (seg.confidence < MIN_CONFIDENCE) continue;

    totalDelay    += seg.expectedDelaySec;
    weightedConf  += seg.confidence;
    validSegments++;

    // Ağır ve tıkalı segmentler kavşak cezası alır
    if (JUNCTION_PENALTY_MIN_LEVEL.has(seg.level)) {
      junctionPenalty += JUNCTION_PENALTY_SEC;
    }
  }

  // Kavşak cezasını step sayısıyla sınırla
  junctionPenalty = Math.min(junctionPenalty, junctionCount * JUNCTION_PENALTY_SEC);

  const avgConfidence = validSegments > 0 ? weightedConf / validSegments : 0;
  const adjustedSeconds = Math.round(
    baseSeconds + totalDelay + junctionPenalty,
  );

  return {
    baseSeconds:            Math.round(baseSeconds),
    trafficDelaySeconds:    Math.round(totalDelay),
    junctionPenaltySeconds: Math.round(junctionPenalty),
    adjustedSeconds:        Math.max(baseSeconds, adjustedSeconds), // asla kısaltma
    avgConfidence:          Math.round(avgConfidence * 100) / 100,
    segmentCount:           validSegments,
  };
}

/* ── ETA karşılaştırma yardımcısı ────────────────────────────── */

/**
 * Düzeltilmiş ETA'nın NavigationHUD'da gösterilip gösterilmeyeceğini
 * belirler. Küçük farklar UI'da titreme yaratır.
 *
 * @returns Gösterilmesi gereken ETA (saniye)
 */
export function resolveDisplayEta(
  adjustedSeconds: number,
  currentDisplaySeconds: number,
): number {
  const diff = Math.abs(adjustedSeconds - currentDisplaySeconds);
  if (diff < ETA_UPDATE_THRESHOLD_SEC) return currentDisplaySeconds;
  return adjustedSeconds;
}

/**
 * Mevcut rotanın trafik maliyetini hesapla ve kazancı döner.
 * trafficSuggestionEngine.ts alternatif öneri için bu değeri kullanır.
 *
 * @returns Pozitif = mevcut rota daha yavaş (alternatif daha iyi)
 */
export function computeSavingSeconds(
  currentCost:     RouteCostResult,
  alternativeCost: RouteCostResult,
): number {
  return Math.round(currentCost.adjustedSeconds - alternativeCost.adjustedSeconds);
}

/* ── Boş sonuç ───────────────────────────────────────────────── */

function _emptyResult(base: number): RouteCostResult {
  return {
    baseSeconds:            Math.max(0, Math.round(base)),
    trafficDelaySeconds:    0,
    junctionPenaltySeconds: 0,
    adjustedSeconds:        Math.max(0, Math.round(base)),
    avgConfidence:          0,
    segmentCount:           0,
  };
}
