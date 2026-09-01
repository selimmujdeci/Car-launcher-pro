/**
 * selfHealingTrigger — P0-VDK-F5B · ÜRETİM TETİKLEYİCİSİ + BÜTÇE SAHİPLİĞİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NE YAPAR ──────────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F5-A'da yazılan `runGapResolution` yalnız testten çağrılıyordu. Bu katman
 * onu gerçek ürün akışına bağlar — ama **kontrolsüz değil**: yalnız mevcut
 * bütçe · işlem · oturum · admisyon otoriteleri izin verdiğinde.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ BÜTÇE OTORİTESİ DEĞİLDİR.** Kendi istek/süre bütçesini
 *     YARATMAZ; sahibi olan `DiagnosticTransaction`ın KALAN bütçesinden
 *     açık bir PAY alır ve normal taramaya bir REZERV bırakır.
 * (2) **İKİNCİ ZAMANLAYICI DEĞİLDİR.** `setInterval`/`setTimeout` YOKTUR.
 *     Tetik, mevcut tam-araç taramasının bitiş noktasıdır (olay-güdümlü).
 * (3) **İKİNCİ ADMİSYON KAPISI DEĞİLDİR.** Mevcut `diagnosticAdmission`
 *     kararını OKUR; yeni bir "güvenli mi" mantığı KURMAZ.
 * (4) **İKİNCİ OTURUM/PDU MOTORU DEĞİLDİR.** Ölçüm F5-A resolver'ın normal
 *     VDK zincirinden geçer; burada native/`CarLauncher` ÇAĞRILMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÖNCELİK (pazarlıksız) ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Self-Healing kullanıcıya görünür tanı işinden **DAHA DÜŞÜK** önceliklidir.
 * Bu yapısal olarak garanti edilir: tetik, tam araç taraması BİTTİKTEN sonra
 * ve yalnız kalan bütçe rezervin ÜSTÜNDEYSE çalışır. Kritik kurtarma ya da
 * yeni bir tarama gerekiyorsa karar `DEFERRED`dir.
 */

import { logError } from '../../crashLogger';
import type { DiagnosticTransaction } from '../diagnosticTransaction';
import { hasRequestBudget, isTransactionLive } from '../diagnosticTransaction';
import type { DiagnosticAdmission } from '../diagnosticAdmission';
import type { EcuVariant, ServiceDef, ProtocolClassName } from '../cddl/schema';
import type { CapabilityProvenance, TransportConstraint } from '../capability/capabilityGraph';
import { collectResolvableGaps, runGapResolution } from './gapResolverRuntime';
import type { GapResolutionResult } from './gapResolverRuntime';

/* ══════════════════════════════════════════════════════════════════════════
   1) BÜTÇE PAYI — sayılar AÇIK ve tek yerde
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Self-Healing, sahibi işlemin **KALAN** bütçesinin en çok bu oranını alır.
 *
 * `0.25` bilinçlidir: iyileştirme bir lüks, teşhis bir zorunluluktur. Kalanın
 * dörtte biri, tek bir turda birkaç hedefli yoklamaya yeter ve normal işin
 * dörtte üçünü DOKUNULMAMIŞ bırakır.
 */
export const HEALING_BUDGET_SHARE = 0.25;

/**
 * Tek turda harcanabilecek MUTLAK istek tavanı (oran ne derse desin).
 *
 * `10` keyfî değildir: BİR boşluğun ölçümü atomiktir ve en pahalı hâlinde
 * `HEALING_MAX_PROBES_PER_GAP` kadar yoklama gönderir. Tavan bunun altında
 * olsaydı pay tek bir ölçümü bile karşılayamaz, ya iş yapılamaz ya da pay
 * AŞILIRDI — ikincisi normal taramanın bütçesini yemek demektir.
 */
export const HEALING_MAX_REQUESTS = 10;

/**
 * Normal tanıya bırakılan REZERV — kalan istek bunun altındaysa iyileştirme
 * hiç başlamaz (`DEFERRED`). Kullanıcının göreceği işin bütçesini yemez.
 */
export const HEALING_MIN_RESERVE_REQUESTS = 24;

/** Aynı rezerv süre ekseninde. */
export const HEALING_MIN_RESERVE_TIME_MS = 30_000;

