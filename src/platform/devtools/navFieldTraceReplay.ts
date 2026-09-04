/**
 * navFieldTraceReplay.ts — NAV v3 · F8 · SAHA KAYDINDAN DETERMİNİSTİK
 * DOĞRULAMA (SAF).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F8.7.
 *
 * SAF: I/O YOK · timer YOK · `Date.now`/`performance.now` YOK · React YOK ·
 * ağ YOK · modül durumu YOK. Girdi bir `NavFieldTrace`tir (host'ta okunmuş
 * JSON) — bu dosya onu ÜRETMEZ, yalnız üzerinde deterministik hesap yapar.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE İŞE YARAR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `exportFieldTrace()` bir SAHA kaydını host'a taşır. Bu dosya o kaydı
 * F3–F7'nin ZATEN VAR OLAN sözleşme kurallarına karşı DENETLER — sahadaki
 * bir "bug"ı bir host testine ÇEVİRMENİN aracıdır:
 *
 *   1. saha kaydı export edilir (`__CAROS_NAV_FIELD__.exportTrace()`)
 *   2. `replayFieldTrace(trace)` çağrılır (bu dosya, host'ta)
 *   3. bir ihlal çıkarsa TAM O ÖRNEĞİN indeksi/alanı bilinir — sentetik bir
 *      fixture'a dönüştürmek (`navV3*.test.ts` desenleriyle) artık MÜMKÜN
 *
 * ── BU DOSYA NE YAPMAZ (pazarlıksız) ────────────────────────────────────
 *  · **İKİNCİ RUNTIME DEĞİLDİR.** GPS/Guardian/native sağlayıcı TAKLİT
 *    ETMEZ; yalnız ZATEN kaydedilmiş SAYILARI okur.
 *  · **ÜRETİM KARARINA GERİ BESLENMEZ.** Sonuç yalnız bir RAPORDUR.
 *  · **YENİ KURAL İCAT ETMEZ.** Her denetlenen ilke, F3–F7'nin kod
 *    içinde ZATEN uyguladığı bir sözleşmenin izidir (dosya:satır kaynağı
 *    her kontrolün docblock'unda YAZAR).
 */

import type { NavFieldSample, NavFieldTrace } from './navFieldBridge';

/* ══════════════════════════════════════════════════════════════════════════
   1) İLKE SÖZLÜĞÜ
   ══════════════════════════════════════════════════════════════════════════ */

export type FieldTraceInvariantId =
  /** `horizonModel.ts` §conflict: belirsiz kolda `mppPathId` HER ZAMAN `null`. */
  | 'AMBIGUOUS_NOT_DEFINITE'
  /** `enforcementHorizonPort.ts` (F6 düzeltmesi): kesik koridor "yok" DEMEZ. */
  | 'TRUNCATED_CORRIDOR_NOT_ABSENT'
  /** `cehShadowModel.ts`: fark sayısı karşılaştırılabilir sayıyı AŞAMAZ. */
  | 'NOT_MEASURED_NOT_AGREEMENT'
  /** `enforcementEdgeIndex.ts`: her eşleşme YA `ONEWAY_IMPLIED` YA `UNKNOWN_DIRECTION`dır — üçüncü hal (yönsüz kesinlik) YOKTUR. */
  | 'WRONG_DIRECTION_NOT_DEFINITE'
  /** `routeRationaleModel.ts`: `NO_CANDIDATE` ⟺ `chosenIdx === null`; belirlenmiş etken ⟹ bir seçim VARDIR. */
  | 'RATIONALE_MATCHES_SELECTION';

export const FIELD_TRACE_INVARIANTS: readonly FieldTraceInvariantId[] = [
  'AMBIGUOUS_NOT_DEFINITE', 'TRUNCATED_CORRIDOR_NOT_ABSENT',
  'NOT_MEASURED_NOT_AGREEMENT', 'WRONG_DIRECTION_NOT_DEFINITE',
  'RATIONALE_MATCHES_SELECTION',
] as const;

export interface FieldTraceInvariantViolation {
  readonly invariant: FieldTraceInvariantId;
  readonly sampleIndex: number;
  /** Makine-okur ayrıntı — serbest metin DEĞİL, alan=değer biçiminde. */
  readonly detail: string;
}

export interface FieldTraceReplayResult {
  readonly sampleCount: number;
  readonly eventCount: number;
  readonly checkedInvariants: readonly FieldTraceInvariantId[];
  readonly violations: readonly FieldTraceInvariantViolation[];
  readonly passed: boolean;
}

const _EMPTY_RESULT: FieldTraceReplayResult = Object.freeze({
  sampleCount: 0, eventCount: 0, checkedInvariants: FIELD_TRACE_INVARIANTS,
  violations: [], passed: true,
});

/* ══════════════════════════════════════════════════════════════════════════
   2) DENETİM (saf — girdiyi DEĞİŞTİRMEZ)
   ══════════════════════════════════════════════════════════════════════════ */

