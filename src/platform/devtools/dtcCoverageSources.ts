/**
 * dtcCoverageSources — CAROS LAB · DTC Sınıf Kapsamı TEK okuma katmanı (P0-OBD-09).
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, her biri KENDİ try/catch'i
 * içinde. HİÇBİR tarama başlatmaz, komut göndermez, timer kurmaz.
 *
 * GİZLİLİK: taşınan tek şey OBD protokol verisidir (DTC kodu, servis numarası,
 * ECU adresi/etiketi, ham hex yanıt). **VIN · konum · kullanıcı verisi · API
 * anahtarı BU KATMANDAN GEÇMEZ** (CLAUDE.md gözlemlenebilirlik kuralı 6).
 */

import {
  getDtcEvidence, summarizeDtcEvidence,
  type DtcServiceEvidence, type DtcEvidenceSummary,
} from '../obd/dtcScanEvidence';
import { getObdSessionEpoch } from '../obdService';
import { getAdvancedDtcEvidence, type AdvancedDtcEvidenceEntry } from '../obd/advancedDtcEvidence';
import { getEcuObservations, type EcuDiscoveryObservation } from '../obd/ecuAddressability';
import {
  getDtcPipelineEntries, summarizeDtcPipeline,
  type DtcPipelineEntry, type DtcPipelineSummary,
} from '../obd/dtcPipelineAccounting';
import {
  getPhysicalProbes, getPhysicalProbeSkipped, type PhysicalProbeEvidence,
} from '../obd/physicalEcuProbe';
import {
  getTransactions, summarizeTransactions,
  type DiagnosticTransaction, type TransactionSummary,
} from '../obd/diagnosticTransaction';
import { getSessionLeases } from '../obd/diagnosticSessionScheduler';
import {
  getIsoTpTuningEvidence, summarizeIsoTpTuning,
  type IsoTpTuningEvidenceEntry, type IsoTpTuningSummary,
} from '../obd/isoTpTuningPolicy';
import { getAdapterCapabilities } from '../obd/adapterIdentityService';
import {
  getTraceEvents, getDroppedEventCount, summarizeTrace, getTraceId,
  type TraceSummary,
} from '../obd/canonicalTrace';
import type { AdapterCapabilities } from '../obd/adapterCapability';
import type { DiagnosticSessionLease } from '../obd/diagnosticSessionLease';
import {
  getSessionEvidence, summarizeSessionEvidence,
  type SessionEvidenceEntry, type SessionEvidenceSummary,
} from '../obd/diagnosticSessionEvidence';

