/**
 * maviReasoningEngine.ts — TEK KARAR OTORİTESİ: RESOLVER ZİNCİRİ (SAF).
 *
 * ── NE YAPAR ───────────────────────────────────────────────────────────
 * Niyeti çözer → kanıtı toplar → süresi dolanı ayıklar → çelişkiyi bulur →
 * kararı verir → güveni TÜRETİR → kararı tekilleştirir → zinciri kurar.
 *
 * ── TEK VERİ KAPISI (BAĞLAYICI) ────────────────────────────────────────
 * Bu dosya **YALNIZ** `../fleet/aiEvidence*` modüllerini import eder.
 * Driver DNA · Fleet Intelligence · Trip Engine · Deep Scan · telemetri
 * DOĞRUDAN OKUNMAZ — hepsi kanıt omurgasına yazar, motor omurgayı okur.
 * (Kilit: `maviReasoning.test.ts` import listesini sınar.)
 *
 * ── NE YAPMAZ ──────────────────────────────────────────────────────────
 * · **LLM ÇAĞIRMAZ** · cümle kurmaz · öneri vermez · tahmin üretmez.
 * · Güveni DIŞARIDAN ALMAZ — daima kanıttan türetir.
 * · Kanıt YAZMAZ/DEĞİŞTİRMEZ — kanıt omurgası salt-okunur girdidir.
 * · Karar SİLMEZ — süresi dolan karar `EXPIRED` olur.
 * · Paralel bir karar motoru kurmaz; ikinci otorite yoktur.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

import {
  isEvidenceValid,
  sampleConfidenceCeiling,
  type AiEvidence, type EvidenceCategory,
} from '../fleet/aiEvidence';
import type { EvidenceLedger } from '../fleet/aiEvidenceEngine';
import {
  EMPTY_QUEUE_SNAPSHOT, type ReasoningQueueSnapshot,
} from './maviReasoningQueue';
import {
  UNREAD_SCHEDULER_HEALTH, type SchedulerHealth,
} from './maviReasoningSchedule';
import {
  REASONING_DEFAULT_TTL_MS, REASONING_VERSION,
  canTransitionReasoning, categoriesForIntent, evidenceSignature,
  intentForCategory, isReasoningValid, reasoningKey, stateForDecision,
  valuesConflict, weakestReasoningConfidence,
  type ConfidenceReason, type MaviReasoning, type ReasoningChainNode,
  type ReasoningConfidence, type ReasoningConflict, type ReasoningDecision,
  type ReasoningIntent, type ReasoningState,
} from './maviReasoning';

/* ── 1. NİYET ÇÖZÜCÜ ───────────────────────────────────────────────────── */

/** Niyet nereden geldi — bounded KOD (denetlenebilirlik). */
export const INTENT_ORIGINS = ['REQUESTED', 'DERIVED', 'UNRESOLVED'] as const;
export type IntentOrigin = (typeof INTENT_ORIGINS)[number];

export interface IntentResolution {
  readonly intent: ReasoningIntent;
  readonly origin: IntentOrigin;
  /** Türetim sırasında görülen aday niyetler (belirsizlik kanıtı). */
  readonly candidates: readonly ReasoningIntent[];
}

/**
 * Niyeti çözer — **belirsizlik UNKNOWN'dır** (kural 6).
 *
 * ── SIRA ────────────────────────────────────────────────────────────────
 *  1. Çağıran açık bir niyet verdiyse o kullanılır (`REQUESTED`). Niyet bir
 *     serbest metinden ÇIKARILMAZ: metinden niyet üretmek LLM işidir ve bu
 *     katmanda LLM yoktur.
 *  2. Verilmediyse kanıt kategorilerinden türetilir (`DERIVED`) — ama
 *     **yalnız tek bir aday varsa**. Kategoriler birden fazla niyete
 *     işaret ediyorsa motor birini SEÇMEZ; `UNKNOWN` döner.
 *  3. Hiç kategori yoksa `UNRESOLVED`.
 */
