/**
 * ecuIdentityResolver — P0-VDK-F6A · UÇ NOKTA → KİMLİK/ROL ÇÖZÜMÜ + KANONİK ENVANTER.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KAPATILAN AÇIK ────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Ürün motor ECU'sunda derinleşti ama **rolü bilinmeyen uç noktalar ölüydü**:
 *   · `EcuVariant.role` `unknown`ı YASAKLIYORDU (`cddl/schema`),
 *   · `healingTargetFromProvenEcu` yalnız `MEASURABLE_ROLES` kabul ediyordu,
 *   → F4-B servis keşfi · F4-C öğrenmesi · F5-A iyileştirmesi bu uç noktaları
 *     HİÇ görmüyordu. `7E1`'de cevap veren bir modül keşfediliyor, DTC'si
 *     okunuyor, ama yetenek çizgesine GİREMİYORDU.
 *
 * Bu modül o boşluğu kapatır ve **rolü adresten TÜRETMEZ**.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ TARAYICI DEĞİLDİR.** Uç nokta listesi çağırandan gelir
 *     (`multiEcuScan.discoverEcus` ölçümü); kör adres taraması YOK.
 * (2) **İKİNCİ ENVANTER MOTORU DEĞİLDİR.** Kanonik envanter bu turun ÖLÇÜM
 *     çıktısıdır; `ecuIdentityService` (P0-OBD-08, legacy `readObdDid` yolu)
 *     olduğu gibi durur ve DEĞİŞTİRİLMEZ.
 * (3) **İKİNCİ KİMLİK OTORİTESİ DEĞİLDİR.** Parmak izi F4-C
 *     `buildEcuFingerprint`, rol sözlüğü `ecuRoleModel`, ad→rol eşlemesi
 *     `roleFromDeclaredName`, standart garanti `roleFromStandardAddress`tir.
 * (4) **İKİNCİ BÜTÇE/ZAMANLAYICI DEĞİLDİR.** Sahibi işlemin KALAN bütçesinden
 *     pay alır; `setInterval`/`setTimeout` YOK.
 * (5) **ROL-ÖZEL HİÇBİR ŞEY ÇALIŞTIRMAZ.** Gönderilen tek şey salt-okunur
 *     kimlik DID'idir; kodlama · rutin · security · silme · aktüatör · reset
 *     bu yoldan AÇILAMAZ (F4-A native kapısı ayrıca ve bağımsız son kapıdır).
 *
 * ASLA throw etmez: kimlik çözümünün düşmesi taramayı DÜŞÜRMEZ.
 */

import { logError } from '../../crashLogger';
import type { DiagnosticTransaction } from '../diagnosticTransaction';
import { hasRequestBudget, isTransactionLive } from '../diagnosticTransaction';
import type { DiagnosticAdmission } from '../diagnosticAdmission';
import type {
  EcuVariant, ProtocolClassName, ServiceDef, VariantPattern,
} from '../cddl/schema';
import { readByServiceDef } from '../cddlPduRead';
import { recordTraceEvent } from '../canonicalTrace';
import { genericBridgeAvailable } from '../genericPduTransport';
import {
  buildEcuFingerprint, type EcuFingerprint,
} from '../capability/capabilityFingerprint';
import { isProductTrusted, type CapabilityProvenance } from '../capability/capabilityGraph';
import {
  ECU_ROLE_LABEL, roleFromDeclaredName, roleFromStandardAddress,
  type EcuRole,
} from '../ecuRoleModel';
import { decodeDidText } from '../ecuIdentityService';
import { classifyDidProbe, type DidProbeVerdict } from '../identity/earlyIdentityModel';
import {
  HEALING_MAX_REQUESTS, HEALING_MIN_RESERVE_REQUESTS,
} from '../healing/selfHealingTrigger';
import {
  buildEndpointInventory, normalizeAddressBits,
  type EcuEndpoint, type EcuReachability, type MeasuredEcuRecord,
} from './ecuEndpointModel';
import {
  matchVariantPatterns, variantForEndpoint,
  type VariantMatchFacts, type VariantMatchResult,
} from './ecuVariantMatch';
import {
  mergeWithLearnedRole, resolveEcuRole,
  type EcuRoleConfidence, type EcuRoleEvidenceItem, type EcuRoleResolution,
} from './ecuRoleEvidenceModel';
import { learnedRoleEvidence, recordEcuRole, type EcuRoleWriteOutcome } from './ecuRoleStore';

/* ══════════════════════════════════════════════════════════════════════════
   1) SORULACAK DID'LER — ROL-BAĞIMSIZ, SALT-OKUNUR, HEPSİ STANDART
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Uç noktaya sorulacak kimlik DID'leri.
 *
 * ⚠️ **ROL-BAĞIMSIZDIR (görev §12):** bir uç noktanın ne olduğunu bilmeden
 * ona ancak "kendini tanıt" denebilir. Listedeki dördü de ISO 14229-1 Tablo
 * C.1 kimlik tanımlayıcılarıdır ve **hepsi bu repoda ZATEN okunuyordu**
 * (`ecuIdentityService` F197/F18C/F191 · `oemProfileRegistry` F187).
 * Sihirli OEM DID'i EKLENMEDİ.
 *
 * SIRA KİMLİK KARARLILIĞI İÇİNDİR: `F197` (sistem adı) rol kanıtı üretebilen
 * TEK giriştir ve önce sorulur; diğer üçü parmak izi/varyant kanıtıdır.
 */
