/**
 * cehShadowRuntime.ts — NAV v3 · F5 · GÖLGE KOŞUM ZAMANI (durum sahibi).
 *
 * Belge: `CAROS-NAV-ARCH-SPEC-3.0` §F5.3/F5.5/F5.6 · CLAUDE.md §CROSS-DOMAIN
 * 1/2/3/5/7/12/14/15/18.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NEDİR ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **Gölge gözlemcisidir — bir OTORİTE DEĞİLDİR.** Her ego/ufuk adımında,
 * üretimde çalışan legacy cevaplarla CEH'in aynı soruya verdiği cevabı yan
 * yana okur ve FARKI ÖLÇER. Ürettiği tek şey SAYAÇTIR.
 *
 * ── PAZARLIKSIZ SINIRLAR (kilit test kaynak taramasıyla denetler) ────────
 *  · **Yan etki YOK**: TTS yok · uyarı yok · store yazımı yok · navigasyon
 *    kararı yok. Kullanıcıya bu dosyadan TEK BİR ses/uyarı çıkamaz.
 *  · **Tik sahibi DEĞİL**: timer/abonelik/scheduler KURMAZ. `noteCehShadowTick()`
 *    çağrısını mevcut tik sahibi (`navigationSessionRuntime` →
 *    `navEgoHorizonBridge`) yapar. İkinci GPS aboneliği YOK.
 *  · **İkinci gerçek YOK**: ne CEH'i, ne graf ayrıştırıcısını, ne rota
 *    ilerlemesini yeniden hesaplar. Hepsini KANONİK sahiplerinden okur.
 *  · **Üretim otoritesi DEĞİŞMEZ**: legacy cevap ne ise ürün onu kullanmaya
 *    devam eder. Bu dosya hiçbir üretim yoluna geri beslenmez.
 *  · **Fail-soft**: buradaki hiçbir hata navigasyonu, Guardian'ı veya sesli
 *    yönlendirmeyi düşürmez — sayılır ve geçilir.
 *
 * ── NEDEN `horizon/` ALTINDA DEĞİL ───────────────────────────────────────
 * Bu dosya L4 modüllerini (`routingService`) ve Guardian sağlayıcı sayaçlarını
 * OKUR. `horizon/**` ağacında tek bir L4 importu bile bulunmamalıdır (F3 K8
 * kilidi) — bu yüzden gölge katmanı ayrı bir ağaçtadır ve L3'ü yalnız
 * salt-okunur tüketici sözleşmesi üzerinden görür.
 */

import { readMonotonicNow } from '../time/navClock';
import type { MonotonicMs } from '../contracts/navMonotonicTime';
import type { CehAheadDomain, CehAheadClaim } from '../horizon/cehConsumerContract';
import { CEH_AHEAD_DOMAINS, readCehAhead } from '../horizon/cehConsumerContract';
import { getCehAuthority } from '../horizon/cehAuthority';
import { HORIZON_ATTRIBUTE_DOMAINS } from '../horizon/horizonAttributePorts';
import type { HorizonAttributeDomain } from '../horizon/horizonAttributePorts';
import type {
  LegacyAheadClaim, ShadowDomainCounters, ShadowSample,
} from './cehShadowModel';
import {
  EMPTY_SHADOW_COUNTERS, compareAhead, foldShadowSample, legacyAheadUnanswered,
  shadowDivergenceRatio,
} from './cehShadowModel';
import type { CehShadowGuardianVerdict } from './cehGuardianShadowAdapter';
import { buildCehShadowGuardianVerdict } from './cehGuardianShadowAdapter';
import type { SuppressionCounters, SuppressionDisposition } from './cehSuppressionContract';
import {
  EMPTY_SUPPRESSION_COUNTERS, classifySuppression, foldSuppression,
} from './cehSuppressionContract';
import type { CehCutoverGateVerdict } from './cehCutoverGate';
import { evaluateCehCutoverGate } from './cehCutoverGate';
/* Legacy ÜRETİM cevapları — yalnız OKUNUR, hiçbiri çağrılarak tetiklenmez. */
import { getRouteState } from '../../routingService';
import {
  getEnforcementGateCounters,
} from '../guardian/providers/concrete/enforcementMapSource';
import {
  GUARDIAN_ENFORCEMENT_RADIUS_M, GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
  GUARDIAN_ENFORCEMENT_SOURCE_ID,
} from '../guardian/runtime/guardianEnforcementPolicy';
/* Geçerlilik bütçesi deponun TANIMLI eşiğinden gelir — uydurma süre YASAK. */
import { GPS_FIX_STALE_MS } from '../../freshnessPolicy';

