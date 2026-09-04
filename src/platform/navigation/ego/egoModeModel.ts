/**
 * egoModeModel.ts — NAV v3 · L2 · EGO MOD MAKİNESİ + DR TAVANI + KALİTE KAPISI
 * (SAF · F2).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F2.2 · v2 §3.5.
 *
 * SAF: I/O YOK · timer YOK · React YOK · native YOK · saat OKUMAZ · global
 * durum YOK. Zaman ve gözlem DIŞARIDAN gelir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── İKİ BAĞIMSIZ TAVAN (ikisi de fail-closed) ─────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *  ① **SÜRE TAVANI** — ölü hesaplama `DR_TOTAL_MAX_MS = 90 sn`den UZUN
 *     süremez (v2 §3.5 invaryantı). Sınırsız DR, sürücüye var olmayan bir
 *     konum göstermektir.
 *  ② **BELİRSİZLİK TAVANI** — 90 sn TEK BAŞINA yeterli güven şartı DEĞİLDİR.
 *     Füzyonun kendi 1σ yatay belirsizliği kalite eşiğini aşarsa mod
 *     **DAHA ERKEN** düşer. Eşikler UYDURULMADI, deponun mevcut sabitlerinden
 *     TÜRETİLDİ:
 *
 *       `EGO_SIGMA_DEGRADE_M   = GNSS_ACCURACY_REJECT_M` (50 m)
 *          → Füzyonun belirsizliği, REDDEDECEĞİMİZ bir GNSS ölçümünün
 *            doğruluğundan kötüyse o konum karar kalitesinde DEĞİLDİR.
 *
 *       `EGO_SIGMA_LAST_KNOWN_M = CORRIDOR_BASE_M + CORRIDOR_ACC_CAP_M` (95 m)
 *          → Eşleştirme koridorunun tavanı. Bunun ötesinde harita eşleştirme
 *            de kurtaramaz; konum artık bir iddia değil bir anıdır.
 *
 * ── MOD AYRIMI KANITA DAYALI, TAKVİME DEĞİL ──────────────────────────────
 * `GNSS_DR` ile `DR_ONLY` arasındaki fark UYDURMA bir süre eşiği değil,
 * deponun GERÇEK sinyalidir: `LocationEvidence.source`
 * (`'GPS' | 'DEAD_RECKONING' | 'NONE'`). Konumu hâlâ GNSS üretiyorsa
 * (bayat da olsa) `GNSS_DR`; üreten taraf ölü hesaplamaysa `DR_ONLY`.
 */

import type { EgoFixMode } from '../contracts/navEgoPose';
import { CORRIDOR_BASE_M, CORRIDOR_ACC_CAP_M } from '../core/mapMatchModel';
import { GNSS_ACCURACY_REJECT_M } from './egoKalman';

/* ══════════════════════════════════════════════════════════════════════════
   1) EŞİKLER
   ══════════════════════════════════════════════════════════════════════════ */

/** GNSS fix bu yaşa kadar TAZE sayılır (v2 §3.5: `≤ 3 s`). */
export const GNSS_FRESH_MAX_MS = 3_000;

/**
 * Ölü hesaplamanın MUTLAK süre tavanı. **90 saniyeyi AŞAMAZ** (v2 §3.5
 * invaryantı; kilit test bu sabiti denetler).
 */
export const DR_TOTAL_MAX_MS = 90_000;

/** Füzyon 1σ yatay belirsizliği bunu aşarsa konum KARAR KALİTESİNDE değildir. */
export const EGO_SIGMA_DEGRADE_M = GNSS_ACCURACY_REJECT_M;

/** Bunu aşarsa harita eşleştirme de kurtaramaz → `LAST_KNOWN`. */
export const EGO_SIGMA_LAST_KNOWN_M = CORRIDOR_BASE_M + CORRIDOR_ACC_CAP_M;

/* ══════════════════════════════════════════════════════════════════════════
   2) GİRDİ / ÇIKTI
   ══════════════════════════════════════════════════════════════════════════ */

/** Konumu şu an kim üretiyor — `gpsService.LocationEvidence.source` ile aynı sözlük. */
export type EgoPositionProducer = 'GPS' | 'DEAD_RECKONING' | 'NONE';

export interface EgoModeInput {
  /** Bu oturumda HİÇ geçerli fix alındı mı. */
  readonly hasEverFixed: boolean;
  /** Son fix'in MONOTONİK yaşı (ms). `null` = hiç fix yok / yaş ölçülemedi. */
  readonly fixAgeMs: number | null;
  /** Konumu üreten taraf (deponun gerçek sinyali). */
  readonly producer: EgoPositionProducer;
  /** Bir hız kaynağı (araç bus veya GNSS Doppler) VAR mı — DR bunsuz yürüyemez. */
  readonly hasSpeedSource: boolean;
  /** Füzyonun 1σ yatay belirsizliği (m). `null` = ölçülemedi → kötümser. */
  readonly sigmaHorizontalM: number | null;
}

/** Modun NEDEN bu olduğu — makine-okur, serbest metin YOK. */
export type EgoModeReason =
  | 'NO_FIX_YET'
  | 'FIX_FRESH'
  | 'FIX_STALE_DR'
  | 'PRODUCER_IS_DR'
  | 'DR_TIME_CEILING'
  | 'NO_SPEED_SOURCE'
  | 'SIGMA_DEGRADED'
  | 'SIGMA_CEILING'
  | 'AGE_UNKNOWN';

