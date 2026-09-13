/**
 * oemSignalLabModel — CAROS LAB · OEM Sinyal Keşfi SAF görünüm modeli.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK (enjekte edilir) · global durum YOK · React YOK.
 *
 * ⚠️ EN ÖNEMLİ KURAL (mevcut LAB sözleşmesiyle aynı): **hiç yoklama yapılmadıysa `0`
 * GÖSTERİLMEZ.** `0` "sorduk ve bulamadık" demektir; "hiç sormadık" `BİLİNMİYOR`dur.
 * Bu yüzden kanıtı olmayan alanlar `null` döner ve ekran onu ayrı gösterir.
 *
 * Bu model UI OTORİTESİ DEĞİLDİR: yalnız `oemSignalRegistry` (katalog) + kalıcı kanıt
 * kaydını okunur biçime çevirir. Hiçbir durum burada ÜRETİLMEZ.
 */

import {
  oemSignalConfidence, isOemSignalProbeable, isOemSignalDecodable,
  OEM_SIGNAL_CONFIDENCE_LABEL,
  type OemSignalDef, type OemSignalConfidence,
} from '../obd/oem/oemSignalCatalog';
import {
  decideOemPoll, oemEvidenceAgeMs,
  OEM_CAPABILITY_STATE_LABEL, OEM_POLL_DENY_LABEL,
  type OemCapabilityEvidence, type OemCapabilityScope, type OemCapabilityState,
  type OemDecoderStatus, type OemPollDenyReason,
} from '../obd/oem/oemCapabilityEvidence';
import { ECU_ROLE_LABEL } from '../obd/ecuRoleModel';
import type { PollClass } from '../obd/discovery/pollingAdmissionGate';

/* ── Satır ────────────────────────────────────────────────────────────────── */

export interface OemSignalLabRow {
  readonly signalId: string;
  readonly name: string;
  readonly group: string;
  /** ECU rolü (Türkçe etiket) + çözülmüş yanıt adresi; adres yoksa `null`. */
  readonly ecuRoleLabel: string;
  readonly ecuAddress: string | null;
  /** Servis ('22' / '21' / 'UNKNOWN'). */
  readonly service: string;
  /** DID/LID — kanıtlanmamışsa 'UNKNOWN'. */
  readonly identifier: string;
  readonly state: OemCapabilityState;
  readonly stateLabel: string;
  readonly confidence: OemSignalConfidence;
  readonly confidenceLabel: string;
  /** Son pozitif yanıt anı (ms); hiç olmadıysa `null` — `0` YAZILMAZ. */
  readonly lastPositiveAt: number | null;
  /** Son negatif yanıt kodu; yoksa `null`. */
  readonly lastNrc: number | null;
  /** Ardışık kanıt-olmayan sonuç sayısı; hiç yoklanmadıysa `null` (0 ile karıştırılmaz). */
  readonly timeoutCount: number | null;
  /** Kanıt yaşı (ms); kanıt yoksa `null`. */
  readonly evidenceAgeMs: number | null;
  readonly decoderStatus: OemDecoderStatus | 'NO_DECODER';
  /** Ham yanıt örneği (inspect için) — yoksa `null`. UI OTORİTESİ DEĞİLDİR. */
  readonly rawResponseSample: string | null;
  readonly pollEligible: boolean;
  readonly pollReason: OemPollDenyReason;
  readonly pollReasonLabel: string;
  readonly pollClass: PollClass;
  readonly note: string;
}

/** Bir sinyalin LAB'a verilen çalışma-zamanı kanıtı (kalıcı kayıttan çözülür). */
export interface OemSignalLabEvidenceInput {
  readonly evidence: OemCapabilityEvidence | null;
  readonly ecuAddress: string | null;
  readonly rawResponseSample: string | null;
}

export interface OemSignalLabSnapshotInput {
  readonly catalog: readonly OemSignalDef[];
  /** signalId → kanıt. Kaydı olmayan sinyal için giriş OLMAYABİLİR (kanıt yok demektir). */
  readonly evidenceById: ReadonlyMap<string, OemSignalLabEvidenceInput>;
  readonly scope: OemCapabilityScope;
  readonly nowMs: number;
  /** Standart OBD eşdeğeri BU ARAÇTA okunabilen sinyal kimlikleri (ölçülmüş). */
  readonly standardAvailableSignalIds?: ReadonlySet<string>;
  readonly sessionHealthy: boolean;
  readonly corePollingBudgetOk: boolean;
  readonly activeOemPollCount: number;
  readonly maxConcurrentOemPolls: number;
}

/* ── Hüküm ────────────────────────────────────────────────────────────────── */