/* ══════════════════════════════════════════════════════════════════════════
   1) ÖZNİTELİK PORTU GERÇEĞİ — beyan değil, ÖLÇÜM
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * O anda `CehAuthority`ye bağlı portun GERÇEKTEN ürettiği alanlar (F6).
 * `getDiagnostics().boundDomains` bağlı portun KENDİ `boundDomains`
 * KAPASİTESİDİR — beyan değil ölçüm. Okuma hatası → boş (hiçbir şey bağlı
 * SAYILMAZ, fail-closed).
 */
function _currentBoundDomains(): readonly HorizonAttributeDomain[] {
  try {
    const bd = getCehAuthority().getDiagnostics().boundDomains;
    return Array.isArray(bd) ? bd : [];
  } catch {
    return [];
  }
}

/**
 * CEH öznitelik portları TAMAMEN bağlı mı (dört alanın DÖRDÜ de) — cutover
 * kapısının `ATTRIBUTE_PORTS_BOUND` şartı BUDUR (F6). **Yalnız `ENFORCEMENT`
 * bağlı olması bunu KARŞILAMAZ** — tek alan bağlıyken kapı hâlâ kapalı
 * kalmalıdır (görev şartı: "sadece enforcement bağlandı diye tüm attribute
 * portlarını 'bound' sayma").
 */
export function cehAttributePortsBound(): boolean {
  const bd = _currentBoundDomains();
  for (const d of HORIZON_ATTRIBUTE_DOMAINS) {
    if (bd.indexOf(d) < 0) return false;
  }
  return true;
}

/**
 * Bir alanın CEH tarafında GERÇEKTEN ölçülüp ölçülmediği — ALAN BAZINDA
 * (kapı şartından AYRI: burada TEK alanın bağlı olması yeterlidir).
 *
 * `MANEUVER` rota niyetinden üretilir (`horizonModel.maneuverObjects`) →
 * öznitelik portundan BAĞIMSIZ olarak ölçülür. Diğer dört alan yalnız
 * öznitelik portundan gelebilir; bu ALANA ÖZEL bağlı değilken boş liste
 * **"ileride yok" DEMEK DEĞİLDİR** ve `NOT_MEASURED` hükmü döner.
 */
function _domainMeasured(domain: CehAheadDomain): boolean {
  if (domain === 'MANEUVER') return true;
  return _currentBoundDomains().indexOf(domain as HorizonAttributeDomain) >= 0;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) LEGACY OKUYUCULAR — üretim yolunu TETİKLEMEZ, yalnız SON hükmü okur
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Sıradaki manevra — üretimin bugünkü cevabı.
 *
 * Kaynak: `routingService` rota deposu (`distanceToNextTurnMeters` +
 * `distanceToNextTurnSource`). Bu, sesli yönlendirmenin ve HUD'un BUGÜN
 * kullandığı sayının TA KENDİSİDİR (`navigationSessionRuntime._feedVoiceGuidance`
 * aynı alanları okur) — gölge, ürünün gerçekten kullandığı değerle karşılaştırır.
 */