export interface IdentityDidSpec {
  readonly did: string;
  readonly name: string;
  readonly reference: string;
  /** Bu DID'in yanıtı ROL kanıtı üretebilir mi (yalnız sistem adı). */
  readonly roleBearing: boolean;
}

export const ENDPOINT_IDENTITY_DIDS: readonly IdentityDidSpec[] = Object.freeze([
  { did: 'F197', name: 'Sistem adı / motor tipi', roleBearing: true,
    reference: 'ISO 14229-1 · SystemNameOrEngineTypeDataIdentifier' },
  { did: 'F18C', name: 'ECU seri numarası', roleBearing: false,
    reference: 'ISO 14229-1 · ECUSerialNumberDataIdentifier' },
  { did: 'F191', name: 'ECU donanım numarası', roleBearing: false,
    reference: 'ISO 14229-1 · vehicleManufacturerECUHardwareNumberDataIdentifier' },
  { did: 'F187', name: 'Yedek parça numarası', roleBearing: false,
    reference: 'ISO 14229-1 · vehicleManufacturerSparePartNumberDataIdentifier' },
] as const);

/** CDDL 0x22 servis tanımının kimliği (`legacyAdapter.serviceDefIdFor('22')`). */
const DID_SERVICE_DEF_ID = 'uds_read_data_by_identifier';

/* ══════════════════════════════════════════════════════════════════════════
   2) BÜTÇE — F1-A'nın KALANINDAN PAY (görev §17)
   ══════════════════════════════════════════════════════════════════════════ */

/** Kimlik çözümü, sahibi işlemin KALAN bütçesinin en çok bu oranını alır. */
export const IDENTITY_BUDGET_SHARE = 0.25;
/** Tek turda harcanabilecek MUTLAK istek tavanı. */
export const IDENTITY_MAX_REQUESTS = 16;
/** Bir turda en çok kaç uç nokta kimliklenir — sınırsız keşif bir DoS'tur. */
export const IDENTITY_MAX_ENDPOINTS = 8;
/** Uç nokta başına azami DID yoklaması. */
export const IDENTITY_MAX_DIDS_PER_ENDPOINT = ENDPOINT_IDENTITY_DIDS.length;
/**
 * Kimlik çözümünün DOKUNAMAYACAĞI rezerv — `productionDiscovery` ile AYNI
 * türetme: Self-Healing kendi payını her hâlükârda alabilmelidir.
 */
export const IDENTITY_MIN_RESERVE_REQUESTS =
  HEALING_MIN_RESERVE_REQUESTS + HEALING_MAX_REQUESTS;

export type IdentityAdmission = 'RUN' | 'DEFERRED' | 'BLOCKED';

export const IDENTITY_ADMISSION_LABEL: Readonly<Record<IdentityAdmission, string>> = {
  RUN:      'ÇALIŞTI — kimlik ölçüldü',
  DEFERRED: 'ERTELENDİ — bütçe/öncelik (kullanıcı tanısı önce)',
  BLOCKED:  'ENGELLENDİ — yapısal ön koşul YOK',
} as const;

export interface IdentityAdmissionInput {
  readonly admission: DiagnosticAdmission;
  readonly transactionLive: boolean;
  readonly cancelled: boolean;
  readonly staleEpoch: boolean;
  readonly remainingRequests: number;
  readonly protocolKnown: boolean;
  readonly genericBridgeAvailable: boolean;
  readonly endpointCount: number;
  readonly didServiceDefAvailable: boolean;
}

export interface IdentityAdmissionDecision {
  readonly admission: IdentityAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
}

const NO_ALLOC = { allocatedRequests: 0 } as const;

/**
 * Kimlik çözümü ŞİMDİ koşabilir mi — SAF, FAIL-CLOSED.
 *
 * Hiçbir dal araç hakkında hüküm üretmez: reddedilen bir tur "bu ECU'nun rolü
 * yok" DEMEZ, "ölçemedik" der.
 */
