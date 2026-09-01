/**
 * earlyVehicleIdentity — P0-VDK-F5H · ERKEN ARAÇ KİMLİĞİ (ÜRÜN YOLU KABUĞU).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN AÇIK ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Güçlü araç parmak izi YALNIZ tam araç taramasının ölçtüğü yanıt imzasından
 * doğuyordu. Kullanıcı tarama çalıştırmadıkça:
 *   · boşluk sicili doğru bölüme bağlanamıyor,
 *   · yetenek deposu hydrate olmuyor,
 *   · önceki öğrenme kullanılamıyor,
 *   · oturum `UNIDENTIFIED` kalıyordu.
 *
 * Bu kabuk, bağlantıdan sonraki EN ERKEN güvenli noktada, MEVCUT omurgayı
 * kullanarak kanıtlı bir kalibrasyon/kimlik ölçümü yapar ve MEVCUT F4-C
 * parmak izini üretip MEVCUT F5-G bağlama noktasını çağırır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KULLANILAN OMURGA (hiçbiri burada YENİDEN YAZILMADI) ──────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   ECU keşfi         → ÇAĞIRAN sağlar (`earlyIdentityRuntime` →
 *                       `multiEcuScan.discoverEcus`)             (mevcut)
 *   hedef kurulumu    → `selfHealingTrigger.healingTargetFromProvenEcu` (mevcut)
 *   işlem/bütçe/epoch → `diagnosticTransaction`                (F1-A)
 *   admisyon          → `diagnosticAdmission`                  (mevcut)
 *   servis tanımı     → `cddl/legacyAdapter.builtinServiceDefs`(F3-B)
 *   PDU + taşıma      → `cddlPduRead.readByServiceDef` → `vdkPduTransport`
 *                       → GENEL salt-okunur köprü              (F4-A)
 *   varlık sınıfı     → `ecuCapabilityModel.deriveServicePresence` (F4-B)
 *   oturum ihtiyacı   → `sessionHealing.deriveSessionRequirement`  (F5-C)
 *   parmak izi        → `capability/capabilityFingerprint`     (F4-C)
 *   bağlam bağlama    → `vehicleDiagnosticContext`             (F5-G)
 *   kanonik iz        → `canonicalTrace.recordTraceEvent`      (F2-A)
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ KİMLİK OTORİTESİ DEĞİLDİR.** Parmak izi ve gücü F4-C'den gelir.
 * (2) **İKİNCİ TARAYICI DEĞİLDİR.** Adres taraması YOK ve bu modül keşfi
 *     KENDİ ÇAĞIRMAZ: ECU listesi çağırandan gelir (`EarlyIdentityOptions.ecus`).
 *     Bu yalnız bir üslup tercihi değil, `multiEcuScan → productionDiscovery →
 *     earlyVehicleIdentity → multiEcuScan` modül döngüsünü YAPISAL olarak
 *     engelleyen sınırdır. Hedefin kabul kararı MEVCUT
 *     `healingTargetFromProvenEcu`undur.
 * (3) **İKİNCİ OTURUM/BÜTÇE OTORİTESİ DEĞİLDİR.** `10 xx` GÖNDERMEZ, `3E`
 *     GÖNDERMEZ, keepalive KURMAZ, kira defteri AÇMAZ, SecurityAccess YOK.
 * (4) **KULLANILABİLİRLİK KAPISI DEĞİLDİR.** Bu tur düşerse normal OBD/PID
 *     akışı AYNEN çalışmaya devam eder (§12).
 * (5) **MIGRATION MOTORU DEĞİLDİR.** Kanıtsız hiçbir bölüm birleştirilmez.
 *
 * ASLA throw etmez.
 */

import { logError } from '../../crashLogger';
import { getObdSessionEpoch } from '../../obdService';
import { getActiveObdProtocol, getActiveProtocolClass } from '../activeProtocol';
import type { DiscoveredEcu } from '../ecuDiscovery';
import {
  beginTransaction, prepareTransaction, completeTransaction, failTransaction,
  isTransactionLive, type DiagnosticTransaction,
} from '../diagnosticTransaction';
import { getDiagnosticAdmissionSync } from '../diagnosticAdmission';
import { builtinServiceDefs } from '../cddl/legacyAdapter';
import type { EcuVariant, ServiceDef } from '../cddl/schema';
import { healingTargetFromProvenEcu } from '../healing/selfHealingTrigger';
import { readByServiceDef } from '../cddlPduRead';
import { genericBridgeAvailable } from '../genericPduTransport';
import { recordTraceEvent } from '../canonicalTrace';
import { deriveSessionRequirement } from '../healing/sessionHealing';
import { deriveServicePresence } from '../ecuCapabilityModel';
import {
  buildCapabilityFingerprint, isFingerprintReusable,
  type EcuIdentityObservation, type VehicleIdentityAxis,
} from '../capability/capabilityFingerprint';
import { activateVehicleDiagnosticContext } from '../vehicleDiagnosticContext';
import type { GapLedgerScopeState } from '../gapLedgerScope';
import {
  EARLY_IDENTITY_DID_ORDER,
  buildCalibrationEvidence, classifyDidProbe, deriveEarlyIdentityOutcome,
  evaluateEarlyIdentityAdmission, mayTryNextDid, reconcileVehicleIdentity,
  type CalibrationReading, type DidProbeVerdict, type EarlyIdentityAdmission,
  type EarlyIdentityDidSpec, type EarlyIdentityOutcome, type IdentityRelation,
} from './earlyIdentityModel';

