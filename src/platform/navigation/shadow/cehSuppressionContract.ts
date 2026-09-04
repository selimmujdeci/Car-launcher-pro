/**
 * cehSuppressionContract.ts — NAV v3 · F5 · BASTIRILAN OLAY SÖZLEŞMESİ (SAF).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.7 · CLAUDE.md §CROSS-DOMAIN 9/16.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN BOŞLUK ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `guardianAlertRanker` bugün öncelik sıralaması yapar ve `maxSpeakEvents` /
 * `maxDisplayEvents` sınırını aşan olayları listeden DÜŞÜRÜR
 * (`guardianAlertRanker.ts` — `GuardianAlertRankPolicyInput`). Düşen olayın
 * ne olduğu HİÇBİR yerde taşınmaz: "bir daha hiç sunulmayacak" ile
 * "şimdilik sıra gelmedi, hâlâ geçerli" arasındaki fark KAYBOLUR.
 *
 * Sürücü açısından bu fark kritiktir: bütçe dolduğu için düşen bir denetim
 * noktası uyarısı 3 saniye sonra hâlâ geçerlidir; ama geçerlilik ufku
 * bilinmiyorsa onu yeniden sunmak "geçmiş bir uyarıyı şimdi bağırmak"
 * riskini taşır.
 *
 * ── BU FAZDA DAVRANIŞ DEĞİŞMEZ ───────────────────────────────────────────
 * Bu dosya bir **sözleşme + saf sınıflandırıcıdır**. `rankGuardianAlerts`
 * ÇAĞIRMAZ, sıralamayı DEĞİŞTİRMEZ, hiçbir olayı yeniden sunmaz. F5'te tek
 * tüketicisi gölge koşum zamanıdır (ölçüm). Gerçek erteleme davranışı ancak
 * mevcut davranışla PARİTE kanıtı üretildikten sonra açılabilir.
 *
 * ── FAIL-CLOSED ──────────────────────────────────────────────────────────
 * Geçerlilik ufku (`validUntilMonoMs`) YOKSA olay ERTELENEMEZ. "Muhtemelen
 * hâlâ geçerlidir" bir kanıt değildir; kanıtsız erteleme, geçmiş bir olayı
 * geleceğe taşımak demektir.
 */

import type { MonotonicMs } from '../contracts/navMonotonicTime';

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type SuppressionDisposition =
  /** Olay sürücüye sunuldu — bu anahtar bir daha SUNULAMAZ. */
  | 'DELIVERED'
  /** Bastırıldı ama geçerlilik ufku içinde → sonra yeniden değerlendirilebilir. */
  | 'DEFERRED'
  /** Bastırıldı ve geçerlilik ufku GEÇTİ → bir daha sunulmaz. */
  | 'DROPPED_EXPIRED'
  /** Aynı alanda daha güncel bir olay var → eski olay taşınmaz. */
  | 'DROPPED_SUPERSEDED'
  /** Geçerlilik ufku YOK → ertelenemez (fail-closed). */
  | 'DROPPED_NO_VALIDITY'
  /** Bu anahtar zaten sunuldu — İKİNCİ KEZ sunulamaz. */
  | 'DROPPED_ALREADY_DELIVERED';

export const SUPPRESSION_DISPOSITIONS: readonly SuppressionDisposition[] = [
  'DELIVERED', 'DEFERRED', 'DROPPED_EXPIRED', 'DROPPED_SUPERSEDED',
  'DROPPED_NO_VALIDITY', 'DROPPED_ALREADY_DELIVERED',
] as const;

/** Bu hüküm olayın sürücüye ULAŞTIĞINI söylüyor mu. */
export function dispositionReachedDriver(d: SuppressionDisposition): boolean {
  return d === 'DELIVERED';
}