function _readLegacyManeuver(): LegacyAheadClaim {
  try {
    const rs = getRouteState();
    const src = rs.distanceToNextTurnSource;
    const d = rs.distanceToNextTurnMeters;

    /* Mesafe kaynağı bilinmiyorsa üretim de kesin komut ÜRETMEZ
       (`ManeuverDistanceSource.UNKNOWN` sözleşmesi) → ölçülmedi. */
    if (src === 'UNKNOWN' || typeof d !== 'number' || !Number.isFinite(d) || d < 0) {
      return { domain: 'MANEUVER', outcome: 'NOT_MEASURED', distanceM: null, label: null, method: String(src ?? 'UNKNOWN') };
    }

    const next = rs.steps?.[rs.currentStepIndex + 1] ?? null;
    if (!next) {
      /* Rota var, ilerleme ölçülü ama SIRADAKİ manevra yok (son adım) →
         ölçülmüş yokluk. Bu bir kusur değil, gerçek bir gözlemdir. */
      return { domain: 'MANEUVER', outcome: 'MEASURED_ABSENT', distanceM: null, label: null, method: String(src) };
    }

    const type = typeof next.maneuverType === 'string' && next.maneuverType.length > 0
      ? next.maneuverType : 'unknown';
    const mod = typeof next.maneuverModifier === 'string' && next.maneuverModifier.length > 0
      ? next.maneuverModifier : 'unknown';

    return {
      domain: 'MANEUVER',
      outcome: 'CLAIM',
      distanceM: d,
      /* CEH ile AYNI makine-okur biçim — serbest talimat metni TAŞINMAZ. */
      label: `${type}:${mod}`,
      method: String(src),
    };
  } catch {
    return { domain: 'MANEUVER', outcome: 'NOT_MEASURED', distanceM: null, label: null, method: 'ERROR' };
  }
}

/**
 * Denetim noktası — üretimin bugünkü cevabı (Guardian `map` yuvası).
 *
 * Kaynak: `enforcementMapSource` kapı sayaçları. Bu sayaçlar Guardian'ın SON
 * okumasının sonucudur; bu fonksiyon Guardian'ı KOŞTURMAZ (yan etki yok).
 *
 * ⚠️ Yöntem farkı: legacy mesafe **kuş uçuşu + yön konisi** ile bulunur
 * (`GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG`), CEH ise yol-boyu mesafe
 * ister. Bu fark `method` alanında TAŞINIR; kaybolursa saha ölçümü
 * yorumlanamaz hâle gelir.
 */
function _readLegacyEnforcement(): { claim: LegacyAheadClaim; readCount: number } {
  try {
    const g = getEnforcementGateCounters();
    if (g.readCount <= 0) {
      return {
        claim: { domain: 'ENFORCEMENT', outcome: 'NOT_MEASURED', distanceM: null, label: null, method: 'NOT_READ' },
        readCount: 0,
      };
    }
    if (g.lastGate === null && typeof g.lastDistanceM === 'number' && Number.isFinite(g.lastDistanceM)) {
      return {
        claim: {
          domain: 'ENFORCEMENT', outcome: 'CLAIM', distanceM: g.lastDistanceM,
          label: 'enforcement:point', method: 'CONE_RADIUS',
        },
        readCount: g.readCount,
      };
    }
    /* YALNIZ `NO_POINT_AHEAD` bir ÖLÇÜMDÜR: yedi kapının hepsi geçildi,
       yarıçap tarandı ve nokta bulunamadı. Diğer altı kapı bir BİLGİSİZLİKTİR
       (paket hazır değil · konum yok · fix bayat · hız yok · belirsizlik
       büyük · yön güvenilmez) ve "denetim yok" DEMEK DEĞİLDİR. */
    return {
      claim: {
        domain: 'ENFORCEMENT',
        outcome: g.lastGate === 'NO_POINT_AHEAD' ? 'MEASURED_ABSENT' : 'NOT_MEASURED',
        distanceM: null, label: null, method: String(g.lastGate ?? 'UNKNOWN'),
      },
      readCount: g.readCount,
    };
  } catch {
    return {
      claim: { domain: 'ENFORCEMENT', outcome: 'NOT_MEASURED', distanceM: null, label: null, method: 'ERROR' },
      readCount: 0,
    };
  }
}