export function resolveIntent(input: {
  readonly requestedIntent?: ReasoningIntent | null;
  readonly categories: readonly EvidenceCategory[];
}): IntentResolution {
  const requested = input.requestedIntent ?? null;
  if (requested !== null && requested !== 'UNKNOWN') {
    return { intent: requested, origin: 'REQUESTED', candidates: [requested] };
  }

  const candidates: ReasoningIntent[] = [];
  for (const c of input.categories) {
    const i = intentForCategory(c);
    /* Kategorisi bilinmeyen kanıt niyet ÜRETMEZ — bilinmeyenden bilgi çıkmaz. */
    if (i === 'UNKNOWN') continue;
    if (!candidates.includes(i)) candidates.push(i);
  }

  if (candidates.length === 1) {
    return { intent: candidates[0]!, origin: 'DERIVED', candidates };
  }
  /* 0 aday → hiç ipucu yok · 2+ aday → hangisi olduğu BELLİ DEĞİL.
     İkisi de "bilmiyorum"dur; motor kura çekmez. */
  return { intent: 'UNKNOWN', origin: 'UNRESOLVED', candidates };
}

/* ── 2. KANIT ÇÖZÜCÜ ───────────────────────────────────────────────────── */

/** Kararın öznesi — en az biri dolu olmalı. */
export interface ReasoningSubject {
  readonly companyId: string;
  readonly vehicleId?: string | null;
  readonly driverId?: string | null;
  readonly tripId?: string | null;
}

export interface EvidenceResolution {
  /** Özneye ve niyete uyan TÜM kanıtlar (durumdan bağımsız). */
  readonly matched: readonly AiEvidence[];
  /** Karara GİREBİLECEK kanıtlar (geçerli + süresi dolmamış). */
  readonly active: readonly AiEvidence[];
  /** Süresi dolduğu için karara GİRMEYEN kanıtlar — zincirden silinmez. */
  readonly expired: readonly AiEvidence[];
  /** Reddedilmiş/yerine geçilmiş kanıtlar (karara girmez, görünür kalır). */
  readonly excluded: readonly AiEvidence[];
  /** Güveni türetilememiş aktif kanıt sayısı. */
  readonly unknownConfidenceCount: number;
  /** Beklenen kategorilerin kaçı aktif kanıtla karşılandı (`null` = hesaplanamaz). */
  readonly coverageRatio: number | null;
  readonly missingCategories: readonly EvidenceCategory[];
}

const EMPTY_EVIDENCE_RESOLUTION: EvidenceResolution = Object.freeze({
  matched: Object.freeze([]) as readonly AiEvidence[],
  active: Object.freeze([]) as readonly AiEvidence[],
  expired: Object.freeze([]) as readonly AiEvidence[],
  excluded: Object.freeze([]) as readonly AiEvidence[],
  unknownConfidenceCount: 0,
  coverageRatio: null,
  missingCategories: Object.freeze([]) as readonly EvidenceCategory[],
});

/** Kanıt bu özneye ait mi — verilen her özne alanı EŞLEŞMELİDİR. */
function matchesSubject(e: AiEvidence, s: ReasoningSubject): boolean {
  if (e.companyId !== s.companyId) return false;     // CROSS-TENANT kapalı
  if (s.vehicleId != null && e.vehicleId !== s.vehicleId) return false;
  if (s.driverId != null && e.driverId !== s.driverId) return false;
  if (s.tripId != null && e.tripId !== s.tripId) return false;
  return true;
}

/**
 * Karara girecek kanıtları toplar — **tek veri kapısı buradan geçer**.
 *
 * ⚠️ Süresi dolmuş kanıt `expired`e ayrılır ama **atılmaz**: karar sonradan
 * "neye dayanıyordun" sorusuna cevap verebilmelidir (kural 4).
 */
export function resolveEvidence(
  ledger: EvidenceLedger,
  subject: ReasoningSubject,
  intent: ReasoningIntent,
  nowMs: number,
): EvidenceResolution {
  const expected = categoriesForIntent(intent);
  if (expected.length === 0) return EMPTY_EVIDENCE_RESOLUTION;

  const matched = ledger.entries.filter(
    (e) => matchesSubject(e, subject) && expected.includes(e.category));

  const active: AiEvidence[] = [];
  const expired: AiEvidence[] = [];
  const excluded: AiEvidence[] = [];
  for (const e of matched) {
    if (isEvidenceValid(e, nowMs)) { active.push(e); continue; }
    /* `ACTIVE` ama süresi geçmiş kayıt da süresi dolmuş sayılır: defterin
       henüz `expireEvidence` görmemiş olması kanıtı taze yapmaz. */
    if (e.state === 'EXPIRED' || (e.state === 'ACTIVE' && nowMs >= e.expiresAt)) {
      expired.push(e);
    } else {
      excluded.push(e);
    }
  }

  const present: EvidenceCategory[] = [];
  for (const c of expected) {
    if (active.some((e) => e.category === c)) present.push(c);
  }
  const missing = expected.filter((c) => !present.includes(c));

  return {
    matched, active, expired, excluded,
    unknownConfidenceCount: active.filter((e) => e.confidence === 'UNKNOWN').length,
    /* Hiç aktif kanıt yoksa oran `null` — `0` "kapsam sıfır ÖLÇÜLDÜ"
       demek olurdu, oysa gerçek "hiç bakmadık"tır. */
    coverageRatio: active.length === 0 ? null : present.length / expected.length,
    missingCategories: missing,
  };
}

