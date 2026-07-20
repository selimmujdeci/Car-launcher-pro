/**
 * maviCore/wiring/maviEvidenceSection.ts — MAVİ ÇEKİRDEĞİ · TANI RAPORU KANIT BÖLÜMÜ (PR-DIAG-3).
 *
 * ANAYASAL KURAL (DIAG-1'den devralınır): **TANI RAPORU KARAR VERMEZ — KANIT SERİLEŞTİRİR.**
 * Bu modül YENİ ölçüm/üretici/telemetri hattı KURMAZ. Yalnızca DIAG-1/DIAG-2'nin ürettiği kanıtı
 * (`buildMaviEvidenceReport`) MEVCUT tanı rapor yüzeyine (`remoteLogService`) tek bir açık bölüm
 * olarak SERİLEŞTİRİR:
 *
 *   MAVI_VOICE_AND_TAKEOVER_EVIDENCE
 *     ├─ summary                 (iddiasız sayaçlar + çift-yürütme işaretleri)
 *     ├─ lifecycle               (10 faz: status/count/firstAt/lastAt)
 *     ├─ commandDecisions        (TAKEOVER karar zinciri, bounded + nötrleştirilmiş)
 *     ├─ mediaNext               (port gerçekleri + toplamlar)
 *     ├─ legacyExecutions        (eski hattın komut-bazında yürütmeleri)
 *     ├─ ownership               (arbiter.stats() aynası — kopya tutulmaz)
 *     ├─ bargeIn                 (bayat kuşak/iptal kayıtları)
 *     ├─ lifecycleRegistrations  (listener/guard/abonelik sayaçları — sızıntı işareti)
 *     ├─ latencySegments         (5 segment: status/min/max/average/count — boşta null)
 *     ├─ safety                  (AiSafetyGate kararları — üretici bağlı DEĞİL → NO_SOURCE)
 *     ├─ criticalFindings        (olgusal kayıtlar; boşsa hiçbir şey iddia edilmez)
 *     └─ knownMeasurementGaps    (NO_SOURCE / NOT_TESTED alanların dürüst listesi)
 *
 * SÖZLEŞME (uçtan uca kilitli — maviEvidenceSection.test.ts):
 *  - DURUM yalnız dört değerden biri: OBSERVED · NOT_OBSERVED · NOT_TESTED · NO_SOURCE.
 *    NO_SOURCE ↔ NOT_OBSERVED BİRBİRİNE ÇEVRİLMEZ (ölçüm kanalı yokluğu ≠ ölçüldü-gözlenmedi).
 *  - YORUM DİLİ YOK: serileştirilmiş çıktının hiçbir yerinde PASS/FAIL/SUCCESS/WORKING/FIXED veya
 *    Türkçe ÇALIŞIYOR/BAŞARILI/GEÇTİ/KALDI vb. GEÇMEZ. Ham StepStatus 'failed' bir YORUM değil ama
 *    yasaklı sözcüktür → kod alanlarında `neutralizeCode` ile olgusal 'not_ok'a çevrilir.
 *  - BOŞTA SAHTE ÖLÇÜM YOK: örneklem yoksa segment min/max/average = null (0 ms yazılmaz).
 *    Kaynak yoksa firstAt/lastAt ALANI HİÇ ÜRETİLMEZ (uydurma zaman damgası yok).
 *  - GİZLİLİK: ham transkript/konum/wake adı/token/anahtar TAŞINMAZ — kanıt zaten hash+enum'dur;
 *    ek savunma olarak yalnız allowlist alanları kopyalanır (serbest metin yayılmaz).
 *  - BOUNDED: DIAG-1 ring tavanlarına güvenilir; ayrıca bölüm-içi kayıt tavanı uygulanır ve kırpma
 *    sayısı OLGUSAL olarak `truncated` altında bildirilir (sessiz kısaltma yok). Kalıcı ikinci
 *    buffer YOK — her çağrı saf/duraksız türetir.
 *  - FAIL-SOFT: serileştirme herhangi bir noktada patlarsa ana tanı raporu ÇÖKMEZ; bölüm yalnız
 *    olgusal `unavailable` + hata-kategorisi kaydı döner (stack/ham hata metni TAŞINMAZ).
 *  - KARAR VERMEZ: ledgerUpdated sabit false; yeşil/sarı/kırmızı atamaz; "tamamlandı" iddia etmez.
 */