export interface EgoModeVerdict {
  readonly mode: EgoFixMode;
  readonly reason: EgoModeReason;
  /**
   * Rehberlik bu modda serbest mi. `GNSS`/`GNSS_DR` dışında DAİMA `false`
   * (F0 `egoModeAllowsGuidance` ile birebir).
   */
  readonly guidanceAllowed: boolean;
  /** Süre tavanı mı belirsizlik tavanı mı düşürdü — teşhis için ayrı taşınır. */
  readonly degradedByTime: boolean;
  readonly degradedBySigma: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

function _v(
  mode: EgoFixMode, reason: EgoModeReason,
  degradedByTime = false, degradedBySigma = false,
): EgoModeVerdict {
  return {
    mode, reason,
    guidanceAllowed: mode === 'GNSS' || mode === 'GNSS_DR',
    degradedByTime, degradedBySigma,
  };
}

/**
 * Ego modunu belirler. **SAF · FAIL-CLOSED.**
 *
 * Kural sırası (ilk eşleşen kazanır — hepsi gerçek girdilerden):
 *  1. Hiç fix yok                          → `NONE`
 *  2. Belirsizlik `LAST_KNOWN` tavanını aştı → `LAST_KNOWN`  (süreden BAĞIMSIZ)
 *  3. Fix yaşı ölçülemedi                  → `LAST_KNOWN`  (yaş uydurulmaz)
 *  4. DR süre tavanı aşıldı                → `LAST_KNOWN`
 *  5. Fix bayat ve hız kaynağı YOK         → `LAST_KNOWN`
 *  6. Belirsizlik karar eşiğini aştı       → `DR_ONLY`     (erken degrade)
 *  7. Fix taze ve üretici GPS              → `GNSS`
 *  8. Üretici ölü hesaplama                → `DR_ONLY`
 *  9. Fix bayat ama üretici hâlâ GPS       → `GNSS_DR`
 */
export function decideEgoMode(input: EgoModeInput): EgoModeVerdict {
  if (!input || input.hasEverFixed !== true) return _v('NONE', 'NO_FIX_YET');

  const sigma = typeof input.sigmaHorizontalM === 'number' && Number.isFinite(input.sigmaHorizontalM)
    ? input.sigmaHorizontalM
    : null;

  /* ② BELİRSİZLİK TAVANI — süreden ÖNCE değerlendirilir. Kanıt yoksa
     (sigma ölçülemedi) kötümser davranılır: karar kalitesi İDDİA EDİLMEZ. */
  if (sigma === null || sigma > EGO_SIGMA_LAST_KNOWN_M) {
    return _v('LAST_KNOWN', 'SIGMA_CEILING', false, true);
  }

  const age = typeof input.fixAgeMs === 'number' && Number.isFinite(input.fixAgeMs) && input.fixAgeMs >= 0
    ? input.fixAgeMs
    : null;

  /* Yaş ölçülemiyorsa tazelik İDDİA EDİLEMEZ. */
  if (age === null) return _v('LAST_KNOWN', 'AGE_UNKNOWN');

  /* ① SÜRE TAVANI. */
  if (age > DR_TOTAL_MAX_MS) return _v('LAST_KNOWN', 'DR_TIME_CEILING', true, false);

  const fresh = age <= GNSS_FRESH_MAX_MS;

  /* Bayat fix + hız kaynağı yok → ilerletilecek bir şey yok. */
  if (!fresh && input.hasSpeedSource !== true) {
    return _v('LAST_KNOWN', 'NO_SPEED_SOURCE');
  }

  /* ② ERKEN DEGRADE — 90 sn dolmadan belirsizlik karar eşiğini aştıysa. */
  if (sigma > EGO_SIGMA_DEGRADE_M) {
    return _v('DR_ONLY', 'SIGMA_DEGRADED', false, true);
  }

  if (fresh && input.producer === 'GPS') return _v('GNSS', 'FIX_FRESH');
  if (input.producer === 'DEAD_RECKONING') return _v('DR_ONLY', 'PRODUCER_IS_DR');
  if (!fresh && input.producer === 'GPS') return _v('GNSS_DR', 'FIX_STALE_DR');

  /* producer === 'NONE' → canlı üretici yok. */
  return _v('LAST_KNOWN', 'NO_SPEED_SOURCE');
}

/**
 * Güven [0,1] — belirsizlikten TÜRETİLİR, moddan DEĞİL.
 *
 * **"GPS var → güven 1" YASAKTIR.** Güven yalnız ölçülen 1σ belirsizliğin
 * `EGO_SIGMA_LAST_KNOWN_M` tavanına oranından doğrusal olarak türetilir:
 * σ = 0 → 1.0 · σ = 50 m → ~0.47 · σ ≥ 95 m → 0.
 *
 * `sigma` ölçülemezse 0 (kanıtsız kesinlik yok).
 */
export function egoConfidenceFromSigma(sigmaHorizontalM: number | null): number {
  if (typeof sigmaHorizontalM !== 'number' || !Number.isFinite(sigmaHorizontalM) || sigmaHorizontalM < 0) {
    return 0;
  }
  const c = 1 - sigmaHorizontalM / EGO_SIGMA_LAST_KNOWN_M;
  return c <= 0 ? 0 : c >= 1 ? 1 : c;
}