/* ── 3. ÇELİŞKİ ÇÖZÜCÜ ─────────────────────────────────────────────────── */

/** Kanıtın özne imzası — çelişki yalnız AYNI özne üzerinde aranır. */
function subjectSignature(e: AiEvidence): string {
  return `${e.vehicleId ?? '-'}|${e.driverId ?? '-'}|${e.tripId ?? '-'}`;
}

/**
 * Aktif kanıtlar arasındaki çelişkileri bulur (SAF · deterministik).
 *
 * ── İKİ ÇELİŞKİ TÜRÜ ────────────────────────────────────────────────────
 * · `VALUE_DIVERGENCE`  — **farklı kaynaklar** aynı metriği farklı ölçmüş.
 *   Aynı kaynağın kendisiyle çelişmesi mümkün değildir (kanıt omurgası aynı
 *   kimlikte tek satır tutar), bu yüzden yalnız kaynaklar arası bakılır.
 * · `REVISION_DIVERGENCE` — **aynı kaynağın** iki farklı revizyonu birden
 *   aktif. Eskisi `SUPERSEDED` olmalıydı; olmadıysa hangisinin geçerli
 *   olduğu bilinmez → bu da bir çelişkidir.
 *
 * ⚠️ Çıktı sırası girdiden bağımsız olarak DETERMİNİSTİKTİR (kanıt id'sine
 * göre): aynı defter her koşumda aynı çelişki listesini üretmelidir.
 */
export function resolveConflicts(
  active: readonly AiEvidence[],
): readonly ReasoningConflict[] {
  const conflicts: ReasoningConflict[] = [];
  const sorted = [...active].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.metric !== b.metric) continue;
      if (subjectSignature(a) !== subjectSignature(b)) continue;

      if (a.source === b.source) {
        /* Aynı kaynak + aynı metrik + aynı özne → yalnız revizyon farkı
           olabilir; ikisi de aktifse hangisi geçerli BELLİ DEĞİLDİR. */
        conflicts.push({
          kind: 'REVISION_DIVERGENCE', metric: a.metric,
          leftEvidenceId: a.id, rightEvidenceId: b.id,
        });
        continue;
      }
      if (valuesConflict(a.value, b.value)) {
        conflicts.push({
          kind: 'VALUE_DIVERGENCE', metric: a.metric,
          leftEvidenceId: a.id, rightEvidenceId: b.id,
        });
      }
    }
  }
  return conflicts;
}

/* ── 4. KARAR ÇÖZÜCÜ ───────────────────────────────────────────────────── */

/** Olumsuz kanıt — bir iddiayı çürüten önem seviyeleri. */
function isNegative(e: AiEvidence): boolean {
  return e.severity === 'WARNING' || e.severity === 'CRITICAL';
}

export interface DecisionResolution {
  readonly decision: ReasoningDecision;
  readonly confidenceReason: ConfidenceReason;
}

/**
 * Kararı verir — **fail-closed ve SIRALI**.
 *
 * Sıra pazarlıksızdır ve en spesifik gerekçe kazanır:
 *  1. Özne yok → `REJECTED` (öznesiz karar bir yere bağlanamaz).
 *  2. Niyet çözülemedi → `UNKNOWN`.
 *  3. Hiç kanıt yok → `INSUFFICIENT_EVIDENCE`.
 *     ⚠️ "Veri yok, o hâlde sorun yok" bir karar DEĞİLDİR.
 *  4. Kanıt var ama hepsinin süresi dolmuş → `EXPIRED_EVIDENCE`.
 *  5. Çelişki var → `CONFLICTED_EVIDENCE` (karar ÜRETİLMEZ, kural 3).
 *  6. Aktif kanıtların güveni türetilememiş → `UNKNOWN`.
 *  7. Olumsuz kanıt var → `UNSUPPORTED`.
 *  8. Aksi hâlde → `SUPPORTED`.
 */
