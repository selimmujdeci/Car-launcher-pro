/**
 * oemCapabilityEvidence — OEM DISCOVERY FAZ 1 · YETENEK KANIT MODELİ (SAF).
 *
 * ── NEDEN BOOLEAN DEĞİL ───────────────────────────────────────────────────
 * "Destekliyor mu?" sorusunun tek bir `true/false` cevabı YOKTUR. Ürün bunu bir kez
 * `manufacturerPidService`te öğrendi: `!supported` gelen her DID kalıcı kara listeye
 * giriyordu ve "motor çalışınca okunabilen" bir kimlik SONSUZA DEK yasaklanıyordu.
 * Çözüm sözlüğü zaten var (`capabilityOutcome.ts`, PR-CAP-1). Bu modül o sözlüğü
 * OEM sinyali bağlamına taşır — İKİNCİ bir sonuç anlamı İCAT ETMEZ.
 *
 * ── ZERO-TRUST (değişmez) ─────────────────────────────────────────────────
 *  · timeout / hat hatası ARAÇ HAKKINDA KANIT DEĞİLDİR → asla UNSUPPORTED üretmez
 *    (`capabilityOutcome.isCapabilityEvidence` tek karar mercii).
 *  · Kanıt KAPSAMLIDIR: araç parmak izi + protokol sınıfı + ECU adresi. Kapsam değişirse
 *    eski kanıt OTORİTE DEĞİLDİR (körlemesine yeniden kullanılmaz).
 *  · Bayat kanıt otorite değildir — poll kararı tazelik ister.
 *  · Makullük bandı dışı çözüm DEĞER ÜRETMEZ; kanıt ERROR'a düşer (sessiz sahte veri yok).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (enjekte edilir) · global durum YOK · React YOK.
 */

import {
  isCapabilityEvidence, type CapabilityOutcome,
} from '../capabilityOutcome';
import { decodeCompiledDid, type CompiledDidDef, type VehicleDidValue } from '../vehicleDidProfile';
import { recommendPollClass, canAdmitNewDidPoll, type PollClass } from '../discovery/pollingAdmissionGate';
import type { ProtocolClass } from '../protocolProfile';
import type { OemSignalDef, OemSignalId } from './oemSignalCatalog';
import { isOemSignalDecodable, isOemSignalProbeable } from './oemSignalCatalog';

/* ══════════════════════════════════════════════════════════════════════════
 * 1) DURUM SÖZLÜĞÜ
 * ════════════════════════════════════════════════════════════════════════ */

export type OemCapabilityState =
  /** Hiç sorulmadı ya da yalnız kanıt-olmayan sonuç (timeout) görüldü. */
  | 'UNKNOWN'
  /** Bu turda sorgu sırada/uçuşta — geçici çalışma durumu. */
  | 'PROBING'
  /** Pozitif ECU yanıtı alındı (kimlik GERÇEKTEN var). */
  | 'SUPPORTED'
  /** ECU açıkça reddetti (7F-31 requestOutOfRange / 7F-33 securityAccessDenied). KALICI. */
  | 'UNSUPPORTED'
  /** Kimlik var olabilir ama ŞU AN okunamıyor (NO DATA / koşul sağlanmadı). Tekrar denenir. */
  | 'TEMPORARILY_UNAVAILABLE'
  /** Yanıt geldi ama çözülemedi ya da makullük bandı dışı — veri ÜRETİLMEZ. */
  | 'ERROR';

export const OEM_CAPABILITY_STATE_LABEL: Readonly<Record<OemCapabilityState, string>> = {
  UNKNOWN:                 'BİLİNMİYOR — kanıt yok',
  PROBING:                 'SORGULANIYOR',
  SUPPORTED:               'DESTEKLENİYOR — pozitif ECU yanıtı',
  UNSUPPORTED:             'DESTEKLENMİYOR — ECU açıkça reddetti',
  TEMPORARILY_UNAVAILABLE: 'GEÇİCİ OLARAK YOK — şu an okunamıyor',
  ERROR:                   'HATA — yanıt çözülemedi / makul değil',
};

