/**
 * multiEcuDtcCoverageSources — CAROS LAB · Çoklu-ECU DTC Kapsamı TEK okuma katmanı.
 *
 * Desen mevcut LAB turlarıyla AYNI: senkron getter'lar, her biri kendi
 * try/catch'i içinde. **HİÇBİR ŞEY BAŞLATMAZ**: tarama koşturmaz, PDU
 * göndermez, self-healing tetiklemez, depoya yazmaz, timer kurmaz, ağa çıkmaz.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * Ham OEM gövdesi, ham DTC baytı, DTC KODU, VIN ve adaptör kimliği bu
 * katmandan GEÇMEZ — kapsam defterinde de yoktur. Yalnız sayılar, kapalı
 * sözlükten sınıflar ve uç nokta adresi taşınır.
 */

import {
  getDtcCoverageEvidence, summarizeDtcCoverage,
  type DtcCoverageEcuEntry, type DtcCoverageSummary,
} from '../obd/dtcCoverageEvidence';
import {
  getDtcPipelineEntries, summarizeDtcPipeline,
  type DtcPipelineSummary,
} from '../obd/dtcPipelineAccounting';
import {
  getLastEcuCompleteness,
} from '../obd/multiEcuScan';
import type { EcuCompletenessEvidence } from '../obd/ecuCompleteness';
import { getActiveObdProtocol, getActiveProtocolClass } from '../obd/activeProtocol';
import { genericBridgeAvailable } from '../obd/genericPduTransport';
import { getCapabilityScope } from '../obd/capability/capabilityStore';
import { getObdSessionEpoch } from '../obdService';
/* P0-VDK-F6D — kapsam boşluğunun ÇÖZÜM durumu MEVCUT F5 defterlerinden
   okunur; ikinci bir healing defteri KURULMADI. */
import { getGapStates } from '../obd/healing/gapResolverRuntime';
import type { GapState } from '../obd/healing/gapModel';
import { getGapRegistry } from '../obd/gapRegistry';
import type { GapEntry } from '../obd/gapRegistry';
import type { GapLedgerScope } from '../obd/gapLedgerScope';

export interface MultiEcuDtcCoverageSnapshot {
  readonly readAt: number;
  readonly entries: readonly DtcCoverageEcuEntry[];
  readonly summary: DtcCoverageSummary | null;
  /** Mevcut F2 muhasebe zinciri — burada KOPYALANMAZ, referans verilir. */
  readonly pipeline: DtcPipelineSummary | null;
  /** ECU keşif kapsamı (ayrı otorite) — kapsam yüzdesi ORADAN gelir. */
  readonly completeness: EcuCompletenessEvidence | null;
  readonly protocol: string | null;
  readonly protocolClass: string | null;
  readonly bridgeAvailable: boolean | null;
  /** Araç bölümü — bir aracın kapsamı başka araca TAŞINAMAZ. */
  readonly scope: GapLedgerScope | null;
  /**
   * P0-VDK-F6C — ŞU ANKİ OBD oturumu. `getLastEcuCompleteness()` süreç
   * ömlürlüdür ve ARAÇ DEĞİŞSE BİLE son turun kapsamını döndürür; ekran
   * onu ŞU ANKİ araçın gerçeği gibi gösterirse başka bir aracın kapsamını
   * bu araca yazmış olur. Mühür bu yüzden taşınır ve model onu KARŞILAŞTIRIR.
   * Okunamazsa `null` (sahte 0 YASAK).
   */
  readonly sessionEpoch: number | null;
  /** P0-VDK-F6D — çözücünün bu süreçteki durumları (salt-okunur). */
  readonly gapStates: readonly GapState[];
  /** P0-VDK-F6D — kanonik boşluk sicili (salt-okunur). */
  readonly gapEntries: readonly GapEntry[];
}

function _safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export function readMultiEcuDtcCoverageSnapshot(): MultiEcuDtcCoverageSnapshot {
  const entries = _safe(getDtcCoverageEvidence) ?? [];
  return {
    readAt: Date.now(),
    entries,
    /* Hiç ölçüm yoksa özet ÜRETİLMEZ: `null` "KAYNAK YOK" demektir ve
       sıfırlarla dolu bir özet "ölçtük, sıfır çıktı" yalanı olurdu. */
    summary: entries.length === 0 ? null : _safe(() => summarizeDtcCoverage(entries)),
    pipeline: _safe(() => {
      const rows = getDtcPipelineEntries();
      return rows.length === 0 ? null : summarizeDtcPipeline(rows);
    }),
    completeness: _safe(getLastEcuCompleteness),
    protocol: _safe(getActiveObdProtocol),
    protocolClass: _safe(getActiveProtocolClass),
    bridgeAvailable: _safe(genericBridgeAvailable),
    scope: _safe(getCapabilityScope),
    sessionEpoch: _safe(getObdSessionEpoch),
    gapStates: _safe(getGapStates) ?? [],
    gapEntries: _safe(getGapRegistry) ?? [],
  };
}