/**
 * ANTİ-STORM: aynı OBD oturumunda (epoch) en çok bu kadar tur.
 *
 * Yeni bir timer KURULMADAN döngü kesilir: tetik zaten olay-güdümlüdür
 * (tarama bitişi) ve aynı epoch'ta ikinci tarama yapılsa bile iyileştirme
 * tekrar çalışmaz. Epoch değişimi (yeniden bağlanma) sayacı sıfırlar —
 * çünkü o gerçekten YENİ bir ölçüm bağlamıdır.
 */
export const MAX_HEALING_RUNS_PER_EPOCH = 1;

/**
 * BİR boşluğun ölçümünün gönderebileceği azami yoklama sayısı.
 *
 * ⚠️ ÖLÇÜLEN KUSUR (F5B geliştirme turunda yakalandı): tur başına boşluk
 * sayısını ayrılan istek payına eşitlemek YETMİYOR. Tek bir boşluk, hedefine
 * uyan CDDL tanımı sayısı kadar (ve alt fonksiyon yoklamasında daha fazla)
 * istek gönderebilir; 6 istek ayrılmışken 50 istek harcandığı ölçüldü — yani
 * iyileştirme normal taramanın bütçesini yiyordu.
 *
 * Bu sabit payı GERÇEK bir tavana çevirir: tur başına boşluk sayısı
 * `pay ÷ bu sayı` ile sınırlanır ve ayrıca her boşluktan ÖNCE harcanan pay
 * yeniden ölçülür (sert kesme).
 */
export const HEALING_MAX_PROBES_PER_GAP = 10;

/* ══════════════════════════════════════════════════════════════════════════
   2) KARAR — SAF
   ══════════════════════════════════════════════════════════════════════════ */

export type HealingAdmission =
  /** Koşullar sağlandı — ölçüm yapılabilir. */
  | 'RUN'
  /** Şimdi değil: bütçe/öncelik/anti-storm. Koşullar değişirse tekrar denenir. */
  | 'DEFERRED'
  /** Yapısal engel: bağlantı/işlem/oturum/hedef yok. */
  | 'BLOCKED';

export const HEALING_ADMISSION_LABEL: Readonly<Record<HealingAdmission, string>> = {
  RUN:      'ÇALIŞTI — ölçüm yapıldı',
  DEFERRED: 'ERTELENDİ — normal tanı önce gelir',
  BLOCKED:  'ENGELLENDİ — yapısal ön koşul yok',
} as const;

/** Tetiğin hangi ürün olayından geldiği. */
export type HealingTriggerReason =
  | 'AFTER_FULL_VEHICLE_SCAN'
  | 'MANUAL_DEVELOPER'
  | 'UNKNOWN';

export const HEALING_TRIGGER_LABEL: Readonly<Record<HealingTriggerReason, string>> = {
  AFTER_FULL_VEHICLE_SCAN: 'tam araç taraması tamamlandı',
  MANUAL_DEVELOPER:        'geliştirici elle çağırdı',
  UNKNOWN:                 'bilinmeyen tetik',
} as const;

export interface HealingTriggerInput {
  readonly trigger: HealingTriggerReason;
  /** Mevcut `diagnosticAdmission` kararı — burada YENİDEN hesaplanmaz. */
  readonly admission: DiagnosticAdmission;
  readonly transactionLive: boolean;
  readonly cancelled: boolean;
  readonly staleEpoch: boolean;
  /** Sahibi işlemin KALAN istek hakkı. */
  readonly remainingRequests: number;
  /** Sahibi işlemin KALAN süresi (ms). */
  readonly remainingTimeMs: number;
  /** F1-B kirası okumaya izin veriyor mu; `null` = kira sorusu yok. */
  readonly leaseAllows: boolean | null;
  /** Hedef ECU adresi ÖLÇÜLMÜŞ mü (uydurma adres YASAK). */
  readonly ecuAddressProven: boolean;
  /** Hedefe uyan GÜVENLİ CDDL tanımı var mı. */
  readonly safeDefsAvailable: boolean;
  /** Daha yüksek öncelikli tanı işi bekliyor mu (tarama/kurtarma). */
  readonly higherPriorityWorkPending: boolean;
  /** Bu OBD oturumunda kaç iyileştirme turu KOŞTU. */
  readonly runsThisEpoch: number;
  /** Çözülebilir boşluk sayısı (ölçüldü; `0` gerçek bir ölçümdür). */
  readonly resolvableGaps: number;
}

