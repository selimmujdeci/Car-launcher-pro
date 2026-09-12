/**
 * navOutcomeContract.ts — NAV v3 · L8 OUTCOME / ACCOUNTABILITY SÖZLEŞMESİ
 * (SAF · F0 · YALNIZ SÖZLEŞME).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F0/8.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 *
 * ── BU DOSYA NE YAPMAZ (bağlayıcı) ───────────────────────────────────────
 *  · HİÇBİR öğrenme (learning) uygulaması YOK.
 *  · HİÇBİR geri besleme (feedback) mekanizması YOK.
 *  · HİÇBİR kalıcılık, model, ağırlık güncellemesi YOK.
 * Yalnız KAVRAMLARI tiple sabitler: tahmin · gözlem · geçiş kaydı · karşılaştırma.
 * Uygulama F6+ tetikleyici eşikle açılır (v2 §12/F6).
 *
 * ── ANAYASA KURALI (sözleşmede açık) ─────────────────────────────────────
 * Gözlem (`NavObservedOutcome`) OTORİTATİF HARİTA GERÇEĞİNİ DOĞRUDAN EZEMEZ.
 * L8 çıktısı ayrı bir "inanç/öneri" katmanına yazılır; L1 (MapStore) ve L3
 * (ufuk) kanonik gerçeği değişmeden kalır. `NAV_OUTCOME_CONTRACT` bunu
 * makine-okur bir sabitle beyan eder ve kilit test denetler.
 */

import type { EdgeId } from './navEdgeId';
import type { MonotonicMs } from './navMonotonicTime';
import type { EvidenceReason, NavSignalSource } from './navEvidence';

/* ══════════════════════════════════════════════════════════════════════════
   1) TAHMİN
   ══════════════════════════════════════════════════════════════════════════ */

/** Bir navigasyon otoritesinin ileriye dönük öngörüsü. */
export interface NavPrediction<T> {
  readonly predicted: T;
  /** Öngörü ufku (saniye) — "kaç sn sonrası". */
  readonly horizonS: number;
  /** Öngörünün hangi kanıt temeline dayandığı. */
  readonly basis: EvidenceReason;
  /** Öngörünün yapıldığı monotonik an. */
  readonly madeAtMonoMs: MonotonicMs;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) GÖZLENEN SONUÇ
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavObservedOutcome<T> {
  readonly observed: T;
  readonly observedAtMonoMs: MonotonicMs;
  readonly source: NavSignalSource;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KENAR GEÇİŞ KAYDI (traversal) — salt gözlem
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavTraversalRecord {
  readonly edgeId: EdgeId;
  readonly enteredMonoMs: MonotonicMs;
  /** Kenar henüz terk edilmediyse `null`. */
  readonly exitedMonoMs: MonotonicMs | null;
  /** Kenar boyunca kat edilen yol-boyu mesafe (metre); ölçülemezse `null`. */
  readonly traversedM: number | null;
  /** Gözlenen ortalama hız (m/s); ölçülemezse `null`. */
  readonly meanSpeedMps: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KARŞILAŞTIRMA — saf, yalnız fark hesabı (öğrenme DEĞİL)
   ══════════════════════════════════════════════════════════════════════════ */

export interface NavOutcomeComparison<T> {
  readonly prediction: NavPrediction<T>;
  readonly outcome: NavObservedOutcome<T>;
  /** Sayısal alanlarda `|predicted - observed|`; sayısal değilse `null`. */
  readonly deltaAbs: number | null;
  /** Gözlem, öngörü anından sonra mı geldi (zaman tutarlılığı). */
  readonly outcomeAfterPrediction: boolean;
}

/**
 * Öngörü ile gözlemi karşılaştırır. **Yalnız fark hesaplar** — hiçbir modeli
 * güncellemez, hiçbir yere yazmaz.
 */
export function compareOutcome<T>(
  prediction: NavPrediction<T>,
  outcome: NavObservedOutcome<T>,
): NavOutcomeComparison<T> {
  let deltaAbs: number | null = null;
  if (typeof prediction.predicted === 'number' && typeof outcome.observed === 'number') {
    const d = Math.abs(prediction.predicted - outcome.observed);
    deltaAbs = Number.isFinite(d) ? d : null;
  }
  return {
    prediction,
    outcome,
    deltaAbs,
    outcomeAfterPrediction: outcome.observedAtMonoMs >= prediction.madeAtMonoMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ANAYASA BEYANI — makine-okur (kilit test denetler)
   ══════════════════════════════════════════════════════════════════════════ */

export const NAV_OUTCOME_CONTRACT = {
  /** L8 otoritatif harita (L1) gerçeğine YAZAMAZ. */
  canWriteAuthoritativeMap: false,
  /** L8 ufuk (L3) gerçeğine YAZAMAZ. */
  canWriteHorizonTruth: false,
  /** L8 ego (L2) gerçeğine YAZAMAZ. */
  canWriteEgoTruth: false,
  /** L8 rota (L4) gerçeğine YAZAMAZ. */
  canWriteRouteTruth: false,
  /** Gözlem yalnız AYRI bir öneri/inanç katmanına gider. */
  observationTarget: 'SEPARATE_BELIEF_LAYER',
  /** F0'da hiçbir öğrenme/geri besleme uygulaması YOKTUR. */
  learningImplemented: false,
} as const;