/**
 * Hız limiti / viraj / yol profili — üretimde "İLERİDE" sorusunu cevaplayan
 * otorite **YOKTUR**.
 *
 * ÖLÇÜLDÜ (2026-09-03): `speedLimitService` + `useEffectiveSpeedLimit`
 * BULUNULAN yolun limitini verir, ileride değişen limiti değil.
 * `guardianRuntime._SOURCE_WIRING` map yuvası için "yalnız speedCamera dilimi
 * bağlı; viraj/limit/eğim/tehlike dilimlerinin üreticisi YOK" der ve
 * `enforcementMapSource.read()` yalnız `{ speedCamera }` döndürür.
 *
 * Bu yüzden hüküm `NOT_ANSWERED`tır → karşılaştırma `NOT_COMPARABLE` olur ve
 * oranın PAYDASINA GİRMEZ. Bunu "uyum" saymak, hiç sormayarak %100 uyum
 * kazanmak olurdu.
 */
function _readLegacyUnanswered(domain: CehAheadDomain): LegacyAheadClaim {
  return legacyAheadUnanswered(domain);
}

/* ══════════════════════════════════════════════════════════════════════════
   3) DURUM (modül düzeyinde — tek sahip, bounded)
   ══════════════════════════════════════════════════════════════════════════ */

/** Ufuk durum dağılımı — belirsizlik/bozulma sahada görünür olsun diye. */
export interface CehShadowStateCounters {
  readonly horizons: number;
  readonly ambiguous: number;
  readonly physicallyConfirmed: number;
  readonly routeIntentOnly: number;
  readonly noHorizon: number;
  readonly lastState: string | null;
  readonly lastProvenance: string | null;
}

const _EMPTY_STATE_COUNTERS: CehShadowStateCounters = Object.freeze({
  horizons: 0, ambiguous: 0, physicallyConfirmed: 0, routeIntentOnly: 0,
  noHorizon: 0, lastState: null, lastProvenance: null,
});

export interface CehShadowSnapshot {
  /** Gölge hiç koştu mu. */
  readonly active: boolean;
  readonly ticks: number;
  readonly errorCount: number;
  readonly lastErrorAgeMs: number | null;
  /** CEH öznitelik portları gerçekten bağlı mı (referans kimliği ölçümü). */
  readonly attributePortsBound: boolean;
  /** Alan başına karşılaştırma defteri. */
  readonly domains: Readonly<Record<CehAheadDomain, ShadowDomainCounters>>;
  /** Tüm alanların toplamı (oran bu toplamdan hesaplanır). */
  readonly total: ShadowDomainCounters;
  /** Fark oranı [0,1] — karşılaştırılabilir örnek yoksa `null`. */
  readonly divergenceRatio: number | null;
  readonly states: CehShadowStateCounters;
  /** Guardian gölge hükmü — SON tur. */
  readonly guardianShadow: CehShadowGuardianVerdict | null;
  /** Guardian gölgesinin kaç turda uyarı ÜRETECEĞİ (kapı açık olsaydı). */
  readonly guardianWouldEmitCount: number;
  readonly suppression: SuppressionCounters;
  /** Cutover kapısı — varsayılan KAPALI. */
  readonly cutover: CehCutoverGateVerdict;
  /**
   * Bu gölge katmanının sürücüye ürettiği yan etki sayısı. **Yapısal olarak
   * DAİMA 0'dır** (dosyada ses/uyarı/store yazımı yoktur) — LAB'da bu sayı
   * gölge sözleşmesinin canlı kanıtıdır.
   */
  readonly sideEffectCount: 0;
}

function _emptyDomains(): Record<CehAheadDomain, ShadowDomainCounters> {
  const out = {} as Record<CehAheadDomain, ShadowDomainCounters>;
  for (const d of CEH_AHEAD_DOMAINS) out[d] = EMPTY_SHADOW_COUNTERS;
  return out;
}

/** Sunulmuş olay anahtarları — bounded (sınırsız büyüme YOK). */
const MAX_DELIVERED_KEYS = 64;

let _active = false;
let _ticks = 0;
let _errors = 0;
let _lastErrorAtMonoMs: MonotonicMs | null = null;
let _domains: Record<CehAheadDomain, ShadowDomainCounters> = _emptyDomains();
let _total: ShadowDomainCounters = EMPTY_SHADOW_COUNTERS;
let _states: CehShadowStateCounters = _EMPTY_STATE_COUNTERS;
let _guardianShadow: CehShadowGuardianVerdict | null = null;
let _guardianWouldEmit = 0;
let _suppression: SuppressionCounters = EMPTY_SUPPRESSION_COUNTERS;
let _lastEnforcementReadCount = -1;
let _lastEventKey: string | null = null;
let _deliveredKeys = new Set<string>();