/** Çözücünün son gözlemdeki durumu — "yanıt var" ile "değer var" AYNI ŞEY DEĞİLDİR. */
export type OemDecoderStatus =
  /** Çözücü tanımlı değil — pozitif yanıt yalnız YETENEK kanıtıdır, değer üretilmez. */
  | 'NO_DECODER'
  /** Çözüldü ve makullük bandı içinde. */
  | 'OK'
  /** Çözüldü ama fiziksel bant dışı — çözücü ya da kimlik YANLIŞ (değer atılır). */
  | 'IMPLAUSIBLE'
  /** Yanıt bozuk/eksik bayt — çözülemedi. */
  | 'PARSE_ERROR'
  /** Bu gözlemde çözüm denenmedi (pozitif yanıt yoktu). */
  | 'NOT_ATTEMPTED';

/* ══════════════════════════════════════════════════════════════════════════
 * 2) KAPSAM — kanıtın hangi araç/hat/ECU için geçerli olduğu
 * ════════════════════════════════════════════════════════════════════════ */

export interface OemCapabilityScope {
  /** `discoveryFingerprint` / `discoveredDataRepository` ile AYNI anahtar uzayı (VIN hash). */
  readonly vehicleFingerprint: string;
  readonly protocolClass: ProtocolClass;
  /** Yanıt filtre adresi (rx) — `discoveredDataRepository.ecuAddress` ile aynı alan. */
  readonly ecuAddress: string;
}

export function isSameOemScope(a: OemCapabilityScope, b: OemCapabilityScope): boolean {
  return a.vehicleFingerprint === b.vehicleFingerprint
    && a.protocolClass === b.protocolClass
    && a.ecuAddress === b.ecuAddress;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3) KANIT KAYDI
 * ════════════════════════════════════════════════════════════════════════ */

export interface OemCapabilityEvidence {
  readonly signalId: OemSignalId;
  readonly scope: OemCapabilityScope;
  readonly state: OemCapabilityState;
  /** Son ham sonucun `capabilityOutcome` sınıfı — durumu neyin ürettiğini saklar. */
  readonly lastOutcome: CapabilityOutcome | null;
  /** Son NEGATİF yanıt kodu (7F xx yy → yy); yoksa `null`. */
  readonly lastNrc: number | null;
  /** Son POZİTİF yanıt anı (ms); hiç olmadıysa `null`. */
  readonly lastPositiveAt: number | null;
  /** Bu kapsamda ardışık kanıt-olmayan (timeout/hat) sonuç sayısı. */
  readonly timeoutCount: number;
  /** Bu kaydın son güncellendiği an (ms) — tazelik bundan hesaplanır. */
  readonly observedAt: number;
  readonly decoderStatus: OemDecoderStatus;
  /** Toplam gözlem sayısı (bounded değil — sayaç doyurulur). */
  readonly probeCount: number;
}

/** Sayaç doyurma — uzun sürüşte sınırsız büyüme/taşma yok. */
const COUNTER_CAP = 1_000_000;
const sat = (n: number): number => (n >= COUNTER_CAP ? COUNTER_CAP : n + 1);

/* ══════════════════════════════════════════════════════════════════════════
 * 4) TAZELİK
 * ════════════════════════════════════════════════════════════════════════ */

/** Kanıtlanmış DESTEK bu süre sonunda otorite olmaktan çıkar → yeniden yoklanır. */
export const OEM_SUPPORTED_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün
/** GEÇİCİ durum bu süre geçmeden yeniden yoklanmaz (hat israfı olmasın). */
export const OEM_TRANSIENT_RETRY_MS = 5 * 60 * 1000;         // 5 dakika

export function oemEvidenceAgeMs(ev: OemCapabilityEvidence, nowMs: number): number {
  return Math.max(0, nowMs - ev.observedAt);
}

/** DESTEKLENİYOR kanıtı bayatladı mı? (Yalnız SUPPORTED için anlamlı.) */
export function isOemEvidenceStale(ev: OemCapabilityEvidence, nowMs: number, ttlMs = OEM_SUPPORTED_TTL_MS): boolean {
  return oemEvidenceAgeMs(ev, nowMs) > ttlMs;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5) SINIFLANDIRMA + BİRLEŞTİRME
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ham sonuç → OEM yetenek durumu. `null` = bu sonuç ARAÇ HAKKINDA KANIT DEĞİL
 * (timeout/hat hatası) → çağıran önceki durumu KORUR.
 *
 * `security_required` UNSUPPORTED'a düşer: kimlik var olabilir ama SecurityAccess bu
 * ürünün kapsamı DIŞINDADIR (27 servisi yasak) → salt-okuma yolundan KALICI okunamaz.
 * Gerçek sebep `lastOutcome`ta saklanır, kaybolmaz.
 */
