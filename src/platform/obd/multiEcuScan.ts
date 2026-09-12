/**
 * multiEcuScan — Çoklu-ECU tarama orkestrasyonu (OBD-OS-F2-2 · F2-3 · F2-4).
 *
 * Car Scanner farkının somut çıktısı: DTC artık YALNIZ motor ECU'sundan değil, keşfedilen
 * HER ECU'dan okunur ve her kod HANGİ ECU'dan geldiğini taşır (provenance). Bugüne kadar
 * ABS/airbag/şanzıman arızaları basitçe GÖRÜNMÜYORDU — sorulmuyordu bile.
 *
 * ROUTER SÖZLEŞMESİ (F2-2): her istek doğru ECU'ya (tx/rx header) yönlendirilir; native
 * `withEcuHeader` header set → oku → restore'u ATOMİK yapar. Yanlış ECU'ya sızıntı olamaz:
 * bir ECU'nun sonucu yalnız kendi kaydına yazılır (aşağıdaki test bunu kilitler).
 *
 * FAIL-SOFT (F2-4): bir ECU düşerse (timeout/hata) tarama DURMAZ — o ECU 'failed' işaretlenir,
 * diğerleri okunmaya devam eder. Kapsam (coverage) dürüstçe raporlanır: kısmi tarama
 * "temiz" DEMEZ (F0-1/F1-4 ile aynı fail-closed felsefe).
 *
 * BÜTÇE: ECU × mod = sorgu sayısı. Her sorgu ~0.5-4 sn → tavan konur (MAX_SCAN_ECUS).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import {
  vdkAdvancedDtcsFn, vdkDtcFromEcuFn, vdkProbeEcusFn, vdkTransportAvailable, isReplayActive,
} from './vdkTransport';
import { resolveFunctionalDtcSource } from './functionalDtcSource';
import { encodePduRequest, makePdu } from './pdu';
import {
  getFunctionalDtcEvidence, recordFunctionalDtcEvidence,
} from './functionalDtcEvidence';
import { logError } from '../crashLogger';
import { buildTopology, emptyTopology, type DiscoveredEcu, type VehicleTopology } from './ecuDiscovery';
import { scanHintsFor, recordVehicleObservation } from './fleetKbService';
import {
  classifyUdsDtcState, countUdsDtcRecords, formatDtcDisplayCode, parseUdsDtcResponse,
  udsDtcToScanMode, validateUdsDtcResponse,
  type UdsDtc, type UdsDtcState,
} from './udsDtc';
import { countKwpDtcRecords, parseKwpDtcResponse, validateKwpDtcResponse } from './kwpDtc';
import { recordDtcPipelineEntry } from './dtcPipelineAccounting';
import {
  applyLeaseSessionEvidence, closeLeasesForTransaction, openSessionLease,
} from './diagnosticSessionScheduler';
import { canReadUnderLease, leaseDenialReason } from './diagnosticSessionLease';
import {
  classifyTransportOutcome, decideIsoTpTuning, recordIsoTpTuningEvidence,
  type TuningDecision,
} from './isoTpTuningPolicy';
import { getAdapterCapabilities } from './adapterIdentityService';
import { traceFromTransaction, traceTransactionBoundary } from './traceRecorder';
import {
  acceptResponse, addRestoreObligation, beginTransaction, completeTransaction,
  consumeRequest, failTransaction, hasRequestBudget, prepareTransaction,
  prepareTransactionSync, transactionLiveness,
  type DiagnosticTransaction,
} from './diagnosticTransaction';
import { isSlowSerialProtocol, classifyProtocol } from './protocolProfile';
/* P0-VDK-F5B — SELF-HEALING ÜRETİM TETİĞİ.
   İKİNCİ TARAMA/BÜTÇE/OTURUM OTORİTESİ DEĞİL: aynı işlemin KALAN bütçesinden
   pay alır, kararı mevcut admisyon kapısından okur, ölçümü F5-A resolver'ın
   normal VDK zincirinden yaptırır. Buradan native/CarLauncher ÇAĞRILMAZ. */
import {
  maybeRunSelfHealing, healingTargetFromProvenEcu,
} from './healing/selfHealingTrigger';
/* P0-VDK-F5B.1 — üretim taraması ↔ F4-B/F4-C kanıt zinciri. */
import {
  runProductionDiscovery, type DiscoveryEcuInput,
} from './healing/productionDiscovery';
import { getGapRegistry, recordGap } from './gapRegistry';
/* P0-VDK-F6D — kapsam boşluğu → MEVCUT sicil köprüsü (SAF çevirici;
   yeni sicil/zamanlayıcı/çözücü DEĞİL). */
import {
  coverageOutcomeFromHealing, parseCoverageContext, planCoverageGaps,
  planFunctionalAttributionGaps,
  type CoverageGapEndpointInput, type FunctionalAttributionInput,
} from './healing/dtcCoverageGapBridge';
import { getGapStates } from './healing/gapResolverRuntime';
/* P0-VDK-F6C — ürün-güvenilirlik kuralı F4-C'de; kopyalanmaz. */
import { isProductTrusted } from './capability/capabilityGraph';
/* P0-VDK-F6E — kapsam ölçümü ↔ MEVCUT F4-C öğrenmesi (SAF çevirici).
   Yeni öğrenme motoru/deposu/otoritesi DEĞİL. */
import {
  learnedCoverageSkips, mergeMeasuredAndLearned, planCoverageLearningWrites,
  type CoverageLearningEndpoint,
} from './capability/coverageLearning';
import {
  getVehicleCapabilities, recordCapabilityObservation,
} from './capability/capabilityStore';
import { getCapabilityScope } from './capability/capabilityStore';
import {
  builtinServiceDefs, extraReadOnlyServiceDefs, cddlDocumentFromLegacy,
} from './cddl/legacyAdapter';
/* P0-VDK-F6A — uç nokta kimlik/rol çözümü. Yeni tarayıcı DEĞİL: uç nokta
   listesi bu dosyanın ÖLÇTÜĞÜ topolojidir. */
import { resolveEcuIdentities } from './ecu/ecuIdentityResolver';
import { getProductOemProfiles } from './oem/oemProfileRegistry';
import { getHandshakeVin } from '../safety/vinContext';
import { genericBridgeAvailable, GENERIC_UDS_19_SUBS } from './genericPduTransport';
import {
  ecuFromPhysicalProbe, isEcuPresenceEvidence, planPhysicalProbes,
  recordPhysicalProbe, recordPhysicalProbeSkipped, rxForPhysicalTx,
  /* B7 — sessiz adres eleme merdiveni (mevcut prob otoritesinin içinde). */
  noteProbeOutcome, recordSuppressedProbes, MAX_PHYSICAL_PROBES,
  type PhysicalProbeResult,
} from './physicalEcuProbe';
import { getHandshakeDiagnostics } from '../obdService';
import { getDtcEvidence, recordDtcEvidence } from './dtcScanEvidence';
import {
  getDtcAuthoritySnapshot, recordDtcObservation, recordDtcServiceScan,
  type DtcObservationClass, type DtcScanOutcome, type DtcSourceService,
} from './dtcAuthority';
import { lookupEcuIdentity } from './ecuIdentityService';
import type { EcuRole, EcuRoleEvidence } from './ecuRoleModel';
import { getObdSessionEpoch } from '../obdService';
import {
  buildEcuCompleteness, ecuCoverageKey,
  type DiagnosticEndpointInput, type EcuCompletenessEvidence,
} from './ecuCompleteness';
import {
  extendedDataReference, getAdvancedDtcEvidence, normalizeAdvancedOutcome, parseSnapshotIdentification,
  parseStatusAvailability, recordAdvancedDtcEvidence,
  type AdvancedDtcOutcome,
} from './advancedDtcEvidence';
import { getDiagnosticAdmissionSync } from './diagnosticAdmission';
/* P0-VDK-F6B — KAPSAM PLANI VE DÜRÜSTLÜK SINIFI.
   Yeni tarayıcı/otorite DEĞİL: plan SAF bir karardır, bütçe hakkı yine
   `consumeRequest`ten, güvenlik izni yine native kapının TS aynasından gelir. */
import {
  DTC_COVERAGE_CLASS_SPECS, compareDeclaredRecordCount, coverageGapRoot,
  coverageOutcomeFromAdvanced, coverageOutcomeFromSkip, planEcuDtcCoverage,
  planStatusMask, rollupEcuDtcCoverage,
  type CoverageRollupRow, type DeclaredCountVerdict, type DtcCoverageClass,
  type DtcCoverageOutcome, type DtcCoveragePlanStep, type StatusMaskProvenance,
} from './dtcCoveragePlan';
import {
  NRC_SERVICE_NOT_SUPPORTED, type ServicePresence,
} from './ecuCapabilityModel';
import {
  getDtcCoverageEvidence, recordDtcCoverage,
  type DtcCoverageEcuEntry, type DtcCoverageRow,
} from './dtcCoverageEvidence';
import {
  addressabilityFromOutcome, getEcuObservations, mergeAddressability, recordEcuObservation,
  type EcuAddressability, type EcuServiceAttempt,
} from './ecuAddressability';
import {
  KWP_SESSION_COMMANDS, classifyKwpSessionResponse, getKwpSessionProbes,
  recordKwpSessionProbe, summarizeKwpSession,
  type KwpSessionVerdict,
} from './kwpSessionProbe';
import {
  KWP_ADDRESSING_VARIANTS, KWP_ADDRESSING_MAX_VARIANTS,
  classifyKwpAddressingResponse, ecuSourceFromRxHeader, getKwpAddressingProbes,
  recordKwpAddressingProbe, resolveVariantHeader, summarizeKwpAddressing,
  type KwpAddressingVerdict,
} from './kwpAddressingProbe';
import type { DtcReadOutcome } from './dtcScanEvidence';

/** Taranacak azami ECU sayısı — tarama süresi bütçesi (ECU × 3 mod × ~2 sn). */
export const MAX_SCAN_ECUS = 8;

/** KWP 0x18 yalnız yavaş seri protokol + açık fiziksel target/session kanıtında gönderilir. */
export function isKwpDtcAddressable(ecu: DiscoveredEcu, protocol: string | null): boolean {
  return isSlowSerialProtocol(protocol) && ecu.kwpTargetVerified === true;
}

/**
 * P0-OBD-08 — bir ECU'nun kimlik alanlarını üretir (DTC etiketleme için TEK yer).
 *
 * Envanter yoksa ya da BAYATSA hiçbir alan yazılmaz: bayat bir rolü koda
 * yapıştırmak, başka aracın kimliğini bu araca yazmak olurdu.
 */
function _ecuIdentityFields(ecu: DiscoveredEcu): Partial<EcuDtc> {
  try {
    const id = lookupEcuIdentity(ecu.rxHeader, ecu.addressBits);
    if (id !== null) {
      return { ecuRole: id.role, ecuRoleEvidence: id.evidence, ecuKey: id.identityKey };
    }
  } catch { /* fail-soft: kimlik yoksa DTC yine de kaybolmaz */ }
  /* Keşfin kendi STANDART kanıtı korunur (7E8 → engine). */
  return { ecuRole: ecu.role, ecuRoleEvidence: ecu.roleEvidence };
}

/**
 * Bir ECU'da bir modun okuma sonucu.
 *
 * P0-OBD-FINAL-01 · `deferred` (ÖNCELİK 3): sorgu HİÇ GÖNDERİLMEDİ çünkü tanı
 * admisyonu (session/recovery/reconnect) o anda kapalıydı. `unsupported`
 * ("soruldu, ECU bilmiyor") ve `failed` ("soruldu, düştü") ile ASLA
 * karıştırılmaz — ertelenmiş bir okuma ne kapsam kaybıdır ne de temizlik kanıtı.
 */
export type EcuModeStatus = 'ok' | 'failed' | 'unsupported' | 'deferred';

/** Kaynağı etiketli DTC — hangi ECU'dan, hangi moddan geldiği KAYBOLMAZ. */
export interface EcuDtc {
  code: string;
  /** Kodun okunduğu ECU (provenance — 'Motor (ECM)' / 'ECU 7E1'). */
  ecuLabel: string;
  ecuTxHeader: string;
  /**
   * P0-OBD-08 — kodun geldiği ECU'nun ROLÜ ve rolün KANITI.
   *
   * Etiket ("ECU 7E1") bir adrestir, sistem adı değildir; kullanıcı "hangi
   * sistemde arıza var" sorusunu ondan yanıtlayamaz. Rol envanterden gelir ve
   * envanter yoksa/bayatsa `unknown` KALIR — adresten rol UYDURULMAZ.
   */
  ecuRole?: EcuRole;
  ecuRoleEvidence?: EcuRoleEvidence;
  /** Kararlı ECU kimliği (araç bağlamı dâhil); bilinmiyorsa `undefined`. */
  ecuKey?: string;
  mode: 'stored' | 'pending' | 'permanent';
  /**
   * OBD-OS-F3-1: kod UDS 0x19'dan (üretici tabanı) mı geldi? true → standart OBD taraması
   * bunu GÖREMEZDİ (Renault DF… sınıfı). UI bunu ayırt edip "üretici kodu" diye gösterir.
   */
  fromUds?: boolean;
  /**
   * V-08: kod KWP 0x18'den mi geldi? KWP araçlarda UDS 0x19 YOKTUR; üretici
   * kodları burada yaşar. `fromUds` ile AYRI tutulur — ikisini birleştirmek
   * kodun hangi protokolden geldiğini (provenance) yok ederdi.
   */
  fromKwp?: boolean;
  /**
   * P0-OBD-DIAG-02 — kodu ÜRETEN KWP servisi ('18' ReadDTCByStatus · '13'
   * eski nesil readDTC). `fromKwp` "KWP tabanından geldi" der, bu alan HANGİ
   * servisten geldiğini söyler. İkisini birleştirmek provenance'ı yok ederdi:
   * 0x18'i bilmeyip 0x13 cevaplayan bir ECU, teşhis açısından FARKLI bir
   * gerçektir (o araçta 0x18 aramak sonsuza dek boş döner).
   */
  kwpService?: '18' | '13';
  /** UDS'e özgü arıza alt tipi (FTB) — yalnız fromUds kodlarda. */
  failureType?: string;
  /** UDS status: kod ŞU AN aktif mi (testFailed) — Mode 03 bunu ayıramaz. */
  active?: boolean;
  /** UDS/KWP ham status baytı; kanonik authority'ye kayıpsız taşınır. */
  rawStatus?: string;
  /**
   * P0-OBD-FINISH — ALT KOD (Car Scanner'ın `P0380(11)` parantezi).
   *
   * ÖLÇÜLEN KUSUR: UDS tarafında bu bayt `failureType` olarak ZATEN
   * çözülüyordu ama KWP tarafında hiç yoktu ve HİÇBİR yolda ekrana çıkmıyordu.
   * `subCode` iki protokolün ORTAK alanıdır: hangi servisten gelirse gelsin
   * kaydın kimliğinin parçasıdır ve dedup anahtarına GİRER — aksi hâlde
   * `P0380(11)` ile `P0380(96)` (iki AYRI devre arızası) tek satıra iner.
   */
  subCode?: string;
  /**
   * P0-OBD-PARITY — kodu üreten UDS 0x19 ALT FONKSİYONU.
   *
   * `'02'` (reportDTCByStatusMask) ile `'0A'` (reportSupportedDTC) AYRI
   * teşhis gerçekleridir: 0x02 status maskesiyle FİLTRELER, 0x0A filtresizdir.
   * Bir kod yalnız 0x0A'da görünüyorsa bu, o kaydın maske tarafından elendiği
   * (arşiv / etkin değil) anlamına gelir — provenance olarak KAYBEDİLEMEZ.
   */
  udsSubFunction?: '02' | '0A';
  /** Ham DTC baytları (hex) — üretici tablosu eşlemesi için KAYBOLMAZ. */
  rawDtc?: string;
  /**
   * P0-OBD-FINISH — kaydın ÖLÇÜLEN durumu (ISO 14229-1 D.1 status baytından).
   * `stored | pending` ikilisi ARŞİV kaydını aktif arıza gibi gösteriyordu.
   * Standart Mode 03/07/0A'da status baytı YOKTUR → alan `undefined` kalır.
   */
  state?: UdsDtcState;
}

export interface EcuScanResult {
  ecu: DiscoveredEcu;
  stored: EcuModeStatus;
  pending: EcuModeStatus;
  permanent: EcuModeStatus;
  /** F3-1: bu ECU UDS 0x19'u destekliyor mu? null = denenmedi. */
  uds: EcuModeStatus | null;
  /**
   * V-08: KWP 0x18 durumu. `null` = DENENMEDİ (protokol CAN olduğu için).
   *
   * `null` ile `'unsupported'` AYRI ANLAMLIDIR ve karıştırılmamalıdır:
   * `null`  → "bu araçta sorulmadı" · `'unsupported'` → "soruldu, ECU bilmiyor".
   * İkisini birleştirmek, KWP aracında üretici kodu olmadığı hâlde "temiz"
   * demeye yol açardı — tam olarak V-08'in yasakladığı sessiz yalan.
   */
  kwp: EcuModeStatus | null;
  /**
   * P0-OBD-DIAG-02 — ISO 14230-3 servis 0x13 kanalı. `null` = SORULMADI
   * (0x18 zaten cevap verdi ya da adres kanıtlanmadı); `unsupported` = soruldu,
   * ECU 0x13'ü de bilmiyor. Ayrı alan çünkü "0x18 yok ama 0x13 var" ile
   * "ikisi de yok" AYRI teşhislerdir.
   */
  kwp13: EcuModeStatus | null;
  /**
   * P0-OBD-PARITY — UDS 0x19 **alt fonksiyon 0x0A** (reportSupportedDTC) durumu.
   * `null` = denenmedi (köprü yok / native platform değil).
   *
   * NEDEN AYRI ALAN: 0x19-02 `statusMask` ile FİLTRELER; birçok ECU maskeyi
   * AND'lerken status baytı 0x00 olan (arşiv / etkin değil) kayıtları ELER.
   * 0x19-0A o filtreyi HİÇ uygulamaz — "bu ECU'nun tanıdığı bütün DTC'ler"
   * listesidir. İkisini tek duruma indirmek, "0x19-02 boş döndü → ECU temiz"
   * yalanını üretirdi; tam olarak bu turda kapatılan tek-servis bağımlılığı.
   */
  udsSupported: EcuModeStatus | null;
  udsDiagnosticOutcome?: AdvancedDtcOutcome;
  udsSupportedDiagnosticOutcome?: AdvancedDtcOutcome;
  kwpDiagnosticOutcome?: AdvancedDtcOutcome;
  kwp13DiagnosticOutcome?: AdvancedDtcOutcome;
  /* ── P0-VDK-F6B · KAPSAM ÖLÇÜMÜ (additive; ürün listesini DEĞİŞTİRMEZ) ────
     Bu alanlar YENİ bir otorite kurmaz; taramanın ZATEN ölçtüğü ama hiçbir
     yere yazmadığı gerçekleri taşır. Hepsi `undefined` kalabilir: ölçülmeyen
     alan sahte bir 0/`false` ile DOLDURULMAZ. */
  /** 0x19-01 sonucu — status availability maskesi ÖLÇÜLEBİLDİ Mİ. */
  udsAvailabilityDiagnosticOutcome?: AdvancedDtcOutcome;
  /** 0x19-02 isteğine KONAN maske ve künyesi (ölçülen mi, varsayılan mı). */
  udsStatusMask?: string;
  udsStatusMaskProvenance?: StatusMaskProvenance;
  /** ECU'nun 0x19-01'de BEYAN ettiği kayıt sayısı — bağımsız tanık. */
  udsDeclaredDtcCount?: number | null;
  /** 0x19-03 sonucu ve ÖLÇÜLEN snapshot referans sayısı. */
  udsSnapshotDiagnosticOutcome?: AdvancedDtcOutcome;
  udsSnapshotReferenceCount?: number | null;
  /** 0x19-06 sonucu; gönderilen istek adedi ve bütçe yüzünden ertelenen adet. */
  udsExtendedDiagnosticOutcome?: AdvancedDtcOutcome;
  udsExtendedRequests?: number;
  udsExtendedDeferred?: number;
  /** 0x19-02'den ÇÖZÜMLENEN kayıt sayısı — beyan/ölçüm karşılaştırması için. */
  udsParsedCount?: number | null;
  /** Bu ECU için hatta ÇIKAN toplam istek (F1-A bütçesinden düşen). */
  requestCount?: number;
  codes: EcuDtc[];
  /** Ürün listesinden bağımsız kaynak kanıtları; aynı DTC'nin OBD+UDS kaynaklarını korur. */
  authorityCodes: EcuDtc[];
}

export interface MultiEcuScanReport {
  topology: VehicleTopology;
  results: EcuScanResult[];
  /** Tüm ECU'lardan toplanan kodlar (provenance korunur). */
  allCodes: EcuDtc[];
  /** Okuma denemesi düşen (ECU, mod) çifti sayısı — >0 ise tarama KISMİ. */
  failedReads: number;
  /** Taranan ECU sayısı (tavanla kesilmiş olabilir). */
  scannedEcus: number;
  /** Tavan yüzünden taranMAYAN ECU sayısı — sessiz kırpma YASAK, raporlanır. */
  skippedEcus: number;
  /** ECU keşif/tarama kapsamı; payda bilinmiyorsa yüzde null/UNKNOWN kalır. */
  completeness: EcuCompletenessEvidence;
}

let _lastCompleteness: EcuCompletenessEvidence | null = null;
export function getLastEcuCompleteness(): EcuCompletenessEvidence | null { return _lastCompleteness; }
/**
 * Test izolasyonu (P0-VDK-F6C). `_lastCompleteness` SÜREÇ ÖMLÜRLÜDÜR ve
 * sıfırlama kancası YOKTU — bir testin taraması bir sonrakinin LAB
 * okumasına sızıyordu. Üretim yolunda ÇAĞRILMAZ (oturum mührü üretimde
 * zaten `sessionEpoch` karşılaştırmasıyla korunur).
 */
export function _resetLastCompletenessForTest(): void { _lastCompleteness = null; }

const MODES: ReadonlyArray<{ mode: '03' | '07' | '0A'; key: 'stored' | 'pending' | 'permanent' }> = [
  { mode: '03', key: 'stored' },
  { mode: '07', key: 'pending' },
  { mode: '0A', key: 'permanent' },
];

/**
 * Araçtaki ECU'ları keşfeder (F2-1). Native prob yoksa/başarısızsa boş topoloji (fail-soft) —
 * `probedAt: null` "keşif çalışmadı" demektir, "ECU yok" DEĞİL.
 */