export function evaluateIdentityAdmission(
  i: IdentityAdmissionInput,
): IdentityAdmissionDecision {
  if (i.admission !== 'READY') {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: `tanı admisyonu READY değil: ${i.admission}` };
  }
  if (i.cancelled) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem iptal edildi' };
  }
  if (i.staleEpoch) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'OBD oturum mührü ölçülemedi — ölçüm başka araca yazılamaz' };
  }
  if (!i.transactionLive) {
    return { admission: 'BLOCKED', ...NO_ALLOC, reason: 'işlem canlı değil' };
  }
  if (!i.protocolKnown) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'aktif protokol ÖLÇÜLMEDİ — hangi tanımın geçerli olduğu bilinemez' };
  }
  if (!i.genericBridgeAvailable) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'genel salt-okunur PDU köprüsü YOK (eski APK) — araç kararı DEĞİL' };
  }
  if (i.endpointCount === 0) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'ölçülmüş uç nokta YOK — adres uydurulmaz' };
  }
  if (!i.didServiceDefAvailable) {
    return { admission: 'BLOCKED', ...NO_ALLOC,
      reason: 'güvenli CDDL 0x22 tanımı yok — kör istek kurulmaz' };
  }
  if (i.remainingRequests < IDENTITY_MIN_RESERVE_REQUESTS) {
    return { admission: 'DEFERRED', ...NO_ALLOC,
      reason: `kalan istek (${i.remainingRequests}) rezervin `
        + `(${IDENTITY_MIN_RESERVE_REQUESTS} = Self-Healing rezervi + payı) altında` };
  }
  const share = Math.min(
    IDENTITY_MAX_REQUESTS, Math.floor(i.remainingRequests * IDENTITY_BUDGET_SHARE));
  if (share < 1) {
    return { admission: 'DEFERRED', ...NO_ALLOC,
      reason: `pay (${share}) tek bir kimlik okumasını karşılamıyor` };
  }
  return {
    admission: 'RUN', allocatedRequests: share,
    reason: `kalan ${i.remainingRequests} istekten ${share} pay ayrıldı · `
      + `${i.endpointCount} ölçülmüş uç nokta`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   3) KANONİK ECU ENVANTERİ (görev §21)
   ══════════════════════════════════════════════════════════════════════════ */

/** Tek bir DID okumasının kanıt satırı — **HAM DEĞER TAŞIMAZ**. */
export interface IdentityProbeRow {
  readonly did: string;
  readonly request: string | null;
  readonly verdict: DidProbeVerdict;
  readonly nrc: number | null;
  readonly latencyMs: number | null;
  /** Yanıt gövdesinin hex hane sayısı — İÇERİK DEĞİL, yalnız ölçü. */
  readonly valueHexLength: number;
  readonly sent: boolean;
}

/**
 * KANONİK ECU KAYDI.
 *
 * Ölçülmeyen her alan `null`dur (sahte `0` · sahte tarih · sahte rol YASAK).
 */
export interface CanonicalEcuRecord {
  readonly endpointKey: string;
  readonly txHeader: string;
  readonly rxHeader: string;
  readonly addressing: EcuEndpoint['addressing'];
  readonly protocol: string | null;
  readonly reachability: EcuReachability;
  readonly endpointSource: EcuEndpoint['source'];
  /** F4-C ECU parmak izi; kurulamadıysa `null`. */
  readonly ecuFingerprint: EcuFingerprint | null;
  readonly role: EcuRole;
  readonly roleConfidence: EcuRoleConfidence;
  readonly roleReason: string;
  readonly roleEvidence: readonly EcuRoleEvidenceItem[];
  readonly conflictingRoles: readonly EcuRole[];
  /** Bu uç noktada GERÇEKTEN yapılan kimlik okumaları. */
  readonly identityProbes: readonly IdentityProbeRow[];
  /** ÖLÇÜLMÜŞ salt-okunur servis sonuçları (yetenek imzası girdisi). */
  readonly servicesMeasured: Readonly<Record<string, string | null>>;
  /** Öğrenmeden mi geldi (bu turda yeniden ölçülemedi). */
  readonly reusedFromLearning: boolean;
  /**
   * Bu kayıt ÜRÜN kararı üretebilir mi (YALNIZ canlı ölçüm).
   *
   * ⚠️ Rol replay/sentetik koşuda da AYNI motorla ve AYNI deterministik
   * sonuçla hesaplanır (parite ölçülebilsin diye) — ama `false` olduğunda
   * öğrenmeye YAZILMAZ ve ürün gerçeği SAYILMAZ (görev §15).
   */
  readonly productTrusted: boolean;
  readonly roleWrite: EcuRoleWriteOutcome | null;
  readonly lastSeenMs: number | null;
  readonly provenance: CapabilityProvenance;
  /** Sahibi araç referansı (F4-C araç parmak izi); yoksa `null`. */
  readonly vehicleFingerprint: string | null;
  /** Rol yükselmediyse NEDEN — sessiz "bilinmiyor" YASAK. */
  readonly unresolvedReason: string | null;
}

export interface EcuIdentityRunEvidence {
  readonly admission: IdentityAdmission;
  readonly reason: string;
  readonly allocatedRequests: number;
  readonly usedRequests: number | null;
  readonly endpointsSeen: number;
  readonly endpointsProbed: number | null;
  readonly variantMatch: VariantMatchResult | null;
  readonly records: readonly CanonicalEcuRecord[];
  readonly sessionEpoch: number;
  readonly atMs: number | null;
}

export const MAX_IDENTITY_EVIDENCE = 8;

let _evidence: EcuIdentityRunEvidence[] = [];

