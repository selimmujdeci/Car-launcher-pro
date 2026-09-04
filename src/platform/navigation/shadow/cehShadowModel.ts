/**
 * cehShadowModel.ts — NAV v3 · F5 · GÖLGE KARŞILAŞTIRMA ÇEKİRDEĞİ (SAF).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.3 · CLAUDE.md §CROSS-DOMAIN 1/7/13.
 *
 * SAF: I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * modül durumu YOK · ağ YOK. Durum sahibi `cehShadowRuntime.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GÖLGE NEDİR, NE DEĞİLDİR ──────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Gölge, **üretim kararını DEĞİŞTİRMEDEN** aynı soruya ikinci bir cevap
 * hesaplayıp iki cevabı ÖLÇMEKTİR. Bu dosya yalnız ölçer:
 *  · yan etki ÜRETMEZ (ses yok · uyarı yok · store yazımı yok),
 *  · hangi cevabın doğru olduğuna KARAR VERMEZ (o hüküm saha ölçümünündür),
 *  · bir farkı "kabul edilebilir" ilan ETMEZ — eşiği çağıran verir.
 *
 * ── "FARK" TEK BİR ŞEY DEĞİLDİR ──────────────────────────────────────────
 * İki cevabın uyuşmaması altı ayrı arıza sınıfı olabilir ve sahada alınacak
 * aksiyon her birinde farklıdır:
 *   · ikisi de iddia etti, mesafe farklı        → kalibrasyon/eşleşme sorunu
 *   · legacy iddia etti, CEH ölçmedi            → port bağlanmamış (bugünkü hâl)
 *   · CEH iddia etti, legacy ölçmedi            → legacy kapısı kapalı (#508)
 *   · legacy "yok" dedi, CEH "var" dedi         → gerçek çelişki
 *   · CEH belirsiz                              → karar REDDİ (kusur değil)
 *   · legacy o soruyu HİÇ cevaplamıyor          → karşılaştırılamaz
 * Hepsini tek "divergence" kovasına atmak, sahada hangi sorunu aradığımızı
 * kaybetmek demektir. Bu yüzden hüküm ayrıştırılır.
 */

import type { CehAheadClaim, CehAheadDomain } from '../horizon/cehConsumerContract';

/* ══════════════════════════════════════════════════════════════════════════
   1) LEGACY (ÜRETİM) CEVABI — CEH'ten BAĞIMSIZ şekil
   ══════════════════════════════════════════════════════════════════════════ */

export type LegacyAheadOutcome =
  /** Üretim otoritesi bu alanda ileride bir nesne İDDİA ETTİ. */
  | 'CLAIM'
  /** Üretim otoritesi taradı ve bu menzilde nesne YOK dedi (ölçüm). */
  | 'MEASURED_ABSENT'
  /** Üretim otoritesinin kapısı düştü / kaynağı yok → ölçemedi. */
  | 'NOT_MEASURED'
  /**
   * Üretimde bu soruyu cevaplayan bir otorite HİÇ YOK (ör. "ileride limit
   * değişiyor mu" sorusunun bugün hiçbir sahibi yoktur). Karşılaştırma bir
   * kusur ölçmez — yokluğu ölçer.
   */
  | 'NOT_ANSWERED';

export const LEGACY_AHEAD_OUTCOMES: readonly LegacyAheadOutcome[] = [
  'CLAIM', 'MEASURED_ABSENT', 'NOT_MEASURED', 'NOT_ANSWERED',
] as const;

export interface LegacyAheadClaim {
  readonly domain: CehAheadDomain;
  readonly outcome: LegacyAheadOutcome;
  /** Yol-boyu (veya legacy'nin kendi yöntemiyle) mesafe. Yalnız `CLAIM`de sayı. */
  readonly distanceM: number | null;
  /** Makine-okur etiket — serbest metin/koordinat TAŞIMAZ. */
  readonly label: string | null;
  /**
   * Legacy'nin mesafeyi HANGİ yöntemle bulduğu (`ALONG_ROUTE` · `STRAIGHT_LINE`
   * · `CONE_RADIUS` · `UNKNOWN`). Yöntem farkı, sayı farkının GEREKÇESİDİR;
   * kaybolursa saha ölçümü yorumlanamaz.
   */
  readonly method: string;
}