export async function discoverEcus(
  opts: {
    /**
     * B7 — KULLANICI aktif tarama istedi mi? `true` ise sessiz-adres eleme
     * merdiveni ATLANIR (kullanıcıya "geçen sefer sormuştuk" denmez).
     * Arka plan izleyicileri bunu GEÇMEZ → varsayılan `false`.
     */
    readonly userInitiated?: boolean;
  } = {},
): Promise<VehicleTopology> {
  /* P0-VDK-F2B — TAŞIMA KAPISI. Canlı araçta `CarLauncher`, replay koşusunda
     doğrulanmış izin ölçülmüş yanıtı. Ayrım BURADA biter: aşağıdaki hiçbir
     satır Real/Virtual farkını BİLMEZ. */
  const probeFn = vdkProbeEcusFn();
  if (!probeFn) return emptyTopology();

  /* P0-OBD-CORE-05 — ADMİSYON KAPISI. Saha kanıtı: `EcuProbeFailed` recovery/
     reconnect sürerken üretiliyordu; ölçülen `raw:''` yanıtı `probeEmpty:true`
     yapıp "hiçbir ECU yanıt vermedi" izlenimi bırakıyordu — oysa aynı sorgu
     recovery bitince normal cevap verdi. `emptyTopology()` (`probedAt:null`)
     dönülür: bu, mevcut sözleşmede zaten "keşif çalışmadı" demektir ve
     `probeEmpty:true`den (verdictEngine.computeConfidence) BİLİNÇLİ AYRIDIR —
     "0 ECU bulundu" ile "hiç sorulmadı" karışmasın. */
  /* P0-VDK-F1A — admisyon + epoch mühürü + bütçe artık KANONİK İŞLEMDE.
     İkinci kapı KURULMADI: işlem `diagnosticAdmission`ı ÇAĞIRIR. */
  const txn = beginTransaction({ purpose: 'ecu_discovery' });
  const prepared = await prepareTransaction(txn);
  if (!prepared.ok) return emptyTopology();

  /* P0-OBD-FINAL-01 — PROTOKOL KEŞFE GİRER. Yavaş seri hatta (KWP2000/ISO 9141)
     yanıt header'ı 3 BAYTTIR ve fiziksel `tx` ancak protokol bilinirse doğru
     kuralla türetilebilir. Bilinmezse ECU yine KEŞFEDİLİR ama `txProvenance`
     'unknown' kalır ve o ECU'ya istek GÖNDERİLMEZ (uydurma adres YASAK). */
  let protocol: string | null = null;
  try { protocol = getHandshakeDiagnostics().protocolActive ?? null; } catch { protocol = null; }

  try {
    if (!consumeRequest(txn)) { failTransaction(txn, 'bütçe'); return emptyTopology(); }
    const { raw } = await probeFn();
    /* Geç yanıt: prob uçuştayken oturum değişmiş olabilir → envanter YAZILMAZ. */
    if (!acceptResponse(txn)) { failTransaction(txn, 'geç yanıt'); return emptyTopology(); }
    const topology = buildTopology(raw ?? '', Date.now(), protocol);
    /* P0-OBD-PARITY — FONKSİYONEL KEŞİF TEK BAŞINA "TAM ARAÇ" DEĞİLDİR.
       `0100` bir OBD-II emisyon servisidir; fonksiyonel yayına katılmayan
       birimler onu HİÇ yanıtlamaz. Standart fiziksel adres uzayı ayrıca
       sorulur (yalnız CAN, salt-okunur, kanıt zorunlu). */
    const extended = await _extendWithPhysicalProbes(topology, protocol, txn, opts.userInitiated === true);
    completeTransaction(txn);
    return extended;
  } catch (e) {
    logError('OBD:EcuProbeFailed', e);
    failTransaction(txn, e instanceof Error ? e.message : String(e));
    return emptyTopology();   // keşif düştü → "bakılmadı" (fail-closed: uydurma ECU yok)
  }
}

/**
 * P0-OBD-PARITY — standart CAN fiziksel adres uzayını salt-okunur sorar.
 *
 * KAPILAR (hepsi geçilmeli, yoksa topoloji DEĞİŞMEDEN döner):
 *  · protokol CAN olmalı — yavaş seri hatta (KWP/ISO9141) ASLA koşmaz;
 *    K-line'da kör adres taraması başka modülü uyandırabilir.
 *  · `readAdvancedDtcs` köprüsü bulunmalı (eski APK'da yok → sessizce atlanır).
 *  · fonksiyonel keşif ZATEN bulmuş bir adres tekrar sorulmaz.
 *
 * FAIL-SOFT: prob düşerse mevcut topoloji AYNEN korunur — bu adım keşfi
 * ZENGİNLEŞTİRİR, ona bağımlı DEĞİLDİR.
 */
async function _extendWithPhysicalProbes(
  topology: VehicleTopology, protocol: string | null, txn: DiagnosticTransaction,
  userInitiated = false,
): Promise<VehicleTopology> {
  const fn = vdkAdvancedDtcsFn();
  if (!fn) return topology;
  /* YALNIZ CAN. `isSlowSerialProtocol` KWP/ISO9141'i yakalar; protokol
     BİLİNMİYORSA da koşmaz (fail-closed: bilinmeyen hatta kör istek YASAK). */
  if (protocol === null || isSlowSerialProtocol(protocol)) return topology;

  /* ── B7 · SESSİZ ADRES MERDİVENİ ────────────────────────────────────────
     SAHA (2026-08-30): bu blok ana ekranda 10 dk'da 712 istek üretiyordu ve
     7E1–7E7'nin tamamı NO DATA dönüyordu — hiç öğrenilmiyordu. Merdiven
     doğrulanmış sessizliği zaman aşımlı olarak bastırır; kullanıcı aktif
     tarama isterse (`userInitiated`) ATLANIR. */
  const { targets, skipped, suppressed } = planPhysicalProbes(
    topology.ecus, MAX_PHYSICAL_PROBES, { nowMs: Date.now(), force: userInitiated },
  );
  recordSuppressedProbes(suppressed);
  if (targets.length === 0) return topology;

  const found: DiscoveredEcu[] = [];
  for (const tx of targets) {
    const rx = rxForPhysicalTx(tx);
    if (rx === null) continue;
    /* Bütçe/iptal/bayat oturum → kalan adresler SORULMAZ (sessiz devam YOK). */
    if (!consumeRequest(txn)) break;
    const probeStartedAt = Date.now();
    try {
      const res = await fn({ service: '19', subFunction: '02', payload: 'FF', tx, rx });
      if (!acceptResponse(txn)) break;   // geç yanıt → envantere YAZILMAZ
      const outcome = String(res.outcome ?? '');
      /* B7: sonucu merdivene işle. `RESPONDED` bastırmayı SİLER, `SILENT`
         basamağı ilerletir, `INCONCLUSIVE` (hat sorunu) ÖĞRENME ÜRETMEZ. */
      noteProbeOutcome(tx, normalizeAdvancedOutcome(outcome, res.nrc ?? null), res.nrc ?? null,
        txn.sessionEpoch, protocol, Date.now(), Date.now() - probeStartedAt);
      const result: PhysicalProbeResult = {
        txHeader: tx, rxHeader: rx, outcome,
        nrc: res.nrc ?? null, raw: res.raw?.length ? res.raw : null,
        /* SESSİZLİK ECU DEĞİLDİR; "duydu ve reddetti" ECU'DUR. */
        present: isEcuPresenceEvidence(normalizeAdvancedOutcome(outcome, res.nrc ?? null))
          || isEcuPresenceEvidence(outcome),
      };
      recordPhysicalProbe(result, protocol);
      const ecu = ecuFromPhysicalProbe(result);
      if (ecu !== null) found.push(ecu);
    } catch (e) {
      /* B7: istisna HAT sorunudur, ECU yokluğu DEĞİL → `INCONCLUSIVE`
         (bastırma üretmez; adaptör koparsa yedi adres birden "yok" öğrenilemez). */
      noteProbeOutcome(tx, 'transport_error', null, txn.sessionEpoch, protocol,
        Date.now(), Date.now() - probeStartedAt);
      logError('OBD:PhysicalEcuProbe', e);   // tek adres düştü — tarama SÜRER
    }
  }

  if (skipped > 0) recordPhysicalProbeSkipped(skipped);
  if (found.length === 0) return topology;
  /* Fonksiyonel kayıtlar ÖNDE kalır (kanıtı daha güçlüdür: araç onları
     kendiliğinden bildirdi); fiziksel bulgular arkaya EKLENİR. */
  return { ...topology, ecus: [...topology.ecus, ...found], probeEmpty: false };
}

/**
 * Tam araç taraması (F2-4): keşfedilen HER ECU'da Mode 03/07/0A okur.
 *
 * FAIL-SOFT: bir ECU/mod düşerse diğerleri devam eder; düşen okuma `failedReads`'e sayılır
 * → çağıran (UI/verdict) kısmi taramayı "temiz" sanmaz.
 */
