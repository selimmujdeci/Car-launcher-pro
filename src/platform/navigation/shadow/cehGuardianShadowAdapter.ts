/**
 * cehGuardianShadowAdapter.ts — NAV v3 · F5 · GUARDIAN GÖLGE ADAPTÖRÜ (SAF).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.5 · CLAUDE.md §CROSS-DOMAIN 1/2/6.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · React YOK · modül durumu YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU ADAPTÖR NE YAPAR ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yalnız ŞU SORUYU cevaplar: *"Guardian'ın uyarı kararı bugün CEH'ten
 * gelseydi ne olurdu?"* — ve cevabı **gölge hükmü** olarak döndürür.
 *
 * ── NE YAPMAZ (pazarlıksız) ──────────────────────────────────────────────
 *  · `GuardianRuleRegistryInput` / `RawMapData` / `RawSpeedCameraData`
 *    **ÜRETMEZ**. Üretseydi bir gün yanlışlıkla `buildGuardianRegistryInput`e
 *    bağlanabilir ve ikinci bir uyarı otoritesi doğardı.
 *  · Guardian'ın hiçbir sağlayıcısını, adaptörünü, kuralını, motorunu
 *    ÇAĞIRMAZ. Guardian üretim yolu (`guardianRuntime._tick` →
 *    `buildGuardianRawPlatformData` → `buildGuardianRegistryInput` →
 *    `buildGuardianRuleResults` → `runGuardian`) bu fazda AYNEN KALIR.
 *  · Severity/eşik İCAT ETMEZ — politika DI ile gelir (`guardianEnforcementPolicy`
 *    sahibidir; bu dosya yalnız okur).
 *  · Cutover kapısı KAPALIYKEN `wouldEmit` `true` olsa bile hiçbir yan etki
 *    doğmaz: bu bir ölçümdür, bir emir değil.
 */

import type { CehAheadClaim } from '../horizon/cehConsumerContract';
import { cehClaimIsActionable, cehClaimIsUnmeasured } from '../horizon/cehConsumerContract';

/* ══════════════════════════════════════════════════════════════════════════
   1) POLİTİKA GİRDİSİ (DI — bu dosya sayı icat etmez)
   ══════════════════════════════════════════════════════════════════════════ */

export interface CehShadowGuardianPolicy {
  /** Uyarı yarıçapı (m) — bunun ötesindeki nesne uyarı üretmez. */
  readonly radiusM: number;
  /** Kural için en düşük güven. Güven ölçülmediyse kural KOŞMAZ. */
  readonly minConfidence: number;
  /** Atıf zinciri etiketi (kaynak kimliği) — köken kaybolmaz. */
  readonly sourceId: string;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) GÖLGE HÜKMÜ
   ══════════════════════════════════════════════════════════════════════════ */

export type CehShadowBlockReason =
  /** Cutover kapısı kapalı — CEH bu fazda üretim otoritesi DEĞİL. */
  | 'CUTOVER_GATE_CLOSED'
  /** CEH bu alanı hiç ölçmedi (öznitelik portu bağlanmadı). */
  | 'NOT_MEASURED'
  /** Kol belirsiz → kesin uyarı kararı üretilemez. */
  | 'AMBIGUOUS'
  /** Ufuk ölçtü ve ileride nesne YOK (uyarı gerekmiyor — kusur değil). */
  | 'NO_OBJECT_IN_HORIZON'
  /** Fiziksel doğrulama yok → mutlak-doğruluk uyarısı üretilemez. */
  | 'NOT_PHYSICALLY_CONFIRMED'
  /** Güven ölçülmedi veya eşiğin altında. */
  | 'BELOW_CONFIDENCE'
  /** Nesne uyarı yarıçapının dışında. */
  | 'OUT_OF_RANGE';

