/**
 * maviCore/wiring/maviEvidence.ts — MAVİ ÇEKİRDEĞİ · ARAÇ DOĞRULAMA KANIT DEPOSU (PR-DIAG-1).
 *
 * ANAYASAL KURAL: **TANI RAPORU KARAR VERMEZ — KANIT ÜRETİR. KARARI KÜTÜK (LEDGER) VERİR.**
 * Bu modül HİÇBİR ZAMAN "özellik çalışıyor", "PASS", "başarılı" gibi bir sonuç üretmez. Yalnızca
 * GÖZLENEN olguları raporlar ve her kontrol maddesi için ÜÇ değerden birini döndürür:
 *   - `OBSERVED`     → ilgili olay CİHAZDA GÖZLENDİ (ham kanıt kayıtlı)
 *   - `NOT_OBSERVED` → deneme YAPILDI ama beklenen kanıt OLUŞMADI
 *   - `NOT_TESTED`   → hiç deneme yapılmadı (kanıt yok — "başarısız" DEĞİL)
 * Ayrıca `NO_SOURCE` (kaynak yok) ile "hiç emit edilmeyen" fazlar dürüstçe ayrılır — bunlar
 * NOT_OBSERVED sayılmaz, çünkü ölçüm kanalı YOKTUR (yanıltıcı olurdu).
 * Bu modül LEDGER'A YAZMAZ. Kütük yalnız İNSAN ONAYIYLA güncellenir.
 *
 * TASARIM (CLAUDE.md · mevcut `buildXxxSnapshot` pull deseniyle simetrik):
 *  - YENİ PARALEL LOG SİSTEMİ DEĞİL: üreticiler zaten hesapladıkları YAPISAL gerçeği yazar;
 *    telemetri segmentleri `voiceStateBridge.recent()`, sahiplik sayaçları `arbiter.stats()`
 *    gibi MEVCUT kaynaklardan rapor anında OKUNUR (kopya tutulmaz).
 *  - YENİ ABONELİK/POLLING/TIMER YOK. `setInterval`/`setTimeout` kullanılmaz.
 *  - IMPORT YAN ETKİSİ YOK: tüm ring'ler boş başlar; bu modülü import etmek davranışı DEĞİŞTİRMEZ.
 *  - BOUNDED: her ring sabit tavanlı (sınırsız büyüme yok, düşük-uçta bellek güvenli).
 *  - PII YOK: ham transkript TAŞINMAZ — yalnız komut tipi + değer-temelli commandId hash'i.
 *  - FAIL-SOFT: hiçbir kayıt fonksiyonu throw etmez; kanıt toplama üretim akışını ASLA bozamaz.
 */

import type { VoiceSegmentKey, VoiceSessionTiming } from './voiceStateBridge';
import type { TakeoverArbiterStats } from './takeoverArbiter';

/* ══════════════════════════════════════════════════════════════════════════
 * Verdict — rapor ASLA "PASS" üretmez
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir kontrol maddesinin GÖZLEM durumu. Bilinçli olarak "PASS"/"FAIL" YOKTUR:
 * rapor karar vermez, yalnız neyin gözlendiğini bildirir.
 */
export type EvidenceVerdict = 'OBSERVED' | 'NOT_OBSERVED' | 'NOT_TESTED' | 'NO_SOURCE';