export async function scanAllEcus(
  topology: VehicleTopology,
  /**
   * V-04/4 — filo hafızasından gelen İPUCU: daha önce bu araçta UDS 0x19'u
   * desteklediği GÖRÜLEN ECU'ların tx başlıkları.
   *
   * YALNIZ SIRA belirler; hiçbir ECU atlanmaz, hiçbir sonuç hafızadan üretilmez.
   * Tek etkisi: `MAX_SCAN_ECUS` tavanına takılan araçlarda üretici kodlarını
   * taşıyan ECU'ların tavanın DIŞINDA kalmaması. Boş dizi → davranış eskisi gibi.
   */
  udsFirst: readonly string[] = [],
  /**
   * P0-VDK-F1A — UYUMLULUK ADAPTÖRÜ. `runFullVehicleScan` kendi kanonik
   * işlemini açar ve BURAYA geçirir; doğrudan çağıran (testler · eski yollar)
   * geçirmezse burada AÇILIR. Böylece public imza BOZULMAZ ama **kanonik yol
   * tektir**: her iki durumda da bütçe/iptal/geç-yanıt aynı omurgadan geçer.
   */
  parentTxn?: DiagnosticTransaction,
): Promise<MultiEcuScanReport> {
  const txn = parentTxn ?? beginTransaction({ purpose: 'multi_ecu_scan' });
  /* Kendi açtıysak hazırlamalıyız; ebeveyn zaten SESSION_ACTIVE'dir.
     Admisyon REDDEDERSE hattan tek bayt çıkmaz — mevcut per-ECU admisyon
     kapısı (`_admissionFor`) AYNEN korunur ve bu onu EZMEZ. */
  if (parentTxn === undefined) {
    const prep = prepareTransactionSync(txn);
    if (!prep.ok) {
      closeLeasesForTransaction(txn, 'admisyon reddetti');
      return { topology, results: [], allCodes: [], failedReads: 0,
        scannedEcus: 0, skippedEcus: topology.ecus.length,
        completeness: _lastCompleteness ?? buildEcuCompleteness({
          candidates: topology.ecus, protocol: null,
          sessionEpoch: txn.sessionEpoch, currentSessionEpoch: txn.sessionEpoch,
          expectedEcuCount: null,
        }) };
    }
  }
  traceTransactionBoundary(txn, 'begin');
  const ordered = orderByUdsHint(topology.ecus, udsFirst);
  const scanList = ordered.slice(0, MAX_SCAN_ECUS);

  /* V-08 — AKTİF PROTOKOL TARAMA BAŞINDA BİR KEZ OKUNUR ve tur boyunca SABİT
     kalır. ECU başına yeniden okumak, tarama ortasında bir yeniden bağlanma
     olursa aynı turun bir kısmını KWP bir kısmını CAN kuralıyla işlerdi —
     rapor kendi içinde çelişirdi. Okunamazsa `null`: KWP dalı DENENMEZ
     (fail-closed) ve bu durum `kwp: null` olarak dürüstçe raporlanır. */
  /* P0-OBD-09 — OTURUM MÜHRÜ: kanıt defterine yazılan her okuma bu turun
     oturumuna aittir. Epoch okunamazsa -1 (sahte 0 YASAK). */
  /* P0-VDK-F1A: mühür ARTIK işlemden gelir — tarama boyunca SABİTTİR ve her
     yanıt ona karşı doğrulanır. Ayrı bir `getObdSessionEpoch()` okuması,
     tarama ortasında değişen bir epoch'ta iki farklı mühür üretirdi. */
  const sessionEpoch = txn.sessionEpoch;

  let activeProtocol: string | null = null;
  try {
    /* `protocolActive` = ATDPN ile GERÇEKTEN okunan protokol (denenen değil). */
    activeProtocol = getHandshakeDiagnostics().protocolActive ?? null;
  } catch { activeProtocol = null; }
  txn.protocol = activeProtocol;
  let skippedEcus = Math.max(0, topology.ecus.length - scanList.length);

  const results: EcuScanResult[] = [];
  const allCodes: EcuDtc[] = [];
  let failedReads = 0;

  /* P0-OBD-FINAL-01 — ADRESLENEBİLİRLİK ÖLÇÜMÜ ve OTURUM MÜHÜRÜ.
     `notAddressableKeys` bugüne kadar `buildEcuCompleteness`in kabul ettiği ama
     HİÇ DOLDURULMAYAN bir alandı — yani "ulaşılamayan ECU" kavramı kodda vardı,
     ölçümü YOKTU. Artık her ECU'nun fiziksel hedefi ÖLÇÜLÜR ve KWP 0x18 kapısı
     bu ölçüme bağlanır (eskiden `kwpTargetVerified` hiçbir yerde true olmuyordu
     → 0x18 hiç gönderilmiyordu → KWP araçta üretici kodu HİÇ okunmuyordu). */
  const notAddressableKeys = new Set<string>();
  const deferredKeys = new Set<string>();

  for (const ecu of scanList) {
    /* ── P0-VDK-F1A · İŞLEM CANLILIK KAPISI ─────────────────────────────
       İptal · süre bütçesi · istek bütçesi → KALAN ECU'lar HİÇ SORULMAZ.
       Sessizce devam etmek, bütçesi dolmuş bir taramanın kısmi sonucunu
       "tam" gibi göstermek olurdu. Kırpma SESSİZ DEĞİLDİR: atlanan ECU'lar
       `skippedEcus`e yazılır ve kapsam raporuna girer.

       ── BAYAT OTURUM BURADA ELE ALINMAZ (bilinçli) ────────────────────────
       `STALE_EPOCH` bu kapıda KASITLI olarak `break` ÜRETMEZ. Oturum değişimi
       için ürünün ZATEN daha zengin bir mekanizması var: aşağıdaki per-ECU
       `_admissionFor` yolu ECU'yu `deferred` işaretler, GEREKÇESİNİ deftere
       yazar ("oturum DEĞİŞTİ"), `staleSession` bayrağını kaldırır ve kapsamı
       `UNKNOWN`a düşürür. Burada erkenden `break` etmek o kanıtı SESSİZCE
       yok ederdi — yani daha kaba bir kapı, daha iyi bir otoriteyi ezerdi.
       Kural: yeni omurga mevcut spesifik otoriteleri EZMEZ, onlara YER AÇAR. */
    const live = transactionLiveness(txn);
    if ((!live.live && live.denial !== 'STALE_EPOCH') || !hasRequestBudget(txn)) {
      skippedEcus += scanList.length - results.length;
      break;
    }

    const result: EcuScanResult = {
      ecu,
      stored: 'failed',
      pending: 'failed',
      permanent: 'failed',
      uds: null,
      udsSupported: null,
      kwp: null,
      kwp13: null,
      codes: [],
      authorityCodes: [],
    };

    /* P0-OBD-FINAL-01 · OTURUM-GÜVENLİ TARAMA (ÖNCELİK 3).
       Admisyon tarama BAŞINDA bir kez sorulmuştu (`discoverEcus`); uzun bir tam
       araç taraması sırasında session/recovery DEĞİŞEBİLİR. Değiştiğinde okuma
       0 kod döner ve rapor "temiz" görünür — sahada tam olarak bu oluyordu.
       Her ECU'dan ÖNCE kapı yeniden sorulur; kapalıysa o ECU 'deferred' olur ve
       ASLA "0 kod / temiz" sayılmaz. */
    const gate = _admissionFor(ecu, sessionEpoch);
    if (gate !== null) {
      result.stored = 'deferred'; result.pending = 'deferred'; result.permanent = 'deferred';
      result.uds = null; result.udsSupported = null; result.kwp = null;
      deferredKeys.add(ecuCoverageKey(ecu));
      for (const { mode } of MODES) {
        recordDtcEvidence({
          service: mode, ecuLabel: ecu.label, ecuTxHeader: _txOrNull(ecu),
          outcome: 'failed', sessionEpoch, raw: null,
          error: `ERTELENDİ — ${gate}`, protocol: activeProtocol,
        });
      }
      _observe(ecu, sessionEpoch, activeProtocol, 'NOT_ATTEMPTED',
        `tanı admisyonu kapalı: ${gate}`, [], gate, false);
      results.push(result);
      continue;
    }

    /* Fiziksel adres TÜRETİLEMEDİYSE (protokol bilinmiyor) istek GÖNDERİLMEZ:
       boş `tx` native tarafta "varsayılan adresleme" demektir ve sessizce
       FONKSİYONEL hatta sızardı — bir ECU'nun sonucu başka ECU'ya yazılırdı. */
    if (!_hasPhysicalTarget(ecu)) {
      result.stored = 'unsupported'; result.pending = 'unsupported'; result.permanent = 'unsupported';
      notAddressableKeys.add(ecuCoverageKey(ecu));
      _observe(ecu, sessionEpoch, activeProtocol, 'NOT_ATTEMPTED',
        'fiziksel tx türetilemedi (protokol bilinmiyor) — istek gönderilmedi', [],
        'READY', false);
      results.push(result);
      continue;
    }

    const attempts: EcuServiceAttempt[] = [];
    let addressability: EcuAddressability = 'NOT_ATTEMPTED';

    for (const { mode, key } of MODES) {
      const fromEcuFn = vdkDtcFromEcuFn();
      if (!fromEcuFn) {
        result[key] = 'unsupported';
        recordDtcEvidence({
          service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
          outcome: 'unsupported', sessionEpoch, raw: null, protocol: activeProtocol,
        });
        attempts.push({ service: mode, subFunction: null, outcome: null, raw: null, codeCount: 0 });
        continue;
      }
      /* ── P0-VDK-F1A · BÜTÇE KAPISI (STANDART MODLAR) ────────────────────
         Mode 03/07/0A ÜRÜNÜN ANA YOLUDUR ve bütçeye girmiyordu: bir taramanın
         gerçek maliyeti ölçülemiyor, iptal/bayat oturum burada ISIRMIYORDU.
         Hak yoksa `deferred` — "okuma düştü" DEĞİL, sorgu HİÇ GÖNDERİLMEDİ. */
      if (!consumeRequest(txn)) {
        result[key] = 'deferred';
        deferredKeys.add(ecuCoverageKey(ecu));
        recordDtcEvidence({
          service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
          outcome: 'deferred', sessionEpoch, raw: null, protocol: activeProtocol,
          error: `işlem reddetti: ${txn.lastDenial ?? 'UNKNOWN'}`,
        });
        continue;
      }
      try {
        const res = await fromEcuFn({ tx: ecu.txHeader, rx: ecu.rxHeader, mode });
        /* GEÇ YANIT KAPISI: çağrı uçuştayken tur iptal edilmiş ya da OBD
           oturumu değişmiş olabilir. Eskiden böyle bir yanıtın kodları
           SESSİZCE yeni turun raporuna giriyordu — başka bir oturumun
           kodları bu oturumun sonucu gibi görünüyordu. */
        if (!acceptResponse(txn)) {
          result[key] = 'deferred';
          deferredKeys.add(ecuCoverageKey(ecu));
          recordDtcEvidence({
            service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
            outcome: 'deferred', sessionEpoch, raw: null, protocol: activeProtocol,
            error: `geç yanıt reddedildi: ${txn.lastDenial ?? 'UNKNOWN'}`,
          });
          continue;
        }
        /* P0-OBD-FINAL-01 — HAM YANIT + ÖLÇÜLEN SONUÇ artık köprüden geliyor.
           Eski APK bu alanları taşımaz → `undefined`; o zaman ESKİ (kaba)
           sözleşme aynen uygulanır (regresyon yok). */
        const raw = typeof res.raw === 'string' && res.raw.length > 0 ? res.raw : null;
        const nativeOutcome = typeof res.outcome === 'string' ? res.outcome : null;
        addressability = mergeAddressability(addressability, addressabilityFromOutcome(nativeOutcome));
        attempts.push({
          service: mode, subFunction: null, outcome: nativeOutcome, raw,
          codeCount: (res.codes ?? []).length,
        });

        /* P0-VDK-F2A · KANONİK İZ — standart modlar ÜRÜNÜN ANA YOLUDUR ve
           ham yanıtları koreleli kronolojiye girmeliydi. */
        traceFromTransaction(txn, {
          operation: mode === '03' ? 'mode03' : mode === '07' ? 'mode07' : 'mode0A',
          rawRequest: mode, rawResponse: raw,
          transportOutcome: nativeOutcome,
          latencyMs: typeof res.elapsedMs === 'number' ? res.elapsedMs : null,
          ecuTxHeader: ecu.txHeader, ecuRxHeader: ecu.rxHeader, ecuLabel: ecu.label,
          protocol: res.protocol ?? activeProtocol, sessionEpoch,
        });

        const measured = _outcomeFromNative(nativeOutcome, res.supported);
        if (measured !== 'ok') {
          /* "ECU SUSTU" ile "servis yok" AYRI: ilki kapsam KAYBIDIR, ikincisi
             kalıcı ve normal bir bilgidir. İkisi de "0 kod = temiz" DEĞİLDİR. */
          result[key] = measured === 'no_response' || measured === 'failed' ? 'failed' : 'unsupported';
          if (measured === 'no_response' || measured === 'failed') failedReads++;
          recordDtcEvidence({
            service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
            outcome: measured, sessionEpoch, raw, protocol: res.protocol ?? activeProtocol,
            elapsedMs: res.elapsedMs ?? null, recoveryCount: res.recoveryCount ?? null,
          });
          continue;
        }
        result[key] = 'ok';
        /* ── P0-VDK-F2C1 · KANONİK ANLAM OTORİTESİ ────────────────────────
           Fonksiyonel yolla (`dtcService`) AYNI seçim kuralı: ham gövde varsa
           kanonik TS çözümleyicisi ÜRÜN OTORİTESİDİR, native listesi yalnız
           PARİTE TANIĞIDIR. İkinci bir kural burada KOPYALANMAZ —
           `functionalDtcSource` tek yerdir. */
        const fnSrc = resolveFunctionalDtcSource({
          mode, rawResponse: raw,
          nativeCodes: isReplayActive() ? null : (res.codes ?? []),
        });
        recordFunctionalDtcEvidence(fnSrc, isReplayActive());
        const decoded = fnSrc.codes;
        recordDtcEvidence({
          service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
          outcome: 'ok', codes: [...decoded], sessionEpoch, raw,
          protocol: res.protocol ?? activeProtocol,
          elapsedMs: res.elapsedMs ?? null, recoveryCount: res.recoveryCount ?? null,
        });
        for (const code of decoded) {
          // ROUTER KİLİDİ: kod YALNIZ kendi ECU'sunun kaydına yazılır (sızıntı yok).
          const tagged: EcuDtc = {
            code, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader, mode: key,
            ..._ecuIdentityFields(ecu),
          };
          result.codes.push(tagged);
          result.authorityCodes.push(tagged);
          allCodes.push(tagged);
        }
      } catch (e) {
        result[key] = 'failed';
        failedReads++;
        recordDtcEvidence({
          service: mode, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
          outcome: 'failed', sessionEpoch, raw: null, protocol: activeProtocol,
          error: e instanceof Error ? e.message : String(e),
        });
        attempts.push({ service: mode, subFunction: null, outcome: 'ERROR', raw: null, codeCount: 0 });
        logError('OBD:EcuDtcFailed', e);   // bu ECU/mod düştü — tarama DURMAZ
      }
    }

    /* ── P0-OBD-FINAL-02 · KWP TANI OTURUMU KANIT PROBU ────────────────────
       SAHA (2026-08-25 · Protocol 5 / KWP · ECU 7A): fonksiyonel sorgular cevap
       verdi, FİZİKSEL `817AF1` SUSTU (3/3). Elimizdeki tek gözlem "Mode 03
       sustu"ydu ve bu iki AYRI gerçeği ayıramıyordu: (a) o adreste ECU yok,
       (b) ECU tanı oturumu açılmadan fiziksel isteğe cevap vermiyor.

       Prob YALNIZ adres HENÜZ KANITLANMAMIŞKEN koşar (kanıtlıysa tek komut bile
       gönderilmez) ve YALNIZ POZİTİF yanıt adreslenebilirliği YÜKSELTİR.
       Sessizlik · NRC · bozuk yanıt · hat hatası POZİTİF SAYILMAZ → mevcut
       fail-closed karar (NOT_ADDRESSABLE / UNKNOWN) AYNEN KORUNUR. */
    let sessionVerdict: KwpSessionVerdict | null = null;
    if (addressability !== 'PROVEN' && isSlowSerialProtocol(activeProtocol)) {
      sessionVerdict = await _probeKwpSession(ecu, sessionEpoch, activeProtocol);
      attempts.push({
        service: '10', subFunction: sessionVerdict.request?.slice(2) ?? null,
        outcome: sessionVerdict.result, raw: sessionVerdict.response,
        codeCount: 0,
      });
      /* MONOTON: yalnız POZİTİF kanıt yükseltir; hiçbir sonuç DÜŞÜRMEZ. */
      if (sessionVerdict.proven) addressability = mergeAddressability(addressability, 'PROVEN');
    }

    /* ── P0-OBD-DIAG-01 · FİZİKSEL ADRESLEME KANIT MATRİSİ ──────────────────
       SAHA (2026-08-25): fiziksel `817AF1` isteklerinin TAMAMI sustu — Mode 03
       (1 bayt, uzunluk DOĞRU) da, oturum probu `10 81` (2 bayt, uzunluk YANLIŞ
       beyan ediliyor) da. Araçta BİLİNEN gerçek arıza var ama emisyon hafızası
       boş → arıza ÜRETİCİ hafızasında ve oraya YALNIZ fiziksel adresle ulaşılır.
       Yani fiziksel adresleme ürünün önündeki TEK kapıdır.

       Elimizdeki tek gözlem üç ayrı gerçeği ayıramıyordu: (a) o adreste ECU yok,
       (b) format baytının uzunluk alanı yanlış (ürün HER isteği `81` ile
       gönderiyor — ISO 14230-2'de o alan VERİ UZUNLUĞUDUR), (c) ECU o adreste
       başka bir kip bekliyor. Matris bunları ARACA ölçtürür; tahmin YOK.

       KAPSAM DAR: yalnız yavaş seri protokolde, yalnız adres HENÜZ kanıtlanmamışken
       ve yalnız köprü yeteneği varken koşar. İlk cevap veren fiziksel satırda
       DURUR (gereksiz K-line trafiği yok). */
    let addressingVerdict: KwpAddressingVerdict | null = null;
    let provenTxHeader: string | null = null;
    if (addressability !== 'PROVEN' && isSlowSerialProtocol(activeProtocol)) {
      addressingVerdict = await _probeKwpAddressing(ecu, sessionEpoch, activeProtocol);
      attempts.push({
        service: 'MTX', subFunction: addressingVerdict.provenVariantId,
        outcome: addressingVerdict.proven ? 'ANSWERED' : 'NO_ANSWER',
        raw: addressingVerdict.response,
        codeCount: 0,
      });
      if (addressingVerdict.proven && addressingVerdict.provenHeader !== null) {
        /* ADRES UYDURULMADI, ÖLÇÜLDÜ: kazanan header ürüne geri yazılır ve
           bundan sonraki fiziksel istekler (0x18/0x19 dâhil) onu kullanır. */
        provenTxHeader = addressingVerdict.provenHeader;
        addressability = mergeAddressability(addressability, 'PROVEN');
      }
    }

    if (addressability === 'NOT_ADDRESSABLE') notAddressableKeys.add(ecuCoverageKey(ecu));
    else notAddressableKeys.delete(ecuCoverageKey(ecu));

    /* ÖLÇÜLEN adreslenebilirlik ECU kaydına GERİ YAZILIR — sonraki adım (KWP
       0x18) bunu okur. Kanıt tek yönlüdür: fonksiyonel keşif hedefi kanıtlamaz,
       yalnız FİZİKSEL bir cevap kanıtlar. */
    const addressed: DiscoveredEcu = addressability === 'PROVEN'
      ? { ...ecu,
          /* P0-OBD-DIAG-01: matris bir header KANITLADIYSA hedef ONDAN gelir —
             `81<src>F1` varsayımı ölçümle EZİLİR. Matris koşmadıysa mevcut
             türetme AYNEN korunur (davranış regresyonu yok). */
          txHeader: provenTxHeader ?? ecu.txHeader,
          kwpTargetVerified: ecu.addressBits === 8, probeOutcome: 'responded',
          discoverySource: 'physical_probe' }
      : ecu;

    /* ── P0-VDK-F6B · KAPSAM PLANI (VERİ ODAKLI — ROL TABLOSU YOK) ───────
       Hangi ailenin sorulacağı artık bu dosyaya GÖMÜLÜ bir `if` değil, SAF bir
       karardır ve girdileri MEVCUT otoritelerden gelir: CDDL tanım kümesi,
       native salt-okunur alt fonksiyon kümesinin TS aynası, ölçülmüş protokol,
       adreslenebilirlik ve bu oturumda ÖLÇÜLMÜŞ servis yokluğu.

       ROL PLANA GİRMEZ: rolü `unknown` olan uç nokta, rolü kanıtlanmış bir uç
       noktayla BİREBİR aynı planı alır (F6-A §4 sözleşmesi). */
    const coveragePlan = _planCoverageFor(addressed, activeProtocol, sessionEpoch);
    const planOf = (cls: DtcCoverageClass): DtcCoveragePlanStep =>
      coveragePlan.find((x) => x.cls === cls)!;

    // OBD-OS-F3-1: ÜRETİCİ-ÖZEL DTC'ler (UDS 0x19). Standart modlar yalnız emisyon (P0…)
    // kodlarını verir; Renault DF… sınıfı arızalar BURADA yaşar. F1-2'nin "MIL yanıyor ama
    // standart kod yok" uyarısının somut cevabı budur. Fail-soft: ECU 0x19'u bilmiyorsa
    // (NRC 0x11/0x12/0x31 → supported:false) bu bir HATA DEĞİLDİR, tarama sürer.
    if (planOf('UDS_DTC_BY_STATUS').decision === 'QUERY') {
      const udsCodes = await readUdsForEcu(addressed, result, sessionEpoch, activeProtocol, txn);
      result.codes.push(...udsCodes);
      allCodes.push(...udsCodes);
      if (result.uds === 'failed') failedReads++;
    }
    attempts.push({
      service: '19', subFunction: '02',
      outcome: result.udsDiagnosticOutcome ?? (result.uds === null ? 'NOT_RUN' : String(result.uds)),
      raw: _lastAdvancedRaw('19', ecu.txHeader, sessionEpoch),
      codeCount: result.authorityCodes.filter((c) => c.fromUds === true).length,
    });

    /* V-08 — KWP 0x18: UDS 0x19'un KWP KARŞILIĞI.
       YALNIZ yavaş seri protokolde (KWP2000 / ISO9141) denenir. CAN'de denemek
       anlamsız trafik üretir ve KWP hattı zaten yavaştır. Protokol bilinmiyorsa
       DENENMEZ ve `kwp` `null` kalır — "sorulmadı" ile "desteklenmiyor" AYRI. */
    if (planOf('KWP_DTC_18').decision === 'QUERY') {
      const kwpCodes = await readKwpForEcu(addressed, result, sessionEpoch, activeProtocol, txn);
      result.codes.push(...kwpCodes);
      allCodes.push(...kwpCodes);
      if (result.kwp === 'failed') failedReads++;
      attempts.push({
        service: '18', subFunction: '18',
        outcome: result.kwpDiagnosticOutcome ?? (result.kwp === null ? 'NOT_RUN' : String(result.kwp)),
        raw: _lastAdvancedRaw('18', ecu.txHeader, sessionEpoch),
        codeCount: result.authorityCodes.filter((c) => c.fromKwp === true && c.kwpService !== '13').length,
      });
      /* P0-OBD-DIAG-02: 0x13 yalnız 0x18 reddedilince koşar; koşmadıysa satır
         "NOT_RUN" olarak görünür — "denendi ve olmadı" ile "hiç sorulmadı" AYRI. */
      attempts.push({
        service: '13', subFunction: '13',
        outcome: result.kwp13DiagnosticOutcome ?? (result.kwp13 === null ? 'NOT_RUN' : String(result.kwp13)),
        raw: _lastAdvancedRaw('13', ecu.txHeader, sessionEpoch),
        codeCount: result.authorityCodes.filter((c) => c.kwpService === '13').length,
      });
    }

    _observe(addressed, sessionEpoch, activeProtocol, addressability,
      _addressabilityReason(addressability, attempts), attempts, 'READY',
      addressed.kwpTargetVerified === true);

    /* P0-VDK-F6B — "neyi sordum, ne cevap verdi, neyi okuyamadım ve neden".
       Kanıt yazımı ASLA taramayı düşürmez. */
    _recordEcuCoverage(addressed, result, coveragePlan, addressability,
      sessionEpoch, activeProtocol, txn);

    results.push(result);
  }

  /* V-08 — KWP kanalının son tur kanıtını hatırla (yeni ölçüm YOK). */
  try {
    const kwpStates = results.map((r) => r.kwp).filter((v) => v !== null);
    _kwpEvidence = Object.freeze({
      lastScanAtMs: Date.now(),
      protocolAtScan: activeProtocol,
      attempted: kwpStates.length > 0,
      channelAvailable: Capacitor.isNativePlatform() && typeof CarLauncher.readKwpDtcs === 'function',
      okCount: kwpStates.filter((v) => v === 'ok').length,
      unsupportedCount: kwpStates.filter((v) => v === 'unsupported').length,
      failedCount: kwpStates.filter((v) => v === 'failed').length,
      codeCount: allCodes.filter((c) => c.fromKwp === true).length,
      functional03Raw: null, functional07Raw: null,
      physicalTarget: null, targetProvenance: null,
      sessionRequest: null, sessionResponse: null,
      request18Tx: null, response18Raw: null,
      gateOutcome: null, notSentReason: null,
      foundDtcs: allCodes.filter((c) => c.fromKwp === true).map((c) => c.code),
      publishedToCanonicalAuthority: null,
    });
    const last18 = [...getAdvancedDtcEvidence()].reverse().find((e) =>
      e.service === '18' && e.sessionEpoch === sessionEpoch);
    if (last18) {
      /* P0-OBD-FINAL-02 — oturum kanıtı 0x18 hedefiyle AYNI ECU'dan okunur;
         başka bir ECU'nun oturum kanıtı buraya YAZILAMAZ (provenance kilidi). */
      const sessionSummary = summarizeKwpSession(getKwpSessionProbes(), last18.tx, sessionEpoch);
      const sent = last18.outcome !== 'not_addressable';
      /* P0-OBD-FINAL-01 (ÖNCELİK 5) — TARGET PROVENANCE ARTIK ÖLÇÜMDÜR.
         Eskiden burada sabit bir metin ('ecuDiscovery.kwpTargetVerified')
         yazıyordu ama o bayrak KODUN HİÇBİR YERİNDE true OLMUYORDU: yani
         "SENT" satırı hiç görünemezdi ve KWP üretici kodu HİÇ okunmadı.
         Artık hedef, bu ECU'ya yapılan FİZİKSEL Mode 03 okumasının cevap
         vermesiyle KANITLANIR; kanıtın adı da buraya yazılır. */
      const provenObs = getEcuObservations().find((o) =>
        o.sessionEpoch === sessionEpoch && o.txHeader === last18.tx);
      _kwpEvidence = Object.freeze({ ..._kwpEvidence,
        physicalTarget: sent ? last18.tx : null,
        targetProvenance: sent
          ? `physical_probe:${provenObs?.txProvenance ?? 'unknown'} · ${provenObs?.addressability ?? 'UNKNOWN'}`
          : 'UNKNOWN',
        /* P0-OBD-FINAL-02 — KWP OTURUM KANITI ARTIK ÖLÇÜLÜYOR.
           Bu iki alan kodda VARDI ama sonsuza dek `null`dı: oturum komutu yalnız
           bir NRC sonrası YAN ETKİ olarak gönderiliyor ve sonucu bir `boolean`a
           düşürülüp ATILIYORDU. Artık kontrollü prob (`kwpSessionProbe`) ölçüyor
           ve kanıt buradan LAB'a taşınıyor. Prob koşmadıysa yine `null` — sahte
           "oturum açıldı" iddiası ÜRETİLMEZ. */
        sessionRequest: sessionSummary?.request ?? null,
        sessionResponse: sessionSummary?.response ?? null,
        request18Tx: sent ? '1800FF00' : null,
        response18Raw: last18.raw,
        gateOutcome: sent ? 'SENT' : 'NOT_SENT',
        notSentReason: sent ? null : (last18.error ?? 'KWP target/session kanıtı yok'),
        foundDtcs: [...last18.dtcs],
      });
    }
  } catch { /* fail-soft: kanıt toplama taramayı ASLA bozmaz */ }

  const scannedKeys = new Set<string>();
  const failedKeys = new Set<string>();
  for (const r of results) {
    const key = ecuCoverageKey(r.ecu);
    /* P0-OBD-FINAL-01: ERTELENEN ve ULAŞILAMAYAN ECU "tarandı" SAYILMAZ —
       ikisi de kapsam paydasında ayrı sınıftır (`deferred` → skipped,
       `not_addressable` → not_addressable), aksi halde kısmi bir tur %100
       kapsam gibi görünürdü. */
    if (deferredKeys.has(key) || notAddressableKeys.has(key)) continue;
    const states = [r.stored, r.pending, r.permanent, r.uds, r.kwp];
    if (states.some((s) => s === 'ok' || s === 'unsupported')) scannedKeys.add(key);
    else failedKeys.add(key);
  }
  const skippedKeys = new Set([
    ...ordered.slice(scanList.length).map(ecuCoverageKey),
    ...deferredKeys,
  ]);
  let currentSessionEpoch = -1;
  try { currentSessionEpoch = getObdSessionEpoch(); } catch { currentSessionEpoch = -1; }
  /* ── P0-VDK-F6C · İKİ GERÇEK TEK OTORİTEDE BİRLEŞİR ───────────────
     “ECU'ları buldum” ile “arıza hafızalarını yeterince taradım” AYNI ŞEY
     DEĞİLDİR. F6-B kapsam defterini üretiyordu ama üst seviye kapsam hükmü
     onu HİÇ GÖRMÜYORDU. Artık aynı turun ÖLÇÜLMÜŞ kapsamı mevcut
     `ecuCompleteness` otoritesine GİRDİ olarak verilir — paralel bir
     completeness otoritesi KURULMADI. */
  const completeness = buildEcuCompleteness({
    candidates: topology.ecus, scannedKeys, failedKeys, skippedKeys,
    notAddressableKeys,
    protocol: activeProtocol, sessionEpoch, currentSessionEpoch,
    /* Fonksiyonel 0100 yalnız cevap verenleri bilir; gerçek ECU toplamı BİLİNMİYOR. */
    expectedEcuCount: null,
    diagnostic: _diagnosticInputs(sessionEpoch),
  });
  _lastCompleteness = completeness;
  const report: MultiEcuScanReport = {
    topology,
    results,
    allCodes,
    failedReads,
    scannedEcus: scanList.length,
    skippedEcus,
    completeness,
  };
  /* P0-OBD-CORE-03 — ÇOKLU-ECU SONUCU KANONİK OTORİTEYE TAŞINIR.
     Eskiden bu rapor YALNIZ DTCPanel'in yerel state'inde yaşıyordu; Mavi,
     AI Mechanic ve uzak teşhis onu HİÇ göremiyordu ve yalnız Mode 03
     listesine bakıp "araç temiz" diyebiliyordu. */
  /* ── P0-VDK-F1B · KEEPALIVE KESİN DURUR ────────────────────────────────
     Tarama bitti → bu işleme ait TÜM oturum kiraları kapanır. Bir işlem
     kapandıktan sonra hattan tek bir `3E` daha çıkamaz; zamanlayıcı canlı
     kira kalmayınca kendini DURDURUR (timer sızıntısı yapısal olarak yok). */
  closeLeasesForTransaction(txn, 'tarama tamamlandı');
  /* P0-VDK-F2A: işlem sınırı — kronolojinin sonu tek bakışta görünür. */
  traceTransactionBoundary(txn, 'end');

  const published = _publishScanToAuthority(report, sessionEpoch, activeProtocol);

  /* ── P0-OBD-PARITY · TURUN TOPLAM SAYIM KÜNYESİ ────────────────────────
     Servis satırları okuma ANINDA yazıldı; bu satır turun BÜTÜNÜNÜ ölçer ve
     tek gerçek soruyu yanıtlar: **ECU'nun gönderdiği kayıt sayısı ile ekrana
     ulaşan satır sayısı tutuyor mu?**

     `authority` burada KANONİK otoriteden (`dtcAuthority`) okunur — tarama içi
     `authorityCodes` listesinden DEĞİL. İkisi farklı dedup uygular
     (`observationKey` kod+sınıf+ECU+alt kod+status) ve tam olarak aradaki
     fark, üretici kodlarının sessizce eridiği yerlerden biriydi.

     Sayı okunamazsa `null` KALIR — `describeDtcPipelineLoss` bunu `UNKNOWN`
     yapar, "kayıp yok" DEMEZ. */
  try {
    let authorityCount: number | null = null;
    try {
      authorityCount = getDtcAuthoritySnapshot().observations
        .filter((o) => o.sessionEpoch === sessionEpoch && o.provenance === 'physical_ecu').length;
    } catch { authorityCount = null; }

    const rawTotal = results.reduce<number | null>((acc, r) => {
      if (acc === null) return null;
      return acc + r.authorityCodes.length;
    }, 0);

    recordDtcPipelineEntry({
      sessionEpoch, txHeader: 'TOPLAM', rxHeader: 'TOPLAM', ecuLabel: `${scanList.length} ECU`,
      service: 'TOTAL', subFunction: 'TOTAL', protocol: activeProtocol,
      /* Tur toplamında `raw` = kanıt katmanına ulaşan satır (servis satırları
         zarf geometrisini zaten ayrı ayrı ölçtü); asıl aranan AUTHORITY↔UI. */
      raw: rawTotal, parsed: rawTotal,
      authority: authorityCount, ui: allCodes.length,
      measured: published, outcome: published ? 'ok' : 'not_published',
    });
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
  try {
    _kwpEvidence = Object.freeze({ ..._kwpEvidence,
      publishedToCanonicalAuthority: results.some((r) => r.authorityCodes.some((c) => c.fromKwp === true)),
    });
  } catch { /* kanıt yayını ürünü düşürmez */ }
  /* P0-OBD-FINAL-01 (ÖNCELİK 4) — "otorite yayını" artık ÖLÇÜLÜR bir alandır.
     Eskiden bir ECU'nun sonucunun kanonik DTC otoritesine gerçekten yazılıp
     yazılmadığı hiçbir yerde görünmüyordu; yayın sessizce düşse rapor yine
     "tarandı" derdi. */
  try {
    for (const o of getEcuObservations()) {
      if (o.sessionEpoch !== sessionEpoch) continue;
      recordEcuObservation({ ...o, publishedToAuthority: published });
    }
  } catch { /* kanıt kaydı ürünü düşürmez */ }
  return report;
}

/* ═══════════════════════════════════════════════════════════════════════
   P0-VDK-F6B — KAPSAM PLANI VE KAPSAM KANITI (yeni otorite KURMAZ)
   ═══════════════════════════════════════════════════════════════════════ */

/** Aktif protokolden planın anladığı aile. Ölçülmediyse `unknown` (fail-closed). */
function _protocolFamily(protocol: string | null): 'can' | 'kwp' | 'unknown' {
  if (protocol === null) return 'unknown';
  if (isSlowSerialProtocol(protocol)) return 'kwp';
  const cls = classifyProtocol(protocol);
  return cls === 'can' ? 'can' : 'unknown';
}

/**
 * Bu OTURUMDA bu uç noktada ÖLÇÜLMÜŞ servis yokluğu.
 *
 * YALNIZ `NRC 0x11` (serviceNotSupported) bir servisi "yok" yapar — F4-B
 * `deriveServicePresence`in pazarlıksız kuralıyla BİREBİR aynı ilke. 0x12/0x31
 * yokluğun KANITI DEĞİLDİR ve buradan atlama üretmez; aksi hâlde "argümanım
 * aralık dışı" diyen bir ECU'nun servisi sonsuza dek sorulmaz olurdu.
 *
 * İKİNCİ YETENEK OTORİTESİ DEĞİL: kaynak mevcut `advancedDtcEvidence` defteridir
 * ve kapsam OTURUM MÜHRÜ + uç nokta adresidir — başka aracın öğrenmesi TAŞINMAZ.
 */
function _measuredPresenceFor(
  tx: string, epoch: number, ecuKey: string, protocol: string | null,
): ReadonlyMap<string, ServicePresence> {
  const out = new Map<string, ServicePresence>();
  try {
    for (const e of getAdvancedDtcEvidence()) {
      if (e.sessionEpoch !== epoch || e.tx !== tx) continue;
      if (e.outcome === 'unsupported' && e.nrc === NRC_SERVICE_NOT_SUPPORTED) {
        out.set(`${e.service}|${e.service === '19' ? e.subFunction : ''}`, 'ABSENT');
      }
    }
  } catch { /* fail-soft: kanıt okunamazsa plan DARALMAZ, geniş kalır */ }

  /* ── P0-VDK-F6E · ÖĞRENİLMİŞ YOKLUK PLANA GİRER ──────────────────
     Geçen turlarda AYNI araçta AYNI uç noktada `7F .. 11` ile kanıtlanmış bir
     servis her taramada yeniden sorulmak zorunda değildir. Karar MEVCUT F4-C
     `decideReuse` otoritesindedir: bayat (30 gün) · çelişkili · canlı olmayan ·
     taşıma koşulu değişmiş · parmak izi zayıf kenar **REUSE ÜRETMEZ** ve
     gerçek sorgu geri gelir. Öğrenme bir HIZ optimizasyonudur; kapsamı DEĞİL.

     YALNIZ `ABSENT` atlatır: öğrenilmiş `PRESENT` hiçbir sorguyu KALDIRMAZ —
     kaldırsaydı öğrenme, ölçmesi gereken bir kanalı ölçmeden "biliyorum" derdi.

     FAIL-SOFT: öğrenme okunamazsa plan ESKİSİ GİBİ (geniş) kalır. */
  try {
    const scope = getCapabilityScope();
    const vehicleRef = scope.vehicleRef;
    if (vehicleRef === null) return out;
    const learned = learnedCoverageSkips(
      getVehicleCapabilities(vehicleRef), ecuKey,
      {
        nowMs: Date.now(),
        /* ── P0-VDK-F6E-1 · KANONİK DEĞER, TÜRETME YOK ─────────────────
           Önceki tur burada `scope.persistenceAllowed` kullanıyordu — o "DİSKE
           yazabilir miyiz" sorusudur ve köken/iz modu/referans BİÇİMİ
           kapılarını da içerir. "Kimlik bu öğrenmeyi bu araca ATFEDECEK kadar
           güçlü mü" sorusunun KANONİK cevabı F4-C `isFingerprintReusable`tır
           ve artık kapsam üzerinde AYNEN taşınır. İkinci bir güven hesabı YOK. */
        fingerprintReusable: scope.fingerprintReusable,
        transport: { genericBridge: genericBridgeAvailable(), routePolicy: null,
          adapterHash: null },
        /* P0-VDK-F6E-1 — PROTOKOL İZOLASYONU: CAN'de öğrenilmiş yokluk KWP
           taramasında atlama gerekçesi OLAMAZ. Karar yine `decideReuse`de. */
        protocol,
      });
    return mergeMeasuredAndLearned(out, learned);
  } catch { return out; }
}

/** Bir uç noktanın salt-okunur DTC kapsam planı (girdiler MEVCUT otoritelerden). */
function _planCoverageFor(
  ecu: DiscoveredEcu, protocol: string | null, epoch: number,
): readonly DtcCoveragePlanStep[] {
  let defIds: ReadonlySet<string> = new Set<string>();
  try {
    defIds = new Set([...builtinServiceDefs(), ...extraReadOnlyServiceDefs()].map((d) => d.id));
  } catch { /* fail-soft: tanım okunamazsa plan TÜMÜYLE BLOCKED olur (fail-closed) */ }
  return planEcuDtcCoverage({
    protocolFamily: _protocolFamily(protocol),
    addressable: _hasPhysicalTarget(ecu),
    advancedBridge: vdkAdvancedDtcsFn() !== null,
    /* `readUdsForEcu`nun KENDİ kapısıyla BİREBİR aynı koşul — ikinci bir
       köprü kuralı kurulmaz, mevcut olan okunur. */
    legacyUdsBridge: vdkTransportAvailable() && typeof CarLauncher.readUdsDtcs === 'function',
    standardBridge: vdkDtcFromEcuFn() !== null,
    readOnlyUdsSubFunctions: GENERIC_UDS_19_SUBS,
    serviceDefIds: defIds,
    measuredPresence: _measuredPresenceFor(
      ecu.txHeader, epoch, ecuCoverageKey(ecu), protocol),
  });
}

/** `EcuModeStatus` → kapsam sınıfı (standart modların TEK çevirisi). */
function _coverageFromModeStatus(st: EcuModeStatus | null): DtcCoverageOutcome {
  if (st === 'ok') return 'COMPLETE';
  if (st === 'unsupported') return 'UNSUPPORTED_MEASURED';
  if (st === 'deferred') return 'DEFERRED';
  if (st === 'failed') return 'UNKNOWN';
  return 'DEFERRED';   // null = hiç sorulmadı
}

/** Bir kapsam sınıfının ÖLÇÜLEN sonucu (plan QUERY dediyse). */
function _measuredCoverage(
  cls: DtcCoverageClass, r: EcuScanResult, declared: DeclaredCountVerdict,
): { outcome: DtcCoverageOutcome; measured: string | null; records: number | null } {
  switch (cls) {
    case 'STANDARD_STORED':
      return { outcome: _coverageFromModeStatus(r.stored), measured: r.stored,
        records: r.codes.filter((c) => c.mode === 'stored' && !c.fromUds && !c.fromKwp).length };
    case 'STANDARD_PENDING':
      return { outcome: _coverageFromModeStatus(r.pending), measured: r.pending,
        records: r.codes.filter((c) => c.mode === 'pending' && !c.fromUds && !c.fromKwp).length };
    case 'STANDARD_PERMANENT':
      return { outcome: _coverageFromModeStatus(r.permanent), measured: r.permanent,
        records: r.codes.filter((c) => c.mode === 'permanent' && !c.fromUds && !c.fromKwp).length };
    case 'UDS_STATUS_AVAILABILITY':
      return { outcome: coverageOutcomeFromAdvanced(r.udsAvailabilityDiagnosticOutcome ?? null),
        measured: r.udsAvailabilityDiagnosticOutcome ?? null, records: null };
    case 'UDS_DTC_BY_STATUS':
      return { outcome: coverageOutcomeFromAdvanced(r.udsDiagnosticOutcome ?? null, declared),
        measured: r.udsDiagnosticOutcome ?? null, records: r.udsParsedCount ?? null };
    case 'UDS_SUPPORTED_DTC':
      return { outcome: coverageOutcomeFromAdvanced(r.udsSupportedDiagnosticOutcome ?? null),
        measured: r.udsSupportedDiagnosticOutcome ?? null,
        records: r.authorityCodes.filter((c) => c.udsSubFunction === '0A').length };
    case 'UDS_SNAPSHOT_ID':
      return { outcome: coverageOutcomeFromAdvanced(r.udsSnapshotDiagnosticOutcome ?? null),
        measured: r.udsSnapshotDiagnosticOutcome ?? null,
        records: r.udsSnapshotReferenceCount ?? null };
    case 'UDS_EXTENDED_DATA':
      return { outcome: coverageOutcomeFromAdvanced(r.udsExtendedDiagnosticOutcome ?? null),
        measured: r.udsExtendedDiagnosticOutcome ?? null, records: r.udsExtendedRequests ?? null };
    case 'KWP_DTC_18':
      return { outcome: r.kwpDiagnosticOutcome !== undefined
        ? coverageOutcomeFromAdvanced(r.kwpDiagnosticOutcome)
        : _coverageFromModeStatus(r.kwp),
        measured: r.kwpDiagnosticOutcome ?? r.kwp,
        records: r.authorityCodes.filter((c) => c.fromKwp === true && c.kwpService !== '13').length };
    case 'KWP_DTC_13':
      return { outcome: r.kwp13DiagnosticOutcome !== undefined
        ? coverageOutcomeFromAdvanced(r.kwp13DiagnosticOutcome)
        : _coverageFromModeStatus(r.kwp13),
        measured: r.kwp13DiagnosticOutcome ?? r.kwp13,
        records: r.authorityCodes.filter((c) => c.kwpService === '13').length };
    case 'UDS_SNAPSHOT_RECORD':
    default:
      /* 0x19-04 bu turda hatta ÇIKMAZ (native kapı kümesinde YOK) — plan zaten
         SKIP der ve buraya DÜŞMEZ. Fail-closed varsayılan: ölçüm YOK. */
      return { outcome: 'DEFERRED', measured: null, records: null };
  }
}

/**
 * P0-VDK-F6B — bir uç noktanın tur kapsamını kanıt defterine yazar (TEK yer).
 *
 * ASLA throw etmez. ÜRÜNÜ DEĞİŞTİRMEZ: kod listesi, hüküm ve kapsam yüzdesi
 * bu fonksiyondan ETKİLENMEZ — yalnız "neyi sordum / ne alamadım" görünür olur.
 */
function _recordEcuCoverage(
  ecu: DiscoveredEcu, r: EcuScanResult, plan: readonly DtcCoveragePlanStep[],
  addressability: EcuAddressability, sessionEpoch: number, protocol: string | null,
  txn: DiagnosticTransaction | null,
): void {
  try {
    const declared = compareDeclaredRecordCount(r.udsDeclaredDtcCount, r.udsParsedCount);
    const rows: DtcCoverageRow[] = [];
    let capabilityReused = 0;

    for (const spec of DTC_COVERAGE_CLASS_SPECS) {
      const step = plan.find((x) => x.cls === spec.cls);
      if (step === undefined) continue;

      if (step.decision === 'SKIP') {
        if (step.skipReason === 'SERVICE_ABSENT_MEASURED') capabilityReused++;
        const skipOutcome = coverageOutcomeFromSkip(step.skipReason ?? 'NOT_QUERIED');
        rows.push({
          cls: spec.cls, axis: spec.axis, service: spec.service, subFunction: spec.subFunction,
          outcome: skipOutcome,
          gapRoot: coverageGapRoot(skipOutcome, null, step.skipReason),
          nrc: null,
          skipReason: step.skipReason, requestCount: 0,
          recordCount: null, declaredCount: null, declaredVerdict: 'UNKNOWN',
          measuredOutcome: null, detail: step.detail,
        });
        continue;
      }

      const m = _measuredCoverage(spec.cls, r, spec.cls === 'UDS_DTC_BY_STATUS' ? declared : 'UNKNOWN');

      /* ÖN KOŞULLU sınıf hiç sorulmadıysa bu bir KAYIP DEĞİL, ölçülmüş bir
         yokluktur: gönderilecek hedef kaydı YOKTU. */
      if (step.decision === 'CONDITIONAL' && m.measured === null) {
        rows.push({
          cls: spec.cls, axis: spec.axis, service: spec.service, subFunction: spec.subFunction,
          outcome: 'DEFERRED', skipReason: 'NO_PRECONDITION_EVIDENCE',
          gapRoot: coverageGapRoot('DEFERRED', null, 'NO_PRECONDITION_EVIDENCE'),
          nrc: null,
          requestCount: 0, recordCount: null, declaredCount: null,
          declaredVerdict: 'UNKNOWN', measuredOutcome: null,
          detail: 'ölçülmüş DTC kaydı yok — gönderilecek hedef YOKTU',
        });
        continue;
      }

      const finalOutcome: DtcCoverageOutcome = m.measured === null ? 'DEFERRED' : m.outcome;
      const finalSkip = m.measured === null ? ('NOT_QUERIED' as const) : null;
      /* P0-VDK-F6E — ÖĞRENME İÇİN HAM NRC. Yalnız gelişmiş servislerde
         ölçülür; standart modlarda native NRC taşımaz → `null`. */
      const rowNrc = (spec.service === '19' || spec.service === '18' || spec.service === '13')
        ? _lastAdvancedNrc(spec.service, spec.subFunction, ecu.txHeader, sessionEpoch)
        : null;
      rows.push({
        cls: spec.cls, axis: spec.axis, service: spec.service, subFunction: spec.subFunction,
        gapRoot: coverageGapRoot(finalOutcome, m.measured, finalSkip),
        nrc: rowNrc,
        /* Plan "sorulur" dedi ama ölçüm YOKSA bu ERTELENMİŞTİR — "desteklenmiyor"
           ya da "temiz" DEĞİL. */
        outcome: finalOutcome,
        skipReason: finalSkip,
        requestCount: m.measured === null ? 0 : 1,
        recordCount: m.records,
        declaredCount: spec.cls === 'UDS_DTC_BY_STATUS' ? (r.udsDeclaredDtcCount ?? null) : null,
        declaredVerdict: spec.cls === 'UDS_DTC_BY_STATUS' ? declared : 'UNKNOWN',
        measuredOutcome: m.measured, detail: step.detail,
      });
    }

    const measured = rollupEcuDtcCoverage(
      rows.map<CoverageRollupRow>((x) => ({ cls: x.cls, outcome: x.outcome })));
    /* Adreslenemeyen uç noktada hüküm EZİLİR ama BİRİM SAYIMLARI KORUNUR:
       payda ve terminal sayısı ölçülmüş gerçektir ve kapsam oranının
       hesaplanabilmesi için gereklidir. */
    const rollup = addressability === 'NOT_ADDRESSABLE'
      ? { ...measured,
          verdict: 'NOT_ADDRESSABLE' as const,
          reasons: ['fiziksel istek gitti, ECU sustu — kapsam ÖLÇÜLEMEDİ'],
          completeClasses: 0, incompleteClasses: rows.length,
          deep: { ...measured.deep, verdict: 'NOT_ADDRESSABLE' as const } }
      : measured;

    const id = lookupEcuIdentity(ecu.rxHeader, ecu.addressBits);
    recordDtcCoverage({
      atMs: Date.now(), sessionEpoch,
      /* P0-VDK-F6C — İKİ EKSENİ BİRLEŞTİREN ANAHTAR.
         `ecuCompleteness` uç noktaları `ecuCoverageKey` (adres bitleri + rx) ile
         anahtarlıyor; kapsam defteri ise yalnız `rxHeader` ile. İki eksen ancak
         AYNI anahtarla birleşebilir — aksi hâlde “6 uç nokta bulundu, 6'sının
         kapsamı ölçüldü” iddiası yanlış eşleşmeyle üretilebilirdi. */
      ecuKey: ecuCoverageKey(ecu),
      txHeader: _txOrNull(ecu), rxHeader: ecu.rxHeader, ecuLabel: ecu.label,
      /* Rol KANITTAN gelir; `unknown` bir rol DEĞİL, kanıt yokluğudur → null. */
      role: id?.role !== undefined && id.role !== 'unknown' ? id.role
        : (ecu.role === 'unknown' ? null : ecu.role),
      roleEvidence: id?.evidence ?? ecu.roleEvidence ?? null,
      protocol,
      /* P0-VDK-F6D — F5-D kanıt bağları. Ölçülmeyen `null` KALIR. */
      transactionId: txn?.transactionId ?? null,
      evidenceCorrelationId: txn?.evidenceCorrelationId ?? null,
      vehicleRef: _activeVehicleRef(),
      /* P0-VDK-F6C — replay koşusu ÜRÜN hükmü üretemez (F4-C ilkesi). */
      provenance: isReplayActive() ? 'replay' : 'live',
      addressability,
      verdict: rollup.verdict, reasons: rollup.reasons,
      /* P0-VDK-F6C — DERİN eksen AYRI taşınır: `19-04` yapısal olarak kapalı
         olduğu için temel kapsamı sonsuza dek kısmi göstermek yasak. */
      deepVerdict: rollup.deep.verdict, deepReasons: rollup.deep.reasons,
      corePlannedUnits: rollup.core.plannedUnits,
      coreTerminalUnits: rollup.core.terminalUnits,
      deepPlannedUnits: rollup.deep.plannedUnits,
      deepTerminalUnits: rollup.deep.terminalUnits,
      rows,
      requestCount: r.requestCount ?? 0,
      dtcCount: r.codes.length,
      failureTypeCount: r.authorityCodes.filter((c) =>
        (c.subCode ?? c.failureType ?? '') !== '').length,
      statusByteCount: r.authorityCodes.filter((c) => (c.rawStatus ?? '') !== '').length,
      statusMask: r.udsStatusMask ?? null,
      statusMaskProvenance: r.udsStatusMaskProvenance ?? null,
      snapshotReferenceCount: r.udsSnapshotReferenceCount ?? null,
      /* `true` YALNIZ "ham genişletilmiş veri MEVCUT" demektir; baytların ANLAMI
         OEM'e özgüdür ve UYDURULMAZ. Ölçülmediyse `null`. */
      extendedDataAvailable: r.udsExtendedDiagnosticOutcome === undefined
        ? null : r.udsExtendedDiagnosticOutcome === 'ok',
      capabilityReused,
    });
  } catch (e) {
    logError('OBD:DtcCoverageEvidence', e);   // kanıt yazımı taramayı DÜŞÜRMEZ
  }
}

/**
 * P0-VDK-F6D — AKTİF ARAÇ REFERANSI (yeni kimlik otoritesi DEĞİL).
 *
 * Kaynak MEVCUT `capabilityStore.getCapabilityScope()`tur. Tarama anında araç
 * bölümü henüz aktive edilmemiş olabilir (o iş tam tarama SONRASINDA
 * `runProductionDiscovery` içinde yapılır) — o zaman `null` döner ve bu
 * DÜRÜST bir sonuçtur: kimliği bilinmeyen bir ölçümü bir araca atfetmek YASAK.
 */
function _activeVehicleRef(): string | null {
  try { return getCapabilityScope().vehicleRef; } catch { return null; }
}

/**
 * P0-VDK-F6C — bu turun kapsam defterini `ecuCompleteness` girdisine çevirir.
 *
 * SAF VERİ KÖPRÜSÜ: yeni ölçüm ÜRETMEZ, yeni otorite KURMAZ. Yalnız BU
 * oturuma ait satırlar taşınır — başka bir oturumun (başka aracın) kapsamı
 * bu turun hükmüne KARIŞAMAZ. Ham DTC kodu/gövdesi bu köprüden GEÇMEZ.
 */
function _diagnosticInputs(sessionEpoch: number): readonly DiagnosticEndpointInput[] | null {
  try {
    const rows: readonly DtcCoverageEcuEntry[] = getDtcCoverageEvidence()
      .filter((e) => e.sessionEpoch === sessionEpoch);
    if (rows.length === 0) return null;   // kanıt YOK → `null` (sahte 0 YASAK)
    return rows.map<DiagnosticEndpointInput>((e) => ({
      ecuKey: e.ecuKey,
      coreVerdict: e.verdict, deepVerdict: e.deepVerdict,
      corePlannedUnits: e.corePlannedUnits, coreTerminalUnits: e.coreTerminalUnits,
      deepPlannedUnits: e.deepPlannedUnits, deepTerminalUnits: e.deepTerminalUnits,
      roleUnknown: e.role === null || e.role === 'unknown',
      productTrusted: isProductTrusted(e.provenance),
      requestCount: e.requestCount,
      rows: e.rows.map((r) => ({ axis: r.axis, outcome: r.outcome, gapRoot: r.gapRoot })),
    }));
  } catch { return null; }   // fail-soft: kanıt okunamazsa kapsam ESKİSİ GİBİ
}

/** Servis sonucu → kanonik tarama sonucu. `null` = hiç denenmedi. */
function _ecuStatusToOutcome(st: EcuModeStatus | null): DtcScanOutcome {
  if (st === null)          return 'not_scanned';
  if (st === 'ok')          return 'ok';
  if (st === 'unsupported') return 'unsupported';
  /* `deferred` bir BAŞARISIZLIK değildir ama BAŞARI hiç değildir: kanonik
     otoritede "hiç taranmadı" sayılır → hüküm motoru bunu temizlik kanıtı
     OLARAK KULLANAMAZ. */
  if (st === 'deferred')    return 'not_scanned';
  return 'failed';
}

/* ══════════════════════════════════════════════════════════════════════════
   P0-OBD-FINAL-01 — TARAMA YARDIMCILARI (saf/ince; ikinci otorite KURMAZ)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu ECU okunabilir mi? Engel varsa TR gerekçe döner, yoksa `null`.
 *
 * İKİ EKSEN:
 *  ① tanı admisyonu (session/recovery/reconnect) — `diagnosticAdmission` TEK
 *     otoritedir, burada yeniden hesaplanmaz, yalnız SORULUR (senkron okuma:
 *     ek native trafik üretmez).
 *  ② oturum mührü — tarama ortasında yeniden bağlanma olduysa epoch DEĞİŞİR;
 *     o noktadan sonraki okumalar BAŞKA bir oturuma aittir ve aynı raporda
 *     birleştirilirse rapor kendi içinde çelişir.
 */
function _admissionFor(_ecu: DiscoveredEcu, scanEpoch: number): string | null {
  let nowEpoch = scanEpoch;
  try { nowEpoch = getObdSessionEpoch(); } catch { nowEpoch = scanEpoch; }
  if (nowEpoch !== scanEpoch) {
    return `oturum DEĞİŞTİ (tarama ${scanEpoch} → şimdi ${nowEpoch})`;
  }
  try {
    const a = getDiagnosticAdmissionSync();
    if (a.admission !== 'READY') return `${a.admission}: ${a.reason}`;
  } catch { /* fail-soft: kapı okunamazsa tarama ESKİSİ GİBİ sürer */ }
  return null;
}

/** Fiziksel hedef gerçekten var mı — boş `tx` native'de FONKSİYONEL hat demektir. */
function _hasPhysicalTarget(ecu: DiscoveredEcu): boolean {
  return typeof ecu.txHeader === 'string' && ecu.txHeader.length > 0
    && ecu.txProvenance !== 'unknown';
}

/** Kanıt defterinde boş string yerine dürüst `null`. */
function _txOrNull(ecu: DiscoveredEcu): string | null {
  return typeof ecu.txHeader === 'string' && ecu.txHeader.length > 0 ? ecu.txHeader : null;
}

/**
 * Native'in ÖLÇTÜĞÜ sonucu kanıt defterinin sınıfına çevirir.
 *
 * Eski APK `outcome` TAŞIMAZ → `supported` bayrağına düşülür (mevcut davranış
 * BİREBİR korunur). Yeni APK'da "NO DATA" artık `ok` SAYILMAZ: P0-OBD-11'in
 * kök nedeni tam olarak sessizliğin başarı sanılmasıydı.
 */
function _outcomeFromNative(nativeOutcome: string | null, supported: boolean): DtcReadOutcome {
  if (nativeOutcome === null) return supported === false ? 'unsupported' : 'ok';
  switch (nativeOutcome.trim()) {
    case 'OK':          return 'ok';
    case 'UNSUPPORTED': return 'unsupported';
    case 'NO_RESPONSE': return 'no_response';
    case 'BUS_ERROR':   return 'failed';
    case 'NO_SID':      return 'failed';
    default:            return supported === false ? 'unsupported' : 'ok';
  }
}

/**
 * P0-OBD-FINAL-02 — KWP TANI OTURUMU PROBU (kontrollü, salt-kanıt).
 *
 * ── NE ZAMAN KOŞAR ────────────────────────────────────────────────────────
 * YALNIZ üç koşul birden sağlanınca:
 *   (1) aktif protokol YAVAŞ SERİ (KWP2000/ISO 9141) — CAN'de anlamsız trafik,
 *   (2) fiziksel Mode 03/07/0A denemesi adresi KANITLAYAMADI (`PROVEN` değil),
 *   (3) native köprü bu yeteneği taşıyor (eski APK'da yok → graceful degrade).
 * Yani adres zaten kanıtlandıysa FAZLADAN TEK KOMUT BİLE gönderilmez.
 *
 * ── NE YAPAR / NE YAPMAZ ──────────────────────────────────────────────────
 * Yalnız KANIT toplar. `10 81`/`10 C0` SALT OTURUM komutlarıdır: ECU'ya YAZMAZ,
 * security access DEĞİLDİR. Sonuç ne olursa olsun bu fonksiyon adreslenebilirliği
 * DÜŞÜRMEZ — yalnız POZİTİF kanıt varsa YÜKSELTİR (monoton, fail-closed).
 * Sessizlik/NRC/bozuk yanıt POZİTİF SAYILMAZ ve 0x18 zincirini AÇMAZ.
 */
/**
 * Native ileri bir sürümde TANIMADIĞIMIZ bir oturum komutu gönderirse, o komutun
 * pozitif öneki BİLİNMEZ. Hex olmayan bu sentinel HAM YANITTA ASLA eşleşmez
 * (`compactHex` yalnız 0-9A-F bırakır) → sonuç `MALFORMED` kalır. Uydurma bir
 * pozitif önek eşleştirmek, ölçülmemiş bir başarıyı başarı saymak olurdu.
 */
const UNKNOWN_SESSION_NEEDLE = 'BILINMEYEN-ONEK';

async function _probeKwpSession(
  ecu: DiscoveredEcu, sessionEpoch: number, protocol: string | null,
): Promise<KwpSessionVerdict> {
  const tx = ecu.txHeader;
  if (!Capacitor.isNativePlatform() || !CarLauncher.probeKwpSession || !isSlowSerialProtocol(protocol)) {
    return summarizeKwpSession(getKwpSessionProbes(), tx, sessionEpoch);
  }
  try {
    const res = await CarLauncher.probeKwpSession({ tx, rx: ecu.rxHeader });
    const request = typeof res.request === 'string' && res.request.length > 0 ? res.request : null;
    /* Hangi komutun kanıtı olduğunu ISTEKTEN çözeriz; native başka bir komut
       gönderdiyse (ileri sürüm) pozitif önek BİLİNMEZ → eşleşme yapılmaz ve
       sonuç `MALFORMED` kalır. Uydurma pozitif önek YASAK. */
    const cmd = KWP_SESSION_COMMANDS.find((c) => c.request === request)
      ?? { request: request ?? '', positive: UNKNOWN_SESSION_NEEDLE, label: 'bilinmeyen oturum komutu' };
    const raw = typeof res.raw === 'string' && res.raw.length > 0 ? res.raw : null;
    const outcome = typeof res.outcome === 'string' && res.outcome.length > 0 ? res.outcome : null;
    const nrc = typeof res.nrc === 'number' && Number.isFinite(res.nrc) ? res.nrc : null;
    const verdict = classifyKwpSessionResponse(cmd, { request, raw, outcome, nrc });
    recordKwpSessionProbe({
      atMs: Date.now(), sessionEpoch, tx, rx: ecu.rxHeader, protocol,
      request, positiveNeedle: cmd.positive, raw,
      result: verdict.result, nrc: verdict.nrc, nativeOutcome: outcome,
      error: typeof res.error === 'string' && res.error.length > 0 ? res.error : null,
    });
  } catch (e) {
    /* Hat hatası ECU hakkında BİR ŞEY SÖYLEMEZ — kanıt olarak öyle yazılır. */
    recordKwpSessionProbe({
      atMs: Date.now(), sessionEpoch, tx, rx: ecu.rxHeader, protocol,
      request: null, positiveNeedle: '', raw: null,
      result: 'TRANSPORT_ERROR', nrc: null, nativeOutcome: null,
      error: e instanceof Error ? e.message : String(e),
    });
    logError('OBD:KwpSessionProbeFailed', e);   // prob düştü — tarama DURMAZ
  }
  return summarizeKwpSession(getKwpSessionProbes(), tx, sessionEpoch);
}

/**
 * P0-OBD-DIAG-01 — FİZİKSEL ADRESLEME MATRİSİ (kontrollü, salt-okuma).
 *
 * Matrisin TEK sahibi `kwpAddressingProbe.ts`tir; burada yalnız SIRAYLA koşulur.
 * Kontrol satırı (fonksiyonel) HER ZAMAN koşar ve erken durdurmaz: fiziksel
 * satırların sessizliği ancak hat CANLIYKEN "adres kapalı" anlamına gelir.
 * İlk CEVAP VEREN fiziksel satırda durulur (gereksiz K-line trafiği yok).
 *
 * Hiçbir sonuç adreslenebilirliği DÜŞÜRMEZ — yalnız kanıt varsa YÜKSELTİR.
 */
async function _probeKwpAddressing(
  ecu: DiscoveredEcu, sessionEpoch: number, protocol: string | null,
): Promise<KwpAddressingVerdict> {
  const rx  = ecu.rxHeader;
  const src = ecuSourceFromRxHeader(rx);
  if (!Capacitor.isNativePlatform() || !CarLauncher.probeKwpAddressingRow
      || !isSlowSerialProtocol(protocol) || src === null) {
    return summarizeKwpAddressing(getKwpAddressingProbes(), rx, sessionEpoch);
  }

  const rows = KWP_ADDRESSING_VARIANTS.slice(0, KWP_ADDRESSING_MAX_VARIANTS);
  /* K-line BAŞLATMA satırlarının kapısı: başlatma çalışan fonksiyonel oturumu
     ANLIK olarak böler, bu yüzden ancak "hat canlı AMA fiziksel adres kapalı"
     ÖLÇÜLDÜKTEN sonra denenir. Kontrol satırı cevap vermediyse hattın kendisi
     şüphelidir ve onu bir de biz yeniden başlatmayız. */
  let controlAnswered = false;
  for (const v of rows) {
    const init = v.initFirst ?? null;
    if (init !== null && !controlAnswered) continue;   // hat kanıtlanmadan başlatma YOK
    const header = resolveVariantHeader(v, src);
    try {
      const res = await CarLauncher.probeKwpAddressingRow(
        init === null ? { header, request: v.request } : { header, request: v.request, init });
      const request = typeof res.request === 'string' && res.request.length > 0 ? res.request : null;
      const raw     = typeof res.raw === 'string' && res.raw.length > 0 ? res.raw : null;
      const outcome = typeof res.outcome === 'string' && res.outcome.length > 0 ? res.outcome : null;
      const initRaw = typeof res.initRaw === 'string' && res.initRaw.length > 0 ? res.initRaw : null;
      const verdict = classifyKwpAddressingResponse(v, { request, raw, outcome, initRaw });
      recordKwpAddressingProbe({
        atMs: Date.now(), sessionEpoch, rx, header,
        variantId: v.id, physical: v.physical, initFirst: init, initRaw,
        request, raw, result: verdict.result, nrc: verdict.nrc,
        protocol, nativeOutcome: outcome,
        error: typeof res.error === 'string' && res.error.length > 0 ? res.error : null,
      });
      if (!v.physical && (verdict.result === 'ANSWERED' || verdict.result === 'NEGATIVE')) {
        controlAnswered = true;   // hat CANLI ölçüldü → başlatma satırları serbest
      }
      /* ERKEN DURDURMA: fiziksel bir satır ECU'dan yanıt aldıysa (pozitif ya da
         ayrık negatif) aradığımız kanıt ELDEDİR; kalan satırları göndermek
         yalnız K-line'ı meşgul eder. */
      if (v.physical && (verdict.result === 'ANSWERED' || verdict.result === 'NEGATIVE')) break;
    } catch (e) {
      recordKwpAddressingProbe({
        atMs: Date.now(), sessionEpoch, rx, header,
        variantId: v.id, physical: v.physical, initFirst: init, initRaw: null,
        request: null, raw: null, result: 'TRANSPORT_ERROR', nrc: null,
        protocol, nativeOutcome: null,
        error: e instanceof Error ? e.message : String(e),
      });
      logError('OBD:KwpAddressingProbeFailed', e);   // matris düştü — tarama DURMAZ
      break;                                         // hat hatasında ısrar etme
    }
  }
  return summarizeKwpAddressing(getKwpAddressingProbes(), rx, sessionEpoch);
}

/** Adreslenebilirlik kararının insan-okur gerekçesi (LAB'da kararın NEDENİ). */
function _addressabilityReason(
  a: EcuAddressability, attempts: readonly EcuServiceAttempt[],
): string {
  const seen = attempts.map((x) => `${x.service}${x.subFunction === null ? '' : `-${x.subFunction}`}:${x.outcome ?? '?'}`);
  const tail = seen.length === 0 ? 'deneme yok' : seen.join(' · ');
  switch (a) {
    case 'PROVEN':
      return `fiziksel istek cevaplandı (${tail})`;
    case 'NOT_ADDRESSABLE':
      return `fiziksel istek gitti, ECU sustu (${tail})`;
    case 'NOT_ATTEMPTED':
      return `istek gönderilmedi (${tail})`;
    default:
      return `sonuç ölçülemedi — eski köprü sonuç alanı taşımıyor olabilir (${tail})`;
  }
}

/**
 * P0-VDK-F6E — bu tur+ECU+servis+alt fonksiyon için ÖLÇÜLEN NRC.
 *
 * ÖĞRENME KAPISI: yokluk iddiası (`ABSENT`) yalnız NRC `0x11` ile öğrenilebilir.
 * Kaynak MEVCUT `advancedDtcEvidence` defteridir; yeni bir NRC otoritesi
 * KURULMADI. Ölçülmediyse `null` — sahte 0 YASAK.
 */
function _lastAdvancedNrc(
  service: '19' | '18' | '13', subFunction: string | null, tx: string, epoch: number,
): number | null {
  try {
    const hit = [...getAdvancedDtcEvidence()].reverse().find((e) =>
      e.service === service && e.tx === tx && e.sessionEpoch === epoch
      && (subFunction === null || e.subFunction === subFunction));
    return hit?.nrc ?? null;
  } catch { return null; }
}

/** Gelişmiş (19/18) kanıtından bu tur+ECU için SON ham yanıt; yoksa `null`. */
function _lastAdvancedRaw(service: '19' | '18' | '13', tx: string, epoch: number): string | null {
  try {
    const hit = [...getAdvancedDtcEvidence()].reverse().find((e) =>
      e.service === service && e.tx === tx && e.sessionEpoch === epoch);
    return hit?.raw ?? null;
  } catch { return null; }
}

/** Keşif/adreslenebilirlik gözlemini deftere yazar (ASLA fırlatmaz). */
function _observe(
  ecu: DiscoveredEcu, sessionEpoch: number, protocol: string | null,
  addressability: EcuAddressability, reason: string,
  attempts: readonly EcuServiceAttempt[], admission: string, kwpTargetVerified: boolean,
): void {
  try {
    recordEcuObservation({
      atMs: Date.now(), sessionEpoch, protocol,
      rxHeader: ecu.rxHeader, txHeader: _txOrNull(ecu), addressBits: ecu.addressBits,
      label: ecu.label, role: ecu.role, roleEvidence: ecu.roleEvidence,
      discoverySource: ecu.discoverySource ?? 'functional_0100',
      probeOutcome: ecu.probeOutcome ?? 'responded',
      txProvenance: ecu.txProvenance ?? 'unknown',
      addressability, addressabilityReason: reason,
      attempts: [...attempts], admission, kwpTargetVerified,
      /* Yayın adımı tur SONUNDA çalışır; burada henüz ölçülmedi → null. */
      publishedToAuthority: null,
    });
  } catch { /* kanıt kaydı taramayı DÜŞÜRMEZ */ }
}

/**
 * İki okuma sonucundan EN GÜÇLÜ olanı seçer (ok > unsupported > failed > null).
 * FAIL-CLOSED değil, KAPSAM-DÜRÜST: "ok" yalnız gerçekten okunmuş bir yanıttan
 * gelir; `null` (sorulmadı) hiçbir zaman `unsupported`a (soruldu, yok) terfi etmez.
 */
function _bestEcuStatus(a: EcuModeStatus | null, b: EcuModeStatus | null): EcuModeStatus | null {
  const rank = (v: EcuModeStatus | null): number =>
    v === 'ok' ? 4 : v === 'unsupported' ? 3 : v === 'failed' ? 2 : v === 'deferred' ? 1 : 0;
  return rank(a) >= rank(b) ? a : b;
}

/**
 * P0-OBD-PARITY — BU ECU'DAN DTC BİLGİSİ ALABİLDİK Mİ? (SAF)
 *
 * ── ÖLÇÜLEN KUSUR ─────────────────────────────────────────────────────────
 * Bu soru ürünün İKİ yerinde (güven hesabı ve ECU satırı) YALNIZ standart
 * modlara bakarak yanıtlanıyordu:
 *   `stored==='failed' && pending==='failed' && permanent==='failed'`
 *
 * Fiziksel adres uzayı açıldığı anda bu kural YANLIŞ cevap verir: OBD kapsamı
 * dışındaki bir birim Mode 03/07/0A'yı BİLMEZ (onlar emisyon servisleridir)
 * ama UDS 0x19'a pekâlâ cevap verir. Eski kural o ECU'yu "okunamadı" sayıp
 * güveni haksız yere düşürüyor ve "N ECU okunamadı" diye YANLIŞ gerekçe
 * yazıyordu.
 *
 * ── NEDEN YALNIZ `ok` SAYILIR (ve `unsupported` SAYILMAZ) ─────────────────
 * Bu fonksiyon ADRESLENEBİLİRLİK ölçmez — o ayrı bir kavramdır ve
 * `ecuAddressability` defterinde yaşar. Burada sorulan tek şey KAPSAMDIR:
 * "bu ECU'nun arıza hafızası hakkında bir şey öğrenebildik mi?"
 *
 * `unsupported` ("ECU bu servisi bilmiyor") ULAŞILDIĞININ kanıtıdır ama
 * ARIZA BİLGİSİ DEĞİLDİR. Tüm servisleri düşmüş, yalnız birinde
 * "bilmiyorum" demiş bir ECU'yu "okundu" saymak, güveni olduğundan yüksek
 * gösterir — yani tam olarak bu ürünün kaçındığı kapsam yalanı olur.
 *
 * FAIL-CLOSED: `deferred` · `failed` · `null` de sayılmaz.
 */
export function isEcuReadable(r: EcuScanResult): boolean {
  const read = (v: EcuModeStatus | null): boolean => v === 'ok';
  return read(r.stored) || read(r.pending) || read(r.permanent)
    || read(r.uds) || read(r.udsSupported) || read(r.kwp) || read(r.kwp13);
}

/** `EcuDtc` → kanonik sınıf. UDS/KWP standart sınıflarla KARIŞTIRILMAZ. */
function _observationClassOf(c: EcuDtc): { cls: DtcObservationClass; service: DtcSourceService } {
  if (c.fromUds === true) return { cls: 'UDS', service: '19' };
  /* P0-OBD-DIAG-02: KWP tabanı iki servisten okunabilir; sınıf aynı, KAYNAK farklı. */
  if (c.fromKwp === true) return { cls: 'KWP', service: c.kwpService === '13' ? '13' : '18' };
  switch (c.mode) {
    case 'pending':   return { cls: 'PENDING',   service: '07' };
    case 'permanent': return { cls: 'PERMANENT', service: '0A' };
    default:          return { cls: 'CONFIRMED', service: '03' };
  }
}

/**
 * P0-OBD-CORE-03 — çoklu-ECU raporunu kanonik otoriteye yazar (TEK yer).
 *
 * `beginDtcScanRound` ÇAĞRILMAZ: fonksiyonel (7DF) tarama zaten turu açtı ve
 * bu adım onun ÜSTÜNE EKLER. Aynı kod hem fonksiyonel hem fiziksel yoldan
 * görülürse iki AYRI gözlemdir (`ecuKey` farklı) — biri diğerini EZMEZ.
 */
function _publishScanToAuthority(
  report: MultiEcuScanReport,
  sessionEpoch: number,
  protocol: string | null,
): boolean {
  try {
    for (const r of report.results) {
      const ecuKey  = lookupEcuIdentity(r.ecu.rxHeader, r.ecu.addressBits)?.identityKey ?? null;
      const ecuRole = r.ecu.role === 'unknown' ? null : r.ecu.role;
      const rows: Array<[DtcSourceService, EcuModeStatus | null]> = [
        ['03', r.stored], ['07', r.pending], ['0A', r.permanent],
        /* P0-OBD-PARITY — servis 19 satırı İKİ alt fonksiyonun EN İYİ sonucudur.
           0x19-02 reddedilip 0x19-0A cevap verdiyse servis bu araçta VARDIR;
           yalnız 0x02'ye bakmak kapsamı olduğundan kötü gösterirdi. Alt
           fonksiyon ayrımı `advancedDtcEvidence`te KAYIPSIZ durur. */
        ['19', _bestEcuStatus(r.uds, r.udsSupported)], ['18', r.kwp],
      ];
      /* ── P0-OBD-DIAG-02 · 0x13 SATIRI YALNIZ DENENDİYSE YAZILIR ───────────
         `null` outcome kanonik otoritede `not_scanned`e düşer ve `not_scanned`
         bir KAPSAM KAYBIDIR → hüküm motoru "temiz" DİYEMEZ. 0x13 ise yalnız
         0x18 AÇIKÇA reddedildiğinde sorulur; sorulmadığı turlarda "sorulmadı"
         bir kayıp DEĞİL, DOĞRU sonuçtur (0x18 zaten cevap verdi). Satırı
         koşulsuz yazmak, her araca kalıcı ve sahte bir kapsam kaybı eklerdi. */
      if (r.kwp13 !== null) rows.push(['13', r.kwp13]);
      for (const [service, st] of rows) {
        recordDtcServiceScan({
          service, ecuKey, ecuRole, txHeader: r.ecu.txHeader,
          outcome: _ecuStatusToOutcome(st), sessionEpoch, protocol,
          codeCount: r.authorityCodes.filter((c) => _observationClassOf(c).service === service).length,
          diagnosticOutcome: service === '19' ? r.udsDiagnosticOutcome
            : service === '18' ? r.kwpDiagnosticOutcome
              : service === '13' ? r.kwp13DiagnosticOutcome : undefined,
        });
      }
    }
    for (const c of report.results.flatMap((r) => r.authorityCodes)) {
      const { cls, service } = _observationClassOf(c);
      recordDtcObservation({
        dtcCode: c.code, dtcClass: cls,
        ecuKey:  c.ecuKey ?? c.ecuTxHeader ?? null,
        /* Rol KANITTAN gelir; 'unknown' bir rol DEĞİL, kanıt yokluğudur → null. */
        ecuRole: c.ecuRole === undefined || c.ecuRole === 'unknown' ? null : c.ecuRole,
        rxHeader: null, txHeader: c.ecuTxHeader ?? null,
        protocol, sessionEpoch, sourceService: service, provenance: 'physical_ecu',
        rawStatusByte: c.rawStatus,
        /* P0-OBD-FINISH: alt kod kanonik otoriteye KAYIPSIZ taşınır ve dedup
           anahtarına girer — `P0380(11)` ile `P0380(96)` burada da AYRIŞIR. */
        failureType: c.subCode ?? c.failureType,
        rawDtc: c.rawDtc,
        /* P0-OBD-PARITY: alt fonksiyon SABİT '02' yazılıyordu; 0x19-0A'dan gelen
           kayıtlar da '02' damgası alıp provenance'ını KAYBEDİYORDU. */
        sourceSubFunction: c.fromUds ? (c.udsSubFunction ?? '02')
          : c.fromKwp ? (c.kwpService ?? '18') : undefined,
      });
    }
    return true;
  } catch { /* kanıt yayını taramayı DÜŞÜRMEZ */ }
  return false;
}

/**
 * İpucundaki ECU'ları öne alır — KARARLI sıralama (stable): ipucunda olanlar kendi
 * aralarındaki sırayı, olmayanlar da kendi aralarındaki sırayı KORUR.
 *
 * Neden `sort` değil de iki kova: `Array.prototype.sort` kararlılığı ES2019'dan beri
 * garanti olsa da niyeti okunur kılmak, "sıra neden değişti" sorusunu ileride
 * kimsenin sormamasını sağlar. Filtreleme YOKTUR — küme aynı kalır.
 */
function orderByUdsHint(
  ecus: readonly DiscoveredEcu[],
  udsFirst: readonly string[],
): DiscoveredEcu[] {
  if (udsFirst.length === 0) return [...ecus];
  const hinted = new Set(udsFirst);
  const first: DiscoveredEcu[] = [];
  const rest: DiscoveredEcu[] = [];
  for (const e of ecus) (hinted.has(e.txHeader) ? first : rest).push(e);
  return [...first, ...rest];
}

/**
 * OBD-OS-F3-1: bir ECU'da UDS 0x19-02 okur ve kodları DEDUPE ederek döner.
 *
 * DEDUPE ŞART: aynı arıza hem Mode 03'te (P0301) hem UDS 0x19'da görünebilir — aynı kodu
 * iki kez listelemek kullanıcıya "iki arıza var" yalanı söyler. Standart moddan gelen kod
 * KAZANIR (zaten listede); UDS yalnız EK olanları getirir — asıl kazanç zaten o (üretici kodu).
 */
async function readUdsForEcu(
  ecu: DiscoveredEcu, result: EcuScanResult, sessionEpoch: number, protocol: string | null,
  txn: DiagnosticTransaction,
): Promise<EcuDtc[]> {
  const advFn = vdkAdvancedDtcsFn();
  if (!advFn && !(vdkTransportAvailable() && CarLauncher.readUdsDtcs)) {
    result.uds = 'unsupported';
    return [];
  }
  try {
    /* Yeni APK: NRC/timeout/malformed ayrımını korur. Eski APK mevcut 0x19-02 yolunda kalır. */
    if (advFn) {
      /* ── P0-VDK-F1A · 0x19-01 DE BÜTÇEYE GİRER ─────────────────────────
         ÖLÇÜLEN KUSUR: bu istek hattan ÇIKIYOR ama `consumeRequest` ondan
         SONRA çağrılıyordu — yani turun ilk gelişmiş isteği hiçbir bütçeye
         yazılmıyordu. 8 ECU'lu bir araçta bu 8 görünmez istek demekti. */
      if (!consumeRequest(txn)) { result.uds = null; return []; }   // sorulmadı ≠ desteklenmiyor
      const availability = await advFn({
        service: '19', subFunction: '01', payload: 'FF', tx: ecu.txHeader, rx: ecu.rxHeader,
      });
      if (!acceptResponse(txn)) { result.uds = null; return []; }   // geç yanıt → maske GÜVENİLMEZ
      result.requestCount = (result.requestCount ?? 0) + 1;
      const av = availability.outcome === 'ok' ? parseStatusAvailability(availability.raw) : null;
      result.udsAvailabilityDiagnosticOutcome =
        normalizeAdvancedOutcome(availability.outcome, availability.nrc ?? null);
      _recordAdvanced(txn, ecu, '19', '01', 'FF', availability, sessionEpoch, protocol,
        [], [], [], av?.valid === false ? 'malformed' : undefined, [], av?.availabilityMask ?? null);

      /* ── P0-VDK-F6B · SİHİRLİ MASKE KALDIRILDI ─────────────────────────
         0x19-02 isteğine bugüne kadar SABİT `FF` konuyordu ve az önce ölçülen
         `statusAvailabilityMask` ATILIYORDU. Artık maske ÖLÇÜMDEN gelir;
         ölçülemezse `FF`e düşülür ama bu SESSİZ DEĞİLDİR (`ASSUMED_FULL`).
         EK SORGU ÜRETİLMEZ — aynı yanıtın zaten elde olan alanı kullanılır. */
      const maskPlan = planStatusMask(av?.availabilityMask ?? null);
      result.udsStatusMask = maskPlan.mask;
      result.udsStatusMaskProvenance = maskPlan.provenance;
      /* ECU'nun BEYAN ettiği kayıt sayısı — `COMPLETE` demenin tek bağımsız
         tanığı. Ölçülemediyse `null` KALIR (sahte 0 YASAK). */
      result.udsDeclaredDtcCount = av?.valid === true ? av.count : null;

      /* ── P0-VDK-F1B · OTURUM KİRASI ────────────────────────────────────
         Kira ÖNCE açılır ama keepalive HENÜZ başlamaz: oturumun gerçekten
         açıldığı native kanıtla (`sessionOpened`) doğrulanana kadar tek bir
         `3E` bile gönderilmez (kör keepalive yasağı). */
      const lease = openSessionLease(txn, ecu, protocol);
      if (!canReadUnderLease(lease)) {
        /* Oturum kaybı → okuma fail-closed ERTELENİR. "ECU arızalı" ya da
           "DTC yok" DEMEK DEĞİL: ölçüm alınamadı, kapsam bunu temiz saymaz. */
        result.uds = 'deferred';
        result.udsDiagnosticOutcome = 'not_addressable';
        _accountUds(ecu, sessionEpoch, protocol, '02', null, null, null, null,
          `oturum kirası reddetti: ${leaseDenialReason(lease)}`);
        return [];
      }

      /* ── P0-VDK-F1C · ISO-TP TUNING KARARI ─────────────────────────────
         0x19-02 ÇOK-FRAME beklenen bir okumadır (20 DTC ≈ 13 çerçeve).
         Karar SAF politikadan gelir ve adaptör yeteneği MEVCUT otoriteden
         okunur; kanıtsız hiçbir AT komutu gönderilmez. */
      const dec02 = _decideTuning(txn, ecu, protocol, '19', '02');
      if (dec02 === 'APPLY') {
        /* F1-A restore yükümlülüğü: native restore'u ATOMİK yapar (`finally`),
           TS onu ÇALIŞTIRMAZ — yalnız KAYDEDER ve sonucunu DOĞRULAR. */
        addRestoreObligation(txn, 'adapter_config',
          `ISO-TP flow control (ATFCSM) — ECU ${ecu.txHeader}`);
        _tunedKeys.add(_tuneKey(txn.transactionId, ecu.txHeader));
      }

      /* 0x19-02 AYRI bir istektir ve AYRI bütçe hakkı ister. */
      if (!consumeRequest(txn)) { result.uds = null; return []; }
      const res = await advFn({
        service: '19', subFunction: '02', payload: maskPlan.mask,
        tx: ecu.txHeader, rx: ecu.rxHeader,
        ...(dec02 === 'APPLY' ? { isoTpTuning: true } : {}),
      });
      result.requestCount = (result.requestCount ?? 0) + 1;
      /* UDS 0x19 kaydı 4 BAYTTIR (3 bayt DTC + 1 status) → gövde sınırına
         oturmuyorsa akış YARIDA kesilmiştir (TRUNCATED), `malformed` DEĞİL. */
      _recordTuning(txn, ecu, protocol, '19', '02', dec02, res,
        null, 4);
      /* Native oturum kanıtı kiraya UYGULANIR — keepalive'ın TEK açılış yolu. */
      applyLeaseSessionEvidence(lease, txn, {
        sessionOpened: res.sessionOpened === true,
        sessionCommand: typeof res.sessionCommand === 'string' ? res.sessionCommand : null,
      });
      /* Geç yanıt: tur bittikten/iptal edildikten sonra gelen cevap kayıt
         defterine YAZILMAZ ve `uds` durumunu DEĞİŞTİRMEZ. */
      if (!acceptResponse(txn)) { result.uds = null; return []; }
      const outcome = normalizeAdvancedOutcome(res.outcome, res.nrc ?? null);
      result.udsDiagnosticOutcome = outcome;
      if (outcome !== 'ok') {
        _recordAdvanced(txn, ecu, '19', '02', maskPlan.mask, res, sessionEpoch, protocol);
        result.uds = outcome === 'unsupported' || outcome === 'security_required' ? 'unsupported' : 'failed';
        _accountUds(ecu, sessionEpoch, protocol, '02', null, null, null, null, outcome);
        /* BİR SERVİSİN DÜŞMESİ DİĞERİNİ KESMEZ: 0x19-02 reddedilse bile
           0x19-0A ayrı bir alt fonksiyondur ve ayrıca desteklenebilir. */
        const only0A = await _readUdsSupportedDtcs(ecu, result, sessionEpoch, protocol, txn);
        /* P0-VDK-F6B: 0x19-02 düşse bile 0x19-0A kayıt getirdiyse snapshot/
           extended kanıtı O kayıtlar için de ölçülür — eskiden bu dal
           referansları HİÇ sormuyordu (kapsam asimetrisi). */
        await _readUdsReferences(ecu, only0A.parsed, sessionEpoch, protocol, txn, result);
        return only0A.codes;
      }
      const envelope = validateUdsDtcResponse(res.raw);
      if (!envelope.valid) {
        _recordAdvanced(txn, ecu, '19', '02', maskPlan.mask, res, sessionEpoch, protocol, [], [], [], 'malformed');
        result.uds = 'failed'; result.udsDiagnosticOutcome = 'malformed';
        _accountUds(ecu, sessionEpoch, protocol, '02', res.raw, null, null, null, 'malformed');
        const only0A = await _readUdsSupportedDtcs(ecu, result, sessionEpoch, protocol, txn);
        await _readUdsReferences(ecu, only0A.parsed, sessionEpoch, protocol, txn, result);
        return only0A.codes;
      }
      const parsed = parseUdsDtcResponse(res.raw);
      _recordAdvanced(txn, ecu, '19', '02', maskPlan.mask, res, sessionEpoch, protocol,
        /* P0-OBD-FINISH: LAB kanıtına da ALT KODLU künye yazılır — kanıt
           ekranında `P0380` ile `P0380(11)` karışmaz. */
        parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)), parsed.map((d) => d.rawStatus),
        [], undefined, [], envelope.availabilityMask);
      result.uds = 'ok';
      result.udsDiagnosticOutcome = 'ok';
      /* AUTHORITY sayısı PARSER'dan BAĞIMSIZ ölçülür: `_tagUdsCodes` kanıt
         listesine (`authorityCodes`) kaç satır YAZDIYSA o. Aradaki fark yanıt
         içi tekrar (birebir aynı kayıt) demektir ve künyede görünür. */
      const authBefore02 = result.authorityCodes.length;
      result.udsParsedCount = parsed.length;
      const tagged02 = _tagUdsCodes(ecu, result, parsed);
      _accountUds(ecu, sessionEpoch, protocol, '02', res.raw, parsed.length,
        result.authorityCodes.length - authBefore02, tagged02.length, 'ok');

      /* ── P0-OBD-PARITY · TEK SERVİS BAĞIMLILIĞI KALDIRILDI ──────────────
         0x19-02 BAŞARILI olsa bile 0x19-0A DA sorulur. Neden: 0x19-02 istek
         `statusMask` ile filtreler ve birçok ECU maskeyi AND'lerken status
         baytı 0x00 olan (ARŞİV / etkin değil) kayıtları ELER. 0x19-0A
         (reportSupportedDTC, ISO 14229-1) o filtreyi HİÇ uygulamaz ve yanıt
         gövdesi 0x02 ile AYNI biçimdedir → AYNI çözücü kullanılır, ikinci
         parser KURULMAZ.

         Bulunan kayıtlar mevcut listenin ÜSTÜNE eklenir; birebir aynı kayıt
         (kod+alt kod+status) `_tagUdsCodes` içindeki `seen` ile zaten tek
         satıra iner → yalancı çift arıza ÜRETİLMEZ. Maliyet: ECU başına TEK
         ek komut. */
      const extra = await _readUdsSupportedDtcs(ecu, result, sessionEpoch, protocol, txn);

      /* ── P0-VDK-F6B · REFERANSLAR MERDİVENİN SONUNDA, TEK KEZ ────────
         ÖLÇÜLEN KUSUR: `_readUdsReferences` 0x19-02'nin HEMEN ardından
         çağrılıyordu; yalnız 0x19-0A'da görülen kayıtlar (arşiv / etkin değil
         sınıfı — 0x0A'nın VAR OLMA SEBEBİ) snapshot/extended kanıtı HİÇ
         almıyordu. Artık merdiven bitince BİR KEZ, birleşmiş ve tekilleşmiş
         kayıt kümesiyle çalışır: istek sayısı ARTMAZ, kapsam simetrik olur. */
      await _readUdsReferences(ecu, _mergeUdsRecords(parsed, extra.parsed),
        sessionEpoch, protocol, txn, result);
      return [...tagged02, ...extra.codes];
    }

    const res = await CarLauncher.readUdsDtcs!({ tx: ecu.txHeader, rx: ecu.rxHeader, statusMask: 'FF' });
    if (res.supported === false) {
      result.uds = 'unsupported';   // ECU 0x19'u bilmiyor — hata DEĞİL (çoğu eski araç)
      return [];
    }
    result.uds = 'ok';

    return _tagUdsCodes(ecu, result, parseUdsDtcResponse(res.raw ?? ''));
  } catch (e) {
    result.uds = 'failed';
    logError('OBD:UdsDtcFailed', e);       // UDS düştü — standart sonuçlar KORUNUR
    return [];
  }
}