export function resolveDecision(
  subject: ReasoningSubject,
  intentResolution: IntentResolution,
  evidence: EvidenceResolution,
  conflicts: readonly ReasoningConflict[],
): DecisionResolution {
  if (subject.companyId.length === 0
      || (subject.vehicleId == null && subject.driverId == null && subject.tripId == null)) {
    return { decision: 'REJECTED', confidenceReason: 'SUBJECT_MISMATCH' };
  }
  if (intentResolution.intent === 'UNKNOWN') {
    return { decision: 'UNKNOWN', confidenceReason: 'INTENT_UNRESOLVED' };
  }
  if (evidence.matched.length === 0) {
    return { decision: 'INSUFFICIENT_EVIDENCE', confidenceReason: 'NO_EVIDENCE' };
  }
  if (evidence.active.length === 0) {
    return evidence.expired.length > 0
      ? { decision: 'EXPIRED_EVIDENCE', confidenceReason: 'ALL_EVIDENCE_EXPIRED' }
      : { decision: 'INSUFFICIENT_EVIDENCE', confidenceReason: 'NO_EVIDENCE' };
  }
  if (conflicts.length > 0) {
    return { decision: 'CONFLICTED_EVIDENCE', confidenceReason: 'CONFLICTING_EVIDENCE' };
  }
  if (evidence.unknownConfidenceCount === evidence.active.length) {
    return { decision: 'UNKNOWN', confidenceReason: 'EVIDENCE_UNKNOWN_CONFIDENCE' };
  }

  const negative = evidence.active.some(isNegative);
  const reason: ConfidenceReason =
    evidence.missingCategories.length > 0 ? 'COVERAGE_INCOMPLETE'
      : evidence.active.length === 1 ? 'SINGLE_OBSERVATION'
        : 'WEAKEST_EVIDENCE_LINK';
  return { decision: negative ? 'UNSUPPORTED' : 'SUPPORTED', confidenceReason: reason };
}

/* ── 5. GÜVEN ÇÖZÜCÜ ───────────────────────────────────────────────────── */

/**
 * Karar güvenini TÜRETİR — **tek yol budur** (kural 2).
 *
 * ⚠️ Güven bir GİRDİ DEĞİLDİR: hiçbir çağıran (LLM dâhil) kendi güvenini
 * yazamaz. Formül `aiEvidence`ten İTHAL edilir; burada ikinci bir güven
 * otoritesi tanımlanmaz.
 *
 * ── ZİNCİR ──────────────────────────────────────────────────────────────
 *  · Sonuçlandırıcı olmayan karar (`UNKNOWN`, `REJECTED`, çelişki, süre,
 *    yetersizlik) → **daima `UNKNOWN`**: "kararsızım ama eminim" olamaz.
 *  · Sonuçlandırıcı karar → aktif kanıtların EN ZAYIF güveni,
 *    · kanıt SAYISI tavanıyla (tek gözlem `MEDIUM`u aşamaz),
 *    · kapsam tavanıyla (%50 altı → `LOW`, %80 altı → `MEDIUM`)
 *    daraltılır. Her adım yalnız AŞAĞI çeker; hiçbir adım güveni yükseltemez.
 */
export function resolveConfidence(
  decision: ReasoningDecision,
  evidence: EvidenceResolution,
): ReasoningConfidence {
  if (decision !== 'SUPPORTED' && decision !== 'UNSUPPORTED') return 'UNKNOWN';
  if (evidence.active.length === 0) return 'UNKNOWN';

  let confidence: ReasoningConfidence = 'VERY_HIGH';
  for (const e of evidence.active) {
    confidence = weakestReasoningConfidence(confidence, e.confidence);
  }
  /* Kaç AYRI kanıt karara girdi — tek kanıtla verilen karar bir eğilim
     değildir (kanıt omurgasındaki örnek-sayısı tavanının aynısı). */
  confidence = weakestReasoningConfidence(
    confidence, sampleConfidenceCeiling(evidence.active.length));

  const ratio = evidence.coverageRatio;
  if (ratio === null) return 'UNKNOWN';
  if (ratio < 0.5) confidence = weakestReasoningConfidence(confidence, 'LOW');
  else if (ratio < 0.8) confidence = weakestReasoningConfidence(confidence, 'MEDIUM');

  return confidence;
}

/* ── 6. KARAR ÜRETİMİ ──────────────────────────────────────────────────── */

export interface ReasoningRequest {
  readonly subject: ReasoningSubject;
  readonly requestedIntent?: ReasoningIntent | null;
  readonly observedAt: number;
  readonly ttlMs?: number;
}