export function legacyAheadUnanswered(domain: CehAheadDomain): LegacyAheadClaim {
  return { domain, outcome: 'NOT_ANSWERED', distanceM: null, label: null, method: 'NONE' };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type ShadowVerdict =
  /** İkisi de iddia etti ve mesafe farkı tolerans içinde. */
  | 'AGREE'
  /** İkisi de iddia etti ama mesafe farkı tolerans DIŞINDA. */
  | 'DIVERGE_DISTANCE'
  /** Biri "var" dedi, diğeri ÖLÇEREK "yok" dedi — gerçek çelişki. */
  | 'DIVERGE_PRESENCE'
  /** Legacy iddia etti, CEH ölçmedi/ölçemedi. */
  | 'LEGACY_ONLY'
  /** CEH iddia etti, legacy ölçmedi/ölçemedi. */
  | 'CEH_ONLY'
  /** İkisi de ölçtü ve ikisi de "ileride yok" dedi. */
  | 'BOTH_ABSENT'
  /** İkisi de ölçemedi — bu bir uyuşma DEĞİLDİR, ortak bilgisizliktir. */
  | 'BOTH_UNMEASURED'
  /** CEH belirsiz kol nedeniyle kesin iddia REDDETTİ (kusur değil, koruma). */
  | 'CEH_AMBIGUOUS'
  /** Üretimde bu soruyu cevaplayan otorite yok → karşılaştırma anlamsız. */
  | 'NOT_COMPARABLE';

export const SHADOW_VERDICTS: readonly ShadowVerdict[] = [
  'AGREE', 'DIVERGE_DISTANCE', 'DIVERGE_PRESENCE', 'LEGACY_ONLY', 'CEH_ONLY',
  'BOTH_ABSENT', 'BOTH_UNMEASURED', 'CEH_AMBIGUOUS', 'NOT_COMPARABLE',
] as const;

/** Bu hüküm bir "gerçek fark" mı (cutover eşiğine giren sınıflar). */
export function verdictIsDivergence(v: ShadowVerdict): boolean {
  return v === 'DIVERGE_DISTANCE' || v === 'DIVERGE_PRESENCE'
    || v === 'LEGACY_ONLY' || v === 'CEH_ONLY';
}

/**
 * Bu hüküm cutover oranının PAYDASINA girer mi. `NOT_COMPARABLE` ve
 * `BOTH_UNMEASURED` girmez: hiç ölçüm yapılmamış örneklerle "uyum oranı"
 * hesaplamak, oranı sahte biçimde yükseltir (ölçmeyerek uyum kazanmak YASAK).
 */
export function verdictIsComparable(v: ShadowVerdict): boolean {
  return v !== 'NOT_COMPARABLE' && v !== 'BOTH_UNMEASURED';
}

export interface ShadowSample {
  readonly domain: CehAheadDomain;
  readonly verdict: ShadowVerdict;
  /** `legacy − ceh` mesafe farkı (m). Yalnız ikisi de iddia ettiyse sayı. */
  readonly deltaM: number | null;
  readonly legacyOutcome: LegacyAheadOutcome;
  readonly cehOutcome: CehAheadClaim['outcome'];
  /** Etiketler de farklıysa (aynı mesafe, farklı nesne) ayrı kanıttır. */
  readonly labelMismatch: boolean;
  /** Karşılaştırmanın dayandığı ufuk üretimi — eski ufuk yeni sanılamaz. */
  readonly generation: number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KARŞILAŞTIRICI (saf)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Mesafe toleransı — **politika, ölçüm DEĞİL.**
 *
 * ⚠️ Bu sayı sahamızdan kalibre edilmemiştir; `DEVICE_VALIDATION_LEDGER`
 * maddesidir. Mutlak taban + orana bağlı pay: yakın mesafede mutlak fark,
 * uzak mesafede oransal fark anlamlıdır.
 */
export const SHADOW_DISTANCE_TOLERANCE_BASE_M = 25;
export const SHADOW_DISTANCE_TOLERANCE_RATIO = 0.1;

export function shadowDistanceToleranceM(referenceM: number): number {
  const r = Number.isFinite(referenceM) ? Math.abs(referenceM) : 0;
  return SHADOW_DISTANCE_TOLERANCE_BASE_M + r * SHADOW_DISTANCE_TOLERANCE_RATIO;
}

function _num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Tek gölge örneği üretir. **Saf** — yan etki YOK, karar YOK, ölçüm VAR.
 *
 * Öncelik sırası bilinçlidir: karşılaştırılamazlık → belirsizlik → varlık
 * çelişkisi → mesafe farkı. Belirsizlik `DIVERGE`ten ÖNCE gelir çünkü CEH'in
 * susması bir hata değil, bir korumadır ve fark sayacını kirletmemelidir.
 */
export function compareAhead(
  legacy: LegacyAheadClaim, ceh: CehAheadClaim,
): ShadowSample {
  const gen = ceh.generation;
  const base = {
    domain: legacy.domain,
    legacyOutcome: legacy.outcome,
    cehOutcome: ceh.outcome,
    generation: gen,
  } as const;

  /* ① Üretimde bu soruyu soran yok → karşılaştırma anlamsız. */
  if (legacy.outcome === 'NOT_ANSWERED') {
    return { ...base, verdict: 'NOT_COMPARABLE', deltaM: null, labelMismatch: false };
  }

  /* ② CEH belirsiz → karar REDDİ. Fark sayılmaz. */
  if (ceh.outcome === 'AMBIGUOUS') {
    return { ...base, verdict: 'CEH_AMBIGUOUS', deltaM: null, labelMismatch: false };
  }

  const legacyClaims = legacy.outcome === 'CLAIM' && _num(legacy.distanceM) !== null;
  const cehClaims = ceh.outcome === 'CLAIM' && _num(ceh.distanceM) !== null;
  const legacyMeasured = legacy.outcome === 'CLAIM' || legacy.outcome === 'MEASURED_ABSENT';
  const cehMeasured = ceh.outcome === 'CLAIM' || ceh.outcome === 'NO_OBJECT_IN_HORIZON';

  /* ③ İkisi de iddia etti → mesafe karşılaştırması. */
  if (legacyClaims && cehClaims) {
    const l = legacy.distanceM as number;
    const c = ceh.distanceM as number;
    const delta = l - c;
    const tol = shadowDistanceToleranceM(Math.min(Math.abs(l), Math.abs(c)));
    const labelMismatch = legacy.label !== null && ceh.label !== null
      && legacy.label !== ceh.label;
    return {
      ...base,
      verdict: Math.abs(delta) <= tol ? 'AGREE' : 'DIVERGE_DISTANCE',
      deltaM: delta,
      labelMismatch,
    };
  }

  /* ④ Biri "var" dedi, diğeri ÖLÇEREK "yok" dedi → gerçek çelişki. */
  if (legacyClaims && ceh.outcome === 'NO_OBJECT_IN_HORIZON') {
    return { ...base, verdict: 'DIVERGE_PRESENCE', deltaM: null, labelMismatch: false };
  }
  if (cehClaims && legacy.outcome === 'MEASURED_ABSENT') {
    return { ...base, verdict: 'DIVERGE_PRESENCE', deltaM: null, labelMismatch: false };
  }

  /* ⑤ Tek taraflı iddia (diğer taraf ölçemedi). */
  if (legacyClaims && !cehMeasured) {
    return { ...base, verdict: 'LEGACY_ONLY', deltaM: null, labelMismatch: false };
  }
  if (cehClaims && !legacyMeasured) {
    return { ...base, verdict: 'CEH_ONLY', deltaM: null, labelMismatch: false };
  }

  /* ⑥ İkisi de ölçtü ve ikisi de yok dedi. */
  if (legacy.outcome === 'MEASURED_ABSENT' && ceh.outcome === 'NO_OBJECT_IN_HORIZON') {
    return { ...base, verdict: 'BOTH_ABSENT', deltaM: null, labelMismatch: false };
  }

  /* ⑦ Kalan her hâl ortak bilgisizliktir — uyum SAYILMAZ. */
  return { ...base, verdict: 'BOTH_UNMEASURED', deltaM: null, labelMismatch: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   4) DEFTER (saf indirgeyici — sınırsız büyüme YOK)
   ══════════════════════════════════════════════════════════════════════════ */

export interface ShadowDomainCounters {
  readonly samples: number;
  readonly agree: number;
  readonly divergeDistance: number;
  readonly divergePresence: number;
  readonly legacyOnly: number;
  readonly cehOnly: number;
  readonly bothAbsent: number;
  readonly bothUnmeasured: number;
  readonly cehAmbiguous: number;
  readonly notComparable: number;
  readonly labelMismatches: number;
  /** Karşılaştırılabilir örnek sayısı (oranın PAYDASI). */
  readonly comparable: number;
  /** Gerçek fark sayısı (oranın PAYI). */
  readonly divergences: number;
  /** En büyük mutlak mesafe farkı (m) — hiç ölçülmediyse `null` (sahte 0 YOK). */
  readonly maxAbsDeltaM: number | null;
  readonly lastDeltaM: number | null;
  readonly lastVerdict: ShadowVerdict | null;
  /** Son örneğin dayandığı ufuk üretimi. */
  readonly lastGeneration: number | null;
}

export const EMPTY_SHADOW_COUNTERS: ShadowDomainCounters = Object.freeze({
  samples: 0,
  agree: 0,
  divergeDistance: 0,
  divergePresence: 0,
  legacyOnly: 0,
  cehOnly: 0,
  bothAbsent: 0,
  bothUnmeasured: 0,
  cehAmbiguous: 0,
  notComparable: 0,
  labelMismatches: 0,
  comparable: 0,
  divergences: 0,
  maxAbsDeltaM: null,
  lastDeltaM: null,
  lastVerdict: null,
  lastGeneration: null,
});

/** Örneği deftere KATLAR. **Saf** — girdiyi değiştirmez, yeni nesne döner. */
export function foldShadowSample(
  prev: ShadowDomainCounters, s: ShadowSample,
): ShadowDomainCounters {
  const d = _num(s.deltaM);
  const absD = d === null ? null : Math.abs(d);
  const prevMax = prev.maxAbsDeltaM;
  return {
    samples: prev.samples + 1,
    agree: prev.agree + (s.verdict === 'AGREE' ? 1 : 0),
    divergeDistance: prev.divergeDistance + (s.verdict === 'DIVERGE_DISTANCE' ? 1 : 0),
    divergePresence: prev.divergePresence + (s.verdict === 'DIVERGE_PRESENCE' ? 1 : 0),
    legacyOnly: prev.legacyOnly + (s.verdict === 'LEGACY_ONLY' ? 1 : 0),
    cehOnly: prev.cehOnly + (s.verdict === 'CEH_ONLY' ? 1 : 0),
    bothAbsent: prev.bothAbsent + (s.verdict === 'BOTH_ABSENT' ? 1 : 0),
    bothUnmeasured: prev.bothUnmeasured + (s.verdict === 'BOTH_UNMEASURED' ? 1 : 0),
    cehAmbiguous: prev.cehAmbiguous + (s.verdict === 'CEH_AMBIGUOUS' ? 1 : 0),
    notComparable: prev.notComparable + (s.verdict === 'NOT_COMPARABLE' ? 1 : 0),
    labelMismatches: prev.labelMismatches + (s.labelMismatch ? 1 : 0),
    comparable: prev.comparable + (verdictIsComparable(s.verdict) ? 1 : 0),
    divergences: prev.divergences + (verdictIsDivergence(s.verdict) ? 1 : 0),
    maxAbsDeltaM: absD === null ? prevMax : (prevMax === null ? absD : Math.max(prevMax, absD)),
    lastDeltaM: d,
    lastVerdict: s.verdict,
    lastGeneration: s.generation,
  };
}

/**
 * Fark oranı [0,1]. **Karşılaştırılabilir örnek yoksa `null`** — sıfır fark
 * İDDİA EDİLMEZ (hiç ölçmeyerek "%0 sapma" göstermek yalandır).
 */
export function shadowDivergenceRatio(c: ShadowDomainCounters): number | null {
  if (!c || c.comparable <= 0) return null;
  return c.divergences / c.comparable;
}