/** CDDL 0x22 servis tanımının kimliği (`legacyAdapter.serviceDefIdFor('22')`). */
const DID_SERVICE_DEF_ID = 'uds_read_data_by_identifier';

/* ══════════════════════════════════════════════════════════════════════════
   1) KANIT DEFTERİ — LAB salt-okuma yüzeyi
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek bir DID yoklamasının kanıt satırı. **HAM DEĞER YOKTUR.** */
export interface EarlyIdentityProbeRow {
  readonly did: string;
  /** Hatta çıkan ham istek künyesi (`22F18C`) — gizli veri içermez. */
  readonly request: string | null;
  readonly verdict: DidProbeVerdict;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  /** Yanıt gövdesinin hex hane sayısı — İÇERİK DEĞİL, yalnız ölçü. */
  readonly valueHexLength: number;
  /** İstek GERÇEKTEN gönderildi mi (gönderilmediyse gerekçe `detail`dedir). */
  readonly sent: boolean;
  readonly detail: string | null;
}

export type EarlyIdentityActivation =
  | 'NOT_ATTEMPTED' | 'ACTIVATED' | 'SKIPPED_WEAK' | 'FAILED';

export const EARLY_IDENTITY_ACTIVATION_LABEL:
Readonly<Record<EarlyIdentityActivation, string>> = {
  NOT_ATTEMPTED: 'DENENMEDİ — ölçülmüş kimlik yok',
  ACTIVATED:     'BAĞLANDI — araç tanı bağlamı aktive edildi',
  SKIPPED_WEAK:  'ATLANDI — kimlik yeniden kullanıma yetmedi',
  FAILED:        'DÜŞTÜ — bağlama sırasında hata (fail-soft)',
} as const;

export interface EarlyIdentityEvidence {
  /** Tur GERÇEKTEN değerlendirildi mi (her çağrıda `true`). */
  readonly attempted: boolean;
  readonly admission: EarlyIdentityAdmission;
  readonly reason: string;
  readonly outcome: EarlyIdentityOutcome;
  readonly protocol: string | null;
  readonly protocolClass: string | null;
  readonly targetTx: string | null;
  readonly targetRx: string | null;
  readonly probes: readonly EarlyIdentityProbeRow[];
  /** Hatta çıkan istek sayısı; hiç gönderilmediyse `0`. */
  readonly requestsUsed: number;
  /** Ölçülen toplam RTT; hiç ölçüm yoksa `null` (sahte `0` YASAK). */
  readonly totalLatencyMs: number | null;
  /** Kalibrasyon DID'i oturum İSTEDİ mi (ölçülmüş NRC kanıtı). */
  readonly sessionRequired: boolean;
  /**
   * Oturum AÇILDI mı. **Bu turda YAPISAL OLARAK `false`**: `10 xx` gönderen
   * tek satır yoktur. Alan, "hiç denenmedi" ile "denendi açılmadı" ayrımının
   * LAB'da görünmesi için taşınır.
   */
  readonly sessionOpened: boolean;
  readonly calibrationDid: string | null;
  readonly calibrationMeasured: boolean;
  /** Kimliğin ayrım gücü — filo riski burada GÖRÜNÜR (`VARIANT` = zayıf ayrım). */
  readonly calibrationDiscrimination: 'INSTANCE' | 'VARIANT' | null;
  /** YAPISAL SABİT: ham kalibrasyon değeri hiçbir kalıcı yüzeye YAZILMAZ. */
  readonly rawCalibrationPersisted: false;
  readonly measuredAxes: readonly VehicleIdentityAxis[] | null;
  readonly confidence: number | null;
  readonly vehicleRef: string | null;
  readonly reusable: boolean | null;
  readonly activation: EarlyIdentityActivation;
  readonly scopeState: GapLedgerScopeState | null;
  readonly hydratedGapEntries: number | null;
  readonly hydratedCapabilityEdges: number | null;
  readonly sessionEpoch: number;
  readonly atMs: number | null;
}