export interface HealingTriggerDecision {
  readonly admission: HealingAdmission;
  readonly reason: string;
  /** Bu tura ayrılan istek payı; çalışmayacaksa `0`. */
  readonly allocatedRequests: number;
  /** Bu tura ayrılan süre payı (ms); çalışmayacaksa `0`. */
  readonly allocatedTimeMs: number;
}

const NO_BUDGET = { allocatedRequests: 0, allocatedTimeMs: 0 } as const;

/**
 * Self-Healing şimdi çalışabilir mi — SAF karar.
 *
 * FAIL-CLOSED: emin olunmayan her durum `BLOCKED`/`DEFERRED`dir. Hiçbir dal
 * "muhtemelen güvenlidir" varsaymaz.
 */
export function evaluateHealingTrigger(
  i: HealingTriggerInput,
): HealingTriggerDecision {
  /* ── YAPISAL ENGELLER (BLOCKED) ─────────────────────────────────────── */
  if (i.admission !== 'READY') {
    return { admission: 'BLOCKED', ...NO_BUDGET,
      reason: `tanı admisyonu READY değil: ${i.admission}` };
  }
  if (i.cancelled) {
    return { admission: 'BLOCKED', ...NO_BUDGET, reason: 'işlem iptal edildi' };
  }
  if (i.staleEpoch) {
    return { admission: 'BLOCKED', ...NO_BUDGET,
      reason: 'OBD oturumu değişti (bayat epoch) — ölçüm başka araca yazılamaz' };
  }
  if (!i.transactionLive) {
    return { admission: 'BLOCKED', ...NO_BUDGET, reason: 'işlem canlı değil' };
  }
  if (i.leaseAllows === false) {
    return { admission: 'BLOCKED', ...NO_BUDGET, reason: 'oturum kirası okumaya izin vermiyor' };
  }
  if (!i.ecuAddressProven) {
    return { admission: 'BLOCKED', ...NO_BUDGET,
      reason: 'hedef ECU adresi KANITLI değil — adres uydurulmaz' };
  }
  if (!i.safeDefsAvailable) {
    return { admission: 'BLOCKED', ...NO_BUDGET,
      reason: 'hedefe uyan güvenli CDDL tanımı yok — kör tarama yapılmaz' };
  }

  /* ── ÖNCELİK ve ANTİ-STORM (DEFERRED) ───────────────────────────────── */
  if (i.higherPriorityWorkPending) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: 'daha yüksek öncelikli tanı işi bekliyor — iyileştirme sonra' };
  }
  if (i.runsThisEpoch >= MAX_HEALING_RUNS_PER_EPOCH) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: `bu OBD oturumunda tur tavanı doldu (${MAX_HEALING_RUNS_PER_EPOCH})` };
  }

  /* ── BÜTÇE PAYI ─────────────────────────────────────────────────────── */
  if (i.remainingRequests < HEALING_MIN_RESERVE_REQUESTS) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: `kalan istek (${i.remainingRequests}) normal tanı rezervinin `
        + `(${HEALING_MIN_RESERVE_REQUESTS}) altında` };
  }
  if (i.remainingTimeMs < HEALING_MIN_RESERVE_TIME_MS) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: `kalan süre (${i.remainingTimeMs} ms) rezervin `
        + `(${HEALING_MIN_RESERVE_TIME_MS} ms) altında` };
  }

  const share = Math.min(
    HEALING_MAX_REQUESTS,
    Math.floor(i.remainingRequests * HEALING_BUDGET_SHARE),
  );
  /* ⚠️ BİR BOŞLUK ATOMİKTİR: ölçümü başlatıp yarıda kesmek hem isteği çöpe
     atar hem de yarım kanıt üretir. Pay tek bir boşluğun EN PAHALI hâlini
     karşılamıyorsa hiç başlanmaz — böylece `harcanan ≤ ayrılan` invaryantı
     yapısal olarak korunur ve pay ASLA aşılmaz. */
  if (share < HEALING_MAX_PROBES_PER_GAP) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: `pay (${share}) tek bir boşluğun ölçümünü `
        + `(${HEALING_MAX_PROBES_PER_GAP} yoklama) karşılamıyor` };
  }

  /* ── ÖLÇÜLECEK BİR ŞEY VAR MI ───────────────────────────────────────── */
  if (i.resolvableGaps === 0) {
    return { admission: 'DEFERRED', ...NO_BUDGET,
      reason: 'çözülebilir boşluk YOK — bu bir ÖLÇÜMDÜR, hata değil' };
  }

  return {
    admission: 'RUN',
    allocatedRequests: share,
    allocatedTimeMs: Math.floor(i.remainingTimeMs * HEALING_BUDGET_SHARE),
    reason: `${HEALING_TRIGGER_LABEL[i.trigger]} · kalan ${i.remainingRequests} istekten `
      + `${share} pay ayrıldı (rezerv ${HEALING_MIN_RESERVE_REQUESTS} korunuyor) · `
      + `${i.resolvableGaps} çözülebilir boşluk`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   2b) HEDEF SEÇİMİ — KANITLI ECU, UYDURMA ADRES YOK
   ══════════════════════════════════════════════════════════════════════════ */