export interface ReasoningOutcome {
  readonly reasoning: MaviReasoning;
  readonly intentResolution: IntentResolution;
  readonly evidence: EvidenceResolution;
  readonly conflicts: readonly ReasoningConflict[];
}

/**
 * Kanıttan karar üretir — **SAF**, deterministik, LLM'siz.
 *
 * Aynı defter + aynı istek → **bit bit aynı** karar. Motorun tek girdisi
 * kanıt omurgası ve gözlem anıdır; başka hiçbir kaynağa bakmaz.
 */
export function reason(
  ledger: EvidenceLedger, request: ReasoningRequest,
): ReasoningOutcome {
  const { subject, observedAt } = request;

  /* Niyet kanıt kategorilerinden türetilecekse önce ÖZNEYE ait kanıtların
     kategorileri toplanır — başka aracın kanıtı niyet belirleyemez. */
  const subjectCategories: EvidenceCategory[] = [];
  for (const e of ledger.entries) {
    if (!matchesSubject(e, subject)) continue;
    if (!isEvidenceValid(e, observedAt)) continue;
    if (!subjectCategories.includes(e.category)) subjectCategories.push(e.category);
  }

  const intentResolution = resolveIntent({
    requestedIntent: request.requestedIntent ?? null,
    categories: subjectCategories,
  });
  const evidence = resolveEvidence(
    ledger, subject, intentResolution.intent, observedAt);
  const conflicts = resolveConflicts(evidence.active);
  const { decision, confidenceReason } = resolveDecision(
    subject, intentResolution, evidence, conflicts);
  const confidence = resolveConfidence(decision, evidence);

  /* Zincirin uçları: kanıt → içgörü / DNA bağları omurgadan OKUNUR.
     Bağ yoksa uydurulmaz (boş dizi = "bağ kurulmamış"). */
  const evidenceIds = evidence.active.map((e) => e.id);
  const insightIds = consumerIdsFor(ledger, evidenceIds, 'FLEET_INSIGHT');
  const dnaIds = consumerIdsFor(ledger, evidenceIds, 'DRIVER_DNA');

  const ttl = request.ttlMs ?? REASONING_DEFAULT_TTL_MS;
  const reasoning: MaviReasoning = {
    reasoningId: reasoningKey({
      companyId: subject.companyId,
      intent: intentResolution.intent,
      vehicleId: subject.vehicleId ?? null,
      driverId: subject.driverId ?? null,
      tripId: subject.tripId ?? null,
      evidenceIds,
    }),
    intent: intentResolution.intent,
    decision,
    confidence,
    confidenceReason,
    reasoningVersion: REASONING_VERSION,
    vehicleId: subject.vehicleId ?? null,
    driverId: subject.driverId ?? null,
    tripId: subject.tripId ?? null,
    companyId: subject.companyId,
    evidenceIds,
    insightIds,
    dnaIds,
    createdAt: observedAt,
    expiresAt: observedAt + ttl,
    /* ⚠️ Bu fonksiyonun KENDİSİ `ANALYZING` evresidir: saf motor kararı tek
       adımda sonuçlandırır ve doğrudan terminal duruma yazar. `NEW →
       ANALYZING → terminal` yürüyüşü sunucu akışında (migration 057) adım
       adım koşar; geçiş kapısı (`canTransitionReasoning`) her iki tarafta
       da AYNI kuralı uygular — ikinci bir durum makinesi yoktur. */
    state: stateForDecision(decision),
  };

  return { reasoning, intentResolution, evidence, conflicts };
}

/** Verilen kanıtları TÜKETEN çıktıların kimlikleri (zincirin üst ucu). */
function consumerIdsFor(
  ledger: EvidenceLedger, evidenceIds: readonly string[], consumer: string,
): readonly string[] {
  const ids = new Set(evidenceIds);
  const out: string[] = [];
  for (const l of ledger.chain) {
    if (l.consumer !== consumer) continue;
    if (!ids.has(l.evidenceId)) continue;
    if (!out.includes(l.consumerId)) out.push(l.consumerId);
  }
  return out.sort();
}

/* ── 7. KARAR DEFTERİ VE TEKİLLEŞTİRME ─────────────────────────────────── */

export interface ReasoningLedger {
  readonly entries: readonly MaviReasoning[];
  /** Aynı kararın tekrar üretilme sayısı — yeni kayıt AÇILMADI. */
  readonly duplicateCount: number;
  /** Geçersiz durum geçişi denemesi sayısı (sessiz yutma YOK). */
  readonly invalidTransitionCount: number;
}