function _checkSample(s: NavFieldSample, i: number, out: FieldTraceInvariantViolation[]): void {
  /* ① belirsiz kolda MPP olamaz */
  if (s.ceh !== null && s.ceh.state === 'AMBIGUOUS_PATH' && s.ceh.mppPresent === true) {
    out.push({
      invariant: 'AMBIGUOUS_NOT_DEFINITE', sampleIndex: i,
      detail: `ceh.state=AMBIGUOUS_PATH ceh.mppPresent=true`,
    });
  }

  /* ② kesik koridor "ileride yok" DİYEMEZ (F6 kusuru — burada SAHA verisiyle yeniden denetlenir) */
  if (s.roadCorridor !== null && s.roadCorridor.lastCorridorTruncated === true
    && s.roadCorridor.lastOutcome === 'NO_OBJECTS_IN_RANGE') {
    out.push({
      invariant: 'TRUNCATED_CORRIDOR_NOT_ABSENT', sampleIndex: i,
      detail: `roadCorridor.lastCorridorTruncated=true roadCorridor.lastOutcome=NO_OBJECTS_IN_RANGE`,
    });
  }

  /* ③ gölge fark sayısı karşılaştırılabilir sayıyı AŞAMAZ (NOT_MEASURED payda dışıdır) */
  if (s.shadow !== null && s.shadow.divergent > s.shadow.comparable) {
    out.push({
      invariant: 'NOT_MEASURED_NOT_AGREEMENT', sampleIndex: i,
      detail: `shadow.divergent=${s.shadow.divergent} > shadow.comparable=${s.shadow.comparable}`,
    });
  }
  /* Oranın kendisi de sayaçlarla TUTARLI olmalı — hesaplama sürüklenmesi
     ("yaklaşık uydu ama sayaçtan bağımsızlaştı") burada yakalanır. */
  if (s.shadow !== null && s.shadow.comparable > 0 && s.shadow.divergenceRatio !== null) {
    const expected = s.shadow.divergent / s.shadow.comparable;
    if (Math.abs(expected - s.shadow.divergenceRatio) > 1e-6) {
      out.push({
        invariant: 'NOT_MEASURED_NOT_AGREEMENT', sampleIndex: i,
        detail: `shadow.divergenceRatio=${s.shadow.divergenceRatio} beklenen=${expected}`,
      });
    }
  }

  /* ④ her eşleşme YÖNÜ bilinir hâlde sınıflanır — üçüncü (yönsüz-kesin) hâl YOK */
  if (s.enforcement !== null) {
    const e = s.enforcement;
    if (e.onewayImplied + e.unknownDirection !== e.matchedToEdge) {
      out.push({
        invariant: 'WRONG_DIRECTION_NOT_DEFINITE', sampleIndex: i,
        detail: `matchedToEdge=${e.matchedToEdge} onewayImplied=${e.onewayImplied} unknownDirection=${e.unknownDirection}`,
      });
    }
  }

  /* ⑤ gerekçe ↔ seçim tutarlılığı */
  if (s.rationale !== null) {
    const r = s.rationale;
    if (r.lastFactor === 'NO_CANDIDATE' && r.lastChosenIdx !== null) {
      out.push({
        invariant: 'RATIONALE_MATCHES_SELECTION', sampleIndex: i,
        detail: `rationale.lastFactor=NO_CANDIDATE rationale.lastChosenIdx=${r.lastChosenIdx}`,
      });
    }
    if (r.lastFactor !== null && r.lastFactor !== 'NO_CANDIDATE' && r.lastFactor !== 'UNKNOWN'
      && r.lastChosenIdx === null) {
      out.push({
        invariant: 'RATIONALE_MATCHES_SELECTION', sampleIndex: i,
        detail: `rationale.lastFactor=${r.lastFactor} rationale.lastChosenIdx=null`,
      });
    }
  }
}

/**
 * Kaydı DENETLER. **Saf** — aynı kayıt daima aynı sonucu verir. Trace
 * `null`/boşsa ihlal ÜRETİLMEZ (denetlenecek veri yok — "geçti" DEĞİL,
 * `sampleCount: 0` bunu açıkça söyler).
 */
export function replayFieldTrace(trace: NavFieldTrace | null | undefined): FieldTraceReplayResult {
  if (!trace || !Array.isArray(trace.samples) || trace.samples.length === 0) {
    return _EMPTY_RESULT;
  }
  const violations: FieldTraceInvariantViolation[] = [];
  for (let i = 0; i < trace.samples.length; i++) {
    _checkSample(trace.samples[i], i, violations);
  }
  return {
    sampleCount: trace.samples.length,
    eventCount: Array.isArray(trace.events) ? trace.events.length : 0,
    checkedInvariants: FIELD_TRACE_INVARIANTS,
    violations,
    passed: violations.length === 0,
  };
}