/**
 * P0-OBD-FINISH — TEKİLLEŞTİRME ANAHTARI ARTIK `kod + ALT KOD + STATUS`.
 *
 * ── ÖLÇÜLEN KUSUR (ürünün üretici DTC'lerini kaybettiği YER) ───────────────
 * Anahtar YALNIZ `d.code` idi. Aynı araçta Car Scanner'ın gösterdiği
 *   P0380(11) · P0380(12) · P0380(13) · P0380(96)
 * dört AYRI kaydıdır (kızdırma bujisi devresi: şaseye kısa · beslemeye kısa ·
 * devre açık · bileşen içi arıza). Eski anahtar bunların ÜÇÜNÜ sessizce
 * ATIYORDU; ekrana tek "P0380" düşüyordu. Aynı şey `P2263(21)`/`P2263(22)` ve
 * `P047B(92)`/`P047B(29)` için de geçerliydi.
 *
 * Anahtar artık kaydın GERÇEK kimliğidir; birebir aynı üçlü tekrar gelirse
 * (çok-çerçeveli yanıtın tekrarı) yine TEK kayıt olur — yani gerçek çift
 * kayıt koruması KAYBOLMAZ.
 */
function _recordKey(code: string, subCode?: string, rawStatus?: string): string {
  return `${code}|${subCode ?? ''}|${rawStatus ?? ''}`;
}