export const EMPTY_REASONING_LEDGER: ReasoningLedger = Object.freeze({
  entries: Object.freeze([]) as readonly MaviReasoning[],
  duplicateCount: 0,
  invalidTransitionCount: 0,
});

/** Defter tavanı — sınırsız büyüyen dizi bellek sızıntısıdır. */
export const REASONING_LEDGER_MAX = 500;

/** Kayıt sonucu — bounded KOD. */
export const RECORD_RESULTS = ['RECORDED', 'DUPLICATE'] as const;
export type RecordResult = (typeof RECORD_RESULTS)[number];

/**
 * Kararı deftere yazar — **tekilleştirir, çoğaltmaz** (kural 5).
 *
 * Aynı kimlikteki karar İKİNCİ KEZ AÇILMAZ: replay yalnız `duplicateCount`
 * artırır. Kanıt kümesi değişmişse kimlik de değişir → o artık **başka bir
 * karardır**, çünkü dayanağı başkadır.
 */
export function recordReasoning(
  ledger: ReasoningLedger, reasoning: MaviReasoning,
): { readonly ledger: ReasoningLedger; readonly result: RecordResult } {
  if (ledger.entries.some((r) => r.reasoningId === reasoning.reasoningId)) {
    return {
      ledger: { ...ledger, duplicateCount: ledger.duplicateCount + 1 },
      result: 'DUPLICATE',
    };
  }
  const entries = [...ledger.entries, reasoning];
  return {
    ledger: {
      ...ledger,
      entries: entries.length <= REASONING_LEDGER_MAX
        ? entries : entries.slice(entries.length - REASONING_LEDGER_MAX),
    },
    result: 'RECORDED',
  };
}

/**
 * Durum geçişi uygular — **geçersiz geçişi REDDEDER** (sessizce düzeltmez).
 *
 * ⚠️ Reddedilen geçiş sayılır ve görünür kalır: "karar durumu neden
 * ilerlemedi" sorusu cevapsız bırakılamaz.
 */
export function transitionReasoning(
  ledger: ReasoningLedger, reasoningId: string, to: ReasoningState,
): { readonly ledger: ReasoningLedger; readonly ok: boolean } {
  const idx = ledger.entries.findIndex((r) => r.reasoningId === reasoningId);
  if (idx < 0) return { ledger, ok: false };

  const prev = ledger.entries[idx]!;
  if (!canTransitionReasoning(prev.state, to)) {
    return {
      ledger: { ...ledger, invalidTransitionCount: ledger.invalidTransitionCount + 1 },
      ok: false,
    };
  }
  const entries = [...ledger.entries];
  entries[idx] = { ...prev, state: to };
  return { ledger: { ...ledger, entries }, ok: true };
}

/**
 * Süresi dolan kararları `EXPIRED` yapar — **SİLMEZ** ve **İDEMPOTENTTİR**.
 *
 * ⚠️ Yalnız sonuçlandırıcı kararlar süresi dolabilir; `REJECTED` zaten
 * terminaldir ve `UNKNOWN` bir karar değil bir bilgisizlik beyanıdır —
 * ikisi de durum makinesinin izin verdiği ölçüde işlenir.
 */
export function expireReasoning(
  ledger: ReasoningLedger, nowMs: number,
): ReasoningLedger {
  let changed = false;
  const entries = ledger.entries.map((r) => {
    if (nowMs < r.expiresAt) return r;
    if (!canTransitionReasoning(r.state, 'EXPIRED')) return r;
    changed = true;
    return { ...r, state: 'EXPIRED' as const };
  });
  return changed ? { ...ledger, entries } : ledger;
}

/* ── 8. KARAR ZİNCİRİ ──────────────────────────────────────────────────── */

/**
 * Kararı geriye doğru okur:
 * `DECISION → EVIDENCE → FLEET_INSIGHT · DRIVER_DNA → TRIP → VEHICLE`.
 *
 * ⚠️ Okunamayan düğüm **UYDURULMAZ**: kanıt defterde yoksa düğüm
 * `resolved: false` ile görünür kalır. Sessizce atlamak, zincirde delik
 * olduğunu gizlemek olurdu.
 */