export function getEcuIdentityRuns(): readonly EcuIdentityRunEvidence[] {
  try { return [..._evidence]; } catch { return []; }
}
export function getLastEcuIdentityRun(): EcuIdentityRunEvidence | null {
  return _evidence.length === 0 ? null : _evidence[_evidence.length - 1]!;
}
/** Kimlik çözümü HİÇ değerlendirildi mi — `0` ile KARIŞTIRILMAZ. */
export function ecuIdentityEverEvaluated(): boolean { return _evidence.length > 0; }
/** Son turun kanonik envanteri; hiç koşmadıysa `null` (boş dizi DEĞİL). */
export function getCanonicalEcuInventory(): readonly CanonicalEcuRecord[] | null {
  const last = getLastEcuIdentityRun();
  return last === null ? null : last.records;
}
/** @internal — testler arası izolasyon. */
export function _resetEcuIdentityResolverForTest(): void { _evidence = []; }

function _record(e: EcuIdentityRunEvidence): void {
  try {
    _evidence.push(e);
    if (_evidence.length > MAX_IDENTITY_EVIDENCE) _evidence.shift();
  } catch { /* kanıt kaydı ASLA taramayı düşürmez */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   4) ROL-BAĞIMSIZ HEDEF KURULUMU
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ÖLÇÜLMÜŞ bir uç noktadan CDDL hedefi kurar — **rol SORULMADAN**.
 *
 * ⚠️ `healingTargetFromProvenEcu` ile BİLİNÇLİ OLARAK AYRIDIR: o, Self-Healing
 * için ölçülmüş bir ROL ister (`MEASURABLE_ROLES`) ve öyle kalmalıdır —
 * iyileştirme rol-özel bir iştir. Bu ise **rol-bağımsız, salt-okunur** keşif
 * hedefidir (görev §11/§12): rolü bilinmeyen bir uç nokta artık çöpe atılmaz,
 * ama ona yalnız "kendini tanıt" ve "bu servisi destekliyor musun" sorulabilir.
 *
 * `null` döner: adres türetilememişse (uydurma adrese istek YASAK).
 */
export function endpointTargetFromEcu(
  ep: EcuEndpoint, serviceRefs: readonly string[],
): EcuVariant | null {
  if (!ep.addressable) return null;
  if (serviceRefs.length === 0) return null;
  return {
    id: `endpoint.${ep.key}`,
    name: `Uç nokta ${ep.rxHeader}`,
    /* Rol UYDURULMAZ. `EcuVariant.role` artık `unknown` taşıyabilir; belge
       düzeyindeki yasak `cddl/validate.ROLE_UNKNOWN_FORBIDDEN` ile DURUYOR —
       yani bir PROFİL hâlâ rolsüz adres tanımlayamaz, ama bir ÖLÇÜM edebilir. */
    role: 'unknown',
    addressing: ep.addressing,
    txHeader: ep.txHeader,
    rxHeader: ep.rxHeader,
    kwpTarget: ep.addressBits === 8
      ? (ep.kwpTargetVerified === true ? ep.txHeader : 'UNKNOWN') : null,
    session: 'default',
    serviceRefs: [...serviceRefs],
    provenance: {
      /* Sözlük MEVCUT `CddlSource`tur: araçtan ÖLÇÜLEREK türetilmiş tanım
         `learned`dır. Paralel bir değer (`measured`) uydurmak, künyeyi
         `CDDL_SOURCE_LABEL` ve `checkProvenance` kapılarının tanımadığı bir
         şeye çevirirdi. */
      source: 'learned',
      reference: `endpoint:${ep.source}`,
      license: 'ölçüm — telif yok',
      verifiedOn: null,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) ÜRÜN YOLU
   ══════════════════════════════════════════════════════════════════════════ */

export interface EcuIdentityContext {
  readonly admission: DiagnosticAdmission;
  /** Taramanın ÖLÇTÜĞÜ ECU kayıtları (kör tarama YOK). */
  readonly ecus: readonly MeasuredEcuRecord[];
  readonly defs: readonly ServiceDef[];
  /** CDDL varyant desenleri (F3-B) — boşsa desen ekseni ÖLÇÜLMEZ. */
  readonly patterns: readonly VariantPattern[];
  readonly variants: readonly EcuVariant[];
  readonly protocol: string | null;
  readonly protocolClass: ProtocolClassName | 'unknown' | null;
  /** ÖLÇÜLMÜŞ VIN (desen ekseni için); okunmadıysa `null`. */
  readonly vin: string | null;
  /** ECU başına ÖLÇÜLMÜŞ servis sonuçları (yetenek imzası). */
  readonly serviceStatuses: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  /** F4-C araç parmak izi; `null` = öğrenme OKUNMAZ ve YAZILMAZ. */
  readonly vehicleRef: string | null;
  readonly provenance: CapabilityProvenance;
  readonly nowMs: number | null;
}

function _traceProbe(
  txn: DiagnosticTransaction, ep: EcuEndpoint, spec: IdentityDidSpec,
  request: string | null, verdict: DidProbeVerdict,
  nrc: number | null, latencyMs: number | null,
): void {
  try {
    recordTraceEvent({
      transactionId: txn.transactionId,
      evidenceCorrelationId: `ecu-identity:${ep.key}:${spec.did}`,
      sessionEpoch: txn.sessionEpoch,
      ecuTxHeader: ep.txHeader.length === 0 ? null : ep.txHeader,
      ecuRxHeader: ep.rxHeader.length === 0 ? null : ep.rxHeader,
      ecuLabel: `Uç nokta ${ep.rxHeader}`,
      protocol: ep.protocol,
      transport: 'unknown',
      direction: 'request_response',
      operation: 'did_read',
      subFunction: null,
      rawRequest: request,
      /* HAM GÖVDE TAŞINMAZ: kimlik DID'i seri/parça numarası döndürür ve dışa
         aktarılan izde yer alamaz (F5-H ile AYNI gizlilik kararı). */
      rawResponse: null,
      transportOutcome: verdict,
      nrc, latencyMs,
      byteCount: null, frameCount: null,
      sessionLeaseRef: null, adapterKind: null, isoTpTuningRef: null,
      redactionState: 'REDACTED',
    });
  } catch (e) { logError('OBD:EcuIdentityTrace', e); }
}

/** Ölçülen servis sonuçlarından ECU yanıt imzası (F4-C ekseni). */
function _signature(st: Readonly<Record<string, string | null>> | undefined): string | null {
  if (st === undefined) return null;
  const parts: string[] = [];
  for (const k of Object.keys(st).sort()) {
    const v = st[k];
    if (v === null || v === undefined) continue;   // sorulmadı → imzaya girmez
    parts.push(`${k}:${v}`);
  }
  return parts.length === 0 ? null : parts.join('|');
}

/**
 * Uç noktaların kimliğini çözer ve KANONİK ENVANTERİ üretir.
 *
 * SIRA (pazarlıksız):
 *   1. Ölçülmüş kayıtlar kanonik uç noktalara çevrilir (rol OKUNMADAN).
 *   2. Admisyon SORULUR; `RUN` değilse hatta tek bayt çıkmaz.
 *   3. CDDL varyant desenleri ÖLÇÜLMÜŞ gerçeklere karşı değerlendirilir.
 *   4. Her uç noktada rol-bağımsız kimlik DID'leri sırayla okunur (bütçeli).
 *   5. Kanıtlar toplanır → F4-C ECU parmak izi → `resolveEcuRole`.
 *   6. Öğrenilmiş rol yalnız ölçüm KAYBINDA devreye girer (PROVEN düşmez).
 *   7. Eyleme geçirilebilir rol araç bölümüne yazılır; çelişki SİLER.
 *
 * ASLA throw etmez.
 */
export async function resolveEcuIdentities(
  txn: DiagnosticTransaction | null, ctx: EcuIdentityContext,
): Promise<EcuIdentityRunEvidence> {
  const epoch = txn?.sessionEpoch ?? -1;
  const endpoints = buildEndpointInventory(ctx.ecus, ctx.protocol);
  const def = ctx.defs.find((d) => d.id === DID_SERVICE_DEF_ID) ?? null;

  const live = txn !== null && isTransactionLive(txn);
  const remaining = txn === null ? 0 : Math.max(0, txn.requestBudget - txn.requestsUsed);

  const decision = evaluateIdentityAdmission({
    admission: ctx.admission,
    transactionLive: live,
    cancelled: txn?.cancelled === true,
    staleEpoch: txn !== null && txn.sessionEpoch === -1,
    remainingRequests: remaining,
    protocolKnown: (ctx.protocolClass ?? null) !== null && ctx.protocolClass !== 'unknown',
    genericBridgeAvailable: _safeBridge(),
    endpointCount: endpoints.length,
    didServiceDefAvailable: def !== null,
  });

  /* ── DESEN EŞLEŞMESİ — ölçülmüş gerçeklere karşı, hatta istek YOK ────── */
  let variantMatch: VariantMatchResult | null = null;
  const didResponses: Record<string, string> = {};

  if (decision.admission !== 'RUN' || txn === null || def === null) {
    /* Ölçüm yapılmadı ama envanter yine ÜRETİLİR: uç noktalar ÖLÇÜLDÜ ve
       rolsüz de olsa kayıptan kurtarılır (görev §11). */
    const records = endpoints.map((ep) => _unprobedRecord(ep, ctx, decision.reason));
    const ev: EcuIdentityRunEvidence = {
      admission: decision.admission, reason: decision.reason,
      allocatedRequests: decision.allocatedRequests,
      usedRequests: null, endpointsSeen: endpoints.length, endpointsProbed: null,
      variantMatch: null, records: Object.freeze(records),
      sessionEpoch: epoch, atMs: ctx.nowMs,
    };
    _record(ev);
    return ev;
  }

  const requestsAtStart = txn.requestsUsed;
  const targets = endpoints.slice(0, IDENTITY_MAX_ENDPOINTS);
  const records: CanonicalEcuRecord[] = [];
  let probed = 0;

  let processed = 0;
  for (const ep of targets) {
    if (!isTransactionLive(txn) || !hasRequestBudget(txn)) break;
    if ((txn.requestsUsed - requestsAtStart) >= decision.allocatedRequests) break;
    processed++;

    const target = endpointTargetFromEcu(ep, [DID_SERVICE_DEF_ID]);
    if (target === null) {
      records.push(_unprobedRecord(ep, ctx,
        'uç nokta adresi türetilemedi — uydurma adrese istek GÖNDERİLMEZ'));
      continue;
    }

    const probes: IdentityProbeRow[] = [];
    let declaredName: string | null = null;
    let calibrationDid: string | null = null;
    let calibrationHash: string | null = null;

    for (const spec of ENDPOINT_IDENTITY_DIDS.slice(0, IDENTITY_MAX_DIDS_PER_ENDPOINT)) {
      if (!isTransactionLive(txn) || !hasRequestBudget(txn)) break;
      if ((txn.requestsUsed - requestsAtStart) >= decision.allocatedRequests) break;

      let row: IdentityProbeRow;
      try {
        const r = await readByServiceDef({
          service: def, ecu: target, argument: spec.did,
          protocol: ctx.protocol, protocolClass: ctx.protocolClass, txn,
          targetVerified: true, ecuKey: ep.rxHeader, sessionEpoch: txn.sessionEpoch,
        });
        if (!r.sent || r.response === null) {
          probes.push({ did: spec.did, request: r.request, verdict: 'NOT_CARRIED',
            nrc: null, latencyMs: null, valueHexLength: 0, sent: false });
          break;                                    // istek gitmedi → tur biter
        }
        const clean = (r.response.raw ?? '').replace(/[^0-9A-Fa-f]/g, '');
        const verdict = classifyDidProbe(r.response.outcome, r.response.nrc, clean.length);
        row = { did: spec.did, request: r.request, verdict,
          nrc: r.response.nrc, latencyMs: r.response.latencyMs,
          valueHexLength: clean.length, sent: true };
        probes.push(row);
        _traceProbe(txn, ep, spec, r.request, verdict,
          r.response.nrc, r.response.latencyMs);

        if (verdict === 'MEASURED') {
          if (spec.roleBearing) declaredName = decodeDidText(clean);
          else if (calibrationDid === null) {
            calibrationDid = spec.did;
            calibrationHash = clean;               // yalnız parmak izi girdisi
          }
          /* Desen ekseni ÖLÇÜLMÜŞ yanıtı görmeli (VariantEvidence.did_response). */
          didResponses[spec.did] = clean;
          /* ── ERKEN ÇIKIŞ: kimlik ekseni DOLDU ────────────────────────────
             Rol kanıtı (F197) ayrı bir eksendir ve her hâlükârda sorulur;
             ama parmak izi ekseni için TEK ölçülmüş kimlik DID'i yeterlidir.
             Kalanları sormak, bütçeyi hiçbir yeni kanıt üretmeden harcamak
             olurdu (görev §17/§18: bilgi kazancı olmayan istek gönderilmez). */
          if (!spec.roleBearing) break;
        }
        /* ── DEVAM KURALI (F5-H kimlik kararlılığı dersi) ──────────────────
           Yalnız DETERMİNİSTİK sonuçlar bir sonraki adaya geçirir:
           `MEASURED` (kanıt alındı) ve `NOT_SUPPORTED` (ECU "bende yok" dedi).
           Sessizlik · zaman aşımı · oturum/koşul NRC'si ölçüm KAYBIDIR ve bu
           uç noktanın turunu BİTİRİR — aksi hâlde aynı ECU bir turda F18C,
           başka turda F191 ile parmaklanıp kimliği KAYARDI. */
        if (verdict !== 'MEASURED' && verdict !== 'NOT_SUPPORTED') break;
      } catch (e) {
        logError('OBD:EcuIdentityProbe', e);
        break;
      }
    }
    probed++;

    /* ── KANITLAR ──────────────────────────────────────────────────────── */
    const evidence: EcuRoleEvidenceItem[] = [];

    const std = roleFromStandardAddress(ep.rxHeader, ep.addressBits);
    if (std !== null && std !== 'unknown') {
      evidence.push({
        kind: 'STANDARD_ADDRESS_ROLE', role: std,
        detail: `${ep.rxHeader} için standardın KENDİ garantisi (adres tahmini DEĞİL).`,
        source: `standard:${ep.rxHeader}`, observedAt: ctx.nowMs,
        provenance: ctx.provenance,
      });
    }

    const declaredRole = roleFromDeclaredName(declaredName);
    if (declaredRole !== null && declaredRole !== 'unknown') {
      evidence.push({
        kind: 'IDENTITY_DID', role: declaredRole,
        detail: `ECU kendini "${(declaredName ?? '').trim()}" olarak tanıttı (F197).`,
        source: 'did:F197', observedAt: ctx.nowMs, provenance: ctx.provenance,
      });
    }

    /* ── ECU PARMAK İZİ — F4-C otoritesi (yeniden hesaplanmaz) ─────────── */
    let fp: EcuFingerprint | null = null;
    try {
      fp = buildEcuFingerprint({
        txHeader: ep.txHeader.length === 0 ? null : ep.txHeader,
        rxHeader: ep.rxHeader.length === 0 ? null : ep.rxHeader,
        protocol: ep.protocol,
        responseSignature: _signature(ctx.serviceStatuses[ep.rxHeader]),
        calibrationDid,
        /* Ham değer parmak izine GİRMEZ: F4-C zaten karma bekler. */
        calibrationValueHash: calibrationHash === null ? null
          : `LEN${calibrationHash.length}:${calibrationHash.slice(0, 8)}`,
      });
    } catch (e) { logError('OBD:EcuIdentityFingerprint', e); }

    /* ── ÖĞRENİLMİŞ ROL — yalnız AYNI araç bölümünden, AYNI parmak iziyle ── */
    let learned: EcuRoleEvidenceItem | null = null;
    if (fp !== null && ctx.vehicleRef !== null) {
      learned = learnedRoleEvidence(fp.id);
      if (learned !== null) evidence.push(learned);
    }

    records.push(_buildRecord(ep, ctx, {
      fp, evidence, probes,
      learnedUsed: learned !== null,
    }));
  }

  /* ── HİÇBİR UÇ NOKTA KAYBOLMAZ ─────────────────────────────────────────
     İki ayrı kırpma vardır ve İKİSİ DE envanterde görünür:
      (a) bütçe/iptal turu erken bitirdi → sorulmamış HEDEFLER,
      (b) uç nokta tavanı aşıldı → hedef listesine hiç girmeyenler.
     Sessiz kırpma, "o ECU'da rol yok" gibi okunacak bir yalandır. */
  for (const ep of targets.slice(processed)) {
    records.push(_unprobedRecord(ep, ctx,
      'bütçe/iptal turu erken bitirdi — YARIM KALDI, "rol yok" DEĞİL'));
  }
  for (const ep of endpoints.slice(targets.length)) {
    records.push(_unprobedRecord(ep, ctx,
      `uç nokta tavanı (${IDENTITY_MAX_ENDPOINTS}) — YARIM KALDI, "rol yok" DEĞİL`));
  }

  /* ── DESEN EŞLEŞMESİ (ölçümden SONRA: DID yanıtları artık elimizde) ──── */
  const facts: VariantMatchFacts = {
    vin: ctx.vin,
    protocolClass: ctx.protocolClass ?? null,
    didResponses,
    respondedTx: endpoints.map((e) => e.txHeader),
  };
  try { variantMatch = matchVariantPatterns(ctx.patterns, facts); }
  catch (e) { logError('OBD:EcuVariantMatch', e); variantMatch = null; }

  const finalRecords = _applyVariantEvidence(records, ctx, variantMatch);

  const ev: EcuIdentityRunEvidence = {
    admission: 'RUN', reason: decision.reason,
    allocatedRequests: decision.allocatedRequests,
    usedRequests: txn.requestsUsed - requestsAtStart,
    endpointsSeen: endpoints.length,
    endpointsProbed: probed,
    variantMatch,
    records: Object.freeze(finalRecords),
    sessionEpoch: epoch, atMs: ctx.nowMs,
  };
  _record(ev);
  return ev;
}

function _safeBridge(): boolean {
  try { return genericBridgeAvailable(); } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════════════
   6) KAYIT KURULUMU
   ══════════════════════════════════════════════════════════════════════════ */

function _unprobedRecord(
  ep: EcuEndpoint, ctx: EcuIdentityContext, reason: string,
): CanonicalEcuRecord {
  return {
    endpointKey: ep.key, txHeader: ep.txHeader, rxHeader: ep.rxHeader,
    addressing: ep.addressing, protocol: ep.protocol,
    reachability: ep.reachability, endpointSource: ep.source,
    ecuFingerprint: null,
    role: 'unknown', roleConfidence: 'UNKNOWN',
    roleReason: 'Uç nokta ÖLÇÜLDÜ ama kimlik sorulmadı — rol UYDURULMADI.',
    roleEvidence: Object.freeze([]), conflictingRoles: Object.freeze([]),
    identityProbes: Object.freeze([]),
    servicesMeasured: ctx.serviceStatuses[ep.rxHeader] ?? {},
    reusedFromLearning: false,
    productTrusted: isProductTrusted(ctx.provenance),
    roleWrite: null,
    lastSeenMs: ctx.nowMs, provenance: ctx.provenance,
    vehicleFingerprint: ctx.vehicleRef,
    unresolvedReason: reason,
  };
}

function _buildRecord(
  ep: EcuEndpoint, ctx: EcuIdentityContext,
  d: {
    fp: EcuFingerprint | null;
    evidence: readonly EcuRoleEvidenceItem[];
    probes: readonly IdentityProbeRow[];
    learnedUsed: boolean;
  },
): CanonicalEcuRecord {
  /* ⚠️ `productTrustedOnly: false` BİLİNÇLİDİR: rol replay koşusunda da
     hesaplanmalıdır ki determinizm/parite ÖLÇÜLEBİLSİN. Güven kapısı ayrı bir
     eksendedir (`productTrusted`) ve yazma yolunda (`recordEcuRole`) uygulanır. */
  const fresh = resolveEcuRole(d.evidence.filter((e) => e.kind !== 'LEARNED_CONFIRMED'),
    { productTrustedOnly: false });
  const learnedOnly = d.evidence.filter((e) => e.kind === 'LEARNED_CONFIRMED');
  const learnedRes: EcuRoleResolution | null = learnedOnly.length === 0 ? null
    : resolveEcuRole(learnedOnly, { productTrustedOnly: false });

  /* Ölçüm KAYBI kanıtlanmış rolü DÜŞÜRMEZ (görev §15). */
  const merged = mergeWithLearnedRole(fresh, learnedRes);

  return {
    endpointKey: ep.key, txHeader: ep.txHeader, rxHeader: ep.rxHeader,
    addressing: ep.addressing, protocol: ep.protocol,
    reachability: ep.reachability, endpointSource: ep.source,
    ecuFingerprint: d.fp,
    role: merged.role, roleConfidence: merged.confidence,
    roleReason: merged.reason, roleEvidence: merged.evidence,
    conflictingRoles: merged.conflictingRoles,
    identityProbes: Object.freeze([...d.probes]),
    servicesMeasured: ctx.serviceStatuses[ep.rxHeader] ?? {},
    reusedFromLearning: merged !== fresh && d.learnedUsed,
    productTrusted: isProductTrusted(ctx.provenance),
    roleWrite: null,
    lastSeenMs: ctx.nowMs, provenance: ctx.provenance,
    vehicleFingerprint: ctx.vehicleRef,
    unresolvedReason: merged.confidence === 'UNKNOWN' || merged.confidence === 'CONFLICT'
      ? merged.reason : null,
  };
}

/**
 * Desen eşleşmesini kayıtlara KANIT olarak ekler ve rolü YENİDEN çözer.
 *
 * `AMBIGUOUS`/`NO_MATCH` durumunda hiçbir kanıt eklenmez — belirsiz bir desen
 * rol yükseltmez (görev §14).
 */
function _applyVariantEvidence(
  records: readonly CanonicalEcuRecord[], ctx: EcuIdentityContext,
  match: VariantMatchResult | null,
): CanonicalEcuRecord[] {
  const out = records.map((r) => ({ ...r }));
  if (match === null || match.outcome !== 'SINGLE') return _persistRoles(out, ctx);

  const hit = match.matched[0]!;
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!;
    if (r.ecuFingerprint === null) continue;
    let vh;
    try {
      vh = variantForEndpoint(hit, ctx.variants, {
        key: r.endpointKey, txHeader: r.txHeader, rxHeader: r.rxHeader,
        addressBits: normalizeAddressBits(
          r.addressing === 'kwp' ? 8 : r.addressing === 'can29' ? 29 : 11),
        addressing: r.addressing, protocol: r.protocol,
        source: r.endpointSource, reachability: r.reachability,
        txProvenance: 'can_11bit_standard', addressable: true,
        kwpTargetVerified: null,
      });
    } catch (e) { logError('OBD:EcuVariantForEndpoint', e); continue; }

    if (vh.outcome !== 'SINGLE_VARIANT' || vh.variant === null) continue;
    if (vh.variant.role === 'unknown') continue;

    const extra: EcuRoleEvidenceItem = {
      kind: 'VARIANT_PATTERN', role: vh.variant.role,
      detail: vh.reason, source: `pattern:${hit.patternId}`,
      observedAt: ctx.nowMs, provenance: ctx.provenance,
    };
    const re = resolveEcuRole([...r.roleEvidence, extra], { productTrustedOnly: false });
    out[i] = {
      ...r, role: re.role, roleConfidence: re.confidence,
      roleReason: re.reason, roleEvidence: re.evidence,
      conflictingRoles: re.conflictingRoles,
      unresolvedReason: re.confidence === 'UNKNOWN' || re.confidence === 'CONFLICT'
        ? re.reason : null,
    };
  }
  return _persistRoles(out, ctx);
}

/** Eyleme geçirilebilir rolleri ARAÇ BÖLÜMÜNE yazar; çelişki SİLER. */
function _persistRoles(
  records: CanonicalEcuRecord[], ctx: EcuIdentityContext,
): CanonicalEcuRecord[] {
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    if (r.ecuFingerprint === null) continue;
    let write: EcuRoleWriteOutcome | null = null;
    try {
      write = recordEcuRole({
        ecuFingerprint: r.ecuFingerprint.id,
        vehicleRef: ctx.vehicleRef,
        rxHeader: r.rxHeader,
        resolution: {
          role: r.role, confidence: r.roleConfidence,
          evidence: r.roleEvidence, conflictingRoles: r.conflictingRoles,
          reason: r.roleReason,
        },
        provenance: ctx.provenance,
        atMs: ctx.nowMs,
      });
    } catch (e) { logError('OBD:EcuRolePersist', e); }
    records[i] = { ...r, roleWrite: write };
  }
  return records;
}

/** Rol etiketleri LAB/rapor için tek yerden — ikinci sözlük YOK. */
export { ECU_ROLE_LABEL };