export interface EvidenceItem {
  /** Kontrol maddesinin makine-okur kimliği (ledger eşlemesi için sabit). */
  readonly id: string;
  /** Ne gözlenmeye çalışıldı (insan-okur, iddiasız ifade). */
  readonly what: string;
  readonly verdict: EvidenceVerdict;
  /** Verdict'i ÜRETEN ham sayılar/olgular — yorum değil, ölçüm. */
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
  /** Neden NOT_OBSERVED/NOT_TESTED/NO_SOURCE olduğunun makine-okur gerekçesi. */
  readonly reason?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Correlation — tek ses komutunun tüm yaşam döngüsünü birleştirir (PR-DIAG-2)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Correlation kimlikleri SAF TÜRETİLİR — sayaç/rastgelelik/state YOKTUR. Aynı kuşak+oturum (ve
 * komut) için her çağıran AYNI kimliği üretir; bu yüzden eski hat ile Mavi hattı, birbirini hiç
 * tanımadan aynı correlationId'yi yazar ve rapor sonradan birleştirilebilir.
 *
 * YALNIZ TANI AMAÇLIDIR — hiçbir davranışı etkilemez, hiçbir karar bu kimliğe bakmaz.
 */
export function sessionCorrelationId(generationId: number, sessionId: number): string {
  const g = Number.isFinite(generationId) ? generationId : -1;
  const s = Number.isFinite(sessionId) ? sessionId : -1;
  return `g${g}.s${s}`;
}

/** Komut düzeyi correlation — oturum kimliğinin ALT kümesi (prefix ile join edilebilir). */
export function commandCorrelationId(generationId: number, sessionId: number, commandId: string): string {
  const c = typeof commandId === 'string' && commandId.length > 0 ? commandId : 'unknown';
  return `${sessionCorrelationId(generationId, sessionId)}#${c}`;
}

/**
 * AMBIENT correlation: yürütme sırasında derinlerdeki port'lar (media.next) komut bağlamını
 * bilmez. Köprü turu açarken bunu SET eder, terminal yolda TEMİZLER (finally). Tek string —
 * bounded, timer yok, yan etki yok. Yanlış ilişkilendirme riski turların serileştirilmiş
 * olmasıyla sınırlıdır (barge-in önceki turu iptal eder).
 */
let _currentCorrelation: string | null = null;

export function setCurrentCorrelation(id: string | null): void {
  try { _currentCorrelation = typeof id === 'string' && id.length > 0 ? id : null; } catch { /* fail-soft */ }
}

export function getCurrentCorrelation(): string | null {
  return _currentCorrelation;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kayıt tipleri (üreticiler bunları yazar)
 * ════════════════════════════════════════════════════════════════════════ */

/** 1. Voice lifecycle — her adım: timestamp · generationId · sessionId · correlationId · latency. */
export interface LifecycleEventRecord {
  readonly phase: string;
  /** Duvar saati (rapor okunabilirliği). */
  readonly atMs: number;
  /** Monotonik an (süre hesabı clock-jump güvenli). */
  readonly atMono: number;
  readonly generationId: number;
  readonly sessionId: number;
  /** Oturum düzeyi correlation (`g<gen>.s<session>`). */
  readonly correlationId: string;
  /** Bir önceki olaydan bu yana geçen süre (ilk olayda undefined). */
  readonly latencyMs?: number;
}

/** 2. TAKEOVER — komut başına tam karar zinciri. */
export interface TakeoverDecisionRecord {
  readonly atMs: number;
  readonly generationId: number;
  readonly sessionId: number;
  readonly commandType: string;
  /** Değer-temelli komut kimliği (hash — ham metin DEĞİL). */
  readonly commandId: string;
  /** Komut düzeyi correlation (`g<gen>.s<session>#<commandId>`). */
  readonly correlationId: string;
  /** Çözümlenen pilot eylem (eşleme yoksa null → yalnız legacy adayı). */
  readonly resolvedAction: string | null;
  /** Eski hat bu komutu çalıştırmaya aday mıydı. */
  readonly legacyCandidate: boolean;
  /** Mavi bu komutu çalıştırmaya aday mıydı (eşleme var). */
  readonly maviCandidate: boolean;
  /** Okunan feature flag durumu. */
  readonly flagState: 'shadow' | 'takeover';
  /** Eylem allowlist ∩ eligible sonucu. */
  readonly allowlisted: boolean;
  /** `arbiter.isMaviOwned` sonucu — İKİ HATTIN DA sorduğu ortak karar. */
  readonly ownershipDecision: boolean;
  /** `arbiter.claim` sonucu (sorulmadıysa null). */
  readonly claimOutcome: string | null;
  /** Sahiplik kime ait oldu (kimse almadıysa null). */
  readonly owner: 'legacy' | 'mavi' | null;
  /** GERÇEK yürütmeyi hangi hat yaptı. */
  readonly executedBy: 'legacy' | 'mavi' | 'none';
  /** Yürütme sonucu (executionEngine StepStatus veya port sonucu). */
  readonly executionResult: string | null;
  /** Sahiplik hangi gerekçeyle bırakıldı. */
  readonly releaseReason: string | null;
  /** Hata gerekçesi (varsa) — serbest metin DEĞİL, kısa kod. */
  readonly errorReason: string | null;
}

/** 3. media.next — port gerçekleri. */
export interface MediaNextRecord {
  readonly atMs: number;
  /** Ambient correlation (turu açan köprüden gelir; bağlam yoksa null). */
  readonly correlationId: string | null;
  /** Bu portu hangi hat yürüttü. */
  readonly port: 'mavi' | 'legacy';
  /** Bu port örneğinin kümülatif `next()` çağrı sayısı (çift atlama tespiti). */
  readonly nextCallCount: number;
  readonly cancelAssistantDuckCalled: boolean;
  readonly hasQueue: boolean;
  readonly hasSession: boolean;
  readonly nextCalled: boolean;
  /** Gerçek servis sonucu. */
  readonly serviceResult: 'ok' | 'unavailable' | 'throw';
  /** Üretilen typed feedback kodu (yoksa null). */
  readonly typedFeedback: string | null;
  readonly errorReason: string | null;
}

/** 4. Barge-in. */
export interface BargeInRecord {
  readonly atMs: number;
  /** Eski (iptal edilen) turun oturum correlation'ı. */
  readonly correlationId: string | null;
  readonly oldGeneration: number;
  readonly newGeneration: number;
  readonly staleDecision: boolean;
  /** Uçuşta bir yürütme iptal edildi mi. */
  readonly cancelledExecution: boolean;
  readonly releaseReason: string | null;
}

/** 6. Lifecycle — sızıntı tespiti için sayaçlar. */
export interface LifecycleCounters {
  readonly starts: number;
  readonly restarts: number;
  readonly disposes: number;
  /** Şu an KAYITLI komut listener sayısı (Mavi tarafı). */
  readonly commandListeners: number;
  /** Şu an KAYITLI voice-state aboneliği sayısı. */
  readonly voiceStateSubscriptions: number;
  /** Şu an KAYITLI eski-hat guard sayısı. */
  readonly guards: number;
}

/** 8. Safety — AiSafetyGate ve reddedilen eylemler. */
export interface SafetyRecord {
  readonly atMs: number;
  readonly correlationId: string | null;
  readonly actionId: string;
  /** Kapı kararı. */
  readonly decision: 'allowed' | 'denied' | 'hard_forbidden';
  /** Yalnız okuma kapsamı mıydı. */
  readonly readOnly: boolean;
  readonly reason: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bounded depo (import yan etkisi yok — hepsi boş başlar)
 * ════════════════════════════════════════════════════════════════════════ */

export const MAX_LIFECYCLE_EVENTS = 120;
export const MAX_DECISIONS = 40;
export const MAX_MEDIA_RECORDS = 30;
export const MAX_BARGE_INS = 20;
export const MAX_SAFETY_RECORDS = 30;

const _lifecycle: LifecycleEventRecord[] = [];
const _decisions: TakeoverDecisionRecord[] = [];
const _media: MediaNextRecord[] = [];
const _bargeIns: BargeInRecord[] = [];
const _safety: SafetyRecord[] = [];

const _counters = {
  starts: 0, restarts: 0, disposes: 0,
  commandListeners: 0, voiceStateSubscriptions: 0, guards: 0,
};

/** 4. Eski hattın GERÇEK yürütme kaydı — KOMUT BAZINDA (çift yürütme tespitinin ikinci yarısı). */
export interface LegacyExecutionRecord {
  readonly generationId: number;
  readonly sessionId: number;
  readonly commandId: string;
  readonly correlationId: string;
  /** Çözümlenen pilot eylem (Mavi eşlemesi yoksa null). */
  readonly resolvedAction: string | null;
  /** Bu anahtar için eski hattın kaç kez yürüttüğü. */
  readonly legacyExecutionCount: number;
  readonly lastAtMs: number;
}

export const MAX_LEGACY_EXECUTIONS = 40;

/** correlationId → kayıt (bounded; ekleme sırası korunur). */
const _legacyExec = new Map<string, LegacyExecutionRecord>();

function push<T>(ring: T[], item: T, max: number): void {
  ring.push(item);
  if (ring.length > max) ring.shift();
}

/* ── Kayıt API'si (üreticiler çağırır — hepsi fail-soft) ────── */

export function recordLifecycleEvent(rec: LifecycleEventRecord): void {
  try { push(_lifecycle, Object.freeze({ ...rec }), MAX_LIFECYCLE_EVENTS); } catch { /* fail-soft */ }
}

export function recordTakeoverDecision(rec: TakeoverDecisionRecord): void {
  try { push(_decisions, Object.freeze({ ...rec }), MAX_DECISIONS); } catch { /* fail-soft */ }
}

export function recordMediaNext(rec: MediaNextRecord): void {
  try { push(_media, Object.freeze({ ...rec }), MAX_MEDIA_RECORDS); } catch { /* fail-soft */ }
}

export function recordBargeIn(rec: BargeInRecord): void {
  try { push(_bargeIns, Object.freeze({ ...rec }), MAX_BARGE_INS); } catch { /* fail-soft */ }
}

export function recordSafety(rec: SafetyRecord): void {
  try { push(_safety, Object.freeze({ ...rec }), MAX_SAFETY_RECORDS); } catch { /* fail-soft */ }
}

/**
 * Eski hattın GERÇEKTEN çalıştırdığı komutu KOMUT BAZINDA say (guard'ın geçirdiği yol).
 * Aynı anahtar tekrar gelirse sayaç artar (yeni kayıt açılmaz) → ring şişmez.
 */
export function recordLegacyExecution(input: {
  generationId: number; sessionId: number; commandId: string;
  resolvedAction: string | null; atMs: number;
}): void {
  try {
    if (!input || typeof input.commandId !== 'string') return;
    const correlationId = commandCorrelationId(input.generationId, input.sessionId, input.commandId);
    const prev = _legacyExec.get(correlationId);
    _legacyExec.set(correlationId, Object.freeze({
      generationId: input.generationId,
      sessionId: input.sessionId,
      commandId: input.commandId,
      correlationId,
      resolvedAction: input.resolvedAction ?? null,
      legacyExecutionCount: (prev?.legacyExecutionCount ?? 0) + 1,
      lastAtMs: input.atMs,
    }));
    // Bounded: en eski anahtarı düşür (Map ekleme sırasını korur).
    while (_legacyExec.size > MAX_LEGACY_EXECUTIONS) {
      const oldest = _legacyExec.keys().next().value;
      if (oldest === undefined) break;
      _legacyExec.delete(oldest);
    }
  } catch { /* fail-soft */ }
}

/** Lifecycle sayaçları — wiring çağırır (yeni durum DEĞİL, zaten bilinen olgular). */
export function recordLifecyclePhase(phase: 'start' | 'restart' | 'dispose'): void {
  try {
    if (phase === 'start') _counters.starts++;
    else if (phase === 'restart') _counters.restarts++;
    else _counters.disposes++;
  } catch { /* fail-soft */ }
}

/** Kayıtlı abonelik/guard sayısını GÜNCELLE (delta: +1 kayıt, -1 sökme). */
export function adjustRegistration(
  kind: 'commandListener' | 'voiceStateSubscription' | 'guard', delta: number,
): void {
  try {
    if (!Number.isFinite(delta)) return;
    if (kind === 'commandListener') _counters.commandListeners = Math.max(0, _counters.commandListeners + delta);
    else if (kind === 'voiceStateSubscription') _counters.voiceStateSubscriptions = Math.max(0, _counters.voiceStateSubscriptions + delta);
    else _counters.guards = Math.max(0, _counters.guards + delta);
  } catch { /* fail-soft */ }
}

/** @internal — testler arası izolasyon. */
export function _resetMaviEvidenceForTest(): void {
  _lifecycle.length = 0; _decisions.length = 0; _media.length = 0;
  _bargeIns.length = 0; _safety.length = 0;
  _counters.starts = 0; _counters.restarts = 0; _counters.disposes = 0;
  _counters.commandListeners = 0; _counters.voiceStateSubscriptions = 0; _counters.guards = 0;
  _legacyExec.clear();
  _currentCorrelation = null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Segment toplaması (MEVCUT voiceStateBridge çıktısından türetilir)
 * ════════════════════════════════════════════════════════════════════════ */

export interface SegmentStat {
  readonly count: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly avgMs: number;
}

export const SEGMENT_KEYS: readonly VoiceSegmentKey[] = Object.freeze([
  'wakeToListening', 'listeningToTranscript', 'transcriptToPlan', 'planToExecution', 'executionToSpeech',
] as const);

/**
 * Segment istatistikleri — YENİ ÖLÇÜM YAPMAZ, `voiceStateBridge.recent()` çıktısını toplar.
 * Örnek yoksa `count: 0` döner (uydurma değer üretilmez).
 */
export function aggregateSegments(
  timings: readonly VoiceSessionTiming[],
): Readonly<Record<VoiceSegmentKey, SegmentStat>> {
  const out = {} as Record<VoiceSegmentKey, SegmentStat>;
  for (const key of SEGMENT_KEYS) {
    let count = 0, min = Number.POSITIVE_INFINITY, max = 0, sum = 0;
    for (const t of timings) {
      const v = t?.segments?.[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
      count++; sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[key] = Object.freeze({
      count,
      minMs: count > 0 ? Math.round(min) : 0,
      maxMs: count > 0 ? Math.round(max) : 0,
      avgMs: count > 0 ? Math.round(sum / count) : 0,
    });
  }
  return Object.freeze(out);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Rapor
 * ════════════════════════════════════════════════════════════════════════ */

/** voiceService'in HİÇ emit etmediği fazlar → NOT_OBSERVED değil, NO_SOURCE (dürüstlük). */
export const PHASES_WITHOUT_SOURCE: readonly string[] = Object.freeze([
  'planning',    // Mavi orchestrator üretir, voiceService kanalına bağlı DEĞİL
  'executing',   // aynı
  'speech_end',  // voiceService yalnız 'speaking' (başlangıç) emit eder — bitiş sinyali YOK
]);

export const EXPECTED_PHASES: readonly string[] = Object.freeze([
  'wake_detected', 'listening', 'transcribing', 'planning', 'executing',
  'speaking', 'speech_end', 'cancelled', 'timeout', 'error',
]);

export interface MaviEvidenceReport {
  /** Rapor sözleşmesi — tüketiciye "bu rapor karar vermez" garantisi. */
  readonly contract: 'evidence-only';
  readonly generatedAtMs: number;
  /** 1. Voice lifecycle ham olayları (bounded). */
  readonly lifecycleEvents: readonly LifecycleEventRecord[];
  /** Faz başına gözlem sayısı + kaynak durumu. */
  readonly phaseCoverage: readonly EvidenceItem[];
  /** 2. TAKEOVER komut-başına karar zinciri. */
  readonly takeoverDecisions: readonly TakeoverDecisionRecord[];
  /** 3. media.next port gerçekleri. */
  readonly mediaNext: readonly MediaNextRecord[];
  readonly mediaNextTotals: Readonly<{
    attempts: number; nextCalled: number; legacyExecuted: number; maviExecuted: number;
    unavailable: number; threw: number;
  }>;
  /** 4. Eski hattın komut-bazında yürütme kayıtları. */
  readonly legacyExecutions: readonly LegacyExecutionRecord[];
  /** Barge-in. */
  readonly bargeIns: readonly BargeInRecord[];
  /** 5. Ownership yaşam döngüsü (MEVCUT arbiter.stats() — kopya tutulmaz). */
  readonly ownership: TakeoverArbiterStats | null;
  /** 6. Lifecycle sayaçları + sızıntı işaretleri. */
  readonly lifecycleCounters: LifecycleCounters;
  /** 7. Telemetri segment istatistikleri. */
  readonly segments: Readonly<Record<VoiceSegmentKey, SegmentStat>>;
  /** Telemetri güvenilirlik notları (eksik/sıra-dışı olaylar). */
  readonly telemetryDiagnostics: readonly string[];
  /** 8. Safety kararları. */
  readonly safety: readonly SafetyRecord[];
  /** 9. Kontrol maddeleri — YALNIZ OBSERVED/NOT_OBSERVED/NOT_TESTED/NO_SOURCE. */
  readonly checklist: readonly EvidenceItem[];
  /** KRİTİK bulgular (ör. çift yürütme) — boşsa hiçbir şey iddia edilmez. */
  readonly criticalFindings: readonly string[];
  /** Ledger'a YAZILMADIĞININ açık beyanı. */
  readonly ledgerUpdated: false;
}

export interface BuildEvidenceDeps {
  /** MEVCUT kaynak: voiceStateBridge.recent(). Verilmezse segmentler count:0 kalır. */
  readonly timings?: readonly VoiceSessionTiming[];
  /** MEVCUT kaynak: arbiter.stats(). */
  readonly ownership?: TakeoverArbiterStats | null;
  /** Duvar saati (DI — test). */
  readonly now?: () => number;
}

function item(
  id: string, what: string, verdict: EvidenceVerdict,
  evidence: Record<string, string | number | boolean>, reason?: string,
): EvidenceItem {
  return Object.freeze({ id, what, verdict, evidence: Object.freeze(evidence), ...(reason ? { reason } : {}) });
}

/**
 * Kanıt raporunu KURAR. Hiçbir "çalışıyor" sonucu üretmez; yalnız gözlenen olguları ve üç-değerli
 * gözlem durumunu döner. Ledger'a DOKUNMAZ.
 */
export function buildMaviEvidenceReport(deps: BuildEvidenceDeps = {}): MaviEvidenceReport {
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const timings = Array.isArray(deps.timings) ? deps.timings : [];
  const ownership = deps.ownership ?? null;

  /* ── Faz kapsamı ─────────────────────────────────────────── */
  const phaseCounts = new Map<string, number>();
  for (const e of _lifecycle) phaseCounts.set(e.phase, (phaseCounts.get(e.phase) ?? 0) + 1);

  const phaseCoverage = EXPECTED_PHASES.map((phase) => {
    const count = phaseCounts.get(phase) ?? 0;
    if (PHASES_WITHOUT_SOURCE.includes(phase)) {
      return item(`phase.${phase}`, `'${phase}' lifecycle olayı`, 'NO_SOURCE', { count },
        'voiceService bu fazı emit etmiyor — ölçüm kanalı yok (NOT_OBSERVED sayılamaz)');
    }
    if (count > 0) return item(`phase.${phase}`, `'${phase}' lifecycle olayı`, 'OBSERVED', { count });
    return _lifecycle.length === 0
      ? item(`phase.${phase}`, `'${phase}' lifecycle olayı`, 'NOT_TESTED', { count }, 'hiç lifecycle olayı kaydedilmedi')
      : item(`phase.${phase}`, `'${phase}' lifecycle olayı`, 'NOT_OBSERVED', { count }, 'başka fazlar gözlendi ama bu faz hiç gelmedi');
  });

  /* ── media.next toplamları ───────────────────────────────── */
  const legacyExecutions = [..._legacyExec.values()];
  const legacyMediaNext = legacyExecutions
    .filter((l) => l.resolvedAction === 'media.next')
    .reduce((sum, l) => sum + l.legacyExecutionCount, 0);
  const maviExecuted = _decisions.filter((d) => d.resolvedAction === 'media.next' && d.executedBy === 'mavi').length;
  const mediaNextTotals = Object.freeze({
    attempts: _media.length,
    nextCalled: _media.filter((m) => m.nextCalled).length,
    legacyExecuted: legacyMediaNext,
    maviExecuted,
    unavailable: _media.filter((m) => m.serviceResult === 'unavailable').length,
    threw: _media.filter((m) => m.serviceResult === 'throw').length,
  });

  /* ── KRİTİK: çift yürütme tespiti ────────────────────────── */
  const criticalFindings: string[] = [];
  for (const d of _decisions) {
    if (d.executedBy === 'mavi' && d.legacyCandidate && d.ownershipDecision === false) {
      criticalFindings.push(
        `KRİTİK: ${d.commandType}/${d.commandId} — sahiplik kararı false olmasına rağmen Mavi yürüttü (gen ${d.generationId}).`,
      );
    }
  }
  // Aynı anahtar için hem legacy hem mavi yürütme kaydı.
  const maviKeys = new Set(_decisions.filter((d) => d.executedBy === 'mavi').map((d) => d.correlationId));
  const legacyKeys = new Set([
    ..._decisions.filter((d) => d.executedBy === 'legacy').map((d) => d.correlationId),
    // Eski hattın KENDİ kaydı (guard'ın geçirdiği yol) — correlationId ile join edilir.
    ...legacyExecutions.map((l) => l.correlationId),
  ]);
  for (const k of maviKeys) {
    if (legacyKeys.has(k)) criticalFindings.push(`KRİTİK: ÇİFT YÜRÜTME — ${k} hem Mavi hem eski hat tarafından çalıştırıldı.`);
  }
  // Tek anahtarda eski hat birden fazla kez yürütmüş (çift atlama).
  for (const l of legacyExecutions) {
    if (l.legacyExecutionCount > 1) {
      criticalFindings.push(`KRİTİK: ${l.correlationId} — eski hat aynı komutu ${l.legacyExecutionCount} kez yürüttü.`);
    }
  }
  // Tek turda port birden fazla kez next() çağırmış.
  for (const m of _media) {
    if (m.nextCallCount > 1 && m.correlationId) {
      criticalFindings.push(`KRİTİK: ${m.correlationId} — media.next portu tek turda ${m.nextCallCount} kez çağrıldı.`);
    }
  }
  // Sayaç düzeyinde çift atlama: aynı komut için mavi+legacy media.next toplamı denemeden fazla.
  if (mediaNextTotals.maviExecuted > 0 && mediaNextTotals.legacyExecuted > 0) {
    criticalFindings.push(
      `KRİTİK: media.next hem Mavi (${mediaNextTotals.maviExecuted}) hem eski hat (${mediaNextTotals.legacyExecuted}) tarafından çalıştırılmış — tek hat garantisi ihlal edilmiş olabilir.`,
    );
  }

  /* ── Telemetri ───────────────────────────────────────────── */
  const segments = aggregateSegments(timings);
  const telemetryDiagnostics: string[] = [];
  for (const t of timings) {
    for (const d of (t?.diagnostics ?? [])) {
      if (!telemetryDiagnostics.includes(d)) telemetryDiagnostics.push(d);
    }
  }

  /* ── Kontrol listesi (9) ─────────────────────────────────── */
  const checklist: EvidenceItem[] = [];

  // 2. TAKEOVER
  const takeoverDecisions = _decisions.filter((d) => d.resolvedAction === 'media.next');
  const takeoverMode = _decisions.some((d) => d.flagState === 'takeover');
  checklist.push(
    _decisions.length === 0
      ? item('takeover.decisions', 'media.next için sahiplik kararı üretildi', 'NOT_TESTED', { decisions: 0 }, 'hiç komut kaydedilmedi')
      : item('takeover.decisions', 'media.next için sahiplik kararı üretildi',
        takeoverDecisions.length > 0 ? 'OBSERVED' : 'NOT_OBSERVED',
        { decisions: _decisions.length, mediaNextDecisions: takeoverDecisions.length, takeoverModeSeen: takeoverMode }),
  );
  checklist.push(
    criticalFindings.length > 0
      ? item('takeover.singlePath', 'aynı komutta yalnız TEK hat çalıştı', 'NOT_OBSERVED',
        { criticalFindings: criticalFindings.length }, 'çift yürütme işareti bulundu — kritik bulgulara bakın')
      : _decisions.length === 0
        ? item('takeover.singlePath', 'aynı komutta yalnız TEK hat çalıştı', 'NOT_TESTED', { decisions: 0 })
        : item('takeover.singlePath', 'aynı komutta yalnız TEK hat çalıştı', 'OBSERVED',
          { decisions: _decisions.length, maviExecuted: maviKeys.size, legacyExecuted: legacyKeys.size }),
  );

  // 3. media.next ön-koşulları
  checklist.push(
    _media.length === 0
      ? item('media.precondition', 'media.next ön-koşulu (hasQueue||hasSession) uygulandı', 'NOT_TESTED', { attempts: 0 })
      : item('media.precondition', 'media.next ön-koşulu (hasQueue||hasSession) uygulandı',
        _media.every((m) => m.nextCalled === (m.hasQueue || m.hasSession)) ? 'OBSERVED' : 'NOT_OBSERVED',
        { attempts: _media.length, nextCalled: mediaNextTotals.nextCalled, unavailable: mediaNextTotals.unavailable }),
  );
  checklist.push(
    _media.length === 0
      ? item('media.duckParity', 'cancelAssistantDuck her denemede çağrıldı (eski hat paritesi)', 'NOT_TESTED', { attempts: 0 })
      : item('media.duckParity', 'cancelAssistantDuck her denemede çağrıldı (eski hat paritesi)',
        _media.every((m) => m.cancelAssistantDuckCalled) ? 'OBSERVED' : 'NOT_OBSERVED',
        { attempts: _media.length, duckCalled: _media.filter((m) => m.cancelAssistantDuckCalled).length }),
  );

  // 4. Barge-in
  checklist.push(
    _bargeIns.length === 0
      ? item('bargein.stale', 'yeni wake eski generation\'ı stale yaptı', 'NOT_TESTED', { bargeIns: 0 })
      : item('bargein.stale', 'yeni wake eski generation\'ı stale yaptı',
        _bargeIns.some((b) => b.staleDecision) ? 'OBSERVED' : 'NOT_OBSERVED',
        { bargeIns: _bargeIns.length, staleDecisions: _bargeIns.filter((b) => b.staleDecision).length }),
  );

  // 5. Ownership
  checklist.push(
    ownership === null
      ? item('ownership.lifecycle', 'sahiplik yaşam döngüsü sayaçları okundu', 'NOT_TESTED', {}, 'arbiter.stats() verilmedi')
      : item('ownership.lifecycle', 'sahiplik yaşam döngüsü sayaçları okundu',
        ownership.claimed > 0 ? 'OBSERVED' : 'NOT_TESTED',
        {
          claimed: ownership.claimed, duplicates: ownership.duplicates, staleRejected: ownership.staleRejected,
          notEligible: ownership.notEligible, released: ownership.released,
          timedOut: ownership.timedOut, superseded: ownership.superseded, mode: ownership.mode,
        },
        ownership.claimed === 0 ? 'hiç sahiplik alınmadı (TAKEOVER denenmemiş olabilir)' : undefined),
  );
  checklist.push(
    ownership === null || ownership.claimed === 0
      ? item('ownership.released', 'alınan her sahiplik serbest bırakıldı', 'NOT_TESTED', {})
      : item('ownership.released', 'alınan her sahiplik serbest bırakıldı',
        ownership.released >= ownership.claimed ? 'OBSERVED' : 'NOT_OBSERVED',
        { claimed: ownership.claimed, released: ownership.released, ownedNow: ownership.ownedActionId ?? 'none' },
        ownership.released < ownership.claimed ? 'released < claimed — açık sahiplik kalmış olabilir' : undefined),
  );

  // 6. Lifecycle sızıntısı
  const leak = _counters.commandListeners > 1 || _counters.voiceStateSubscriptions > 1 || _counters.guards > 1;
  checklist.push(
    _counters.starts === 0
      ? item('lifecycle.noLeak', 'start/restart/dispose sonrası tek listener/guard', 'NOT_TESTED', { starts: 0 })
      : item('lifecycle.noLeak', 'start/restart/dispose sonrası tek listener/guard',
        leak ? 'NOT_OBSERVED' : 'OBSERVED',
        {
          starts: _counters.starts, restarts: _counters.restarts, disposes: _counters.disposes,
          commandListeners: _counters.commandListeners,
          voiceStateSubscriptions: _counters.voiceStateSubscriptions, guards: _counters.guards,
        },
        leak ? 'birden fazla kayıt tespit edildi — sızıntı olabilir' : undefined),
  );

  // 7. Telemetri monotonluk/boundedness
  const observedSegments = SEGMENT_KEYS.filter((k) => segments[k].count > 0);
  checklist.push(
    observedSegments.length === 0
      ? item('telemetry.segments', '5 telemetri segmenti ölçüldü', 'NOT_TESTED', { measured: 0 }, 'hiç tamamlanmış oturum yok')
      : item('telemetry.segments', '5 telemetri segmenti ölçüldü',
        observedSegments.length === SEGMENT_KEYS.length ? 'OBSERVED' : 'NOT_OBSERVED',
        {
          measured: observedSegments.length, expected: SEGMENT_KEYS.length,
          sessions: timings.length, telemetryDiagnostics: telemetryDiagnostics.length,
        },
        observedSegments.length < SEGMENT_KEYS.length
          ? `ölçülemeyen segmentler: ${SEGMENT_KEYS.filter((k) => segments[k].count === 0).join(', ')}`
          : undefined),
  );
  // Negatif/monotonik olmayan süre var mı (ölçüm güvenilirliği).
  const nonMonotonic = SEGMENT_KEYS.some((k) => segments[k].count > 0 && segments[k].minMs < 0);
  checklist.push(
    observedSegments.length === 0
      ? item('telemetry.monotonic', 'segment süreleri monotonik ve bounded', 'NOT_TESTED', {})
      : item('telemetry.monotonic', 'segment süreleri monotonik ve bounded',
        nonMonotonic ? 'NOT_OBSERVED' : 'OBSERVED',
        { measuredSegments: observedSegments.length, sessionsRetained: timings.length }),
  );

  // 8. Safety
  checklist.push(
    _safety.length === 0
      ? item('safety.gate', 'AiSafetyGate kararları kaydedildi', 'NOT_TESTED', { records: 0 })
      : item('safety.gate', 'AiSafetyGate kararları kaydedildi', 'OBSERVED',
        {
          records: _safety.length,
          allowed: _safety.filter((s) => s.decision === 'allowed').length,
          denied: _safety.filter((s) => s.decision === 'denied').length,
          hardForbidden: _safety.filter((s) => s.decision === 'hard_forbidden').length,
          readOnly: _safety.filter((s) => s.readOnly).length,
        }),
  );
  checklist.push(
    _decisions.length === 0
      ? item('safety.noVehicleTakeover', 'araç/ECU eylemi takeover EDİLMEDİ', 'NOT_TESTED', { decisions: 0 })
      : item('safety.noVehicleTakeover', 'araç/ECU eylemi takeover EDİLMEDİ',
        _decisions.some((d) => d.executedBy === 'mavi' && d.resolvedAction !== 'media.next')
          ? 'NOT_OBSERVED' : 'OBSERVED',
        {
          maviExecutions: _decisions.filter((d) => d.executedBy === 'mavi').length,
          nonMediaNextMaviExecutions: _decisions.filter((d) => d.executedBy === 'mavi' && d.resolvedAction !== 'media.next').length,
        }),
  );

  return Object.freeze({
    contract: 'evidence-only',
    generatedAtMs: now(),
    lifecycleEvents: Object.freeze(_lifecycle.slice()),
    phaseCoverage: Object.freeze(phaseCoverage),
    takeoverDecisions: Object.freeze(_decisions.slice()),
    mediaNext: Object.freeze(_media.slice()),
    mediaNextTotals,
    legacyExecutions: Object.freeze(legacyExecutions),
    bargeIns: Object.freeze(_bargeIns.slice()),
    ownership,
    lifecycleCounters: Object.freeze({ ..._counters }),
    segments,
    telemetryDiagnostics: Object.freeze(telemetryDiagnostics),
    safety: Object.freeze(_safety.slice()),
    checklist: Object.freeze(checklist),
    criticalFindings: Object.freeze(criticalFindings),
    ledgerUpdated: false,
  });
}