export function buildReasoningChain(
  ledger: EvidenceLedger, reasoning: MaviReasoning,
): readonly ReasoningChainNode[] {
  const nodes: ReasoningChainNode[] = [{
    layer: 'DECISION', refId: reasoning.reasoningId,
    parentRefId: null, resolved: true,
  }];

  for (const evidenceId of reasoning.evidenceIds) {
    const e = ledger.entries.find((x) => x.id === evidenceId) ?? null;
    nodes.push({
      layer: 'EVIDENCE', refId: evidenceId,
      parentRefId: reasoning.reasoningId, resolved: e !== null,
    });
    if (e === null) continue;

    for (const l of ledger.chain) {
      if (l.evidenceId !== evidenceId) continue;
      if (l.consumer === 'FLEET_INSIGHT') {
        nodes.push({
          layer: 'FLEET_INSIGHT', refId: l.consumerId,
          parentRefId: evidenceId, resolved: true,
        });
      } else if (l.consumer === 'DRIVER_DNA') {
        nodes.push({
          layer: 'DRIVER_DNA', refId: l.consumerId,
          parentRefId: evidenceId, resolved: true,
        });
      }
    }

    if (e.tripId !== null) {
      nodes.push({
        layer: 'TRIP', refId: e.tripId, parentRefId: evidenceId, resolved: true,
      });
    }
    if (e.vehicleId !== null) {
      nodes.push({
        layer: 'VEHICLE', refId: e.vehicleId,
        parentRefId: e.tripId ?? evidenceId, resolved: true,
      });
    }
  }
  return nodes;
}

/* ── 9. CİHAZ TARAFI GÖZLEM YÜZEYİ (LAB) ───────────────────────────────── */

/**
 * Karar deposu — **head unit'te BİLİNÇLİ OLARAK BOŞTUR.**
 *
 * Karar omurgası sunucuda yaşar (migration 057): karar şirket geneli
 * sorgulanır, kanıt omurgasının yanında durmalıdır ve tek bir cihazın
 * belleğinde tutulamaz. Head unit'te karar ÜRETEN bir yol YOKTUR; bu depo
 * yalnız gelecekte bir okuma köprüsü bağlandığında dolacak sözleşmeyi ve
 * LAB'ın dürüst "henüz karar yok" cevabını sağlar.
 */
class MaviReasoningStore {
  private _ledger: ReasoningLedger = EMPTY_REASONING_LEDGER;
  private _queue: ReasoningQueueSnapshot = EMPTY_QUEUE_SNAPSHOT;
  private _schedule: SchedulerHealth = UNREAD_SCHEDULER_HEALTH;
  private _scheduleRead = false;
  private _source: 'NONE' | 'SERVER' = 'NONE';

  setFromServer(
    ledger: ReasoningLedger,
    queue?: ReasoningQueueSnapshot,
    schedule?: SchedulerHealth,
  ): void {
    this._ledger = ledger;
    /* Kuyruk ayrı okunur: karar defteri gelip kuyruk gelmediyse kuyruk
       BOŞ değil, BİLİNMEYEN sayılır — LAB bunu ayırt eder. */
    this._queue = queue ?? EMPTY_QUEUE_SNAPSHOT;
    /* Zamanlayıcı da ayrı okunur ve OKUNMADIYSA "sağlıklı" SAYILMAZ:
       `scheduleRead=false` iken durum `NOT_READ`tır (059 sözleşmesi). */
    if (schedule !== undefined) {
      this._schedule = schedule;
      this._scheduleRead = true;
    }
    this._source = 'SERVER';
  }