/** Bu hüküm olayın hâlâ yaşadığını söylüyor mu (yeniden değerlendirilebilir). */
export function dispositionKeepsAlive(d: SuppressionDisposition): boolean {
  return d === 'DEFERRED';
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SINIFLANDIRICI (saf)
   ══════════════════════════════════════════════════════════════════════════ */

export interface SuppressionInput {
  /**
   * Olayın KARARLI kimliği (alan + nesne kimliği). Aynı anahtar sürücüye
   * yalnız BİR KEZ çıkabilir — "aynı event iki kez" yasağının taşıyıcısı.
   */
  readonly key: string;
  /** Sunum katmanı bu olayı bu turda sundu mu. */
  readonly presented: boolean;
  /** Bu anahtar DAHA ÖNCE sunuldu mu (çağıranın defteri). */
  readonly alreadyDelivered: boolean;
  /** Aynı alanda daha yeni bir olay üretildi mi. */
  readonly superseded: boolean;
  /** İddianın geçerlilik ufku. `null` = hesaplanamadı. */
  readonly validUntilMonoMs: MonotonicMs | null;
  readonly nowMonoMs: MonotonicMs | number | null;
}

/**
 * Bastırılan/sunulan bir olayın akıbetini sınıflandırır. **Saf.**
 *
 * Sıra bilinçlidir: tekrar yasağı → sunum → güncellik → geçerlilik.
 * "Zaten sunuldu" kontrolü EN ÖNDEDİR çünkü ikinci kez sunmak, geç kalmış
 * bir uyarıdan daha kötüdür (sürücü aynı şeyi iki kez duyar ve güvenini yitirir).
 */
export function classifySuppression(input: SuppressionInput): SuppressionDisposition {
  if (!input || typeof input.key !== 'string' || input.key.length === 0) {
    return 'DROPPED_NO_VALIDITY';
  }

  if (input.alreadyDelivered === true) return 'DROPPED_ALREADY_DELIVERED';
  if (input.presented === true) return 'DELIVERED';
  if (input.superseded === true) return 'DROPPED_SUPERSEDED';

  const until = input.validUntilMonoMs;
  const now = input.nowMonoMs;
  if (until === null || until === undefined) return 'DROPPED_NO_VALIDITY';
  if (typeof now !== 'number' || !Number.isFinite(now)) return 'DROPPED_NO_VALIDITY';

  return now <= until ? 'DEFERRED' : 'DROPPED_EXPIRED';
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DEFTER (saf indirgeyici)
   ══════════════════════════════════════════════════════════════════════════ */

export interface SuppressionCounters {
  readonly evaluated: number;
  readonly delivered: number;
  readonly deferred: number;
  readonly droppedExpired: number;
  readonly droppedSuperseded: number;
  readonly droppedNoValidity: number;
  readonly droppedAlreadyDelivered: number;
  readonly lastDisposition: SuppressionDisposition | null;
}

export const EMPTY_SUPPRESSION_COUNTERS: SuppressionCounters = Object.freeze({
  evaluated: 0,
  delivered: 0,
  deferred: 0,
  droppedExpired: 0,
  droppedSuperseded: 0,
  droppedNoValidity: 0,
  droppedAlreadyDelivered: 0,
  lastDisposition: null,
});

export function foldSuppression(
  prev: SuppressionCounters, d: SuppressionDisposition,
): SuppressionCounters {
  return {
    evaluated: prev.evaluated + 1,
    delivered: prev.delivered + (d === 'DELIVERED' ? 1 : 0),
    deferred: prev.deferred + (d === 'DEFERRED' ? 1 : 0),
    droppedExpired: prev.droppedExpired + (d === 'DROPPED_EXPIRED' ? 1 : 0),
    droppedSuperseded: prev.droppedSuperseded + (d === 'DROPPED_SUPERSEDED' ? 1 : 0),
    droppedNoValidity: prev.droppedNoValidity + (d === 'DROPPED_NO_VALIDITY' ? 1 : 0),
    droppedAlreadyDelivered:
      prev.droppedAlreadyDelivered + (d === 'DROPPED_ALREADY_DELIVERED' ? 1 : 0),
    lastDisposition: d,
  };
}