/** Keşiften gelen ölçülmüş ECU kaydının bu katmanın ihtiyaç duyduğu izdüşümü. */
export interface ProvenEcuInput {
  readonly txHeader: string;
  readonly rxHeader: string;
  readonly addressBits: number;
  /** `unknown` ise hedef SEÇİLMEZ — rol UYDURULMAZ (EcuVariant `unknown` kabul etmez). */
  readonly role: string;
  readonly label: string;
  /** Bu kayıt hangi GERÇEK gözlemden geldi. */
  readonly discoverySource?: string;
  readonly probeOutcome?: string;
  readonly kwpTargetVerified?: boolean;
}

/** EcuVariant'ın kabul ettiği roller — `unknown` BİLEREK dışarıda. */
const MEASURABLE_ROLES: ReadonlySet<string> = new Set([
  'engine', 'transmission', 'abs_esp', 'airbag_srs', 'body_bcm',
  'eps', 'hvac', 'tpms', 'gateway', 'instrument',
]);

/**
 * Ölçülmüş bir ECU kaydından iyileştirme hedefi kurar — **FAIL-CLOSED**.
 *
 * `null` döndürmek bir başarısızlık DEĞİL, dürüstlüktür: kanıtı olmayan bir
 * adrese istek göndermek, K-line'da başka bir modülü uyandırmak demektir.
 *
 * Reddedilen durumlar (hepsi bilinçli):
 *  · ECU hattan CEVAP VERMEDİ (`probeOutcome !== 'responded'`),
 *  · istek adresi (`txHeader`) ölçülmedi,
 *  · rol `unknown` — adresten rol UYDURULMAZ (ürünün defalarca ödediği kusur).
 */