  clear(): void {
    this._ledger = EMPTY_REASONING_LEDGER;
    this._queue = EMPTY_QUEUE_SNAPSHOT;
    this._schedule = UNREAD_SCHEDULER_HEALTH;
    this._scheduleRead = false;
    this._source = 'NONE';
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(nowMs: number): ReasoningReadout {
    try {
      const l = this._ledger;
      const byIntent = new Map<ReasoningIntent, number>();
      const byDecision = new Map<ReasoningDecision, number>();
      for (const r of l.entries) {
        byIntent.set(r.intent, (byIntent.get(r.intent) ?? 0) + 1);
        byDecision.set(r.decision, (byDecision.get(r.decision) ?? 0) + 1);
      }
      const valid = l.entries.filter((r) => isReasoningValid(r, nowMs));
      const ages = l.entries.map((r) => Math.max(0, nowMs - r.createdAt));

      /* BÜTÜNLÜK: sonuçlandırıcı bir karar kanıtsız veya güvensiz olamaz. */
      const integrityOk = !l.entries.some(
        (r) => (r.decision === 'SUPPORTED' || r.decision === 'UNSUPPORTED')
          && (r.evidenceIds.length === 0 || r.confidence === 'UNKNOWN'));

      return {
        ledger: l,
        queue: this._queue,
        schedule: this._schedule,
        scheduleRead: this._scheduleRead,
        source: this._source,
        reasoningCount: l.entries.length,
        validCount: valid.length,
        expiredCount: l.entries.filter((r) => r.state === 'EXPIRED').length,
        conflictedCount: byDecision.get('CONFLICTED_EVIDENCE') ?? 0,
        unknownCount: (byDecision.get('UNKNOWN') ?? 0)
          + (byDecision.get('INSUFFICIENT_EVIDENCE') ?? 0),
        expiredEvidenceCount: byDecision.get('EXPIRED_EVIDENCE') ?? 0,
        rejectedCount: byDecision.get('REJECTED') ?? 0,
        duplicateCount: l.duplicateCount,
        invalidTransitionCount: l.invalidTransitionCount,
        evidenceRefCount: l.entries.reduce((n, r) => n + r.evidenceIds.length, 0),
        /* Karar yoksa yaş BİLİNMEZ (0 DEĞİL — "hiç karar verilmedi"). */
        newestDecisionAgeMs: ages.length === 0 ? null : Math.min(...ages),
        oldestDecisionAgeMs: ages.length === 0 ? null : Math.max(...ages),
        intentBreakdown: [...byIntent.entries()]
          .map(([intent, count]) => ({ intent, count }))
          .sort((a, b) => b.count - a.count),
        decisionBreakdown: [...byDecision.entries()]
          .map(([decision, count]) => ({ decision, count }))
          .sort((a, b) => b.count - a.count),
        integrityOk,
      };
    } catch {
      return EMPTY_REASONING_READOUT;
    }
  }

  /** @internal — testler arası izolasyon. */
  _resetForTest(): void { this.clear(); }
}

export interface ReasoningReadout {
  readonly ledger: ReasoningLedger;
  /** Üretim olay kuyruğu — head unit'te BOŞ (üretim sunucudadır). */
  readonly queue: ReasoningQueueSnapshot;
  /** Kuyruk koşucusunun zamanlanmış koşum sağlığı (059). */
  readonly schedule: SchedulerHealth;
  /** Zamanlayıcı sunucudan OKUNDU mu — okunmadıysa sağlık `NOT_READ`. */
  readonly scheduleRead: boolean;
  readonly source: 'NONE' | 'SERVER';
  readonly reasoningCount: number;
  readonly validCount: number;
  readonly expiredCount: number;
  readonly conflictedCount: number;
  readonly unknownCount: number;
  readonly expiredEvidenceCount: number;
  readonly rejectedCount: number;
  readonly duplicateCount: number;
  readonly invalidTransitionCount: number;
  readonly evidenceRefCount: number;
  readonly newestDecisionAgeMs: number | null;
  readonly oldestDecisionAgeMs: number | null;
  readonly intentBreakdown: readonly { intent: ReasoningIntent; count: number }[];
  readonly decisionBreakdown: readonly { decision: ReasoningDecision; count: number }[];
  readonly integrityOk: boolean;
}

const EMPTY_REASONING_READOUT: ReasoningReadout = Object.freeze({
  ledger: EMPTY_REASONING_LEDGER,
  queue: EMPTY_QUEUE_SNAPSHOT,
  schedule: UNREAD_SCHEDULER_HEALTH,
  scheduleRead: false,
  source: 'NONE',
  reasoningCount: 0, validCount: 0, expiredCount: 0, conflictedCount: 0,
  unknownCount: 0, expiredEvidenceCount: 0, rejectedCount: 0,
  duplicateCount: 0, invalidTransitionCount: 0, evidenceRefCount: 0,
  newestDecisionAgeMs: null, oldestDecisionAgeMs: null,
  intentBreakdown: Object.freeze([]) as readonly { intent: ReasoningIntent; count: number }[],
  decisionBreakdown: Object.freeze([]) as readonly { decision: ReasoningDecision; count: number }[],
  integrityOk: true,
});

export const maviReasoningStore = new MaviReasoningStore();

/** LAB salt-okuma yüzeyi — karar ÜRETMEZ, yalnız okur. */
export function readMaviReasoning(nowMs: number): ReasoningReadout {
  return maviReasoningStore.read(nowMs);
}

/** Kanıt imzası — dışa açılır (sunucu/istemci imzası aynı olmalı). */
export { evidenceSignature };

/** @internal — testler arası izolasyon. */
export function _resetMaviReasoningStoreForTest(): void {
  maviReasoningStore._resetForTest();
}