export type OemLabVerdict =
  /** Katalogda kimliği kanıtlanmış tek bir sinyal yok → araca hiç sorulmadı. */
  | 'NO_PROBEABLE_SIGNAL'
  /** Sorgulanabilir sinyal var ama bu araçta henüz yoklanmadı. */
  | 'NOT_PROBED_YET'
  /** Yoklandı, hiçbiri desteklenmiyor. */
  | 'NONE_SUPPORTED'
  /** En az bir sinyal DESTEKLENİYOR. */
  | 'HAS_SUPPORTED';

export const OEM_LAB_VERDICT_LABEL: Readonly<Record<OemLabVerdict, string>> = {
  NO_PROBEABLE_SIGNAL: 'KİMLİK KANITI YOK — katalogdaki hiçbir sinyal sorgulanamaz (araca gidilmedi)',
  NOT_PROBED_YET:      'HENÜZ YOKLANMADI — sorgulanabilir sinyal var, bu araçta kanıt yok',
  NONE_SUPPORTED:      'DESTEKLENMİYOR — yoklanan sinyallerin hiçbiri pozitif yanıt vermedi',
  HAS_SUPPORTED:       'DESTEKLENİYOR — en az bir sinyalde pozitif ECU yanıtı var',
};

export interface OemSignalLabSnapshot {
  readonly rows: readonly OemSignalLabRow[];
  readonly verdict: OemLabVerdict;
  readonly verdictLabel: string;
  /** Katalogdaki toplam sinyal sayısı. */
  readonly catalogCount: number;
  /** Kimliği kanıtlanmış (sorgulanabilir) sinyal sayısı. */
  readonly probeableCount: number;
  /** Bu araçta kanıt kaydı OLAN sinyal sayısı. */
  readonly probedCount: number;
  readonly supportedCount: number;
}

/* ── Kurucu ───────────────────────────────────────────────────────────────── */

export function buildOemSignalLabSnapshot(input: OemSignalLabSnapshotInput): OemSignalLabSnapshot {
  const standardAvailable = input.standardAvailableSignalIds ?? new Set<string>();

  const rows: OemSignalLabRow[] = input.catalog.map((def) => {
    const ev = input.evidenceById.get(def.signalId) ?? null;
    const evidence = ev?.evidence ?? null;

    const decision = decideOemPoll({
      def,
      evidence,
      scope: ev?.ecuAddress ? { ...input.scope, ecuAddress: ev.ecuAddress } : input.scope,
      nowMs: input.nowMs,
      standardEquivalentAvailable: standardAvailable.has(def.signalId),
      sessionHealthy: input.sessionHealthy,
      corePollingBudgetOk: input.corePollingBudgetOk,
      activeOemPollCount: input.activeOemPollCount,
      maxConcurrentOemPolls: input.maxConcurrentOemPolls,
    });

    const state: OemCapabilityState = evidence?.state ?? 'UNKNOWN';
    const decoderStatus: OemDecoderStatus = evidence?.decoderStatus
      ?? (isOemSignalDecodable(def) ? 'NOT_ATTEMPTED' : 'NO_DECODER');
    const confidence = oemSignalConfidence(def);

    return {
      signalId: def.signalId,
      name: def.name,
      group: def.group,
      ecuRoleLabel: ECU_ROLE_LABEL[def.ecuRole],
      ecuAddress: ev?.ecuAddress ?? null,
      service: def.service,
      identifier: def.identifier,
      state,
      stateLabel: OEM_CAPABILITY_STATE_LABEL[state],
      confidence,
      confidenceLabel: OEM_SIGNAL_CONFIDENCE_LABEL[confidence],
      lastPositiveAt: evidence?.lastPositiveAt ?? null,
      lastNrc: evidence?.lastNrc ?? null,
      // Hiç yoklanmadıysa `null` — `0` "hiç hata almadık" gibi OKUNURDU.
      timeoutCount: evidence === null ? null : evidence.timeoutCount,
      evidenceAgeMs: evidence === null ? null : oemEvidenceAgeMs(evidence, input.nowMs),
      decoderStatus,
      rawResponseSample: ev?.rawResponseSample ?? null,
      pollEligible: decision.eligible,
      pollReason: decision.reason,
      pollReasonLabel: OEM_POLL_DENY_LABEL[decision.reason],
      pollClass: decision.pollClass,
      note: def.note,
    };
  });

  const probeableCount = input.catalog.filter(isOemSignalProbeable).length;
  const probedCount = rows.filter((r) => r.evidenceAgeMs !== null).length;
  const supportedCount = rows.filter((r) => r.state === 'SUPPORTED').length;

  const verdict: OemLabVerdict =
    probeableCount === 0 ? 'NO_PROBEABLE_SIGNAL'
      : probedCount === 0 ? 'NOT_PROBED_YET'
        : supportedCount > 0 ? 'HAS_SUPPORTED'
          : 'NONE_SUPPORTED';

  return {
    rows,
    verdict,
    verdictLabel: OEM_LAB_VERDICT_LABEL[verdict],
    catalogCount: input.catalog.length,
    probeableCount,
    probedCount,
    supportedCount,
  };
}