export function classifyOemCapability(outcome: CapabilityOutcome): OemCapabilityState | null {
  if (!isCapabilityEvidence(outcome)) return null;
  switch (outcome) {
    case 'working':            return 'SUPPORTED';
    case 'unsupported':        return 'UNSUPPORTED';
    case 'security_required':  return 'UNSUPPORTED';
    case 'no_data':            return 'TEMPORARILY_UNAVAILABLE';
    case 'condition_required': return 'TEMPORARILY_UNAVAILABLE';
    case 'parse_error':        return 'ERROR';
    default:                   return null;
  }
}

/** Tek gözlem — koordinatörün kanıt katmanına verdiği her şey. */
export interface OemCapabilityObservation {
  readonly signalId: OemSignalId;
  readonly scope: OemCapabilityScope;
  readonly outcome: CapabilityOutcome;
  readonly nrc: number | null;
  readonly decoderStatus: OemDecoderStatus;
  readonly nowMs: number;
}

/** Hiç kanıt yokken kullanılacak boş kayıt. */
export function emptyOemEvidence(signalId: OemSignalId, scope: OemCapabilityScope, nowMs: number): OemCapabilityEvidence {
  return {
    signalId, scope,
    state: 'UNKNOWN',
    lastOutcome: null,
    lastNrc: null,
    lastPositiveAt: null,
    timeoutCount: 0,
    observedAt: nowMs,
    decoderStatus: 'NOT_ATTEMPTED',
    probeCount: 0,
  };
}

/**
 * Önceki kanıt + yeni gözlem → birleşmiş kanıt.
 *
 *  · Kapsam UYUŞMUYORSA önceki kanıt ATILIR (araç/hat/ECU değişti — eski kanıt otorite değil).
 *  · timeout: durum KORUNUR (asla UNSUPPORTED olmaz), yalnız `timeoutCount` artar.
 *  · Pozitif yanıt + makullük dışı/bozuk çözüm: yetenek kanıtı kaybolmaz ama durum ERROR'a
 *    DÜŞER — sessizce "çalışıyor" gösterilmez.
 */