import {
  buildMaviEvidenceReport, EXPECTED_PHASES, SEGMENT_KEYS,
  type MaviEvidenceReport, type EvidenceVerdict, type EvidenceItem,
} from './maviEvidence';
import { getTakeoverArbiter, type TakeoverArbiterStats } from './takeoverArbiter';
import type { VoiceSessionTiming, VoiceSegmentKey } from './voiceStateBridge';

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme tipleri
 * ════════════════════════════════════════════════════════════════════════ */

/** Bölüm durum sözleşmesi — DIAG-1 verdict'i ile birebir (dört değer, PASS/FAIL YOK). */
export type EvidenceStatus = EvidenceVerdict;

export interface MaviLifecyclePhaseView {
  readonly phase: string;
  readonly status: EvidenceStatus;
  readonly count: number;
  /** Yalnız count > 0 iken üretilir (kaynak yoksa uydurulmaz). */
  readonly firstAtMs?: number;
  readonly lastAtMs?: number;
  readonly reason?: string;
}

export interface MaviLatencySegmentView {
  readonly segment: VoiceSegmentKey;
  readonly status: EvidenceStatus;
  readonly count: number;
  /** Boş örneklemde null (0 ms yazarak ölçülmüş izlenimi verilmez). */
  readonly minMs: number | null;
  readonly maxMs: number | null;
  readonly averageMs: number | null;
  readonly reason?: string;
}

export interface MaviCommandDecisionView {
  readonly correlationId: string;
  readonly commandType: string;
  readonly commandId: string;
  readonly resolvedAction: string | null;
  readonly flagState: string;
  readonly legacyCandidate: boolean;
  readonly maviCandidate: boolean;
  readonly ownershipDecision: boolean;
  readonly claimOutcome: string | null;
  readonly owner: string | null;
  readonly executedBy: string;
  readonly executionResult: string | null;
  readonly releaseReason: string | null;
  readonly errorReason: string | null;
}

export interface MaviMediaNextView {
  readonly correlationId: string | null;
  readonly port: string;
  readonly nextCallCount: number;
  readonly cancelAssistantDuckCalled: boolean;
  readonly hasQueue: boolean;
  readonly hasSession: boolean;
  readonly nextCalled: boolean;
  readonly serviceResult: string;
  readonly typedFeedback: string | null;
  readonly errorReason: string | null;
}

export interface MaviLegacyExecutionView {
  readonly correlationId: string;
  readonly commandId: string;
  readonly resolvedAction: string | null;
  readonly legacyExecutionCount: number;
  readonly lastAtMs: number;
}

export interface MaviBargeInView {
  readonly correlationId: string | null;
  readonly oldGeneration: number;
  readonly newGeneration: number;
  readonly staleDecision: boolean;
  readonly cancelledExecution: boolean;
  readonly releaseReason: string | null;
}

export interface MaviOwnershipView {
  readonly status: EvidenceStatus;
  readonly active?: boolean;
  readonly mode?: string;
  readonly claimed?: number;
  readonly duplicates?: number;
  readonly staleRejected?: number;
  readonly notEligible?: number;
  readonly released?: number;
  readonly timedOut?: number;
  readonly superseded?: number;
  readonly maxGeneration?: number;
  readonly ownedActionId?: string | null;
  readonly reason?: string;
}

export interface MaviSafetyView {
  readonly status: EvidenceStatus;
  readonly records?: readonly {
    readonly correlationId: string | null;
    readonly actionId: string;
    readonly decision: string;
    readonly readOnly: boolean;
    readonly reason: string | null;
  }[];
  readonly allowed?: number;
  readonly denied?: number;
  readonly hardForbidden?: number;
  readonly readOnly?: number;
  readonly reason?: string;
}

export interface MaviMeasurementGap {
  readonly area: string;
  readonly status: EvidenceStatus;
  readonly reason: string;
}

/** İki hattın aynı komutu çalıştırdığına dair DIAG-2 kaynaklı ÜÇ bağımsız işaret (olgusal). */
export interface MaviDualExecutionSignals {
  /** 1. Aynı correlationId (generationId+sessionId+commandId) hem Mavi hem eski hat kaydında. */
  readonly dualExecutionSameKey: boolean;
  /** 2. ownershipDecision false iken Mavi yürütmesi kaydedildi. */
  readonly maviExecutedWhileNotOwned: boolean;
  /** 3. media.next sayacı iki hatta da arttı (Mavi>0 ve eski hat>0). */
  readonly mediaNextOnBothPaths: boolean;
}