/**
 * P0-OBD-PARITY — ÇAĞRILAR ARASI kayıt kümesi.
 *
 * ── ÖLÇÜLEN KUSUR (servis merdiveni açılınca ortaya çıktı) ────────────────
 * `seen` seti `_tagUdsCodes` gövdesinde YEREL kuruluyordu; yani yalnız TEK bir
 * yanıtın içindeki tekrarları yakalıyordu. Merdiven 0x19-02'den sonra 0x19-0A'yı
 * da sorunca aynı kayıt İKİ AYRI çağrıda geliyor ve ikisi de listeye giriyordu
 * → ekranda **yalancı çift arıza**. (`existing` bunu yakalayamaz: o yalnız
 * `result.codes`e bakar ve UDS kodları oraya çağrı DÖNDÜKTEN sonra eklenir.)
 *
 * Kümeyi `authorityCodes`tan türetmek doğru çözümdür çünkü her etiketlenen
 * kayıt oraya OKUMA ANINDA yazılır — yani merdivenin bir sonraki basamağı
 * öncekinin ne getirdiğini görür. Standart Mode 03/07/0A kayıtlarının alt kodu
 * ve status'u YOKTUR → anahtarları (`P0833||`) üretici kaydının anahtarıyla
 * (`P0833|29|09`) ÇAKIŞMAZ; iki kaynak birbirini ezmez.
 */