export interface CehShadowGuardianVerdict {
  /** **Her zaman `true`** — bu hükmün üretim etkisi YOKTUR (tip düzeyinde damga). */
  readonly shadow: true;
  /** Cutover açık OLSAYDI Guardian bu turda uyarı üretir miydi. */
  readonly wouldEmit: boolean;
  /** Üretmezse NEDEN üretmezdi (`wouldEmit === true` iken `null`). */
  readonly blockedBy: CehShadowBlockReason | null;
  readonly distanceM: number | null;
  readonly confidence: number | null;
  readonly label: string | null;
  readonly sourceId: string;
  /** Olayın kararlı anahtarı — tekrar yasağının taşıyıcısı. `null` = olay yok. */
  readonly eventKey: string | null;
}

function _blocked(
  reason: CehShadowBlockReason, c: CehAheadClaim, policy: CehShadowGuardianPolicy,
): CehShadowGuardianVerdict {
  return {
    shadow: true,
    wouldEmit: false,
    blockedBy: reason,
    /* Mesafe/güven yalnız GERÇEKTEN ölçüldüyse taşınır — engellenmiş bir
       hükümde sahte 0 üretmek, LAB'da "yakında kamera var" yanılgısı olurdu. */
    distanceM: c.outcome === 'CLAIM' ? c.distanceM : null,
    confidence: c.outcome === 'CLAIM' ? c.confidence : null,
    label: c.label,
    sourceId: policy.sourceId,
    eventKey: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ADAPTÖR (saf)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * CEH iddiasını Guardian gölge hükmüne çevirir. **Saf.**
 *
 * Kapı sırası bilinçlidir ve fail-closed'dır:
 *   cutover kapalı → belirsiz → ölçülmedi → ölçülmüş yokluk →
 *   fiziksel doğrulama → güven → menzil.
 *
 * "Cutover kapalı" EN ÖNDEDİR: kapı kapalıyken diğer kapıların sonucu
 * ürünü etkilemez ve hükmün TEK gerekçesi kapının kendisidir (LAB'da
 * "neden sessiz?" sorusunun cevabı tek satır olur).
 */
export function buildCehShadowGuardianVerdict(
  claim: CehAheadClaim | null | undefined,
  policy: CehShadowGuardianPolicy,
  cutoverOpen: boolean,
): CehShadowGuardianVerdict {
  const c: CehAheadClaim = claim ?? {
    domain: 'ENFORCEMENT',
    outcome: 'NOT_MEASURED',
    generation: null,
    distanceM: null,
    label: null,
    confidence: null,
    provenance: null,
    physicallyConfirmed: false,
    validUntilMonoMs: null,
  };

  if (cutoverOpen !== true) return _blocked('CUTOVER_GATE_CLOSED', c, policy);
  if (c.outcome === 'AMBIGUOUS') return _blocked('AMBIGUOUS', c, policy);
  if (c.outcome === 'NO_OBJECT_IN_HORIZON') return _blocked('NO_OBJECT_IN_HORIZON', c, policy);
  if (cehClaimIsUnmeasured(c)) return _blocked('NOT_MEASURED', c, policy);
  if (c.outcome !== 'CLAIM' || c.distanceM === null) return _blocked('NOT_MEASURED', c, policy);

  /* Fiziksel doğrulama olmadan mutlak-doğruluk uyarısı YASAK: paralel yolda
     rota aynen "doğru" görünür (v2 FMEA F05). */
  if (!cehClaimIsActionable(c)) return _blocked('NOT_PHYSICALLY_CONFIRMED', c, policy);

  const conf = c.confidence;
  if (conf === null || !(conf >= policy.minConfidence)) {
    return _blocked('BELOW_CONFIDENCE', c, policy);
  }
  if (!(c.distanceM <= policy.radiusM)) return _blocked('OUT_OF_RANGE', c, policy);

  return {
    shadow: true,
    wouldEmit: true,
    blockedBy: null,
    distanceM: c.distanceM,
    confidence: conf,
    label: c.label,
    sourceId: policy.sourceId,
    /* Anahtar KOORDİNAT TAŞIMAZ; üretim kimliği + alan + etiketten kurulur. */
    eventKey: `${policy.sourceId}:${c.domain}:${c.label ?? 'unlabeled'}`,
  };
}