export interface MaviEvidenceSection {
  readonly contract: 'evidence-only';
  readonly generatedAtMs: number;
  readonly summary: {
    readonly lifecycleEventCount: number;
    readonly observedPhaseCount: number;
    readonly commandDecisionCount: number;
    readonly mediaNextAttempts: number;
    readonly legacyExecutionCount: number;
    readonly bargeInCount: number;
    readonly measuredSegmentCount: number;
    readonly criticalFindingCount: number;
    /** DIAG-1 checklist 'takeover.singlePath' durumu (çift yürütme varsa NOT_OBSERVED). */
    readonly takeoverSinglePath: EvidenceStatus;
    readonly dualExecutionSignals: MaviDualExecutionSignals;
  };
  readonly lifecycle: readonly MaviLifecyclePhaseView[];
  readonly commandDecisions: {
    readonly status: EvidenceStatus;
    readonly count: number;
    readonly dualExecutionSignals: MaviDualExecutionSignals;
    readonly records: readonly MaviCommandDecisionView[];
    readonly truncated?: number;
  };
  readonly mediaNext: {
    readonly status: EvidenceStatus;
    readonly totals: MaviEvidenceReport['mediaNextTotals'];
    readonly records: readonly MaviMediaNextView[];
    readonly truncated?: number;
  };
  readonly legacyExecutions: {
    readonly status: EvidenceStatus;
    readonly records: readonly MaviLegacyExecutionView[];
    readonly truncated?: number;
  };
  readonly ownership: MaviOwnershipView;
  readonly bargeIn: {
    readonly status: EvidenceStatus;
    readonly records: readonly MaviBargeInView[];
    readonly truncated?: number;
  };
  readonly lifecycleRegistrations: {
    readonly status: EvidenceStatus;
    readonly starts: number;
    readonly restarts: number;
    readonly disposes: number;
    readonly commandListeners: number;
    readonly voiceStateSubscriptions: number;
    readonly guards: number;
    readonly reason?: string;
  };
  readonly latencySegments: readonly MaviLatencySegmentView[];
  readonly safety: MaviSafetyView;
  readonly criticalFindings: readonly string[];
  readonly knownMeasurementGaps: readonly MaviMeasurementGap[];
  readonly ledgerUpdated: false;
  /** Yalnız fail-soft yolunda: bölüm serileştirilemedi (olgusal, hata metni YOK). */
  readonly unavailable?: true;
  readonly errorCategory?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yasaklı yorum dili — nötrleştirme
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Serileştirilmiş çıktıda ASLA bulunmaması gereken sözcükler (İngilizce + Türkçe, küçük harf).
 * Sıra önemli: uzun/özel eşleşmeler ('failed') kısa olandan ('fail') ÖNCE denenir ki nötrleştirme
 * artık bir yasaklı iz bırakmasın. Testte (H) aynen bu liste taranır.
 */
export const BANNED_WORDS: readonly string[] = Object.freeze([
  'success', 'failed', 'passed', 'working', 'fixed',
  'çalışıyor', 'çalışmıyor', 'başarılı', 'başarısız', 'geçti', 'kaldı',
  'pass', 'fail',
]);

/** Bilinen ham kod → olgusal, yorumsuz ve yasaksız karşılığı. */
const CODE_REMAP: Readonly<Record<string, string>> = Object.freeze({
  failed: 'not_ok',   // ham StepStatus — YORUM değil ama yasaklı sözcük; olgusal karşılık.
  passed: 'recorded',
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * KOD alanlarını (enum/StepStatus) yorumsuz ve yasaksız hale getirir. Serbest Türkçe metinlerde
 * KULLANILMAZ (onları zaten yasaksız yazarız); yalnız yukarıdan gelen kısa kodlara uygulanır.
 * Önce bilinen kodları anlamlı karşılığıyla değiştirir, sonra artık kalan herhangi bir yasaklı izi
 * nötr işaretle siler (savunma derinliği — enum ileride değişse bile sözleşme korunur).
 */
export function neutralizeCode(v: string | null | undefined): string | null | undefined {
  if (v == null) return v;
  let out = String(v);
  const remap = CODE_REMAP[out.toLowerCase()];
  if (remap) out = remap;
  for (const banned of BANNED_WORDS) {
    if (!banned) continue;
    const re = new RegExp(escapeRegExp(banned), 'gi');
    out = out.replace(re, (m) => '·'.repeat(m.length));
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Segment kaynak haritası (dürüst NO_SOURCE ayrımı)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * MAVI-INSTRUMENTATION-1: BEŞ segmentin de artık ÖLÇÜM KAYNAĞI vardır. `transcriptToPlan`/
 * `planToExecution`/`executionToSpeech` `planning`/`executing`/`speaking` marker'larına muhtaçtı;
 * bu fazlar artık voiceService'ten (processTextCommand/dispatch/dispatchDriving/dispatchChain/
 * _answerSensorQuery) GERÇEKTEN emit edilir → segment NO_SOURCE değil, örneklem yoksa dürüstçe
 * NOT_TESTED/NOT_OBSERVED'a düşer (uydurma 0 ms YOK). Bu ayrım testle (C/G) kilitlenir.
 */
const SEGMENTS_WITH_SOURCE: ReadonlySet<VoiceSegmentKey> = new Set<VoiceSegmentKey>([
  'wakeToListening', 'listeningToTranscript', 'transcriptToPlan', 'planToExecution', 'executionToSpeech',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Bölüm-içi tavanlar (transport MAX_ARRAY_LEN=20 ile hizalı; sessiz kırpma yok)
 * ════════════════════════════════════════════════════════════════════════ */

export const SECTION_MAX_RECORDS = 20;

function verdictOf(report: MaviEvidenceReport, id: string): EvidenceStatus | null {
  const it: EvidenceItem | undefined = report.checklist.find((c) => c.id === id);
  return it ? it.verdict : null;
}

/** Ring'i kuyruktan (en yeni) tavan kadar keser; kırpma olduysa sayısını döner. */
function boundTail<T>(items: readonly T[], max: number): { records: T[]; truncated: number } {
  if (items.length <= max) return { records: items.slice(), truncated: 0 };
  return { records: items.slice(items.length - max), truncated: items.length - max };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çift-yürütme işaretleri (DIAG-2 verisinden YAPISAL türetilir — string eşleşmesi değil)
 * ════════════════════════════════════════════════════════════════════════ */

function deriveDualExecutionSignals(report: MaviEvidenceReport): MaviDualExecutionSignals {
  const maviKeys = new Set(
    report.takeoverDecisions.filter((d) => d.executedBy === 'mavi').map((d) => d.correlationId),
  );
  const legacyKeys = new Set<string>([
    ...report.takeoverDecisions.filter((d) => d.executedBy === 'legacy').map((d) => d.correlationId),
    ...report.legacyExecutions.map((l) => l.correlationId),
  ]);
  let dualExecutionSameKey = false;
  for (const k of maviKeys) { if (legacyKeys.has(k)) { dualExecutionSameKey = true; break; } }

  const maviExecutedWhileNotOwned = report.takeoverDecisions.some(
    (d) => d.executedBy === 'mavi' && d.legacyCandidate && d.ownershipDecision === false,
  );
  const mediaNextOnBothPaths =
    report.mediaNextTotals.maviExecuted > 0 && report.mediaNextTotals.legacyExecuted > 0;

  return Object.freeze({ dualExecutionSameKey, maviExecutedWhileNotOwned, mediaNextOnBothPaths });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ana serileştirici (SAF — deps enjekte edilir, testte doğrudan çağrılır)
 * ════════════════════════════════════════════════════════════════════════ */

export interface BuildSectionDeps {
  /** MEVCUT kaynak: voiceStateBridge.recent(). */
  readonly timings?: readonly VoiceSessionTiming[];
  /** MEVCUT kaynak: arbiter.stats(). */
  readonly ownership?: TakeoverArbiterStats | null;
  readonly now?: () => number;
}

/**
 * DIAG-1/DIAG-2 kanıtını MAVI_VOICE_AND_TAKEOVER_EVIDENCE bölümüne çevirir. YENİ KARAR ÜRETMEZ:
 * durumlar DIAG-1 verdict'lerinden okunur, sayılar ham kayıtlardan türetilir. Fail-soft.
 */
export function buildMaviEvidenceSection(deps: BuildSectionDeps = {}): MaviEvidenceSection {
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  try {
    const timings = Array.isArray(deps.timings) ? deps.timings : [];
    const sessions = timings.length;
    const report = buildMaviEvidenceReport({ timings, ownership: deps.ownership ?? null, now });

    /* ── lifecycle (10 faz: status/count/firstAt/lastAt) ───────── */
    const lifecycle: MaviLifecyclePhaseView[] = EXPECTED_PHASES.map((phase) => {
      const cov = report.phaseCoverage.find((p) => p.id === `phase.${phase}`);
      const status: EvidenceStatus = cov ? cov.verdict : 'NOT_TESTED';
      const events = report.lifecycleEvents.filter((e) => e.phase === phase);
      const count = events.length;
      const base: MaviLifecyclePhaseView = {
        phase, status, count,
        ...(cov?.reason ? { reason: cov.reason } : {}),
      };
      if (count === 0) return Object.freeze(base); // kaynak yok → firstAt/lastAt UYDURULMAZ
      let firstAtMs = events[0].atMs, lastAtMs = events[0].atMs;
      for (const e of events) {
        if (e.atMs < firstAtMs) firstAtMs = e.atMs;
        if (e.atMs > lastAtMs) lastAtMs = e.atMs;
      }
      return Object.freeze({ ...base, firstAtMs, lastAtMs });
    });
    const observedPhaseCount = lifecycle.filter((p) => p.status === 'OBSERVED').length;

    /* ── latencySegments (5 segment: boşta null) ───────────────── */
    const latencySegments: MaviLatencySegmentView[] = SEGMENT_KEYS.map((key) => {
      const stat = report.segments[key];
      const count = stat.count;
      const hasSource = SEGMENTS_WITH_SOURCE.has(key);
      let status: EvidenceStatus;
      let reason: string | undefined;
      if (!hasSource) {
        status = 'NO_SOURCE';
        reason = 'plan/execution fazı voiceService kanalında emit edilmiyor — segment ölçülemiyor';
      } else if (count > 0) {
        status = 'OBSERVED';
      } else if (sessions > 0) {
        status = 'NOT_OBSERVED';
        reason = 'oturum kaydedildi ama bu segment ölçülmedi';
      } else {
        status = 'NOT_TESTED';
        reason = 'tamamlanmış oturum örneklemi yok';
      }
      return Object.freeze({
        segment: key, status, count,
        minMs: count > 0 ? stat.minMs : null,
        maxMs: count > 0 ? stat.maxMs : null,
        averageMs: count > 0 ? stat.avgMs : null,
        ...(reason ? { reason } : {}),
      });
    });
    const measuredSegmentCount = latencySegments.filter((s) => s.count > 0).length;

    /* ── commandDecisions (bounded + nötrleştirilmiş) ──────────── */
    const decBound = boundTail(report.takeoverDecisions, SECTION_MAX_RECORDS);
    const decisionRecords: MaviCommandDecisionView[] = decBound.records.map((d) => Object.freeze({
      correlationId: d.correlationId,
      commandType: d.commandType,
      commandId: d.commandId,
      resolvedAction: d.resolvedAction,
      flagState: d.flagState,
      legacyCandidate: d.legacyCandidate,
      maviCandidate: d.maviCandidate,
      ownershipDecision: d.ownershipDecision,
      claimOutcome: neutralizeCode(d.claimOutcome) ?? null,
      owner: d.owner,
      executedBy: d.executedBy,
      executionResult: neutralizeCode(d.executionResult) ?? null,
      releaseReason: neutralizeCode(d.releaseReason) ?? null,
      errorReason: neutralizeCode(d.errorReason) ?? null,
    }));
    const dualExecutionSignals = deriveDualExecutionSignals(report);

    /* ── mediaNext ─────────────────────────────────────────────── */
    const mediaBound = boundTail(report.mediaNext, SECTION_MAX_RECORDS);
    const mediaRecords: MaviMediaNextView[] = mediaBound.records.map((m) => Object.freeze({
      correlationId: m.correlationId,
      port: m.port,
      nextCallCount: m.nextCallCount,
      cancelAssistantDuckCalled: m.cancelAssistantDuckCalled,
      hasQueue: m.hasQueue,
      hasSession: m.hasSession,
      nextCalled: m.nextCalled,
      serviceResult: neutralizeCode(m.serviceResult) ?? 'unknown',
      typedFeedback: neutralizeCode(m.typedFeedback) ?? null,
      errorReason: neutralizeCode(m.errorReason) ?? null,
    }));

    /* ── legacyExecutions ──────────────────────────────────────── */
    const legacyBound = boundTail(report.legacyExecutions, SECTION_MAX_RECORDS);
    const legacyRecords: MaviLegacyExecutionView[] = legacyBound.records.map((l) => Object.freeze({
      correlationId: l.correlationId,
      commandId: l.commandId,
      resolvedAction: l.resolvedAction,
      legacyExecutionCount: l.legacyExecutionCount,
      lastAtMs: l.lastAtMs,
    }));

    /* ── ownership (arbiter.stats() aynası) ────────────────────── */
    const ownership = buildOwnershipView(report, verdictOf(report, 'ownership.lifecycle'));

    /* ── bargeIn ───────────────────────────────────────────────── */
    const bargeBound = boundTail(report.bargeIns, SECTION_MAX_RECORDS);
    const bargeRecords: MaviBargeInView[] = bargeBound.records.map((b) => Object.freeze({
      correlationId: b.correlationId,
      oldGeneration: b.oldGeneration,
      newGeneration: b.newGeneration,
      staleDecision: b.staleDecision,
      cancelledExecution: b.cancelledExecution,
      releaseReason: neutralizeCode(b.releaseReason) ?? null,
    }));

    /* ── lifecycleRegistrations (sızıntı işareti) ──────────────── */
    const lc = report.lifecycleCounters;
    const leakStatus = verdictOf(report, 'lifecycle.noLeak') ?? 'NOT_TESTED';
    const leaked = lc.commandListeners > 1 || lc.voiceStateSubscriptions > 1 || lc.guards > 1;

    /* ── safety — üretici DIAG-1/DIAG-2'de BAĞLI DEĞİL → NO_SOURCE ── */
    const safety = buildSafetyView(report);

    /* ── criticalFindings (+ monotoniklik ihlali işaretleri) ───── */
    const criticalFindings = buildCriticalFindings(report);

    /* ── knownMeasurementGaps (dürüst eksik-ölçüm listesi) ─────── */
    const knownMeasurementGaps = buildMeasurementGaps(lifecycle, latencySegments, ownership, safety);

    return deepFreeze({
      contract: 'evidence-only' as const,
      generatedAtMs: report.generatedAtMs,
      summary: {
        lifecycleEventCount: report.lifecycleEvents.length,
        observedPhaseCount,
        commandDecisionCount: report.takeoverDecisions.length,
        mediaNextAttempts: report.mediaNextTotals.attempts,
        legacyExecutionCount: report.legacyExecutions.length,
        bargeInCount: report.bargeIns.length,
        measuredSegmentCount,
        criticalFindingCount: criticalFindings.length,
        takeoverSinglePath: verdictOf(report, 'takeover.singlePath') ?? 'NOT_TESTED',
        dualExecutionSignals,
      },
      lifecycle,
      commandDecisions: {
        status: report.takeoverDecisions.length > 0 ? 'OBSERVED' as const : 'NOT_TESTED' as const,
        count: report.takeoverDecisions.length,
        dualExecutionSignals,
        records: decisionRecords,
        ...(decBound.truncated > 0 ? { truncated: decBound.truncated } : {}),
      },
      mediaNext: {
        status: report.mediaNextTotals.attempts > 0 ? 'OBSERVED' as const : 'NOT_TESTED' as const,
        totals: report.mediaNextTotals,
        records: mediaRecords,
        ...(mediaBound.truncated > 0 ? { truncated: mediaBound.truncated } : {}),
      },
      legacyExecutions: {
        status: report.legacyExecutions.length > 0 ? 'OBSERVED' as const : 'NOT_TESTED' as const,
        records: legacyRecords,
        ...(legacyBound.truncated > 0 ? { truncated: legacyBound.truncated } : {}),
      },
      ownership,
      bargeIn: {
        status: verdictOf(report, 'bargein.stale') ?? 'NOT_TESTED',
        records: bargeRecords,
        ...(bargeBound.truncated > 0 ? { truncated: bargeBound.truncated } : {}),
      },
      lifecycleRegistrations: {
        status: leakStatus,
        starts: lc.starts,
        restarts: lc.restarts,
        disposes: lc.disposes,
        commandListeners: lc.commandListeners,
        voiceStateSubscriptions: lc.voiceStateSubscriptions,
        guards: lc.guards,
        ...(leaked ? { reason: 'birden fazla kayıt görüldü — sızıntı işareti' } : {}),
      },
      latencySegments,
      safety,
      criticalFindings,
      knownMeasurementGaps,
      ledgerUpdated: false as const,
    });
  } catch {
    return unavailableSection(now);
  }
}

function buildOwnershipView(
  report: MaviEvidenceReport, lifecycleVerdict: EvidenceStatus | null,
): MaviOwnershipView {
  const o = report.ownership;
  if (o === null) {
    return Object.freeze({ status: 'NOT_TESTED', reason: 'arbiter.stats() okunamadı (hakem pasif olabilir)' });
  }
  const status: EvidenceStatus = lifecycleVerdict ?? (o.claimed > 0 ? 'OBSERVED' : 'NOT_TESTED');
  const reason = o.claimed === 0
    ? 'hiç sahiplik alınmadı (TAKEOVER senaryosu çalıştırılmamış olabilir)'
    : (o.released < o.claimed ? 'released < claimed — açık sahiplik olabilir' : undefined);
  return Object.freeze({
    status,
    active: o.active,
    mode: neutralizeCode(o.mode) ?? o.mode,
    claimed: o.claimed,
    duplicates: o.duplicates,
    staleRejected: o.staleRejected,
    notEligible: o.notEligible,
    released: o.released,
    timedOut: o.timedOut,
    superseded: o.superseded,
    maxGeneration: o.maxGeneration,
    ownedActionId: neutralizeCode(o.ownedActionId) ?? null,
    ...(reason ? { reason } : {}),
  });
}

/**
 * SAFETY dürüstlük kararı: DIAG-1/DIAG-2 kapsamında AiSafetyGate için bağlı BİR ÜRETİCİ YOKTUR
 * (recordSafety yalnız testlerden çağrılır). Dolayısıyla kayıt yoksa durum NO_SOURCE'tur —
 * NOT_TESTED DEĞİL (ölçüm kanalı henüz yok; "denendi ama olmadı" değil). Test kayıt enjekte
 * ederse OBSERVED. Bu ayrım testle (G/H) kilitlenir.
 */
function buildSafetyView(report: MaviEvidenceReport): MaviSafetyView {
  if (report.safety.length === 0) {
    return Object.freeze({
      status: 'NO_SOURCE',
      reason: 'DIAG-1/DIAG-2 kapsamında güvenlik kapısı için bağlı ölçüm üreticisi yok',
    });
  }
  const bound = boundTail(report.safety, SECTION_MAX_RECORDS);
  return Object.freeze({
    status: 'OBSERVED',
    allowed: report.safety.filter((s) => s.decision === 'allowed').length,
    denied: report.safety.filter((s) => s.decision === 'denied').length,
    hardForbidden: report.safety.filter((s) => s.decision === 'hard_forbidden').length,
    readOnly: report.safety.filter((s) => s.readOnly).length,
    records: bound.records.map((s) => Object.freeze({
      correlationId: s.correlationId,
      actionId: s.actionId,
      decision: neutralizeCode(s.decision) ?? s.decision,
      readOnly: s.readOnly,
      reason: neutralizeCode(s.reason) ?? null,
    })),
  });
}

/**
 * criticalFindings: DIAG-1'in ürettiği olgusal kayıtlar + segment telemetrisindeki monotoniklik
 * ihlali işaretleri (neg:/out_of_order:). Yeni karar üretilmez; yalnız zaten gözlenen anomaliler
 * olgusal olarak yüzeye çıkar. Bounded + tekilleştirilmiş.
 */
function buildCriticalFindings(report: MaviEvidenceReport): readonly string[] {
  const out: string[] = [...report.criticalFindings];
  for (const d of report.telemetryDiagnostics) {
    if (d.startsWith('neg:') || d.startsWith('out_of_order:')) {
      const msg = `MONOTONİKLİK: segment telemetrisinde sıra-dışı/negatif işaret (${d})`;
      if (!out.includes(msg)) out.push(msg);
    }
  }
  return Object.freeze(out.slice(0, SECTION_MAX_RECORDS * 2));
}

function buildMeasurementGaps(
  lifecycle: readonly MaviLifecyclePhaseView[],
  segments: readonly MaviLatencySegmentView[],
  ownership: MaviOwnershipView,
  safety: MaviSafetyView,
): readonly MaviMeasurementGap[] {
  const gaps: MaviMeasurementGap[] = [];
  for (const p of lifecycle) {
    if (p.status === 'NO_SOURCE' || p.status === 'NOT_TESTED') {
      gaps.push(Object.freeze({
        area: `lifecycle.${p.phase}`, status: p.status,
        reason: p.reason ?? (p.status === 'NO_SOURCE'
          ? 'ölçüm kanalı yok'
          : 'senaryo çalıştırılmadı / yeterli kanıt yok'),
      }));
    }
  }
  for (const s of segments) {
    if (s.status === 'NO_SOURCE' || s.status === 'NOT_TESTED') {
      gaps.push(Object.freeze({
        area: `latencySegment.${s.segment}`, status: s.status,
        reason: s.reason ?? 'ölçüm kanalı yok',
      }));
    }
  }
  if (ownership.status === 'NOT_TESTED') {
    gaps.push(Object.freeze({
      area: 'ownership', status: 'NOT_TESTED',
      reason: ownership.reason ?? 'sahiplik senaryosu çalıştırılmadı',
    }));
  }
  if (safety.status === 'NO_SOURCE' || safety.status === 'NOT_TESTED') {
    gaps.push(Object.freeze({
      area: 'safety.gate', status: safety.status,
      reason: safety.reason ?? 'ölçüm kanalı yok',
    }));
  }
  return Object.freeze(gaps);
}

/** Fail-soft yolu — ana rapor gövdesi ETKİLENMEZ; olgusal, hata metni YOK. */
function unavailableSection(now: () => number): MaviEvidenceSection {
  let ts = 0;
  try { ts = now(); } catch { ts = 0; }
  const section: MaviEvidenceSection = {
    contract: 'evidence-only',
    generatedAtMs: ts,
    summary: {
      lifecycleEventCount: 0, observedPhaseCount: 0, commandDecisionCount: 0,
      mediaNextAttempts: 0, legacyExecutionCount: 0, bargeInCount: 0,
      measuredSegmentCount: 0, criticalFindingCount: 0,
      takeoverSinglePath: 'NOT_TESTED',
      dualExecutionSignals: Object.freeze({
        dualExecutionSameKey: false, maviExecutedWhileNotOwned: false, mediaNextOnBothPaths: false,
      }),
    },
    lifecycle: Object.freeze([]),
    commandDecisions: Object.freeze({
      status: 'NOT_TESTED', count: 0,
      dualExecutionSignals: Object.freeze({
        dualExecutionSameKey: false, maviExecutedWhileNotOwned: false, mediaNextOnBothPaths: false,
      }),
      records: Object.freeze([]),
    }),
    mediaNext: Object.freeze({
      status: 'NOT_TESTED',
      totals: Object.freeze({
        attempts: 0, nextCalled: 0, legacyExecuted: 0, maviExecuted: 0, unavailable: 0, threw: 0,
      }),
      records: Object.freeze([]),
    }),
    legacyExecutions: Object.freeze({ status: 'NOT_TESTED', records: Object.freeze([]) }),
    ownership: Object.freeze({ status: 'NOT_TESTED', reason: 'kanıt bölümü üretilemedi' }),
    bargeIn: Object.freeze({ status: 'NOT_TESTED', records: Object.freeze([]) }),
    lifecycleRegistrations: Object.freeze({
      status: 'NOT_TESTED', starts: 0, restarts: 0, disposes: 0,
      commandListeners: 0, voiceStateSubscriptions: 0, guards: 0,
    }),
    latencySegments: Object.freeze([]),
    safety: Object.freeze({ status: 'NO_SOURCE', reason: 'kanıt bölümü üretilemedi' }),
    criticalFindings: Object.freeze([]),
    knownMeasurementGaps: Object.freeze([]),
    ledgerUpdated: false,
    unavailable: true,
    errorCategory: 'evidence_serialization_error',
  };
  return deepFreeze(section);
}

/* ── Derin dondurma (immutability — mutasyona kapalı çıktı) ────── */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
  }
  return obj;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Canlı kaynak toplayıcı — remoteLogService entegrasyon noktası
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Segment zamanlaması kaynağı — YENİ BUFFER DEĞİL, MEVCUT `voiceState.recent()`'e bir REFERANS
 * göstericisi. Wiring start/dispose'da set/temizle çağırır (setMaviOwnershipResolver deseniyle
 * simetrik). Kayıt yoksa segmentler dürüstçe NOT_TESTED kalır.
 */
let _timingsSource: (() => readonly VoiceSessionTiming[]) | null = null;

export function setMaviVoiceTimingsSource(fn: (() => readonly VoiceSessionTiming[]) | null): void {
  _timingsSource = typeof fn === 'function' ? fn : null;
}

/**
 * Canlı kaynaklardan (voiceState.recent() + arbiter.stats()) MAVI kanıt bölümünü toplar. remoteLogService
 * bunu `_safeSection` içinde çağırır. Kendi içinde de fail-soft: hiçbir koşulda throw etmez.
 */
export function collectMaviEvidenceSection(): MaviEvidenceSection {
  const now = Date.now;
  try {
    let timings: readonly VoiceSessionTiming[] = [];
    try { timings = _timingsSource ? (_timingsSource() ?? []) : []; }
    catch { timings = []; }
    let ownership: TakeoverArbiterStats | null = null;
    try { ownership = getTakeoverArbiter().stats(); }
    catch { ownership = null; }
    return buildMaviEvidenceSection({ timings, ownership, now });
  } catch {
    return unavailableSection(now);
  }
}

/** @internal — testler arası izolasyon (kaynak göstericisini temizler). */
export function _resetMaviEvidenceSectionForTest(): void {
  _timingsSource = null;
}