/** Erken kimlik ile tam tarama kimliğinin uzlaştırma kanıtı. */
export interface IdentityReconciliationEvidence {
  /** Bağlantı noktası yoksa (`anchor` yok / bayat) `null` — ilişki SORULMADI. */
  readonly relation: IdentityRelation | null;
  readonly reason: string;
  readonly earlyRef: string | null;
  readonly fullRef: string | null;
  readonly adoptedRef: string | null;
  /** Ortak kanıt YENİDEN ölçüldü mü (tek salt-okunur istek). */
  readonly reverified: boolean;
  readonly persistenceFrozen: boolean;
  readonly sessionEpoch: number;
  readonly atMs: number | null;
}

/**
 * ERKEN KİMLİK BAĞLANTI NOKTASI (anchor).
 *
 * Oturum mührüyle birlikte taşınır: mühür değişirse (yeni bağlantı — adaptör
 * başka araca takılmış olabilir) anchor OTOMATİK olarak geçersizdir ve
 * uzlaştırmada KULLANILMAZ.
 */
export interface EarlyIdentityAnchor {
  readonly vehicleRef: string;
  readonly sessionEpoch: number;
  readonly ecuTxHeader: string;
  readonly ecuRxHeader: string;
  /**
   * Kimliğin ölçüldüğü ECU'nun ÖLÇÜLMÜŞ adres genişliği ve rolü.
   *
   * ⚠️ Uzlaştırma turunda hedef YENİDEN KURULUR; bu iki alan taşınmasaydı
   * orada `11` ve `engine` gibi değerler UYDURULMAK zorunda kalırdı ve
   * uydurulan bir `addressBits`, KWP hedef baytı kararını (dolayısıyla
   * hangi modülün uyandığını) sessizce değiştirebilirdi.
   */
  readonly ecuAddressBits: number;
  readonly ecuRole: string;
  readonly calibrationDid: string;
  readonly calibrationValueHash: string;
  readonly protocol: string | null;
  readonly measuredAxes: readonly VehicleIdentityAxis[];
  readonly confidence: number;
}

export const MAX_EARLY_IDENTITY_EVIDENCE = 10;

let _evidence: EarlyIdentityEvidence[] = [];
let _reconciliation: IdentityReconciliationEvidence[] = [];
let _anchor: EarlyIdentityAnchor | null = null;
let _runningEpoch: number | null = null;
let _evaluatedEpoch: number | null = null;

export function getEarlyIdentityEvidence(): readonly EarlyIdentityEvidence[] {
  try { return [..._evidence]; } catch { return []; }
}
export function getLastEarlyIdentity(): EarlyIdentityEvidence | null {
  return _evidence.length === 0 ? null : _evidence[_evidence.length - 1]!;
}
/** Erken kimlik HİÇ değerlendirildi mi — `0`/`false` ile KARIŞTIRILMAZ. */
export function earlyIdentityEverEvaluated(): boolean { return _evidence.length > 0; }

/**
 * P0-VDK-B7 · LIFECYCLE — bu oturum mührü için ölçüm ZATEN tamamlandı mı?
 *
 * ── NEDEN EXPORT EDİLDİ (saha 2026-08-30) ─────────────────────────────────
 * İdempotens kapısı {@link runEarlyVehicleIdentity} İÇİNDEYDİ; çağıran
 * (`earlyIdentityRuntime`) ise o kapıya gelmeden ÖNCE `discoverEcus()`
 * çalıştırıyordu. Sonuç: kimlik ölçümü "tek tur" olsa bile KEŞİF her OBD veri
 * olayında yeniden koşuyor ve fiziksel prob turu (7 × `1902FF`) hatta
 * çıkıyordu — 10 dakikada 102 keşif, 712 istek, %83 boşa giden süre.
 *
 * Bu sorgu YENİ BİR DURUM DEĞİLDİR: aynı `_evaluatedEpoch` defterini okur.
 * Çağıran artık pahalı keşfe girmeden önce sorabilir.
 */
export function isEarlyIdentityEvaluatedForEpoch(epoch: number): boolean {
  return _evaluatedEpoch === epoch && _evidence.length > 0;
}

export function getIdentityReconciliations(): readonly IdentityReconciliationEvidence[] {
  try { return [..._reconciliation]; } catch { return []; }
}
export function getLastIdentityReconciliation(): IdentityReconciliationEvidence | null {
  return _reconciliation.length === 0
    ? null : _reconciliation[_reconciliation.length - 1]!;
}

/**
 * AKTİF bağlantı noktası — **yalnız mühür hâlâ geçerliyse**.
 *
 * Mühür okunamıyorsa (`-1`) anchor VERİLMEZ: bayat bir kimliği yeni bir
 * ölçüme bağlamak, tam olarak bu turun yasakladığı hatadır.
 */
export function getEarlyIdentityAnchor(): EarlyIdentityAnchor | null {
  if (_anchor === null) return null;
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { return null; }
  if (epoch === -1 || epoch !== _anchor.sessionEpoch) return null;
  return _anchor;
}

/** @internal — testler arası izolasyon. */
export function _resetEarlyVehicleIdentityForTest(): void {
  _evidence = []; _reconciliation = []; _anchor = null;
  _runningEpoch = null; _evaluatedEpoch = null;
}