export function healingTargetFromProvenEcu(
  ecu: ProvenEcuInput | null,
  serviceRefs: readonly string[],
): EcuVariant | null {
  if (ecu === null) return null;
  if (ecu.probeOutcome !== undefined && ecu.probeOutcome !== 'responded') return null;
  if (typeof ecu.txHeader !== 'string' || ecu.txHeader.trim().length === 0) return null;
  if (!MEASURABLE_ROLES.has(ecu.role)) return null;
  if (serviceRefs.length === 0) return null;

  return {
    id: `healing.${ecu.rxHeader}`,
    name: ecu.label,
    role: ecu.role,
    addressing: 'physical',
    txHeader: ecu.txHeader,
    rxHeader: ecu.rxHeader,
    /* KWP hedef baytı YALNIZ doğrulanmışsa taşınır; aksi hâlde `UNKNOWN`
       (sahte hedef baytı yanlış modülü uyandırır). */
    kwpTarget: ecu.addressBits === 8
      ? (ecu.kwpTargetVerified === true ? ecu.txHeader : 'UNKNOWN')
      : null,
    session: 'default',
    serviceRefs: [...serviceRefs],
    provenance: {
      source: 'measured',
      reference: `discovery:${ecu.discoverySource ?? 'unknown'}`,
      license: 'ölçüm — telif yok',
      verifiedOn: null,
    },
  } as unknown as EcuVariant;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KANIT DEFTERİ — LAB salt-okuma yüzeyi
   ══════════════════════════════════════════════════════════════════════════ */

export interface HealingTriggerEvidence {
  readonly trigger: HealingTriggerReason;
  readonly decision: HealingAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
  readonly allocatedTimeMs: number;
  /** Gerçekten harcanan istek; ölçülmediyse `null`. */
  readonly usedRequests: number | null;
  readonly resolvedGaps: number | null;
  readonly openGaps: number | null;
  readonly savedRequests: number | null;
  /** Tur damgası — ENJEKTE edilir. */
  readonly atMs: number | null;
  readonly sessionEpoch: number;
}

/** Defter tavanı — sınırsız kanıt bir defter değil, sızıntıdır. */
export const MAX_TRIGGER_EVIDENCE = 20;

let _evidence: HealingTriggerEvidence[] = [];
/** Epoch → o oturumda koşan tur sayısı (anti-storm; timer YOK). */
const _runsByEpoch = new Map<number, number>();

export function getHealingTriggerEvidence(): readonly HealingTriggerEvidence[] {
  try { return [..._evidence]; } catch { return []; }
}

export function getLastHealingTrigger(): HealingTriggerEvidence | null {
  return _evidence.length === 0 ? null : _evidence[_evidence.length - 1];
}

export function getHealingRunsForEpoch(epoch: number): number {
  return _runsByEpoch.get(epoch) ?? 0;
}

/** Çözücü üretim yolundan HİÇ tetiklendi mi — `0` ile KARIŞTIRILMAZ. */
export function healingTriggerEverEvaluated(): boolean {
  return _evidence.length > 0;
}

/** @internal — testler arası izolasyon. */
export function _resetHealingTriggerForTest(): void {
  _evidence = [];
  _runsByEpoch.clear();
}

function _record(e: HealingTriggerEvidence): void {
  try {
    _evidence.push(e);
    if (_evidence.length > MAX_TRIGGER_EVIDENCE) _evidence.shift();
  } catch { /* kanıt kaydı ASLA turu düşürmez */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) KABUK — ürün akışından çağrılır
   ══════════════════════════════════════════════════════════════════════════ */

export interface HealingRunContext {
  readonly trigger: HealingTriggerReason;
  readonly admission: DiagnosticAdmission;
  /** Ölçüm hedefi — çağıran ÖLÇMÜŞ olmalı; resolver adres uydurmaz. */
  readonly ecu: EcuVariant | null;
  readonly defs: readonly ServiceDef[];
  readonly protocolClass: ProtocolClassName | 'unknown' | null;
  readonly protocol: string | null;
  readonly leaseAllows: boolean | null;
  readonly ecuAddressProven: boolean;
  readonly higherPriorityWorkPending: boolean;
  readonly provenance: CapabilityProvenance;
  readonly transport: TransportConstraint;
  readonly targetVerified: boolean;
  readonly vehicleId: string | null;
  readonly ecuId: string | null;
  readonly fingerprintReusable: boolean;
  /** Damga ENJEKTE edilir. */
  readonly nowMs: number | null;
}

export interface HealingRunOutcome {
  readonly decision: HealingTriggerDecision;
  /** Ölçüm yapıldıysa sonucu; yapılmadıysa `null`. */
  readonly result: GapResolutionResult | null;
}

/**
 * Üretim tetiği — tam araç taraması bittikten SONRA çağrılır.
 *
 * ASLA throw etmez: iyileştirmenin düşmesi taramayı DÜŞÜRMEZ. Karar ne olursa
 * olsun kanıt defterine yazılır — sessiz "hiç denenmedi" durumu YOKTUR.
 */
export async function maybeRunSelfHealing(
  txn: DiagnosticTransaction | null,
  ctx: HealingRunContext,
): Promise<HealingRunOutcome> {
  let gaps = 0;
  try { gaps = collectResolvableGaps(ctx.nowMs).length; }
  catch (e) { logError('OBD:HealingCollect', e); }

  const epoch = txn?.sessionEpoch ?? -1;
  const live = txn !== null && isTransactionLive(txn);
  const remainingRequests = txn === null
    ? 0 : Math.max(0, txn.requestBudget - txn.requestsUsed);
  const remainingTimeMs = txn === null || ctx.nowMs === null
    ? 0 : Math.max(0, txn.timeBudgetMs - (ctx.nowMs - txn.startedAt));

  const decision = evaluateHealingTrigger({
    trigger: ctx.trigger,
    admission: ctx.admission,
    transactionLive: live,
    cancelled: txn?.cancelled === true,
    /* Bayat epoch: işlem canlılığı zaten bunu kapsar; ayrıca `-1` (ölçülemedi)
       bir kanıt DEĞİLDİR ve ölçüm o hâlde yapılmaz. */
    staleEpoch: txn !== null && txn.sessionEpoch === -1,
    remainingRequests,
    remainingTimeMs,
    leaseAllows: ctx.leaseAllows,
    ecuAddressProven: ctx.ecuAddressProven && ctx.ecu !== null,
    safeDefsAvailable: ctx.defs.length > 0,
    higherPriorityWorkPending: ctx.higherPriorityWorkPending,
    runsThisEpoch: getHealingRunsForEpoch(epoch),
    resolvableGaps: gaps,
  });

  if (decision.admission !== 'RUN' || txn === null || ctx.ecu === null) {
    _record({
      trigger: ctx.trigger, decision: decision.admission, reason: decision.reason,
      allocatedRequests: decision.allocatedRequests,
      allocatedTimeMs: decision.allocatedTimeMs,
      usedRequests: null, resolvedGaps: null, openGaps: gaps,
      savedRequests: null, atMs: ctx.nowMs, sessionEpoch: epoch,
    });
    return { decision, result: null };
  }

  /* Tur sayacı ölçümden ÖNCE artar: ölçüm düşse bile aynı epoch'ta ikinci tur
     başlamaz (anti-storm, fail-closed). */
  _runsByEpoch.set(epoch, getHealingRunsForEpoch(epoch) + 1);

  /* Pay muhasebesinin başlangıç noktası — sahibi işlemin KENDİ sayacı. */
  const requestsAtStart = txn.requestsUsed;

  let result: GapResolutionResult | null = null;
  try {
    result = await runGapResolution({
      ecu: ctx.ecu,
      defs: ctx.defs,
      /* AYNI işlem: iyileştirme kendi bütçesini YARATMAZ, payını buradan harcar. */
      txn,
      protocolClass: ctx.protocolClass,
      protocol: ctx.protocol,
      provenance: ctx.provenance,
      transport: ctx.transport,
      targetVerified: ctx.targetVerified,
      vehicleId: ctx.vehicleId,
      ecuId: ctx.ecuId,
      fingerprintReusable: ctx.fingerprintReusable,
      nowMs: ctx.nowMs,
      /* Bir boşluk BİRDEN ÇOK yoklama gönderebilir → tur başına boşluk sayısı
         paya DEĞİL, `pay ÷ boşluk başına azami yoklama`ya göre sınırlanır. */
      maxGaps: Math.max(1,
        Math.floor(decision.allocatedRequests / HEALING_MAX_PROBES_PER_GAP)),
      /* SERT KESME: işlem canlılığı VEYA ayrılan payın tükenmesi turu durdurur.
         Pay muhasebesi sahibi işlemin sayacından okunur — ikinci sayaç YOK. */
      isCancelled: () =>
        !isTransactionLive(txn)
        || !hasRequestBudget(txn)
        || (txn.requestsUsed - requestsAtStart) >= decision.allocatedRequests,
    });
  } catch (e) {
    logError('OBD:HealingRun', e);
  }

  _record({
    trigger: ctx.trigger, decision: 'RUN', reason: decision.reason,
    allocatedRequests: decision.allocatedRequests,
    allocatedTimeMs: decision.allocatedTimeMs,
    usedRequests: result?.requestsSpent ?? null,
    resolvedGaps: result?.resolved ?? null,
    openGaps: result === null ? gaps : Math.max(0, gaps - result.resolved),
    savedRequests: result?.requestsSaved ?? null,
    atMs: ctx.nowMs, sessionEpoch: epoch,
  });

  return { decision, result };
}