/* ══════════════════════════════════════════════════════════════════════════
   4) TİK — yan etkisiz ölçüm
   ══════════════════════════════════════════════════════════════════════════ */

function _foldDomain(domain: CehAheadDomain, sample: ShadowSample): void {
  _domains = { ..._domains, [domain]: foldShadowSample(_domains[domain], sample) };
  _total = foldShadowSample(_total, sample);
}

function _noteStates(claim: CehAheadClaim, ambiguous: boolean, hasHorizon: boolean): void {
  _states = {
    horizons: _states.horizons + (hasHorizon ? 1 : 0),
    ambiguous: _states.ambiguous + (ambiguous ? 1 : 0),
    physicallyConfirmed: _states.physicallyConfirmed + (claim.physicallyConfirmed ? 1 : 0),
    routeIntentOnly: _states.routeIntentOnly
      + (claim.provenance === 'ROUTE_INTENT' ? 1 : 0),
    noHorizon: _states.noHorizon + (hasHorizon ? 0 : 1),
    lastState: claim.outcome,
    lastProvenance: claim.provenance,
  };
}

/**
 * Tek gölge adımı. **Tik sahibi çağırır**; burada timer YOKTUR ve hiçbir
 * kullanıcı-görünür etki ÜRETİLMEZ.
 *
 * Sıra: ufku OKU → her alan için CEH iddiasını üret → legacy cevabı OKU →
 * karşılaştır → defteri katla → Guardian gölge hükmünü ve bastırma akıbetini
 * sınıflandır. Hiçbir adım bir üretim yoluna geri BESLENMEZ.
 */