function _seenRecordKeys(result: EcuScanResult): Set<string> {
  return new Set(result.authorityCodes.map((c) => _recordKey(c.code, c.subCode, c.rawStatus)));
}

function _tagUdsCodes(
  ecu: DiscoveredEcu, result: EcuScanResult, parsed: readonly UdsDtc[],
  udsSubFunction: '02' | '0A' = '02',
): EcuDtc[] {
  /* `existing` BİLEREK yalnız kod bazlıdır: aynı kod hem Mode 03 hem UDS'te
     görülürse ÜRÜN listesinde tek satır kalır (yalancı çift arıza kilidi).
     Kanıt katmanı (`authorityCodes`) her iki kaynağı da SAKLAR. */
  const existing = new Set(result.codes.map((c) => c.code));
  const seen = _seenRecordKeys(result); const out: EcuDtc[] = [];
  for (const d of parsed) {
    const key = _recordKey(d.code, d.failureType, d.rawStatus);
    if (seen.has(key)) continue; seen.add(key);
    const tagged: EcuDtc = { code: d.code, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
      ..._ecuIdentityFields(ecu), mode: udsDtcToScanMode(d), fromUds: true,
      failureType: d.failureType, active: d.status.testFailed, rawStatus: d.rawStatus,
      subCode: d.failureType, rawDtc: d.rawDtc, state: classifyUdsDtcState(d.status),
      udsSubFunction };
    result.authorityCodes.push(tagged);
    if (!existing.has(d.code)) out.push(tagged);
  }
  return out;
}

/**
 * P0-OBD-PARITY — UDS 0x19 **alt fonksiyon 0x0A** (reportSupportedDTC, ISO 14229-1).
 *
 * ── NEDEN ─────────────────────────────────────────────────────────────────
 * 0x19-02 isteği bir `statusMask` taşır ve ECU yanıtı O MASKEYE göre filtreler.
 * Birçok ECU maskeyi AND'lerken status baytı `0x00` olan kayıtları (arşiv /
 * "etkin değil") ELER — yani hafızada duran ama şu an düşmeyen arıza
 * GÖRÜNMEZ olur. Car Scanner'ın aynı araçta "Arşiv / Etkin değil" diye
 * gösterdiği kayıtların sınıfı tam olarak budur.
 *
 * 0x19-0A filtre UYGULAMAZ: "bu ECU'nun tanıdığı DTC'ler" listesidir ve yanıt
 * gövdesi 0x02 ile AYNI biçimdedir (`<statusAvailabilityMask><DTC 3 bayt +
 * status 1 bayt>*`) → AYNI çözücü kullanılır. İkinci parser KURULMADI.
 *
 * ── SÖZLEŞME ──────────────────────────────────────────────────────────────
 *  · SALT-OKUNUR. Native whitelist'te ZATEN vardı (`readUdsDtcInformationDetailed`),
 *    yalnız hiçbir yerden ÇAĞRILMIYORDU — yeni bir hat yeteneği açılmadı.
 *  · 0x19-02'nin sonucundan BAĞIMSIZ koşar (biri düşerse diğeri kesilmez).
 *  · Kayıtlar mevcut listeye EKLENİR; birebir aynı kayıt `_tagUdsCodes`
 *    içindeki `seen` anahtarıyla tek satıra iner (yalancı çift arıza YOK).
 *  · Sonuç `result.udsSupported`a yazılır — `result.uds`u EZMEZ, çünkü
 *    "0x19-02 çalıştı" ile "0x19-0A çalıştı" AYRI kapsam gerçekleridir.
 */
async function _readUdsSupportedDtcs(
  ecu: DiscoveredEcu, result: EcuScanResult, sessionEpoch: number, protocol: string | null,
  txn: DiagnosticTransaction,
): Promise<UdsLadderStep> {
  const fn = vdkAdvancedDtcsFn();
  if (!fn) { result.udsSupported = null; return _EMPTY_LADDER_STEP; }   // köprü yok → SORULMADI
  try {
    if (!consumeRequest(txn)) { result.udsSupported = null; return _EMPTY_LADDER_STEP; }
    const dec0A = _decideTuning(txn, ecu, protocol, '19', '0A');
    if (dec0A === 'APPLY') {
      addRestoreObligation(txn, 'adapter_config',
        `ISO-TP flow control (ATFCSM) — ECU ${ecu.txHeader} · 0x19-0A`);
      _tunedKeys.add(_tuneKey(txn.transactionId, ecu.txHeader));
    }
    const res = await fn({
      service: '19', subFunction: '0A', payload: '', tx: ecu.txHeader, rx: ecu.rxHeader,
      ...(dec0A === 'APPLY' ? { isoTpTuning: true } : {}),
    });
    result.requestCount = (result.requestCount ?? 0) + 1;
    _recordTuning(txn, ecu, protocol, '19', '0A', dec0A, res, null, 4);
    if (!acceptResponse(txn)) { result.udsSupported = null; return _EMPTY_LADDER_STEP; }
    const outcome = normalizeAdvancedOutcome(res.outcome, res.nrc ?? null);
    result.udsSupportedDiagnosticOutcome = outcome;
    if (outcome !== 'ok') {
      _recordAdvanced(txn, ecu, '19', '0A', '', res, sessionEpoch, protocol);
      result.udsSupported =
        outcome === 'unsupported' || outcome === 'security_required' ? 'unsupported' : 'failed';
      _accountUds(ecu, sessionEpoch, protocol, '0A', null, null, null, null, outcome);
      return _EMPTY_LADDER_STEP;
    }
    const envelope = validateUdsDtcResponse(res.raw);
    if (!envelope.valid) {
      _recordAdvanced(txn, ecu, '19', '0A', '', res, sessionEpoch, protocol, [], [], [], 'malformed');
      result.udsSupported = 'failed'; result.udsSupportedDiagnosticOutcome = 'malformed';
      _accountUds(ecu, sessionEpoch, protocol, '0A', res.raw, null, null, null, 'malformed');
      return _EMPTY_LADDER_STEP;
    }
    const parsed = parseUdsDtcResponse(res.raw);
    _recordAdvanced(txn, ecu, '19', '0A', '', res, sessionEpoch, protocol,
      parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)),
      parsed.map((d) => d.rawStatus), [], undefined, [], envelope.availabilityMask);
    result.udsSupported = 'ok';
    const authBefore = result.authorityCodes.length;
    const tagged = _tagUdsCodes(ecu, result, parsed, '0A');
    _accountUds(ecu, sessionEpoch, protocol, '0A', res.raw, parsed.length,
      result.authorityCodes.length - authBefore, tagged.length, 'ok');
    return { codes: tagged, parsed };
  } catch (e) {
    result.udsSupported = 'failed';
    logError('OBD:UdsSupportedDtcFailed', e);   // 0x0A düştü — 0x02 sonuçları KORUNUR
    _accountUds(ecu, sessionEpoch, protocol, '0A', null, null, null, null, 'transport_error');
    return _EMPTY_LADDER_STEP;
  }
}

/**
 * P0-VDK-F6B — merdiven basamağının İKİ ÇIKTISI.
 *
 * `codes` ÜRÜN listesine giren (tekilleşmiş) satırlardır; `parsed` ise o
 * basamağın ÇÖZÜMLEDİĞİ HAM kayıtlardır. İkisi AYRI olmak zorunda: bir kayıt
 * ürün listesinde tekrar olduğu için düşebilir ama snapshot/extended kanıtı
 * için yine GEÇERLİ bir hedeftir. Tek dizi döndürmek, 0x19-0A'da görülen
 * arşiv kayıtlarının derin kanıtını sessizce kaybettirirdi.
 */
interface UdsLadderStep {
  readonly codes: EcuDtc[];
  readonly parsed: readonly UdsDtc[];
}

const _EMPTY_LADDER_STEP: UdsLadderStep = { codes: [], parsed: [] };

/**
 * P0-VDK-F6B — iki basamağın ham kayıtlarını KAYIPSIZ birleştirir.
 *
 * Anahtar `rawDtc + failureType`tır: `19-06` isteğinin gövdesi ZATEN
 * `<rawDtc><selector>` olduğu için aynı ham DTC'yi iki kez sormak birebir
 * aynı isteği tekrar göndermek olurdu. Status baytı anahtara GİRMEZ — aynı
 * kaydın 0x02 ve 0x0A'daki status'u FARKLI olabilir ama HEDEF aynıdır.
 */