export interface DtcCoverageSnapshot {
  readonly readAt: number;
  readonly entries: readonly DtcServiceEvidence[];
  readonly summary: DtcEvidenceSummary;
  /**
   * ŞU ANKİ OBD oturumu. Okunamazsa `null` — sahte `0` YASAK
   * ("0. oturum" gerçek bir değerdir, "bilinmiyor" değildir).
   */
  readonly sessionEpoch: number | null;
  readonly advanced: readonly AdvancedDtcEvidenceEntry[];
  /**
   * P0-OBD-FINAL-01 — ECU KEŞİF/ADRESLENEBİLİRLİK gözlemleri.
   *
   * Boş dizi "ECU yok" DEMEK DEĞİLDİR: tarama hiç koşmamış da olabilir. Model
   * bu ikisini AYRI gösterir — sahada boş bir keşif ekranı tam olarak bu iki
   * durumu birbirine karıştırdığı için kök neden 3 hafta görünmez kalmıştı.
   */
  readonly ecuObservations: readonly EcuDiscoveryObservation[];
  /**
   * P0-OBD-PARITY — RAW → PARSER → AUTHORITY → UI sayım künyeleri.
   *
   * Bu iki alan olmadan saha teşhisi TAHMİNE dayanıyordu: ekranda kod yokken
   * "hangi katman düşürdü" sorusunun cevabı hiçbir yerde YOKTU. Artık her
   * (ECU × servis) okuması için dört sayı ve aralarındaki kayıp aşaması
   * görünür.
   */
  readonly pipeline: readonly DtcPipelineEntry[];
  readonly pipelineSummary: DtcPipelineSummary;
  /**
   * P0-OBD-PARITY — standart CAN fiziksel adres uzayı probları (ISO 15765-4
   * 7E1..7E7). Boş dizi "araçta başka ECU yok" DEĞİL: prob YALNIZ CAN'de ve
   * yalnız köprü varsa koşar; K-line'da hiç çalışmaz.
   */
  readonly physicalProbes: readonly PhysicalProbeEvidence[];
  /** Bütçe tavanı yüzünden sorulMAYAN adres adedi — sessiz kırpma YASAK. */
  readonly physicalProbeSkipped: number;
  /**
   * P0-VDK-F1A — kanonik tanı işlemleri. Bütçe · iptal · bayat oturum · geç
   * yanıt kararlarının TAMAMI buradan okunur. `unknown > 0` bir DURUM GEÇİŞİ
   * İHLALİDİR (fail-closed tetiklendi) ve her zaman bir kusurdur.
   */
  readonly transactions: readonly DiagnosticTransaction[];
  readonly transactionSummary: TransactionSummary;
  /**
   * P0-VDK-F1B — tanı oturumu kiraları. Keepalive'ın YALNIZ kanıtlanmış
   * oturumda çalıştığı buradan doğrulanır: `keepAliveRequired:false` bir
   * kirada `attempt > 0` görülüyorsa bu bir KUSURDUR (kör TesterPresent).
   */
  readonly sessionLeases: readonly DiagnosticSessionLease[];
  readonly sessionEvidence: readonly SessionEvidenceEntry[];
  readonly sessionSummary: SessionEvidenceSummary;
  /**
   * P0-VDK-F1C — ISO-TP transport tuning kanıtı. `restoreFailures > 0` bir
   * KUSURDUR: adaptör kirli kalmış olabilir.
   */
  readonly adapter: AdapterCapabilities | null;
  readonly tuning: readonly IsoTpTuningEvidenceEntry[];
  readonly tuningSummary: IsoTpTuningSummary;
  /**
   * P0-VDK-F2A — kanonik iz özeti. `exportReady:false` ise NEDEN mutlaka
   * yazılıdır (maskeleme/bütünlük); sessiz başarısızlık YASAK.
   */
  readonly traceSummary: TraceSummary;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const _EMPTY_SUMMARY: DtcEvidenceSummary = summarizeDtcEvidence([]);
const _EMPTY_PIPELINE: DtcPipelineSummary = summarizeDtcPipeline([]);
const _EMPTY_TXN_SUMMARY: TransactionSummary = summarizeTransactions([]);
const _EMPTY_SESSION_SUMMARY: SessionEvidenceSummary = summarizeSessionEvidence([]);
const _EMPTY_TUNING_SUMMARY: IsoTpTuningSummary = summarizeIsoTpTuning([]);
const _EMPTY_TRACE_SUMMARY: TraceSummary = summarizeTrace([], 0, 'UNKNOWN');

/** Tek senkron okuma. ASLA throw etmez. */
export function readDtcCoverageSnapshot(): DtcCoverageSnapshot {
  const entries = _safe(() => getDtcEvidence(), [] as readonly DtcServiceEvidence[]);
  const pipeline = _safe(() => getDtcPipelineEntries(), [] as readonly DtcPipelineEntry[]);
  const transactions = _safe(() => getTransactions(), [] as readonly DiagnosticTransaction[]);
  const sessionEvidence = _safe(() => getSessionEvidence(), [] as readonly SessionEvidenceEntry[]);
  const tuning = _safe(() => getIsoTpTuningEvidence(), [] as readonly IsoTpTuningEvidenceEntry[]);
  return {
    readAt:       Date.now(),
    entries,
    summary:      _safe(() => summarizeDtcEvidence(entries), _EMPTY_SUMMARY),
    sessionEpoch: _safe<number | null>(() => getObdSessionEpoch(), null),
    advanced:     _safe(() => getAdvancedDtcEvidence(), [] as readonly AdvancedDtcEvidenceEntry[]),
    ecuObservations: _safe(() => getEcuObservations(), [] as readonly EcuDiscoveryObservation[]),
    pipeline,
    pipelineSummary: _safe(() => summarizeDtcPipeline(pipeline), _EMPTY_PIPELINE),
    physicalProbes: _safe(() => getPhysicalProbes(), [] as readonly PhysicalProbeEvidence[]),
    physicalProbeSkipped: _safe(() => getPhysicalProbeSkipped(), 0),
    transactions,
    transactionSummary: _safe(() => summarizeTransactions(transactions), _EMPTY_TXN_SUMMARY),
    sessionLeases: _safe(() => getSessionLeases(), [] as readonly DiagnosticSessionLease[]),
    sessionEvidence: sessionEvidence,
    sessionSummary: _safe(() => summarizeSessionEvidence(sessionEvidence), _EMPTY_SESSION_SUMMARY),
    adapter: _safe<AdapterCapabilities | null>(() => getAdapterCapabilities(), null),
    tuning,
    tuningSummary: _safe(() => summarizeIsoTpTuning(tuning), _EMPTY_TUNING_SUMMARY),
    traceSummary: _safe(
      () => summarizeTrace(getTraceEvents(), getDroppedEventCount(), getTraceId()),
      _EMPTY_TRACE_SUMMARY),
  };
}