export function noteCehShadowTick(): void {
  const now = readMonotonicNow();
  _active = true;
  _ticks++;

  try {
    const horizon = getCehAuthority().getHorizon();
    const hasHorizon = horizon !== null;
    const ambiguous = horizon?.ambiguous === true;

    /* Aynı Guardian okumasını defalarca saymamak için: denetim alanı YALNIZ
       Guardian gerçekten yeniden okuduğunda örneklenir. Aksi hâlde tek bir
       Guardian okuması yüzlerce "örnek" gibi görünür ve oran çürür. */
    const enf = _readLegacyEnforcement();
    const enforcementIsNew = enf.readCount !== _lastEnforcementReadCount;

    let enforcementClaim: CehAheadClaim | null = null;

    for (const domain of CEH_AHEAD_DOMAINS) {
      const claim = readCehAhead(horizon, domain, {
        validityBudgetMs: GPS_FIX_STALE_MS,
        domainMeasured: _domainMeasured(domain),
      });

      if (domain === 'MANEUVER') {
        _noteStates(claim, ambiguous, hasHorizon);
        _foldDomain(domain, compareAhead(_readLegacyManeuver(), claim));
        continue;
      }

      if (domain === 'ENFORCEMENT') {
        enforcementClaim = claim;
        if (enforcementIsNew) {
          _lastEnforcementReadCount = enf.readCount;
          _foldDomain(domain, compareAhead(enf.claim, claim));
        }
        continue;
      }

      /* Limit / viraj / yol profili: üretimde soruyu soran YOK. */
      _foldDomain(domain, compareAhead(_readLegacyUnanswered(domain), claim));
    }

    /* ── Guardian gölge hükmü — kapı KAPALI olduğu için daima engellenir ── */
    const cutover = _evaluateGate();
    const verdict = buildCehShadowGuardianVerdict(
      enforcementClaim,
      {
        radiusM: GUARDIAN_ENFORCEMENT_RADIUS_M,
        minConfidence: GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE,
        sourceId: GUARDIAN_ENFORCEMENT_SOURCE_ID,
      },
      cutover.open,
    );
    _guardianShadow = verdict;
    if (verdict.wouldEmit) _guardianWouldEmit++;

    /* ── Bastırma akıbeti — sunum YOK, bu yüzden `presented` DAİMA false ── */
    const key = verdict.eventKey;
    if (key !== null) {
      const disposition: SuppressionDisposition = classifySuppression({
        key,
        presented: false,                          // gölge SUNMAZ (yapısal)
        alreadyDelivered: _deliveredKeys.has(key),
        superseded: _lastEventKey !== null && _lastEventKey !== key,
        validUntilMonoMs: enforcementClaim?.validUntilMonoMs ?? null,
        nowMonoMs: now,
      });
      _suppression = foldSuppression(_suppression, disposition);
      if (disposition === 'DELIVERED') {
        if (_deliveredKeys.size >= MAX_DELIVERED_KEYS) {
          const oldest = _deliveredKeys.values().next();
          if (!oldest.done) _deliveredKeys.delete(oldest.value);
        }
        _deliveredKeys.add(key);
      }
      _lastEventKey = key;
    }
  } catch {
    /* Fail-soft: gölge ölçümündeki bir hata navigasyonu ASLA düşürmez. */
    _errors++;
    _lastErrorAtMonoMs = now;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   5) CUTOVER KAPISI
   ══════════════════════════════════════════════════════════════════════════ */

function _evaluateGate(): CehCutoverGateVerdict {
  return evaluateCehCutoverGate({
    /* Saha hükmünü ÜRETEN bir çalışma-zamanı kaynağı YOKTUR: kütük
       (`docs/DEVICE_VALIDATION_LEDGER.md` #1232–#1243) bir insan kararıdır.
       `null` = ölçülmedi → şart KARŞILANMAZ (fail-closed). */
    f4FieldValidationPassed: null,
    comparableSamples: _total.comparable,
    divergenceRatio: shadowDivergenceRatio(_total),
    /* Belirsizlik fail-closed kanıtı kilit testlerdedir; çalışma zamanında
       ölçülmez → `null`. */
    ambiguityFailClosedProven: null,
    regressionGuardsPassed: null,
    attributePortsBound: cehAttributePortsBound(),
  });
}

/** Cutover kapısının o andaki hükmü — salt-okunur. */
export function getCehCutoverVerdict(): CehCutoverGateVerdict {
  return _evaluateGate();
}

/* ══════════════════════════════════════════════════════════════════════════
   6) GÖZLEM + ÖMÜR
   ══════════════════════════════════════════════════════════════════════════ */

/** Salt-okunur anlık görüntü — CAROS LAB'ın TEK okuma ucu. Yan etkisi YOKTUR. */
export function getCehShadowSnapshot(): CehShadowSnapshot {
  const now = readMonotonicNow();
  return {
    active: _active,
    ticks: _ticks,
    errorCount: _errors,
    lastErrorAgeMs: (now !== null && _lastErrorAtMonoMs !== null)
      ? Math.max(0, Math.round(now - _lastErrorAtMonoMs))
      : null,
    attributePortsBound: cehAttributePortsBound(),
    domains: _domains,
    total: _total,
    divergenceRatio: shadowDivergenceRatio(_total),
    states: _states,
    guardianShadow: _guardianShadow,
    guardianWouldEmitCount: _guardianWouldEmit,
    suppression: _suppression,
    cutover: _evaluateGate(),
    sideEffectCount: 0,
  };
}

/**
 * Oturum bitti → gölge defteri düşer.
 *
 * Eski oturumun farkları yeni oturuma TAŞINMAZ: farklı yol, farklı rota,
 * farklı GPS kalitesi. Taşınsaydı cutover oranı geçmiş bir yolculuğun
 * kanıtıyla açılabilirdi.
 */
export function resetCehShadow(): void {
  _active = false;
  _ticks = 0;
  _errors = 0;
  _lastErrorAtMonoMs = null;
  _domains = _emptyDomains();
  _total = EMPTY_SHADOW_COUNTERS;
  _states = _EMPTY_STATE_COUNTERS;
  _guardianShadow = null;
  _guardianWouldEmit = 0;
  _suppression = EMPTY_SUPPRESSION_COUNTERS;
  _lastEnforcementReadCount = -1;
  _lastEventKey = null;
  _deliveredKeys = new Set<string>();
}

/** @internal testler arası izolasyon. */
export function _resetCehShadowForTest(): void {
  resetCehShadow();
}