function _mergeUdsRecords(
  a: readonly UdsDtc[], b: readonly UdsDtc[],
): readonly UdsDtc[] {
  const seen = new Set<string>();
  const out: UdsDtc[] = [];
  for (const d of [...a, ...b]) {
    const key = `${d.rawDtc}|${d.failureType ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * P0-OBD-PARITY — bir UDS okumasının RAW→PARSER→AUTHORITY→UI künyesini yazar.
 *
 * `raw` sayısı zarf GEOMETRİSİNDEN ölçülür (`countUdsDtcRecords`), parser'ın
 * ürettiği sayıdan BAĞIMSIZ — aradaki fark `PARSE_DROPPED` olarak görünür.
 * `authority` bu okumanın `authorityCodes`e yazdığı satır sayısıdır; `ui` ise
 * ürün listesine dönen satır. Ölçülemeyen her alan `null` KALIR (sahte 0 YASAK).
 */
/**
 * P0-VDK-F1C — Bu (işlem × ECU) için ISO-TP tuning ZATEN uygulandı mı.
 * Çift tuning gereksiz AT trafiğidir ve `SKIP_ALREADY_TUNED` ile engellenir.
 */
const _tunedKeys = new Set<string>();
export function _resetIsoTpTunedKeysForTest(): void { _tunedKeys.clear(); }
function _tuneKey(txnId: string, tx: string): string { return `${txnId}|${tx}`; }

/**
 * P0-VDK-F1C — tuning kararını verir ve kanıtı yazar (TEK yer).
 *
 * Karar SAF politikadan (`decideIsoTpTuning`) gelir; burada yalnız girdiler
 * toplanır. Adaptör yeteneği MEVCUT otoriteden (`adapterIdentityService`)
 * okunur — ikinci bir yetenek otoritesi KURULMAZ.
 */
function _decideTuning(
  txn: DiagnosticTransaction, ecu: DiscoveredEcu, protocol: string | null,
  service: string, subFunction: string,
): TuningDecision {
  let adapter = null;
  try { adapter = getAdapterCapabilities(); } catch { adapter = null; }
  return decideIsoTpTuning({
    service, subFunction, protocol, adapter,
    slowSerial: isSlowSerialProtocol(protocol),
    alreadyTuned: _tunedKeys.has(_tuneKey(txn.transactionId, ecu.txHeader)),
    /* Replay koşusunda köprü SANAL taşımadır — F1-C kararı aynı kanıt
       kurallarıyla verilir, ikinci bir yetenek kapısı KURULMAZ. */
    bridgeAvailable: vdkAdvancedDtcsFn() !== null,
  });
}

/** P0-VDK-F1C — tuning + transport kanıtını defter'e yazar. */
function _recordTuning(
  txn: DiagnosticTransaction, ecu: DiscoveredEcu, protocol: string | null,
  service: string, subFunction: string, decision: TuningDecision,
  res: { outcome?: string; raw?: string; error?: string;
    tuningApplied?: boolean; tuningCommands?: string;
    tuningPreviousMode?: string; tuningNewMode?: string;
    tuningRestored?: boolean; tuningRestoreDetail?: string;
    byteCount?: number; frameCount?: number } | null,
  recordCount: number | null,
  expectedRecordBytes: number | null,
): void {
  let adapterKind = 'UNKNOWN';
  try { adapterKind = getAdapterCapabilities()?.kind ?? 'UNKNOWN'; } catch { /* fail-soft */ }
  /* ── P0-VDK-F2B · TUNING SONUCU İZE YAZILIR ────────────────────────────
     ÖLÇÜLEN KUSUR (F2-A borcu): iz yalnız DENENEN komutları taşıyordu;
     "uygulandı mı" ve "geri alındı mı" HİÇBİR yerde yoktu. Bir replay bu
     iki cevabı ancak UYDURARAK verebilirdi — yani veremezdi. Sonuç artık
     `transportOutcome` alanında ÖLÇÜM olarak durur ve geri alma AYRI bir
     olaydır (uygulama başarılı olup geri alma DÜŞEBİLİR; tek olay bu iki
     farklı gerçeği aynı satırda ezerdi).

     `applied` kanıt kuralı `recordIsoTpTuningEvidence` ile BİREBİR aynıdır:
     tuning İSTENMEDİYSE hiçbir native alanı onu "uygulandı" yapamaz. */
  const _applied = decision === 'APPLY' && res?.tuningApplied === true;
  traceFromTransaction(txn, {
    operation: 'isotp_tuning_apply', direction: 'observation',
    subFunction, rawRequest: res?.tuningCommands ?? null,
    /* Yeni blok modu = tuning'in ÖLÇÜLEN etkisi. */
    rawResponse: _applied ? (res?.tuningNewMode ?? null) : null,
    transportOutcome: decision !== 'APPLY' ? 'NOT_REQUESTED'
      : _applied ? 'APPLIED' : 'NOT_APPLIED',
    ecuTxHeader: ecu.txHeader, ecuRxHeader: ecu.rxHeader, ecuLabel: ecu.label,
    protocol, isoTpTuningRef: decision,
    byteCount: typeof res?.byteCount === 'number' ? res.byteCount : null,
    frameCount: typeof res?.frameCount === 'number' ? res.frameCount : null,
  });
  /* GERİ ALMA yalnız GERÇEKTEN uygulanmış tuning için anlamlıdır — hiç
     gönderilmemiş bir ATFCSM'in "geri alındı" kaydı yalan olurdu.
     `UNKNOWN` fail-closed: eski APK alanı taşımaz → adaptörün temiz kaldığı
     KANITLANMAMIŞTIR ve öyle de yazılır. */
  if (_applied) {
    traceFromTransaction(txn, {
      operation: 'isotp_tuning_restore', direction: 'observation',
      subFunction,
      rawRequest: `ATFCSM${res?.tuningPreviousMode ?? ''}`,
      rawResponse: res?.tuningRestoreDetail ?? null,
      transportOutcome: res?.tuningRestored === true ? 'RESTORED'
        : res?.tuningRestored === false ? 'RESTORE_FAILED' : 'UNKNOWN',
      ecuTxHeader: ecu.txHeader, ecuRxHeader: ecu.rxHeader, ecuLabel: ecu.label,
      protocol, isoTpTuningRef: decision,
    });
  }
  recordIsoTpTuningEvidence({
    atMs: Date.now(), transactionId: txn.transactionId,
    evidenceCorrelationId: txn.evidenceCorrelationId,
    txHeader: ecu.txHeader, rxHeader: ecu.rxHeader, protocol,
    service, subFunction, decision, adapterKind,
    /* ── FAIL-CLOSED: KANIT, KARARI YANSITIR ────────────────────────────
       Tuning İSTENMEDİYSE (`decision !== 'APPLY'`) hiçbir native alanı onu
       "uygulandı" yapamaz. Aksi hâlde bozuk/eski bir köprü alanı kanıtı
       yalan söyletirdi: hiç gönderilmemiş bir AT komutu "başarılı" görünür
       ve restore sayacı olmayan bir tuning için kusur raporlardı. */
    applied: decision === 'APPLY' && res?.tuningApplied === true,
    commands: decision === 'APPLY' ? (res?.tuningCommands ?? null) : null,
    previousMode: decision === 'APPLY' ? (res?.tuningPreviousMode ?? null) : null,
    newMode: decision === 'APPLY' ? (res?.tuningNewMode ?? null) : null,
    /* Restore yalnız GERÇEKTEN uygulanmış tuning için anlamlıdır. */
    restored: decision === 'APPLY' && res?.tuningApplied === true
      ? (res?.tuningRestored ?? null) : null,
    restoreDetail: decision === 'APPLY' ? (res?.tuningRestoreDetail ?? null) : null,
    transportOutcome: res === null
      ? 'UNKNOWN'
      : classifyTransportOutcome(res.outcome ?? '', res.raw ?? null,
          res.error ?? null, expectedRecordBytes),
    byteCount: typeof res?.byteCount === 'number' ? res.byteCount : null,
    frameCount: typeof res?.frameCount === 'number' ? res.frameCount : null,
    recordCount,
  });
}

/** P0-OBD-PARITY — KWP okumasının künyesi; `raw` KWP zarf geometrisinden ölçülür. */
function _accountKwp(
  ecu: DiscoveredEcu, sessionEpoch: number, protocol: string | null,
  service: '18' | '13', rawHex: string | null | undefined,
  parsed: number | null, authority: number | null, ui: number | null, outcome: string,
): void {
  const rawCount = typeof rawHex === 'string' && rawHex.length > 0 ? countKwpDtcRecords(rawHex) : null;
  recordDtcPipelineEntry({
    sessionEpoch, txHeader: ecu.txHeader, rxHeader: ecu.rxHeader, ecuLabel: ecu.label,
    service, subFunction: service, protocol,
    raw: rawCount, parsed, authority, ui,
    measured: outcome === 'ok', outcome,
  });
}

function _accountUds(
  ecu: DiscoveredEcu, sessionEpoch: number, protocol: string | null,
  subFunction: string, rawHex: string | null | undefined,
  parsed: number | null, authority: number | null, ui: number | null, outcome: string,
): void {
  const rawCount = typeof rawHex === 'string' && rawHex.length > 0 ? countUdsDtcRecords(rawHex) : null;
  recordDtcPipelineEntry({
    sessionEpoch, txHeader: ecu.txHeader, rxHeader: ecu.rxHeader, ecuLabel: ecu.label,
    service: '19', subFunction, protocol,
    raw: rawCount, parsed, authority, ui,
    measured: outcome === 'ok', outcome,
  });
}

/**
 * Bir ECU'da en çok kaç DTC için genişletilmiş veri (0x19-06) okunur.
 *
 * 0x19-06 DTC BAŞINA bir istektir; sınırsız bırakılması 20 kodlu bir ECU'da
 * tek başına 20 istek demektir. Tavanın üstünde kalanlar SESSİZCE atılmaz —
 * `udsExtendedDeferred` olarak SAYILIR ve kapsam künyesine yazılır.
 */
export const MAX_EXTENDED_DATA_READS_PER_ECU = 8;

/**
 * P0-VDK-F6B — 0x19-03 (snapshot kimlikleri) ve 0x19-06 (genişletilmiş veri)
 * KANITI. Salt-okunur, sınırlı, BÜŤÇELİ.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── ÖLÇÜLEN KUSUR (F1-A'nın tek bütçe otoritesi deliniçordu) ────────────
 * ═══════════════════════════════════════════════════════════════════════
 * Bu fonksiyon ECU başına 1 + 8 = 9 isteği hatta çıkarıyordu ve HIÇBİRİ
 * `consumeRequest`ten geçmiyordu: ne bir bütçeden düşüyordu, ne iptal onu
 * durdurabiliyordu, ne de geç yanıt kapısı (`acceptResponse`) işliyordu.
 * 8 ECU'lu bir araçta bu **72 görünmez PDU** demekti — taramanın gerçek
 * maliyeti hiçbir yerde ölçülmüyordu ve `runFullVehicleScan` iptal edilse bile
 * hat meşgul kalmaya devam ediyordu.
 *
 * Artık her istek TEK bütçe kapısından geçer; hak yoksa kalanlar SESSİZCE
 * atlanmaz, ERTELENMİŞ olarak SAYILIR.
 *
 * ── KÖR SÜPÜRME YASAĞI (görev §7/§8) ──────────────────────────
 * 0x19-06 YALNIZ ÖLÇÜLMÜŞ bir DTC kaydı için gönderilir (hedef ham DTC
 * başka bir yerden UYDURULMAZ). Kayıt yoksa TEK BAYT ÇIKMAZ. Snapshot kayıt
 * NUMARASI süpürülmez: 0x19-04 bu turda hatta ÇIKMAZ çünkü native
 * `DiagnosticServiceGate` salt-okunur alt fonksiyon kümesinde YOKTUR — durum
 * `BLOCKED` olarak DÜRÜSTÇE raporlanır, kapı zorlanmaz.
 *
 * OEM veri şeması ÇÖZÜLMEZ: bilinmeyen bayta anlam UYDURULMAZ, yalnız
 * "ham genişletilmiş veri MEVCUT" kanıtı üretilir.
 */
async function _readUdsReferences(
  ecu: DiscoveredEcu, dtcs: readonly UdsDtc[], epoch: number, protocol: string | null,
  txn: DiagnosticTransaction,
  result?: EcuScanResult,
): Promise<void> {
  const fn = vdkAdvancedDtcsFn(); if (!fn) return;

  /* ── 0x19-03 — SNAPSHOT KAYIT KİMLİKLERİ ───────────────────── */
  if (!consumeRequest(txn)) {
    if (result) result.udsSnapshotDiagnosticOutcome = 'not_addressable';
    return;   // bütçe yok → SORULMADI (desteklenmiyor DEĞİL)
  }
  try {
    const snap = await fn({ service: '19', subFunction: '03', payload: '', tx: ecu.txHeader, rx: ecu.rxHeader });
    if (!acceptResponse(txn)) return;   // geç yanıt → kanıt YAZILMAZ
    if (result) result.requestCount = (result.requestCount ?? 0) + 1;
    const parsed = snap.outcome === 'ok' ? parseSnapshotIdentification(snap.raw) : null;
    _recordAdvanced(txn, ecu, '19', '03', '', snap, epoch, protocol, [], [], parsed?.references ?? [],
      parsed?.valid === false ? 'malformed' : undefined);
    if (result) {
      result.udsSnapshotDiagnosticOutcome =
        parsed?.valid === false ? 'malformed'
          : normalizeAdvancedOutcome(snap.outcome, snap.nrc ?? null);
      /* Referans sayısı yalnız GEÇERLİ bir çözümden gelir; aksi hâlde `null`
         KALIR — "0 snapshot var" ile "snapshot okunamadı" AYRI gerçeklerdir. */
      result.udsSnapshotReferenceCount = parsed?.valid === true ? parsed.references.length : null;
    }
  } catch (e) {
    logError('OBD:UdsSnapshotReference', e);
    if (result) result.udsSnapshotDiagnosticOutcome = 'transport_error';
  }

  /* ── 0x19-06 — YALNIZ ÖLÇÜLMÜŞ KAYITLAR İÇİN ────────────────── */
  if (dtcs.length === 0) return;   // hedef yok → tek bayt çıkmaz
  const targets = dtcs.slice(0, MAX_EXTENDED_DATA_READS_PER_ECU);
  if (result) {
    result.udsExtendedDeferred =
      (result.udsExtendedDeferred ?? 0) + (dtcs.length - targets.length);
  }
  for (const d of targets) {
    if (!consumeRequest(txn)) {
      /* Bütçe bitti → KALANLAR sorulmadı ve bu SESSİZ DEĞİLDİR. */
      if (result) {
        result.udsExtendedDeferred = (result.udsExtendedDeferred ?? 0)
          + (targets.length - (result.udsExtendedRequests ?? 0));
      }
      return;
    }
    try {
      const ref = extendedDataReference(d);
      const ext = await fn({ service: '19', subFunction: '06', payload: `${d.rawDtc}FF`, tx: ecu.txHeader, rx: ecu.rxHeader });
      if (!acceptResponse(txn)) return;
      if (result) {
        result.requestCount = (result.requestCount ?? 0) + 1;
        result.udsExtendedRequests = (result.udsExtendedRequests ?? 0) + 1;
        /* İlk terminal sonuç kaydı tutulur; sonraki `ok` onu GÜÇLENDİRİR. */
        const o = normalizeAdvancedOutcome(ext.outcome, ext.nrc ?? null);
        if (result.udsExtendedDiagnosticOutcome === undefined || o === 'ok') {
          result.udsExtendedDiagnosticOutcome = o;
        }
      }
      _recordAdvanced(txn, ecu, '19', '06', `${d.rawDtc}FF`, ext, epoch, protocol, [d.code], [d.rawStatus], [], undefined, [ref]);
    } catch (e) {
      logError('OBD:UdsExtendedDataReference', e);
      if (result && result.udsExtendedDiagnosticOutcome === undefined) {
        result.udsExtendedDiagnosticOutcome = 'transport_error';
      }
    }
  }
}

type _AdvancedBridgeResult = Awaited<ReturnType<NonNullable<typeof CarLauncher.readAdvancedDtcs>>>;
function _recordAdvanced(
  txn: DiagnosticTransaction | null,
  ecu: DiscoveredEcu, service: '19' | '18' | '13', subFunction: string,
  /**
   * P0-VDK-F2B — İSTEĞİN GÖVDESİ. Ölçülen kusur: eskiden ize yalnız
   * `service+subFunction` yazılıyordu; `19-06` ise DTC başına AYRI bir istektir
   * (`1906` + `<rawDtc>FF`). Sekiz farklı istek izde TEK künyeye
   * (`1906`) düşüyordu → replay hangi yanıtın hangi isteğe ait olduğunu
   * AYIRT EDEMEZDİ. Gövde artık künyenin parçasıdır.
   */
  payload: string,
  response: _AdvancedBridgeResult, epoch: number, protocol: string | null,
  dtcs: readonly string[] = [], statusBytes: readonly string[] = [],
  snapshotReferences: readonly string[] = [], override?: AdvancedDtcOutcome,
  extendedDataReferences: readonly string[] = [], statusAvailabilityMask: string | null = null,
): void {
  /* ── P0-VDK-F2A · KANONİK İZ ────────────────────────────────────────────
     Bu nokta ZATEN kanıt yazıyordu; iz onu KOPYALAMAZ, aynı ölçümü
     KORELASYONLU kronolojiye bağlar. Maskeleme `traceRecorder`da TEK yerde
     uygulanır — çağıran onu unutamaz. */
  traceFromTransaction(txn, {
    operation: service === '19' ? 'uds_19' : service === '18' ? 'kwp_18' : 'kwp_13',
    subFunction,
    /* P0-VDK-F3A — KÜNYE TEK YERDEN (`encodePduRequest`). Bu biçim eskiden
       burada ve replay kapısında AYRI AYRI kuruluyordu; biri değişirse replay
       sessizce eşleşmezdi. Artık iki taraf da AYNI fonksiyonu çağırır. */
    rawRequest: encodePduRequest(makePdu({ service, subFunction, payload })),
    rawResponse: response.raw?.length ? response.raw : null,
    transportOutcome: String(override ?? response.outcome ?? ''),
    nrc: response.nrc ?? null,
    ecuTxHeader: ecu.txHeader, ecuRxHeader: ecu.rxHeader, ecuLabel: ecu.label,
    protocol, sessionEpoch: epoch,
  });
  recordAdvancedDtcEvidence({
    atMs: Date.now(), sessionEpoch: epoch, service, subFunction,
    tx: ecu.txHeader, rx: ecu.rxHeader, protocol,
    outcome: override ?? normalizeAdvancedOutcome(response.outcome, response.nrc ?? null),
    nrc: response.nrc ?? null, raw: response.raw?.length ? response.raw : null,
    dtcs, statusBytes, statusAvailabilityMask, snapshotReferences, extendedDataReferences,
    error: response.error ?? null,
  });
}

/* ── V-08: KWP DTC kanalının SALT-OKUNUR kanıtı ─────────────────────────────
 *
 * NEDEN: KWP dalı yalnız TAM ARAÇ TARAMASI sırasında çalışır; sürekli bir
 * akışı yoktur. CAROS LAB "bu araçta KWP DTC sorulabildi mi" sorusunu ancak
 * son turun sonucunu HATIRLARSAK cevaplayabilir.
 *
 * YENİ ÖLÇÜM ÜRETİLMEZ: tarama zaten hesapladığı durumu buraya yazar. Sınırlı
 * (yalnız son tur), süreç-ömürlü, timer yok, I/O yok. */

export interface KwpDtcEvidence {
  /** Son tam taramanın damgası; `null` = bu oturumda hiç taranmadı. */
  readonly lastScanAtMs: number | null;
  /** Tarama anındaki aktif protokol (ATDPN) — `null` = okunamadı. */
  readonly protocolAtScan: string | null;
  /** KWP dalı GERÇEKTEN denendi mi (yavaş seri kapısı geçildi mi). */
  readonly attempted: boolean;
  /** Native köprü bu ortamda var mı — yoksa deneme HİÇ yapılamaz. */
  readonly channelAvailable: boolean;
  /** ECU başına sonuç sayaçları (yalnız denenen turda anlamlı). */
  readonly okCount: number;
  readonly unsupportedCount: number;
  readonly failedCount: number;
  /** Bu turda KWP'den gelen (standart modda OLMAYAN) kod adedi. */
  readonly codeCount: number;
  /** P0-OBD-CORE-07 — son taramanın kaynak-açığı kanıt zinciri. */
  readonly functional03Raw: string | null;
  readonly functional07Raw: string | null;
  readonly physicalTarget: string | null;
  readonly targetProvenance: string | null;
  readonly sessionRequest: string | null;
  readonly sessionResponse: string | null;
  readonly request18Tx: string | null;
  readonly response18Raw: string | null;
  readonly gateOutcome: 'SENT' | 'NOT_SENT' | null;
  readonly notSentReason: string | null;
  readonly foundDtcs: readonly string[];
  readonly publishedToCanonicalAuthority: boolean | null;
}

const _EMPTY_KWP_EVIDENCE: KwpDtcEvidence = Object.freeze({
  lastScanAtMs: null, protocolAtScan: null, attempted: false,
  channelAvailable: false, okCount: 0, unsupportedCount: 0,
  failedCount: 0, codeCount: 0, functional03Raw: null, functional07Raw: null,
  physicalTarget: null, targetProvenance: null, sessionRequest: null,
  sessionResponse: null, request18Tx: null, response18Raw: null,
  gateOutcome: null, notSentReason: null, foundDtcs: [],
  publishedToCanonicalAuthority: null,
});

let _kwpEvidence: KwpDtcEvidence = _EMPTY_KWP_EVIDENCE;

/** LAB salt-okuma yüzeyi — hiçbir şey tetiklemez, ASLA fırlatmaz. */
export function getKwpDtcEvidence(): KwpDtcEvidence {
  /* Fonksiyonel ham RX aynı oturumdaki kanonik servis kanıtından gelir. Ham
     köprüde yoksa null kalır; boş string üretip "temiz" denmez. */
  let e03: string | null = null; let e07: string | null = null;
  try {
    for (const e of getDtcEvidence()) {
      if (e.ecuTxHeader !== null) continue;
      if (e.service === '03') e03 = e.raw;
      if (e.service === '07') e07 = e.raw;
    }
  } catch { /* salt-okunur kanıt başarısızsa mevcut null korunur */ }
  return Object.freeze({ ..._kwpEvidence, functional03Raw: e03, functional07Raw: e07,
    foundDtcs: [..._kwpEvidence.foundDtcs] });
}

/** @internal — testler arası izolasyon. */
export function _resetKwpDtcEvidenceForTest(): void {
  _kwpEvidence = _EMPTY_KWP_EVIDENCE;
}

/**
 * V-08 — bir ECU'da KWP 0x18 (ReadDTCByStatus) okur ve kodları DEDUPE ederek döner.
 *
 * NEDEN AYRI FONKSİYON: KWP DTC **2 BAYTTIR** (UDS 0x19'da 3). Aynı çözücüyü
 * kullanmak kayıt boyunu yanlış sayar ve TÜM LİSTE KAYAR — sessiz veri
 * bozulmasının klasik yolu. Bu yüzden `kwpDtc.ts` ayrı çözücüdür.
 *
 * DEDUPE ŞART: aynı arıza hem Mode 03'te hem 0x18'de görünebilir; iki kez
 * listelemek kullanıcıya "iki arıza var" yalanı söyler. Standart moddan gelen
 * kod KAZANIR; KWP yalnız EK olanları getirir (asıl kazanç zaten üretici kodu).
 *
 * FAIL-SOFT: ECU 0x18'i bilmiyorsa bu bir HATA DEĞİLDİR (`unsupported`) ve
 * standart sonuçlar KORUNUR.
 */
async function readKwpForEcu(
  ecu: DiscoveredEcu, result: EcuScanResult, sessionEpoch: number, protocol: string | null,
  txn: DiagnosticTransaction,
): Promise<EcuDtc[]> {
  /* KWP adresi CAN header aritmetiğinden TÜRETİLEMEZ. Açık target/session kanıtı yoksa gönderme. */
  if (!isKwpDtcAddressable(ecu, protocol)) {
    result.kwp = null;
    result.kwpDiagnosticOutcome = 'not_addressable';
    if (vdkAdvancedDtcsFn()) {
      _recordAdvanced(txn, ecu, '18', '18', '00FF00', {
        raw: '', kind: 'NOT_SENT', outcome: 'not_addressable', error: 'KWP target/session kanıtı yok',
      }, sessionEpoch, protocol);
    }
    return [];
  }
  const kwpAdvFn = vdkAdvancedDtcsFn();
  if (!kwpAdvFn && !(vdkTransportAvailable() && CarLauncher.readKwpDtcs)) {
    result.kwp = 'unsupported';
    return [];
  }
  try {
    if (kwpAdvFn) {
      if (!consumeRequest(txn)) { result.kwp = null; return []; }   // sorulmadı ≠ desteklenmiyor
      const res = await kwpAdvFn({
        service: '18', subFunction: '18', payload: '00FF00', tx: ecu.txHeader, rx: ecu.rxHeader,
        targetVerified: true,
      });
      if (!acceptResponse(txn)) { result.kwp = null; return []; }   // geç yanıt
      const outcome = normalizeAdvancedOutcome(res.outcome, res.nrc ?? null);
      result.kwpDiagnosticOutcome = outcome;
      if (outcome !== 'ok') {
        _recordAdvanced(txn, ecu, '18', '18', '00FF00', res, sessionEpoch, protocol);
        result.kwp = outcome === 'unsupported' || outcome === 'security_required' ? 'unsupported' : 'failed';
        /* ── P0-OBD-DIAG-02 · ESKİ NESİL KWP DTC SERVİSİ (0x13) ─────────────
           ECU 0x18'i AÇIKÇA reddettiyse (`7F 18 11` → `unsupported`) bu bir hat
           sorunu DEĞİL, ölçülmüş bir gerçektir: bu birim o servisi bilmiyor.
           ISO 14230-3'te 0x18'in ÖNCEKİ nesli 0x13'tür ve çok sayıda 2000-2008
           KWP ECU'su YALNIZ onu tanır — ürün bugüne kadar 0x13'ü HİÇ sormadı,
           yani o araçlarda üretici arızası yapısal olarak GÖRÜNMEZDİ.

           KAPI DAR: yalnız (a) ECU 0x18'i AÇIKÇA reddettiyse — sessizlikte ya da
           hat hatasında DENENMEZ, çünkü o durumda adres/hat şüphelidir — ve
           yalnız (b) hedef zaten kanıtlanmışken (buraya `kwpTargetVerified`
           olmadan girilemez). Yani fazladan tek bayt ancak ECU "18'i bilmiyorum"
           DEDİĞİNDE hatta çıkar. */
        if (outcome === 'unsupported') return await _readKwp13ForEcu(ecu, result, sessionEpoch, protocol, txn);
        return [];
      }
      const envelope = validateKwpDtcResponse(res.raw);
      if (!envelope.valid) {
        _recordAdvanced(txn, ecu, '18', '18', '00FF00', res, sessionEpoch, protocol, [], [], [], 'malformed');
        result.kwp = 'failed'; result.kwpDiagnosticOutcome = 'malformed'; return [];
      }
      result.kwp = 'ok';
      result.kwpDiagnosticOutcome = 'ok';
      const parsed = parseKwpDtcResponse(res.raw);
      _recordAdvanced(txn, ecu, '18', '18', '00FF00', res, sessionEpoch, protocol,
        /* P0-OBD-FINISH: LAB kanıtına da ALT KODLU künye yazılır — kanıt
           ekranında `P0380` ile `P0380(11)` karışmaz. */
        parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)), parsed.map((d) => d.rawStatus));
      return _tagKwpCodes(ecu, result, parsed);
    }
    const res = await CarLauncher.readKwpDtcs!({ tx: ecu.txHeader, rx: ecu.rxHeader });
    if (res.supported === false) {
      result.kwp = 'unsupported';   // ECU 0x18'i bilmiyor — hata DEĞİL
      return [];
    }
    result.kwp = 'ok';

    return _tagKwpCodes(ecu, result, parseKwpDtcResponse(res.raw ?? ''));
  } catch (e) {
    result.kwp = 'failed';
    logError('OBD:KwpDtcFailed', e);       // KWP düştü — standart sonuçlar KORUNUR
    return [];
  }
}

/**
 * P0-OBD-DIAG-02 — ISO 14230-3 SERVİS 0x13 (readDiagnosticTroubleCodes).
 *
 * YALNIZ 0x18 AÇIKÇA REDDEDİLDİĞİNDE çağrılır (bkz. çağıran yorumu). İstek tek
 * bayttır (`13`), pozitif yanıt `53 <count> (<DTC hi><DTC lo><status>)*` —
 * gövde biçimi 0x18 ile AYNIDIR, bu yüzden AYNI çözücü kullanılır (ikinci
 * ayrıştırıcı YAZILMADI; kayıt boyu 3 bayt kuralı tek yerde kalır).
 *
 * FAIL-CLOSED: NRC · sessizlik · bozuk gövde kod ÜRETMEZ; hepsi ayrı sonuç
 * sınıfı olarak kanıt defterine yazılır ve `kwp13` alanına dürüstçe düşer.
 */
async function _readKwp13ForEcu(
  ecu: DiscoveredEcu, result: EcuScanResult, sessionEpoch: number, protocol: string | null,
  txn: DiagnosticTransaction,
): Promise<EcuDtc[]> {
  const kwp13Fn = vdkAdvancedDtcsFn();
  if (!kwp13Fn) { result.kwp13 = null; return []; }
  try {
    if (!consumeRequest(txn)) { result.kwp13 = null; return []; }
    const res = await kwp13Fn({
      service: '13', subFunction: '13', payload: '', tx: ecu.txHeader, rx: ecu.rxHeader,
      targetVerified: true,
    });
    if (!acceptResponse(txn)) { result.kwp13 = null; return []; }   // geç yanıt
    const outcome = normalizeAdvancedOutcome(res.outcome, res.nrc ?? null);
    result.kwp13DiagnosticOutcome = outcome;
    if (outcome !== 'ok') {
      _recordAdvanced(txn, ecu, '13', '13', '', res, sessionEpoch, protocol);
      result.kwp13 = outcome === 'unsupported' || outcome === 'security_required'
        ? 'unsupported' : 'failed';
      return [];
    }
    const envelope = validateKwpDtcResponse(res.raw);
    if (!envelope.valid) {
      _recordAdvanced(txn, ecu, '13', '13', '', res, sessionEpoch, protocol, [], [], [], 'malformed');
      result.kwp13 = 'failed'; result.kwp13DiagnosticOutcome = 'malformed'; return [];
    }
    result.kwp13 = 'ok';
    const parsed = parseKwpDtcResponse(res.raw);
    _recordAdvanced(txn, ecu, '13', '13', '', res, sessionEpoch, protocol,
      /* P0-OBD-FINISH: LAB kanıtına da ALT KODLU künye yazılır — kanıt
         ekranında `P0380` ile `P0380(11)` karışmaz. */
      parsed.map((d) => formatDtcDisplayCode(d.code, d.failureType)), parsed.map((d) => d.rawStatus));
    const authBefore13 = result.authorityCodes.length;
    const tagged13 = _tagKwpCodes(ecu, result, parsed, '13');
    _accountKwp(ecu, sessionEpoch, protocol, '13', res.raw, parsed.length,
      result.authorityCodes.length - authBefore13, tagged13.length, 'ok');
    return tagged13;
  } catch (e) {
    result.kwp13 = 'failed';
    logError('OBD:Kwp13DtcFailed', e);   // 0x13 düştü — standart sonuçlar KORUNUR
    return [];
  }
}

function _tagKwpCodes(
  ecu: DiscoveredEcu, result: EcuScanResult, parsed: ReturnType<typeof parseKwpDtcResponse>,
  kwpService: '18' | '13' = '18',
): EcuDtc[] {
  const existing = new Set(result.codes.map((c) => c.code));
  const seen = _seenRecordKeys(result); const out: EcuDtc[] = [];
  for (const d of parsed) {
    const key = _recordKey(d.code, d.failureType, d.rawStatus);
    if (seen.has(key)) continue; seen.add(key);
    const tagged: EcuDtc = { code: d.code, ecuLabel: ecu.label, ecuTxHeader: ecu.txHeader,
      ..._ecuIdentityFields(ecu), mode: 'stored', fromKwp: true, kwpService,
      active: d.status.testFailed, rawStatus: d.rawStatus,
      ...(d.failureType === undefined ? {} : { failureType: d.failureType, subCode: d.failureType }),
      rawDtc: d.rawDtc, state: classifyUdsDtcState(d.status) };
    result.authorityCodes.push(tagged);
    if (!existing.has(d.code)) out.push(tagged);
  }
  return out;
}

/**
 * Tam araç taraması — keşif + ECU başına DTC (F2-4 tek giriş noktası).
 * Keşif hiç çalışmadıysa (native yok / prob düştü) boş rapor döner; çağıran mevcut
 * tek-ECU akışına düşer (graceful degrade — regresyon yok).
 */
/**
 * P0-VDK-F5B — tam tarama bitişinde Self-Healing tetiği (fail-soft kabuk).
 *
 * Hedef ECU **ölçülmüş** kayıttan kurulur; adres/rol UYDURULMAZ. Uygun hedef
 * yoksa iyileştirme `BLOCKED` olur ve hatta tek bayt çıkmaz.
 */
/**
 * P0-VDK-F5B.1 — taramanın ÖLÇTÜĞÜ servis sonuçlarını keşif girdisine çevirir.
 *
 * ⚠️ Yalnız ÖLÇÜM taşınır: hangi servis hangi sonucu verdi. `null` alanlar
 * (SORULMADI) imzaya GİRMEZ — "sorulmadı" ile "desteklemiyor" ayrı şeylerdir.
 * Ham gövde, VIN ve konum TAŞINMAZ.
 */
function discoveryInputsFrom(report: MultiEcuScanReport): DiscoveryEcuInput[] {
  return report.results.map((r) => ({
    txHeader: r.ecu.txHeader,
    rxHeader: r.ecu.rxHeader,
    addressBits: r.ecu.addressBits,
    role: r.ecu.role,
    label: r.ecu.label,
    discoverySource: r.ecu.discoverySource,
    probeOutcome: r.ecu.probeOutcome,
    kwpTargetVerified: r.ecu.kwpTargetVerified,
    /* P0-VDK-F6A — adresin HANGİ standart kuraldan türediği taşınmazsa uç
       nokta adreslenemez sayılır ve istek GÖNDERİLMEZ. */
    ...(r.ecu.txProvenance === undefined ? {} : { txProvenance: r.ecu.txProvenance }),
    serviceStatuses: {
      '03': r.stored, '07': r.pending, '0A': r.permanent,
      '19': r.uds, '18': r.kwp, '13': r.kwp13,
    },
  }));
}

/**
 * P0-VDK-F6D — bu turun kapsam boşluklarını MEVCUT sicile yazar (TEK yer).
 *
 * ASLA throw etmez. Yeni otorite KURMAZ: çeviri saf `planCoverageGaps`te,
 * yazım mevcut `recordGap`te, kimlik/dedupe mevcut `gapRegistryKey`te.
 *
 * `vehicleRef` keşfin TAZE çözdüğü değerden gelir; kapsam defterindeki
 * (tarama anında henüz `null` olabilen) değer yalnız yedektir.
 */
function _recordCoverageGaps(vehicleRef: string | null, sessionEpoch: number): number {
  let written = 0;
  try {
    const endpoints: CoverageGapEndpointInput[] = getDtcCoverageEvidence()
      .map((e) => ({
        ecuKey: e.ecuKey,
        txHeader: e.txHeader,
        rxHeader: e.rxHeader,
        protocol: e.protocol,
        provenance: e.provenance,
        atMs: e.atMs,
        sessionEpoch: e.sessionEpoch,
        transactionId: e.transactionId,
        evidenceCorrelationId: e.evidenceCorrelationId,
        vehicleRef: vehicleRef ?? e.vehicleRef,
        rows: e.rows.map((r) => ({
          axis: r.axis, service: r.service, subFunction: r.subFunction,
          outcome: r.outcome, gapRoot: r.gapRoot, skipReason: r.skipReason,
          measuredOutcome: r.measuredOutcome, requestCount: r.requestCount,
          cls: r.cls,
        })),
      }));
    for (const c of planCoverageGaps(endpoints)) {
      recordGap(c.record);
      written++;
    }
  } catch (e) { logError('OBD:CoverageGapWrite', e); }

  /* ── P0-VDK-F6D-1 · FONKSİYONEL ATIF BOŞLUĞU ───────────────────
     KAPATILAN KOPUKLUK: `functionalDtcGapSignals()` `UNKNOWN_ECU_ATTRIBUTION`
     sinyalini ZATEN üretiyordu ama **hiçbir `recordGap` çağıranı yoktu** —
     yalnız bir LAB kaynağı (`vdkReplaySources`) okuyordu. Yani sahibi
     ölçülemeyen fonksiyonel bir DTC okuması kanonik sicile HİÇ düşmüyor ve
     çözücü tarafından GÖRÜLEMİYORDU.

     REPLAY KAYDI GİRMEZ: replay koşusunda ölçülen bir atıf belirsizliği CANLI
     bir araç boşluğu SAYILMAZ (F4-C `isProductTrusted` ilkesi). */
  try {
    const fn: FunctionalAttributionInput[] = getFunctionalDtcEvidence()
      .filter((e) => e.replay !== true && e.ecuAttribution === 'UNKNOWN')
      .map((e) => ({
        service: e.mode,
        ecuAttribution: 'UNKNOWN',
        protocol: null,
        provenance: 'live' as const,
        atMs: Date.now(),
        sessionEpoch,
        transactionId: null,
        evidenceCorrelationId: null,
        vehicleRef,
      }));
    for (const c of planFunctionalAttributionGaps(fn)) {
      recordGap(c.record);
      written++;
    }
  } catch (e) { logError('OBD:AttributionGapWrite', e); }
  return written;
}

/**
 * P0-VDK-F6D — İYİLEŞTİRME ÖLÇÜMÜ → KANONİK KAPSAM ZİNCİRİ (TEK yol).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ── PAZARLIKSIZ: "GAP RESOLVED" TEK BAŞINA KAPSAM TAMAMLAMAZ ───────────
 * ═══════════════════════════════════════════════════════════════════════
 * Bu fonksiyon `GapState.lifecycle`e **BAKMAZ**. Yalnız `lastOutcome`a —
 * yani ÇÖZÜCÜNÜN GERÇEKTEN ÖLÇTÜĞÜ SONUCA — bakar. "RESOLVED" bir resolver
 * durumudur ("hedeflediğim boşluk için yeni kanıt aldım"); kapsam gerçeği
 * ise `dtcCoverageEvidence` + `ecuCompleteness` + `dtcAuthority`tır.
 * Aynı koşullu yanıt geri geldiyse (`PRESENT_BUT_CONDITIONED`) satır
 * `UNKNOWN` KALIR ve kapsam TAMAMLANMAZ — oturumun açılmış olması başarı DEĞİLDİR.
 *
 * Yalnız **bu köprünün kendi yazdığı** boşluklar geri okunur
 * (`dtc_coverage:` öneki) ve yalnız AYNI (uç nokta × sınıf) hedefi güncellenir —
 * başka bir üreticinin ölçümü kapsam satırına sessizce yazılamaz.
 *
 * İKİNCİ KAPSAM OTORİTESİ KURULMADI: satır güncellenir, hüküm yine
 * `rollupEcuDtcCoverage` + `buildEcuCompleteness` tarafından YENİDEN hesaplanır.
 *
 * @returns güncellenen kapsam satırı sayısı (ölçüm, iddia değil)
 */
function _refreshCoverageAfterHealing(sessionEpoch: number): number {
  let updated = 0;
  try {
    /* Çözücünün BU turdaki ölçümleri: (ecuKey × sınıf) → yeni kapsam sınıfı. */
    const healed = new Map<string, { outcome: DtcCoverageOutcome; measured: string }>();
    for (const st of getGapStates()) {
      const parsed = parseCoverageContext(st.gap.context);
      if (parsed === null) continue;                    // başka üreticinin boşluğu
      const ecuKey = st.gap.target.ecuKey;
      if (ecuKey === null) continue;                    // hedefsiz ölçüm yazılmaz
      const outcome = coverageOutcomeFromHealing(st.lastOutcome);
      if (outcome === null) continue;                   // ÖLÇÜM YOK → satıra dokunma
      healed.set(`${ecuKey}|${parsed.cls}`, {
        outcome, measured: st.lastOutcome ?? '',
      });
    }
    if (healed.size === 0) return 0;

    for (const entry of getDtcCoverageEvidence()) {
      if (entry.sessionEpoch !== sessionEpoch) continue;   // oturum mührü
      let touched = false;
      const rows = entry.rows.map((r) => {
        const hit = healed.get(`${entry.ecuKey}|${r.cls}`);
        if (hit === undefined || hit.outcome === r.outcome) return r;
        touched = true;
        return {
          ...r,
          outcome: hit.outcome,
          /* Kayıp kökü YENİ ölçümden TÜRETİLİR — eski kök taşınmaz. */
          gapRoot: coverageGapRoot(hit.outcome, hit.measured, null),
          skipReason: null,
          requestCount: r.requestCount + 1,
          measuredOutcome: hit.measured,
          detail: `${r.detail} · F6-D hedefli yeniden ölçüm: ${hit.measured}`,
        };
      });
      if (!touched) continue;

      /* HÜKÜM YENİDEN HESAPLANIR — elle "COMPLETE" YAZILMAZ. */
      const rollup = rollupEcuDtcCoverage(
        rows.map<CoverageRollupRow>((x) => ({ cls: x.cls, outcome: x.outcome })));
      recordDtcCoverage({
        ...entry, rows,
        verdict: entry.addressability === 'NOT_ADDRESSABLE'
          ? entry.verdict : rollup.verdict,
        reasons: rollup.reasons,
        deepVerdict: entry.addressability === 'NOT_ADDRESSABLE'
          ? entry.deepVerdict : rollup.deep.verdict,
        deepReasons: rollup.deep.reasons,
        corePlannedUnits: rollup.core.plannedUnits,
        coreTerminalUnits: rollup.core.terminalUnits,
        deepPlannedUnits: rollup.deep.plannedUnits,
        deepTerminalUnits: rollup.deep.terminalUnits,
      });
      updated++;
    }
  } catch (e) { logError('OBD:CoverageRefreshAfterHealing', e); }
  return updated;
}

/**
 * P0-VDK-F6E — bu turun kapsam ölçümlerini MEVCUT öğrenmeye yazar (TEK yer).
 *
 * ASLA throw etmez. Yeni otorite KURMAZ: çeviri saf
 * `planCoverageLearningWrites`te, birleştirme politikası MEVCUT
 * `mergeCapabilityObservation`ta, kalıcılık MEVCUT `capabilityStore`ta.
 *
 * @returns yazılan gözlem sayısı (ölçüm, iddia değil)
 */
function _learnFromCoverage(vehicleRef: string | null, sessionEpoch: number): number {
  let written = 0;
  try {
    const endpoints: CoverageLearningEndpoint[] = getDtcCoverageEvidence()
      .filter((e) => e.sessionEpoch === sessionEpoch)
      .map((e) => ({
        ecuKey: e.ecuKey,
        protocol: e.protocol,
        provenance: e.provenance,
        atMs: e.atMs,
        evidenceRef: e.evidenceCorrelationId,
        rows: e.rows.map((r) => ({
          service: r.service, subFunction: r.subFunction,
          outcome: r.outcome, measuredOutcome: r.measuredOutcome,
          nrc: r.nrc, gapRoot: r.gapRoot, requestCount: r.requestCount,
        })),
      }));
    const writes = planCoverageLearningWrites(endpoints, {
      vehicleRef: vehicleRef ?? getCapabilityScope().vehicleRef,
      transport: { genericBridge: genericBridgeAvailable(), routePolicy: null,
        adapterHash: null },
    });
    for (const o of writes) { recordCapabilityObservation(o); written++; }
  } catch (e) { logError('OBD:CoverageLearningWrite', e); }
  return written;
}

async function runSelfHealingAfterScan(
  txn: DiagnosticTransaction,
  topology: VehicleTopology,
  report: MultiEcuScanReport,
): Promise<void> {
  const defs = [...builtinServiceDefs(), ...extraReadOnlyServiceDefs()];
  const protoClass = classifyProtocol(txn.protocol);

  let admission: ReturnType<typeof getDiagnosticAdmissionSync>['admission'] = 'UNKNOWN';
  try { admission = getDiagnosticAdmissionSync().admission; }
  catch (e) { logError('OBD:SelfHealingAdmission', e); }

  const transport = {
    genericBridge: genericBridgeAvailable(),
    routePolicy: null,
    adapterHash: null,
  };

  /* ── 1) ÜRETİM SERVİS KEŞFİ (F4-B) ────────────────────────────────────
     Normal tarama BİTTİ; kalan bütçeden pay alır ve Self-Healing rezervine
     DOKUNMAZ. Sonuç F4-C yetenek çizgesini ve F2-C boşluk sicilini besler —
     Self-Healing böylece gerçek, ölçülmüş bir boşluk görebilir. */
  let gapsBefore = 0;
  try { gapsBefore = getGapRegistry().length; }
  catch (e) { logError('OBD:DiscoveryGapBaseline', e); }

  let vehicleId: string | null = null;
  let fingerprintReusable = false;
  try {
    const disc = await runProductionDiscovery(txn, {
      admission,
      ecus: discoveryInputsFrom(report),
      defs,
      protocolClass: protoClass === 'unknown' ? null : protoClass,
      protocol: txn.protocol,
      supportedPidBitmap: null,
      transport,
      nowMs: Date.now(),
    }, gapsBefore);
    vehicleId = disc.vehicleId;
    fingerprintReusable = disc.fingerprintReusable;
  } catch (e) {
    logError('OBD:ProductionDiscoveryRun', e);
  }

  /* ── 1b) ECU KİMLİK/ROL ÇÖZÜMÜ (F6-A) ─────────────────────────────────
     ══════════════════════════════════════════════════════════════════════
     SIRA BİLİNÇLİDİR: kullanıcının beklediği tarama BİTTİ, servis keşfi
     ölçüldü (yetenek imzası artık elimizde) ve Self-Healing HENÜZ koşmadı —
     yani kimlik çözümü kalan bütçeden pay alır ama iyileştirmenin rezervine
     DOKUNAMAZ (`IDENTITY_MIN_RESERVE_REQUESTS`).

     Bu adım rolü ADRESTEN TÜRETMEZ: her uç noktaya yalnız rol-bağımsız,
     salt-okunur kimlik DID'leri sorulur ve rol MEVCUT kanıt modelinden
     (F6-A `resolveEcuRole`) çıkar. Rol çözülemezse uç nokta KAYBOLMAZ —
     `UNKNOWN` olarak kanonik envanterde kalır. */
  try {
    const statuses: Record<string, Record<string, string | null>> = {};
    for (const r of report.results) {
      statuses[r.ecu.rxHeader] = {
        '03': r.stored, '07': r.pending, '0A': r.permanent,
        '19': r.uds, '18': r.kwp, '13': r.kwp13,
      };
    }
    let vin: string | null = null;
    try { vin = getHandshakeVin(); } catch { vin = null; }

    /* CDDL belgesi MEVCUT köprüden TEK KEZ üretilir (ikinci profil otoritesi
       yok); desenler ölçülmüş kanıta karşı `matchVariantPatterns` ile
       değerlendirilir. */
    const doc = cddlDocumentFromLegacy({
      documentId: 'runtime.identity', oemProfiles: getProductOemProfiles(),
    });

    await resolveEcuIdentities(txn, {
      admission,
      ecus: topology.ecus,
      defs,
      patterns: doc.patterns,
      variants: doc.variants,
      protocol: txn.protocol,
      protocolClass: protoClass === 'unknown' ? null : protoClass,
      vin,
      serviceStatuses: statuses,
      vehicleRef: vehicleId,
      provenance: 'live',
      nowMs: Date.now(),
    });
  } catch (e) {
    logError('OBD:EcuIdentityResolve', e);
  }

  /* ── 1c) KAPSAM BOŞLUĞU → KANONİK SİCİL (P0-VDK-F6D) ──────────────────
     ══════════════════════════════════════════════════════════════════════
     KAPATILAN KÖK NEDEN: F6-C `measurableGapUnits` üretiyordu ama o sayı
     HİÇBİR YERE GİTMİYORDU — üretimde `recordGap`in TEK çağıranı F4-B servis
     keşfiydi. Yani okunamayan bir DTC kanalı F5 resolver tarafından
     **GÖRÜLEMİYORDU**.

     SIRA BİLİNÇLİDİR: `runProductionDiscovery` ARACIN BÖLÜMÜNÜ aktive eder
     (`activateVehicleDiagnosticContext`). Boşlukları ONDAN ÖNCE yazmak,
     onları kimliği bilinmeyen (ya da ÖNCEKİ aracın) sicilene yazmak olurdu —
     F5-F/G araç izolasyonunun tam olarak yasakladığı şey. Bu yüzden keşiften
     SONRA, iyileştirmeden ÖNCE yazılır: aynı turda üretilen boşluk aynı turda
     çözülmeye aday olur.

     YENİ SİCİL/ZAMANLAYICI/ÇÖZÜCÜ KURULMADI: çeviri SAF (`planCoverageGaps`),
     yazım MEVCUT `recordGap` kapısından. */
  try {
    _recordCoverageGaps(vehicleId, txn.sessionEpoch);
  } catch (e) {
    logError('OBD:CoverageGapBridge', e);   // köprü düşerse tarama DÜŞMEZ
  }

  /* ── 1d) KAPSAM ÖLÇÜMÜ → MEVCUT F4-C ÖĞRENMESİ (P0-VDK-F6E) ──────────
     ══════════════════════════════════════════════════════════════
     KAPATILAN KÖK NEDEN: F4-C öğrenmesinin üretimdeki TEK yazıcısı F4-B servis
     keşfiydi. Ürünün ANA tanı yolu (03/07/0A · 19-xx · 18/13) her taramada
     onlarca güvenilir ölçüm üretiyor ve **hiçbiri öğrenilmiyordu**.

     SIRA: keşten SONRA (araç bölümü aktif) — kimliksiz öğrenme başka araca
     sızabilirdi. Politika (UNKNOWN ezmez · ABSENT kotası · çelişki · köken)
     MEVCUT `mergeCapabilityObservation`tadır; burada KOPYALANMAZ. */
  try {
    _learnFromCoverage(vehicleId, txn.sessionEpoch);
  } catch (e) {
    logError('OBD:CoverageLearning', e);   // öğrenme düşerse tarama DÜŞMEZ
  }

  /* ── 2) SELF-HEALING (F5-B → F5-A) ────────────────────────────────────
     Hedef: hattan CEVAP VERMİŞ ve rolü ÖLÇÜLMÜŞ ilk ECU. Sıra deterministik. */
  let target = null;
  for (const e of topology.ecus) {
    const built = healingTargetFromProvenEcu(
      e as unknown as Parameters<typeof healingTargetFromProvenEcu>[0],
      defs.map((d) => d.id),
    );
    if (built !== null) { target = built; break; }
  }

  const healingResult = await maybeRunSelfHealing(txn, {
    trigger: 'AFTER_FULL_VEHICLE_SCAN',
    admission,
    ecu: target,
    defs,
    protocolClass: protoClass === 'unknown' ? null : protoClass,
    protocol: txn.protocol,
    /* Kira sorusu tarama yolunda ECU başına sorulur; burada tur seviyesinde
       sorulmaz → `null` (kira kapısı resolver içinde yine uygulanır). */
    leaseAllows: null,
    ecuAddressProven: target !== null,
    /* Kısmi/başarısız tarama daha yüksek öncelikli iştir: önce o tamamlanmalı. */
    higherPriorityWorkPending: report.failedReads > 0 || report.skippedEcus > 0,
    provenance: 'live',
    transport,
    targetVerified: target !== null,
    /* Kimlik ve parmak izi gücü KEŞİFTEN gelir — ikinci kimlik sistemi YOK. */
    vehicleId,
    ecuId: target === null ? null : target.id,
    fingerprintReusable,
    nowMs: Date.now(),
  });

  /* ── 3) KAPSAM ZİNCİRİNİ YENİDEN HESAPLA (P0-VDK-F6D) ──────────────
     İyileştirme GERÇEKTEN yeni bir kanal ölçtüyse kapsam gerçeği değişmiştir
     ve kanonik zincir yeniden koşmalıdır:
       yeni ölçüm → dtcCoverageEvidence → ecuCompleteness → scanReport/verdict
     İyileştirme HIÇBİR ŞEY ÖLÇMEDİYSE (`result === null` — karar ERTELENDİ/
     ENGELLENDİ ya da ölçülecek boşluk yoktu) ya da hiçbir kapsam satırı
     değişmediyse kapsam AYNEN kalır — sahte bir tazeleme ÜRETİLMEZ. */
  try {
    if (healingResult.result !== null
        && healingResult.result.measured > 0
        && _refreshCoverageAfterHealing(txn.sessionEpoch) > 0) {
      _recomputeCompletenessAfterHealing(txn);
    }
  } catch (e) {
    logError('OBD:CoverageRefreshChain', e);
  }
}

/**
 * P0-VDK-F6D — kapsam satırı değişti → ÜST HÜKÜİ YENİDEN HESAPLA.
 *
 * `buildEcuCompleteness` MEVCUT ve TEK otoritedir; burada yalnız YENİDEN
 * çağrılır. Aday kümesi ve anahtar sınıfları son turun kanıtından gelir —
 * yeni bir kapsam durumu İCAT EDİLMEZ.
 */
function _recomputeCompletenessAfterHealing(txn: DiagnosticTransaction): void {
  const prev = _lastCompleteness;
  if (prev === null) return;   // kapsam hiç hesaplanmadı → tazelenecek bir şey yok
  let nowEpoch = txn.sessionEpoch;
  try { nowEpoch = getObdSessionEpoch(); } catch { nowEpoch = txn.sessionEpoch; }
  const scanned = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const notAddressable = new Set<string>();
  for (const e of prev.evidence) {
    if (e.status === 'scanned') scanned.add(e.ecuKey);
    else if (e.status === 'failed') failed.add(e.ecuKey);
    else if (e.status === 'skipped') skipped.add(e.ecuKey);
    else if (e.status === 'not_addressable') notAddressable.add(e.ecuKey);
  }
  _lastCompleteness = buildEcuCompleteness({
    candidates: prev.evidence.map((e) => ({
      rxHeader: e.rxHeader ?? '', txHeader: e.txHeader ?? '',
      addressBits: e.addressBits ?? 11, role: e.role, roleEvidence: e.roleEvidence,
      label: e.ecuKey,
      discoverySource: e.discoverySources[0], probeOutcome: e.probeOutcome,
    })),
    scannedKeys: scanned, failedKeys: failed, skippedKeys: skipped,
    notAddressableKeys: notAddressable,
    protocol: txn.protocol, sessionEpoch: prev.sessionEpoch,
    currentSessionEpoch: nowEpoch,
    expectedEcuCount: null,
    diagnostic: _diagnosticInputs(prev.sessionEpoch),
  });
}

export async function runFullVehicleScan(): Promise<MultiEcuScanReport> {
  /* P0-VDK-F1A — TAM TARAMA TEK KANONİK İŞLEMDİR: keşif ve ECU turu AYNI
     bütçeyi, AYNI oturum mührünü ve AYNI iptal sinyalini paylaşır. Eskiden
     ikisi birbirinden habersizdi ve toplam maliyet hiçbir yerde görünmüyordu. */
  const txn = beginTransaction({ purpose: 'multi_ecu_scan' });
  const prep = await prepareTransaction(txn);
  /* B7 kural 10: bu KULLANICI eylemidir (DTC paneli "Tam Tarama") → sessiz-adres
     merdiveni ATLANIR. Kullanıcı teşhis istiyorsa ona "geçen sefer sormuştuk"
     denmez; bastırma yalnız ARKA PLAN turlarını sınırlar. */
  const topology = await discoverEcus({ userInitiated: true });
  if (!prep.ok) {
    closeLeasesForTransaction(txn, 'admisyon reddetti');
    return { topology, results: [], allCodes: [], failedReads: 0,
      scannedEcus: 0, skippedEcus: topology.ecus.length,
      completeness: buildEcuCompleteness({
        candidates: topology.ecus, protocol: null,
        sessionEpoch: txn.sessionEpoch, currentSessionEpoch: txn.sessionEpoch,
        expectedEcuCount: null,
      }) };
  }

  /* V-04/4 — FİLO HAFIZASI (fail-soft, iki uç da isteğe bağlı):
     ① okuma ucu: bilinen UDS'li ECU'lar öne alınır (yalnız SIRA).
     ② yazma ucu: tur bitince gözlem öğrenilir.
     Hafıza okunamaz/yazılamazsa tarama ESKİSİ GİBİ çalışır — öğrenme bir lüks,
     teşhis bir zorunluluktur. */
  let udsFirst: readonly string[] = [];
  try { udsFirst = scanHintsFor(topology).udsFirst; }
  catch (e) { logError('OBD:FleetKbHint', e); }

  const report = await scanAllEcus(topology, udsFirst, txn);

  /* ── P0-VDK-F5B · SELF-HEALING (kullanıcı işinden SONRA, AYNI bütçeden) ──
     Sıra bilinçlidir: `completeTransaction`tan ÖNCE çalışır ki ölçüm AYNI
     işlemin bütçesinden ve AYNI oturum mühründen geçsin — iyileştirme kendi
     bütçesini YARATAMAZ. Tarama işi BİTTİĞİ için kullanıcının gördüğü hiçbir
     okuma gecikmez; kalan bütçe rezervin altındaysa karar `DEFERRED`dir.
     ASLA throw etmez: iyileştirmenin düşmesi taramayı DÜŞÜRMEZ. */
  try {
    await runSelfHealingAfterScan(txn, topology, report);
  } catch (e) {
    logError('OBD:SelfHealingAfterScan', e);
  }

  completeTransaction(txn);

  try {
    const udsCapable = report.results
      .filter((r) => r.uds === 'ok')
      .map((r) => r.ecu.txHeader);
    recordVehicleObservation(topology, udsCapable);
  } catch (e) {
    logError('OBD:FleetKbRecord', e);
  }

  return report;
}