export function mergeOemCapability(
  previous: OemCapabilityEvidence | null,
  obs: OemCapabilityObservation,
): OemCapabilityEvidence {
  const prev = previous !== null && isSameOemScope(previous.scope, obs.scope) ? previous : null;
  const base = prev ?? emptyOemEvidence(obs.signalId, obs.scope, obs.nowMs);

  // (1) Kanıt DEĞİL (timeout / hat hatası) — zero-trust: durum değişmez.
  if (!isCapabilityEvidence(obs.outcome)) {
    return {
      ...base,
      state: base.state === 'PROBING' ? 'UNKNOWN' : base.state,
      lastOutcome: obs.outcome,
      timeoutCount: sat(base.timeoutCount),
      observedAt: obs.nowMs,
      decoderStatus: 'NOT_ATTEMPTED',
      probeCount: sat(base.probeCount),
    };
  }

  const classified = classifyOemCapability(obs.outcome) ?? base.state;
  const positive = obs.outcome === 'working';

  // (2) Pozitif yanıt ama çözüm başarısız/makul değil → ERROR'a düşür (fail-closed).
  const degraded = positive && (obs.decoderStatus === 'IMPLAUSIBLE' || obs.decoderStatus === 'PARSE_ERROR');
  const state: OemCapabilityState = degraded ? 'ERROR' : classified;

  return {
    signalId: obs.signalId,
    scope: obs.scope,
    state,
    lastOutcome: obs.outcome,
    lastNrc: obs.nrc ?? (obs.outcome === 'working' ? null : base.lastNrc),
    lastPositiveAt: positive ? obs.nowMs : base.lastPositiveAt,
    timeoutCount: 0, // gerçek kanıt geldi → ardışık hat hatası zinciri kırıldı
    observedAt: obs.nowMs,
    decoderStatus: obs.decoderStatus,
    probeCount: sat(base.probeCount),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6) ÇÖZÜM — değer üretimi TEK yerde, fail-closed
 * ════════════════════════════════════════════════════════════════════════ */

export interface OemDecodeResult {
  readonly value: VehicleDidValue | null;
  readonly status: OemDecoderStatus;
}

/**
 * Ham hex → değer. `decodeCompiledDid` MEVCUT çözücüdür ve makullük bandını (min/max)
 * ZATEN uygular (bant dışı → NaN). Burada yalnız o sözleşme OEM durumlarına çevrilir:
 * değer ASLA "0"a ya da sahte bir sayıya düşürülmez — yoksa `null`dır.
 */
export function decodeOemResponse(
  compiled: CompiledDidDef | null,
  dataHex: string | null,
): OemDecodeResult {
  if (compiled === null) return { value: null, status: 'NO_DECODER' };
  if (dataHex === null || dataHex.trim().length === 0) return { value: null, status: 'PARSE_ERROR' };

  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  // Beklenen bayt sayısından KISA yanıt güvenle çözülemez (discoveryValidator §3 ile aynı kural).
  if (!compiled.isText && clean.length < compiled.bytes * 2) return { value: null, status: 'PARSE_ERROR' };

  const value = decodeCompiledDid(compiled, dataHex);
  if (typeof value === 'number' && Number.isNaN(value)) {
    // decodeCompiledDid bant dışını da NaN yapar; bayt sayısı yeterliyken NaN = makul değil.
    return { value: null, status: 'IMPLAUSIBLE' };
  }
  if (typeof value === 'string' && value.length === 0) return { value: null, status: 'PARSE_ERROR' };
  return { value, status: 'OK' };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7) POLL KARARI — çekirdek telemetri ÖNCELİKLİ
 * ════════════════════════════════════════════════════════════════════════ */

export type OemPollDenyReason =
  | 'ok'
  | 'not_probeable'        // kimlik/servis/adresleme kanıtı yok → araca hiç gitmez
  | 'no_decoder'           // yetenek kanıtlı ama değer üretilemez
  | 'not_supported'        // SUPPORTED değil (UNKNOWN/UNSUPPORTED/GEÇİCİ/ERROR)
  | 'scope_mismatch'       // kanıt başka araç/hat/ECU'ya ait
  | 'stale_evidence'       // kanıt bayat → önce yeniden yoklanmalı
  | 'standard_owner'       // aynı büyüklüğün standart OBD sahibi var (çift otorite yasağı)
  | 'session_unhealthy'    // ECU oturumu sağlıklı değil
  | 'budget_exhausted';    // çekirdek poll bütçesi / eşzamanlılık tavanı

export const OEM_POLL_DENY_LABEL: Readonly<Record<OemPollDenyReason, string>> = {
  ok:                'Uygun',
  not_probeable:     'Kimlik/servis/adresleme kanıtı yok',
  no_decoder:        'Çözücü yok — değer üretilemez',
  not_supported:     'Yetenek DESTEKLENİYOR değil',
  scope_mismatch:    'Kanıt başka araç/protokol/ECU kapsamında',
  stale_evidence:    'Kanıt bayat — yeniden yoklanmalı',
  standard_owner:    'Standart OBD sinyali kanonik sahip',
  session_unhealthy: 'ECU oturumu sağlıklı değil',
  budget_exhausted:  'Poll bütçesi / eşzamanlılık tavanı dolu',
};

export interface OemPollDecisionInput {
  readonly def: OemSignalDef;
  readonly evidence: OemCapabilityEvidence | null;
  readonly scope: OemCapabilityScope;
  readonly nowMs: number;
  /** Aynı büyüklüğü taşıyan standart OBD sinyali BU ARAÇTA okunabiliyor mu (ölçülmüş). */
  readonly standardEquivalentAvailable: boolean;
  /** ECU/bağlantı oturumu sağlıklı mı (obdService anlık görüntüsünden gelir). */
  readonly sessionHealthy: boolean;
  /** Çekirdek (RPM/hız/SAFETY) poll bütçesinin BOZULMADIĞI çağıran tarafından onaylanır. */
  readonly corePollingBudgetOk: boolean;
  readonly activeOemPollCount: number;
  readonly maxConcurrentOemPolls: number;
  readonly ttlMs?: number;
  /**
   * `discoveryValidator.evaluateAutoAddGate` 10-koşul kapısını GEÇTİ mi (çağıran kanıtlar).
   * Geçmediyse sinyal SÜREKLİ poll hattına ALINMAZ: sınıfı `DISCOVERY_ONLY` kalır — yani
   * yalnız keşif/talep turunda okunur. OEM katmanı o kapıyı ATLAYAMAZ.
   */
  readonly autoAddGatePassed?: boolean;
}

export interface OemPollDecision {
  readonly eligible: boolean;
  readonly reason: OemPollDenyReason;
  /**
   * Önerilen poll sınıfı — MEVCUT `pollingAdmissionGate.recommendPollClass` üretir.
   * `FAST`/`NORMAL` o kapıdan ASLA çıkmaz: OEM sinyali çekirdek kadansa DOKUNAMAZ.
   * 10-koşul kapısı geçilmediyse `DISCOVERY_ONLY` (sürekli poll hattına girmez).
   */
  readonly pollClass: PollClass;
}

/**
 * Bir OEM sinyali canlı poll'e alınabilir mi. Tek karar noktası — kapılar SIRALIDIR ve
 * ilk düşen sebep döner (LAB "neden değil" diye gösterebilsin).
 */
export function decideOemPoll(input: OemPollDecisionInput): OemPollDecision {
  const { def, evidence, scope, nowMs } = input;

  // Poll sınıfı HER dalda mevcut kapıdan gelir — kendi sınıfımızı icat etmiyoruz.
  const pollClass = recommendPollClass({
    // OEM adayı 10-koşul kapısından (discoveryValidator) geçmeden VERIFIED SAYILMAZ →
    // `recommendPollClass` onu DISCOVERY_ONLY'de tutar (sürekli poll hattına giremez).
    status: input.autoAddGatePassed === true ? 'VERIFIED' : 'DECODER_KNOWN',
    protocolClass: scope.protocolClass,
  });
  const deny = (reason: OemPollDenyReason): OemPollDecision => ({ eligible: false, reason, pollClass });

  if (!isOemSignalProbeable(def)) return deny('not_probeable');
  if (!isOemSignalDecodable(def)) return deny('no_decoder');
  if (def.standardEquivalent !== null && input.standardEquivalentAvailable) return deny('standard_owner');

  if (evidence === null) return deny('not_supported');
  if (!isSameOemScope(evidence.scope, scope)) return deny('scope_mismatch');
  if (evidence.state !== 'SUPPORTED') return deny('not_supported');
  if (isOemEvidenceStale(evidence, nowMs, input.ttlMs ?? OEM_SUPPORTED_TTL_MS)) return deny('stale_evidence');
  if (evidence.decoderStatus !== 'OK') return deny('no_decoder');

  if (!input.sessionHealthy) return deny('session_unhealthy');

  // Çekirdek telemetri koruması — MEVCUT admission kapısı (yeni bütçe otoritesi YOK).
  const admitted = canAdmitNewDidPoll({
    activeDiscoveryDidCount: input.activeOemPollCount,
    maxConcurrentNewDids: input.maxConcurrentOemPolls,
    corePollingBudgetOk: input.corePollingBudgetOk,
  });
  if (!admitted) return deny('budget_exhausted');

  return { eligible: true, reason: 'ok', pollClass };
}

/**
 * Sinyal bu turda YENİDEN yoklanmalı mı (keşif planlayıcısının kapısı).
 * UNSUPPORTED kapsam içinde KALICIDIR — `capabilityOutcome.isPermanentOutcome` ile aynı
 * ilke; tekrar sormak hattı boşuna yorar.
 */
export function shouldReprobeOemSignal(
  evidence: OemCapabilityEvidence | null,
  scope: OemCapabilityScope,
  nowMs: number,
  opts: { readonly supportedTtlMs?: number; readonly transientRetryMs?: number } = {},
): boolean {
  if (evidence === null) return true;
  if (!isSameOemScope(evidence.scope, scope)) return true;  // kapsam değişti → eski kanıt geçersiz
  const age = oemEvidenceAgeMs(evidence, nowMs);
  switch (evidence.state) {
    case 'UNSUPPORTED':             return false;
    case 'SUPPORTED':               return age > (opts.supportedTtlMs ?? OEM_SUPPORTED_TTL_MS);
    case 'TEMPORARILY_UNAVAILABLE':
    case 'ERROR':                   return age > (opts.transientRetryMs ?? OEM_TRANSIENT_RETRY_MS);
    case 'PROBING':                 return false;
    case 'UNKNOWN':                 return true;
  }
}