function _record(e: EarlyIdentityEvidence): void {
  try {
    _evidence.push(e);
    if (_evidence.length > MAX_EARLY_IDENTITY_EVIDENCE) _evidence.shift();
    _evaluatedEpoch = e.sessionEpoch;
  } catch { /* kanıt kaydı ASLA ürünü düşürmez */ }
}

function _recordReconcile(e: IdentityReconciliationEvidence): void {
  try {
    _reconciliation.push(e);
    if (_reconciliation.length > MAX_EARLY_IDENTITY_EVIDENCE) _reconciliation.shift();
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) YARDIMCILAR
   ══════════════════════════════════════════════════════════════════════════ */

function _emptyEvidence(
  admission: EarlyIdentityAdmission, reason: string,
  outcome: EarlyIdentityOutcome, epoch: number, nowMs: number,
  protocol: string | null, protocolClass: string | null,
  target: EcuVariant | null,
): EarlyIdentityEvidence {
  return {
    attempted: true, admission, reason, outcome,
    protocol, protocolClass,
    targetTx: target?.txHeader ?? null,
    targetRx: target?.rxHeader ?? null,
    probes: Object.freeze([]),
    requestsUsed: 0, totalLatencyMs: null,
    sessionRequired: false, sessionOpened: false,
    calibrationDid: null, calibrationMeasured: false,
    calibrationDiscrimination: null,
    rawCalibrationPersisted: false,
    measuredAxes: null, confidence: null,
    vehicleRef: null, reusable: null,
    activation: 'NOT_ATTEMPTED', scopeState: null,
    hydratedGapEntries: null, hydratedCapabilityEdges: null,
    sessionEpoch: epoch, atMs: nowMs,
  };
}

/**
 * Erken kimlik hedefini DETERMİNİSTİK seçer.
 *
 * ⚠️ DETERMİNİZM BİR KİMLİK ŞARTIDIR: hedef ECU değişirse parmak izi de
 * değişir ve aynı araç iki farklı kalıcı bölüme düşer. Bu yüzden aday listesi
 * yanıt adresine göre SIRALANIR ve ilk kabul edilen alınır — keşfin döndürme
 * sırası (hat gürültüsüne göre değişebilir) kimliği ETKİLEMEZ.
 *
 * Kabul kararı MEVCUT `healingTargetFromProvenEcu`undur: cevap vermemiş,
 * adresi türetilememiş ya da rolü ölçülmemiş ECU hedef OLAMAZ.
 */
export function selectEarlyIdentityTarget(
  ecus: readonly DiscoveredEcu[],
): EcuVariant | null {
  const sorted = [...ecus].sort((a, b) =>
    (a.rxHeader ?? '').localeCompare(b.rxHeader ?? ''));
  for (const e of sorted) {
    const v = healingTargetFromProvenEcu(
      e as unknown as Parameters<typeof healingTargetFromProvenEcu>[0],
      [DID_SERVICE_DEF_ID],
    );
    if (v !== null) return v;
  }
  return null;
}

function _didServiceDef(): ServiceDef | null {
  try {
    return builtinServiceDefs().find((d) => d.id === DID_SERVICE_DEF_ID) ?? null;
  } catch (e) {
    logError('OBD:EarlyIdentityDefs', e);
    return null;
  }
}

/** Yoklamayı kanonik ize yazar — **ham gövde TAŞINMAZ** (§14 gizlilik). */
function _trace(
  txn: DiagnosticTransaction, target: EcuVariant, spec: EarlyIdentityDidSpec,
  request: string | null, verdict: DidProbeVerdict,
  nrc: number | null, latencyMs: number | null, protocol: string | null,
): void {
  try {
    recordTraceEvent({
      transactionId: txn.transactionId,
      evidenceCorrelationId: `early-identity:${spec.did}`,
      sessionEpoch: txn.sessionEpoch,
      ecuTxHeader: target.txHeader.length === 0 ? null : target.txHeader,
      ecuRxHeader: target.rxHeader.length === 0 ? null : target.rxHeader,
      ecuLabel: target.name,
      protocol,
      transport: 'unknown',
      direction: 'request_response',
      operation: 'vehicle_identity_probe',
      subFunction: null,
      rawRequest: request,
      /* ⚠️ HAM YANIT BİLİNÇLİ OLARAK TAŞINMAZ: kimlik DID'inin gövdesi seri/
         parça numarasıdır ve dışa aktarılan izde yer alamaz. Kimlik kanıtı ize
         yalnız KARMA olarak (evidenceCorrelationId + sonuç) girer. */
      rawResponse: null,
      transportOutcome: verdict,
      nrc, latencyMs,
      byteCount: null, frameCount: null,
      sessionLeaseRef: null, adapterKind: null, isoTpTuningRef: null,
      redactionState: 'REDACTED',
    });
  } catch (e) { logError('OBD:EarlyIdentityTrace', e); }
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ÜRÜN YOLU — ERKEN KİMLİK TURU
   ══════════════════════════════════════════════════════════════════════════ */

export interface EarlyIdentityOptions {
  /**
   * ÖLÇÜLMÜŞ ECU listesi — **çağıran sağlar** (bu modül keşif KOŞTURMAZ).
   * Verilmezse tur `BLOCKED` biter; uydurma hedef kurulmaz.
   */
  readonly ecus?: readonly DiscoveredEcu[];
  /** Enjekte edilebilir duvar saati (test); verilmezse `Date.now()`. */
  readonly nowMs?: number;
  /** Aynı oturumda yeniden ölçüm (uzlaştırma yolu kullanır). */
  readonly force?: boolean;
}

/**
 * TAM ARAÇ TARAMASINDAN ÖNCE kanıtlı araç kimliği ölçer.
 *
 * SIRA (pazarlıksız):
 *   1. Oturum mührü okunur; aynı mühürde ikinci kez ÖLÇÜLMEZ (idempotent).
 *   2. Protokol ÖLÇÜLMÜŞ mü, köprü VAR mı — yoksa hatta tek bayt çıkmaz.
 *   3. ÇAĞIRANIN verdiği keşif listesinden hedef seçilir; yoksa BLOCKED.
 *   4. F1-A işlemi açılır, admisyon SORULUR (kural kopyalanmaz).
 *   5. Aday DID'ler SIRAYLA sorulur; yalnız `7F .. 11` (DID YOK) bir sonraki
 *      adaya geçirir — sessizlik/zaman aşımı turu BİTİRİR (fail-closed).
 *   6. Ölçülen değerin KARMASI alınır; ham değer atılır.
 *   7. F4-C parmak izi kurulur ve gücü F4-C'ye SORULUR.
 *   8. Güçlüyse F5-G bağlama noktası TEK kez çağrılır.
 *
 * ASLA throw etmez ve normal OBD akışını ETKİLEMEZ.
 */
export async function runEarlyVehicleIdentity(
  opts: EarlyIdentityOptions = {},
): Promise<EarlyIdentityEvidence> {
  const nowMs = opts.nowMs ?? Date.now();
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { epoch = -1; }

  /* ── İDEMPOTENS: aynı oturumda tek ölçüm ───────────────────────────────
     Araç oturum içinde DEĞİŞMEZ; ikinci bir tur yalnız hattı meşgul eder. */
  if (!opts.force && _runningEpoch === epoch) {
    return getLastEarlyIdentity()
      ?? _emptyEvidence('DEFERRED', 'ölçüm zaten sürüyor',
        'EARLY_IDENTITY_DEFERRED', epoch, nowMs, null, null, null);
  }
  if (!opts.force && _evaluatedEpoch === epoch && _evidence.length > 0) {
    return _evidence[_evidence.length - 1]!;
  }
  _runningEpoch = epoch;

  const protocol = _safe(getActiveObdProtocol) ?? null;
  const protocolClass = _safe(getActiveProtocolClass) ?? null;

  try {
    /* ── (2) YAPISAL ÖN KOŞULLAR — hatta çıkmadan ölçülür ──────────────── */
    const bridge = _safe(genericBridgeAvailable) ?? false;
    const def = _didServiceDef();

    /* ── (3) HEDEF — ÇAĞIRANIN sağladığı ÖLÇÜLMÜŞ keşif listesinden. ────── */
    const ecus = opts.ecus ?? [];
    const target = ecus.length === 0 ? null : selectEarlyIdentityTarget(ecus);
    /* Hedefin ÖLÇÜLMÜŞ adres genişliği — uzlaştırmada uydurulmaması için
       kaynağından taşınır. */
    const targetBits = target === null ? 11
      : (ecus.find((e) => e.rxHeader === target.rxHeader)?.addressBits ?? 11);

    /* ── (4) İŞLEM + ADMİSYON ──────────────────────────────────────────── */
    const txn = beginTransaction({
      purpose: 'vehicle_identity',
      protocol,
      ...(target === null ? {} : {
        ecuEndpoint: {
          txHeader: target.txHeader.length === 0 ? null : target.txHeader,
          rxHeader: target.rxHeader.length === 0 ? null : target.rxHeader,
          addressBits: null, label: target.name,
        },
      }),
    });
    const prep = await prepareTransaction(txn);

    let admissionName = prep.admission;
    if (prep.ok) {
      try { admissionName = getDiagnosticAdmissionSync().admission; }
      catch { /* fail-closed: prep sonucu kalır */ }
    }

    const decision = evaluateEarlyIdentityAdmission({
      admission: prep.ok ? admissionName : prep.admission,
      transactionLive: prep.ok && isTransactionLive(txn),
      cancelled: txn.cancelled === true,
      staleEpoch: txn.sessionEpoch === -1,
      protocolKnown: protocol !== null && protocolClass !== null
        && protocolClass !== 'unknown',
      protocolSupportsDid: protocolClass === 'can',
      genericBridgeAvailable: bridge,
      provenTargets: target === null ? 0 : 1,
      didServiceDefAvailable: def !== null,
      remainingRequests: Math.max(0, txn.requestBudget - txn.requestsUsed),
    });

    if (decision.admission !== 'RUN' || target === null || def === null) {
      failTransaction(txn, decision.reason);
      const ev = _emptyEvidence(
        decision.admission, decision.reason,
        decision.admission === 'DEFERRED'
          ? 'EARLY_IDENTITY_DEFERRED' : 'EARLY_IDENTITY_BLOCKED',
        txn.sessionEpoch, nowMs, protocol, protocolClass, target);
      _record(ev);
      return ev;
    }

    /* ── (5) ADAY DID'LER — SIRAYLA, FAIL-CLOSED ───────────────────────── */
    const probes: EarlyIdentityProbeRow[] = [];
    const readings: CalibrationReading[] = [];
    let calibration: ReturnType<typeof buildCalibrationEvidence> = null;
    let sessionRequired = false;
    let latencySum = 0;
    let latencyMeasured = false;

    for (const spec of EARLY_IDENTITY_DID_ORDER.slice(0, decision.allocatedRequests)) {
      if (!isTransactionLive(txn)) break;

      const r = await readByServiceDef({
        service: def, ecu: target, argument: spec.did,
        protocol, protocolClass, txn,
        targetVerified: true, ecuKey: target.rxHeader,
        sessionEpoch: txn.sessionEpoch,
      });

      if (!r.sent || r.response === null) {
        probes.push({
          did: spec.did, request: r.request, verdict: 'NOT_CARRIED',
          nrc: null, latencyMs: null, valueHexLength: 0,
          sent: false, detail: r.detail,
        });
        break;   // istek gitmedi → ölçüm yok, tur biter (fail-closed)
      }

      const raw = r.response.raw ?? '';
      const clean = raw.replace(/[^0-9A-Fa-f]/g, '');
      const verdict = classifyDidProbe(r.response.outcome, r.response.nrc, clean.length);

      if (typeof r.response.latencyMs === 'number') {
        latencySum += r.response.latencyMs; latencyMeasured = true;
      }

      probes.push({
        did: spec.did, request: r.request, verdict,
        nrc: r.response.nrc, latencyMs: r.response.latencyMs,
        valueHexLength: clean.length, sent: true, detail: r.detail,
      });
      readings.push({
        did: spec.did, verdict, nrc: r.response.nrc,
        latencyMs: r.response.latencyMs, valueHexLength: clean.length,
      });

      _trace(txn, target, spec, r.request, verdict,
        r.response.nrc, r.response.latencyMs, protocol);

      /* ── OTURUM İHTİYACI — MEVCUT F5-C otoritesi ──────────────────────
         Kör `10 xx` GÖNDERİLMEZ. Oturum gerekiyorsa bu tur güçlü kimlik
         ÜRETMEZ; gerekçe kanıt olarak durur ve tur `DEFERRED` biter. */
      const requirement = deriveSessionRequirement({
        sessionOpened: r.response.session?.opened ?? null,
        sessionCommand: r.response.session?.command ?? null,
        classification: deriveServicePresence(r.response.outcome, r.response.nrc),
        nrc: r.response.nrc,
      });
      if (requirement.required) sessionRequired = true;

      if (verdict === 'MEASURED') {
        /* ⚠️ HAM DEĞER BURADA BİTER: karma alınır, `clean` bir daha
           kullanılmaz ve hiçbir kalıcı yüzeye taşınmaz. */
        calibration = buildCalibrationEvidence(spec, clean);
        if (calibration !== null) break;
      }
      if (!mayTryNextDid(verdict)) break;
    }

    const requestsUsed = probes.filter((p) => p.sent).length;

    /* ── (6-7) PARMAK İZİ — F4-C OTORİTESİ ─────────────────────────────── */
    let vehicleRef: string | null = null;
    let reusable: boolean | null = null;
    let axes: readonly VehicleIdentityAxis[] | null = null;
    let confidence: number | null = null;

    if (calibration !== null) {
      try {
        const obs: EcuIdentityObservation = {
          txHeader: target.txHeader.length === 0 ? null : target.txHeader,
          rxHeader: target.rxHeader.length === 0 ? null : target.rxHeader,
          protocol,
          /* Erken turda servis taraması YAPILMADI → imza ÖLÇÜLMEDİ.
             Uydurulmaz; `null` kalır ve parmak izi bunu SÖYLER. */
          responseSignature: null,
          calibrationDid: calibration.calibrationDid,
          calibrationValueHash: calibration.calibrationValueHash,
        };
        const fp = buildCapabilityFingerprint(
          { protocol, supportedPidBitmap: null, vin: null }, [obs]);
        vehicleRef = fp.id;
        reusable = isFingerprintReusable(fp);
        axes = fp.measuredAxes;
        confidence = fp.confidence;
      } catch (e) {
        logError('OBD:EarlyIdentityFingerprint', e);
      }
    }

    const outcome = deriveEarlyIdentityOutcome(
      readings, calibration !== null, reusable === true);

    /* ── (8) BAĞLAM BAĞLAMA — F5-G TEK NOKTASI ─────────────────────────
       ⚠️ KİMLİK YOKKEN ÇAĞRILMAZ: `vehicleRef: null` ile çağırmak kapsamı
       `UNIDENTIFIED`e çevirir ve HYDRATE EDİLMİŞ bir bölümü AYIRIR. Ölçemediğimiz
       için başkasının belleğini boşaltmak, ölçmemekten daha kötüdür. */
    let activation: EarlyIdentityActivation = 'NOT_ATTEMPTED';
    let scopeState: GapLedgerScopeState | null = null;
    let gapEntries: number | null = null;
    let capEdges: number | null = null;

    if (vehicleRef !== null && reusable === true) {
      try {
        const act = activateVehicleDiagnosticContext({
          vehicleRef, fingerprintReusable: true,
          provenance: 'live', nowMs,
        });
        activation = 'ACTIVATED';
        scopeState = act.scope.state;
        gapEntries = act.gapEntries;
        capEdges = act.capabilityEdges;
        _anchor = {
          vehicleRef, sessionEpoch: txn.sessionEpoch,
          ecuTxHeader: target.txHeader, ecuRxHeader: target.rxHeader,
          ecuAddressBits: targetBits, ecuRole: target.role,
          calibrationDid: calibration!.calibrationDid,
          calibrationValueHash: calibration!.calibrationValueHash,
          protocol, measuredAxes: axes ?? [], confidence: confidence ?? 0,
        };
      } catch (e) {
        logError('OBD:EarlyIdentityActivate', e);
        activation = 'FAILED';
      }
    } else if (vehicleRef !== null) {
      /* Kimlik ölçüldü ama F4-C yeniden kullanıma YETMEDİ → kalıcı bölüm
         AÇILMAZ ve anchor KURULMAZ (zayıf kimlik başka aracı yükleyemez). */
      activation = 'SKIPPED_WEAK';
    }

    completeTransaction(txn);

    const ev: EarlyIdentityEvidence = {
      attempted: true, admission: 'RUN', reason: decision.reason, outcome,
      protocol, protocolClass,
      targetTx: target.txHeader.length === 0 ? null : target.txHeader,
      targetRx: target.rxHeader.length === 0 ? null : target.rxHeader,
      probes: Object.freeze(probes),
      requestsUsed,
      totalLatencyMs: latencyMeasured ? latencySum : null,
      sessionRequired, sessionOpened: false,
      calibrationDid: calibration?.calibrationDid ?? null,
      calibrationMeasured: calibration !== null,
      calibrationDiscrimination: calibration?.discrimination ?? null,
      rawCalibrationPersisted: false,
      measuredAxes: axes, confidence,
      vehicleRef, reusable,
      activation, scopeState,
      hydratedGapEntries: gapEntries, hydratedCapabilityEdges: capEdges,
      sessionEpoch: txn.sessionEpoch, atMs: nowMs,
    };
    _record(ev);
    return ev;
  } catch (e) {
    logError('OBD:EarlyVehicleIdentity', e);
    const ev = _emptyEvidence('BLOCKED', 'erken kimlik turu düştü (fail-soft)',
      'EARLY_IDENTITY_BLOCKED', epoch, nowMs, protocol, protocolClass, null);
    _record(ev);
    return ev;
  } finally {
    _runningEpoch = null;
  }
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) TAM TARAMA UZLAŞTIRMASI — ORTAK KANIT YENİDEN ÖLÇÜLÜR
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReconcileScanContext {
  /** Taramanın ölçtüğü ECU'lar (yanıt adresi + istek adresi). */
  readonly ecus: readonly { readonly txHeader: string; readonly rxHeader: string }[];
  readonly protocol: string | null;
  readonly protocolClass: 'can' | 'kwp' | 'iso9141' | 'j1850' | 'unknown' | null;
  readonly nowMs: number | null;
}

/**
 * Tam tarama parmak izini erken kimlikle UZLAŞTIRIR.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN BİR İSTEK DAHA GÖNDERİYORUZ ─────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Erken kimlik ile tam tarama kimliği YAPISAL OLARAK farklı ID üretir (erken
 * turda yanıt imzası ölçülmemiştir). Aralarındaki ilişkiyi protokol/adres/
 * bitmap benzerliğinden çıkarmak YASAKTIR (§9) — aynı model iki araç bunlarda
 * birebir aynıdır. Kanıtlanabilir tek ortak eksen, **aynı ECU'da aynı DID'in
 * aynı karmayı vermesidir**; o yüzden TEK bir salt-okunur istek gönderilir.
 *
 * Bu istek olmadan `CONFLICT` (iki farklı aracın karışması) ASLA
 * yakalanamazdı — o yüzden bu bir lüks değil, güvenlik ölçümüdür.
 *
 * `anchor` yoksa ya da mühür değiştiyse `relation: null` döner ve çağıran
 * ESKİSİ GİBİ (F5-G davranışı) devam eder.
 */
export async function reconcileEarlyIdentityWithScan(
  txn: DiagnosticTransaction | null,
  ctx: ReconcileScanContext,
  fullRef: string | null,
): Promise<IdentityReconciliationEvidence> {
  const anchor = getEarlyIdentityAnchor();
  const epoch = txn?.sessionEpoch ?? -1;

  if (anchor === null || anchor.sessionEpoch !== epoch) {
    const ev: IdentityReconciliationEvidence = {
      relation: null,
      reason: anchor === null
        ? 'erken kimlik bağlantı noktası YOK — uzlaştırılacak kimlik yok'
        : 'erken kimlik BAŞKA oturum mührüne ait — kullanılmaz',
      earlyRef: anchor?.vehicleRef ?? null, fullRef,
      adoptedRef: null, reverified: false, persistenceFrozen: false,
      sessionEpoch: epoch, atMs: ctx.nowMs,
    };
    _recordReconcile(ev);
    return ev;
  }

  /* ── ORTAK KANITI YENİDEN ÖLÇ (tek istek) ─────────────────────────────── */
  let reverifiedHash: string | null = null;
  let reverifiedRx: string | null = null;
  const spec = EARLY_IDENTITY_DID_ORDER.find((s) => s.did === anchor.calibrationDid);
  const def = _didServiceDef();
  const sameEcu = ctx.ecus.find((e) =>
    (e.rxHeader ?? '').toUpperCase() === anchor.ecuRxHeader.toUpperCase());

  if (txn !== null && spec !== undefined && def !== null && sameEcu !== undefined
      && isTransactionLive(txn)) {
    try {
      /* ⚠️ ADRES/ROL UYDURULMAZ: üçü de erken turda ÖLÇÜLMÜŞ bağlantı
         noktasından gelir; yalnız `txHeader` taramanın ölçtüğü kayıttandır. */
      const variant = healingTargetFromProvenEcu(
        {
          txHeader: sameEcu.txHeader, rxHeader: sameEcu.rxHeader,
          addressBits: anchor.ecuAddressBits, role: anchor.ecuRole,
          label: 'erken kimlik doğrulaması',
          discoverySource: 'functional_0100', probeOutcome: 'responded',
        },
        [DID_SERVICE_DEF_ID],
      );
      if (variant !== null) {
        const r = await readByServiceDef({
          service: def, ecu: variant, argument: spec.did,
          protocol: ctx.protocol, protocolClass: ctx.protocolClass, txn,
          targetVerified: true, ecuKey: sameEcu.rxHeader,
          sessionEpoch: txn.sessionEpoch,
        });
        if (r.sent && r.response !== null) {
          const clean = (r.response.raw ?? '').replace(/[^0-9A-Fa-f]/g, '');
          const verdict = classifyDidProbe(
            r.response.outcome, r.response.nrc, clean.length);
          _trace(txn, variant, spec, r.request, verdict,
            r.response.nrc, r.response.latencyMs, ctx.protocol);
          const cal = verdict === 'MEASURED'
            ? buildCalibrationEvidence(spec, clean) : null;
          if (cal !== null) {
            reverifiedHash = cal.calibrationValueHash;
            reverifiedRx = sameEcu.rxHeader;
          }
        }
      }
    } catch (e) {
      logError('OBD:EarlyIdentityReverify', e);
    }
  }

  const result = reconcileVehicleIdentity({
    earlyRef: anchor.vehicleRef,
    earlyDid: anchor.calibrationDid,
    earlyValueHash: anchor.calibrationValueHash,
    earlyEcuRx: anchor.ecuRxHeader,
    fullRef: fullRef ?? '',
    reverifiedValueHash: reverifiedHash,
    reverifiedEcuRx: reverifiedRx,
  });

  /* ÇELİŞKİ → bağlantı noktası DÜŞÜRÜLÜR: çelişkili bir kimliğin bir sonraki
     turda "kanıt" olarak kullanılması, yanlışı kalıcı yapardı. */
  if (result.relation === 'CONFLICT') _anchor = null;

  const ev: IdentityReconciliationEvidence = {
    relation: result.relation, reason: result.reason,
    earlyRef: anchor.vehicleRef, fullRef,
    adoptedRef: result.adoptedRef,
    reverified: reverifiedHash !== null,
    persistenceFrozen: result.persistenceFrozen,
    sessionEpoch: epoch, atMs: ctx.nowMs,
  };
  _recordReconcile(ev);
  return ev;
}
