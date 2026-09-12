/**
 * reasoningView.ts — FLEET DASHBOARD · KARAR KARTLARI GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * **"Bu filo hakkında verilen kararların kaçı gerçekten kanıtlanmış — kaçı
 * çelişkili, kaçı bilinmiyor, kaçının süresi dolmuş?"**
 *
 * ── BU BİR AI PANELİ DEĞİLDİR ─────────────────────────────────────────
 * Cevap/öneri/cümle üretilmez. **LLM burada da karar vermez**: kartlar
 * sunucunun (migration 057) ZATEN VERDİĞİ kararı sayar ve gösterir.
 *
 * ── İKİ OTORİTE YASAĞI ────────────────────────────────────────────────
 * Karar mantığı ve güven formülü burada YENİDEN YAZILMAZ; sunucu türetir,
 * bu katman yalnız daraltır ve gösterir. Bir kararı bu katmanda
 * "yorumlamak" ikinci bir karar otoritesi kurmak olurdu.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · LLM YOK.
 */

/** `get_reasoning_summary()` satırı — alanlar eksik/bozuk gelebilir. */
export interface ReasoningSummaryRow {
  readonly company_id?: string | null;
  readonly reasoning_total?: number | null;
  readonly valid_count?: number | null;
  readonly expired_count?: number | null;
  readonly supported_count?: number | null;
  readonly unsupported_count?: number | null;
  readonly conflicted_count?: number | null;
  readonly unknown_count?: number | null;
  readonly insufficient_count?: number | null;
  readonly expired_evidence_count?: number | null;
  readonly rejected_count?: number | null;
  readonly duplicate_count?: number | null;
  readonly invalid_transition_count?: number | null;
  readonly rejected_request_count?: number | null;
  readonly evidence_ref_total?: number | null;
  readonly chain_node_total?: number | null;
  readonly high_confidence_ratio?: number | string | null;
  readonly conclusive_ratio?: number | string | null;
  readonly newest_decision_age_seconds?: number | null;
  readonly oldest_decision_age_seconds?: number | null;
  readonly integrity_ok?: boolean | null;
}

/** `get_recent_reasoning()` satırı. */
export interface RecentReasoningRow {
  readonly reasoning_id?: string | null;
  readonly intent?: string | null;
  readonly decision?: string | null;
  readonly confidence?: string | null;
  readonly confidence_reason?: string | null;
  readonly state?: string | null;
  readonly evidence_count?: number | null;
  readonly conflict_count?: number | null;
  readonly coverage_ratio?: number | string | null;
  readonly vehicle_id?: string | null;
  readonly driver_id?: string | null;
  readonly trip_id?: string | null;
  readonly decision_age_seconds?: number | null;
}

export interface ReasoningCard {
  readonly key: 'RECENT' | 'CONFIDENCE' | 'EVIDENCE' | 'CONFLICT' | 'UNKNOWN';
  readonly label: string;
  /** `null` = bilinmiyor (0 DEĞİL). */
  readonly value: number | null;
  readonly unit: 'PERCENT' | 'COUNT';
  /** Karar bağlamı — yorum DEĞİL. */
  readonly detail: string;
  readonly known: boolean;
  /** Dikkat çekmesi gereken kart (çelişki/bilinmezlik) — bir uyarı DEĞİL. */
  readonly attention: boolean;
}

export interface ReasoningItem {
  readonly id: string;
  readonly intent: string;
  readonly decision: string;
  readonly confidence: string;
  readonly confidenceReason: string;
  readonly state: string;
  readonly evidenceCount: number;
  readonly conflictCount: number;
  /** `null` = kapsam hesaplanamadı ("hiç bakmadık"). */
  readonly coverageRatio: number | null;
  readonly ageSeconds: number | null;
  /** Yalnız `SUPPORTED`/`UNSUPPORTED` bir bilgi taşır. */
  readonly conclusive: boolean;
  readonly subjectRef: string;
}

export interface ReasoningView {
  readonly present: boolean;
  readonly cards: readonly ReasoningCard[];
  readonly items: readonly ReasoningItem[];
  readonly total: number;
  readonly conclusiveRatio: number | null;
  readonly highConfidenceRatio: number | null;
  readonly conflictCount: number;
  readonly unknownCount: number;
  readonly expiredCount: number;
  readonly duplicateSuppressed: number | null;
  readonly invalidTransitions: number | null;
  readonly integrityOk: boolean | null;
  readonly newestDecisionAgeSeconds: number | null;
  readonly absentReason: 'NO_ROW' | 'NO_DECISION' | null;
}

export const EMPTY_REASONING_VIEW: ReasoningView = Object.freeze({
  present: false,
  cards: Object.freeze([]) as readonly ReasoningCard[],
  items: Object.freeze([]) as readonly ReasoningItem[],
  total: 0,
  conclusiveRatio: null, highConfidenceRatio: null,
  conflictCount: 0, unknownCount: 0, expiredCount: 0,
  duplicateSuppressed: null, invalidTransitions: null,
  integrityOk: null, newestDecisionAgeSeconds: null,
  absentReason: 'NO_ROW',
});

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100);
}

/** Kısaltılmış özne referansı — ad/plaka/VIN **taşınmaz**. */
function subjectRefOf(r: RecentReasoningRow): string {
  if (typeof r.vehicle_id === 'string' && r.vehicle_id.length > 0) {
    return `veh:${r.vehicle_id.slice(0, 8)}`;
  }
  if (typeof r.driver_id === 'string' && r.driver_id.length > 0) {
    return `drv:${r.driver_id.slice(0, 8)}`;
  }
  if (typeof r.trip_id === 'string' && r.trip_id.length > 0) {
    return `trip:${r.trip_id.slice(0, 8)}`;
  }
  return 'UNAVAILABLE';
}

/**
 * Sunucu satırlarını kart görünümüne çevirir.
 *
 * ⚠️ Karar yoksa **kart dolu gösterilmez** — gerekçe yazılır. Yarım bir
 * karar tablosu, kullanıcıya "her şey karara bağlandı" izlenimi verir.
 */
export function buildReasoningView(
  summary: ReasoningSummaryRow | null | undefined,
  recent?: readonly RecentReasoningRow[] | null,
): ReasoningView {
  if (summary === null || summary === undefined) return EMPTY_REASONING_VIEW;

  const total = num(summary.reasoning_total) ?? 0;
  const valid = num(summary.valid_count) ?? 0;
  const expired = num(summary.expired_count) ?? 0;
  const supported = num(summary.supported_count) ?? 0;
  const unsupported = num(summary.unsupported_count) ?? 0;
  const conflicted = num(summary.conflicted_count) ?? 0;
  const unknown = num(summary.unknown_count) ?? 0;
  const insufficient = num(summary.insufficient_count) ?? 0;
  const expiredEvidence = num(summary.expired_evidence_count) ?? 0;
  const rejected = num(summary.rejected_count) ?? 0;
  const duplicates = num(summary.duplicate_count);
  const invalidTransitions = num(summary.invalid_transition_count);
  const evidenceRefs = num(summary.evidence_ref_total);
  const quality = num(summary.high_confidence_ratio);
  const conclusive = num(summary.conclusive_ratio);
  const newestAge = num(summary.newest_decision_age_seconds);
  const integrity = typeof summary.integrity_ok === 'boolean' ? summary.integrity_ok : null;

  /* "Bilmiyorum"un üç ayrı biçimi tek sayıda toplanır ama gerekçeleri
     kartın detayında AYRI kalır — hepsi aynı şey değildir. */
  const unknownTotal = unknown + insufficient + expiredEvidence;

  const items = buildReasoningItems(recent);

  if (total === 0) {
    return {
      ...EMPTY_REASONING_VIEW,
      items,
      duplicateSuppressed: duplicates,
      invalidTransitions,
      integrityOk: integrity,
      absentReason: 'NO_DECISION',
    };
  }

  const cards: ReasoningCard[] = [
    {
      key: 'RECENT', label: 'Son kararlar',
      value: total, unit: 'COUNT',
      detail: `${valid} geçerli · ${expired} süresi dolmuş`
        + (rejected > 0 ? ` · ${rejected} reddedildi` : ''),
      known: true, attention: false,
    },
    {
      key: 'CONFIDENCE', label: 'Karar güveni',
      value: pct(quality), unit: 'PERCENT',
      /* Güven bir başarı ölçüsü değil, bilgi ölçüsüdür. */
      detail: conclusive === null
        ? 'Sonuçlandırıcı karar oranı bilinmiyor'
        : `%${pct(conclusive)} karar sonuçlandırıcı (${supported} olumlu · ${unsupported} olumsuz)`,
      known: quality !== null, attention: false,
    },
    {
      key: 'EVIDENCE', label: 'Kanıt durumu',
      value: evidenceRefs, unit: 'COUNT',
      detail: evidenceRefs === null
        ? 'Kanıt bağı okunamadı'
        : `${evidenceRefs} kanıt bağı — kanıtsız karar sonuçlandırıcı olamaz`,
      known: evidenceRefs !== null, attention: false,
    },
    {
      key: 'CONFLICT', label: 'Çakışmalar',
      value: conflicted, unit: 'COUNT',
      /* Çelişki bir hata değil, karar verilememesinin GEREKÇESİDİR. */
      detail: conflicted === 0
        ? 'Çelişkili kanıt yok'
        : 'Kaynaklar çelişiyor — bu kararlarda sonuç ÜRETİLMEDİ',
      known: true, attention: conflicted > 0,
    },
    {
      key: 'UNKNOWN', label: 'Bilinmeyenler',
      value: unknownTotal, unit: 'COUNT',
      detail: `${insufficient} kanıt yetersiz · ${expiredEvidence} kanıt süresi dolmuş`
        + ` · ${unknown} niyet/güven çözülemedi`,
      known: true, attention: unknownTotal > 0,
    },
  ];

  return {
    present: true, cards, items,
    total,
    conclusiveRatio: conclusive, highConfidenceRatio: quality,
    conflictCount: conflicted, unknownCount: unknownTotal, expiredCount: expired,
    duplicateSuppressed: duplicates, invalidTransitions,
    integrityOk: integrity, newestDecisionAgeSeconds: newestAge,
    absentReason: null,
  };
}

/**
 * Son karar satırlarını listeye çevirir (SALT-OKUNUR).
 *
 * ⚠️ Bozuk satır SESSİZCE UYDURULMAZ: kimliği veya niyeti okunamayan kayıt
 * atlanır — yarım bir karar, karar değildir.
 */
export function buildReasoningItems(
  rows: readonly RecentReasoningRow[] | null | undefined,
): readonly ReasoningItem[] {
  if (rows === null || rows === undefined) return [];
  const items: ReasoningItem[] = [];
  for (const r of rows) {
    const id = typeof r.reasoning_id === 'string' ? r.reasoning_id : null;
    const intent = typeof r.intent === 'string' ? r.intent : null;
    const decision = typeof r.decision === 'string' ? r.decision : null;
    if (id === null || intent === null || decision === null) continue;
    items.push({
      id, intent, decision,
      confidence: typeof r.confidence === 'string' ? r.confidence : 'UNKNOWN',
      confidenceReason: typeof r.confidence_reason === 'string'
        ? r.confidence_reason : 'NO_EVIDENCE',
      state: typeof r.state === 'string' ? r.state : 'UNKNOWN',
      evidenceCount: num(r.evidence_count) ?? 0,
      conflictCount: num(r.conflict_count) ?? 0,
      coverageRatio: num(r.coverage_ratio),
      ageSeconds: num(r.decision_age_seconds),
      conclusive: decision === 'SUPPORTED' || decision === 'UNSUPPORTED',
      subjectRef: subjectRefOf(r),
    });
  }
  return items;
}

/* ── Üretim kuyruğu ve gecikme (058 wiring) ────────────────────────────── */

/** `get_reasoning_queue()` satırı. */
export interface ReasoningQueueRow {
  readonly company_id?: string | null;
  readonly event_total?: number | null;
  readonly pending_count?: number | null;
  readonly running_count?: number | null;
  readonly completed_count?: number | null;
  readonly failed_count?: number | null;
  readonly retry_pending_count?: number | null;
  readonly rejected_count?: number | null;
  readonly skipped_count?: number | null;
  readonly deduped_count?: number | null;
  readonly suppressed_total?: number | null;
  readonly avg_queue_ms?: number | string | null;
  readonly avg_decision_ms?: number | string | null;
  readonly max_queue_ms?: number | string | null;
  readonly max_decision_ms?: number | string | null;
  readonly oldest_pending_age_seconds?: number | null;
  readonly last_event_age_seconds?: number | null;
  readonly queue_healthy?: boolean | null;
}

export interface QueueCard {
  readonly key: 'QUEUE' | 'LATENCY' | 'SUPPRESSED' | 'FAILED';
  readonly label: string;
  /** `null` = bilinmiyor (0 DEĞİL). */
  readonly value: number | null;
  readonly unit: 'COUNT' | 'MS';
  readonly detail: string;
  readonly known: boolean;
  readonly attention: boolean;
}

export interface ReasoningQueueView {
  readonly present: boolean;
  readonly cards: readonly QueueCard[];
  readonly openCount: number;
  readonly failedCount: number;
  readonly suppressedTotal: number;
  /** `null` = hiç iş bitmedi ("0 ms" DEĞİL). */
  readonly avgQueueMs: number | null;
  readonly avgDecisionMs: number | null;
  readonly maxDecisionMs: number | null;
  readonly oldestPendingAgeSeconds: number | null;
  readonly lastEventAgeSeconds: number | null;
  readonly healthy: boolean | null;
  readonly absentReason: 'NO_ROW' | 'NO_EVENT' | null;
}

export const EMPTY_QUEUE_VIEW: ReasoningQueueView = Object.freeze({
  present: false,
  cards: Object.freeze([]) as readonly QueueCard[],
  openCount: 0, failedCount: 0, suppressedTotal: 0,
  avgQueueMs: null, avgDecisionMs: null, maxDecisionMs: null,
  oldestPendingAgeSeconds: null, lastEventAgeSeconds: null,
  healthy: null, absentReason: 'NO_ROW',
});

/**
 * Kuyruk satırını kart görünümüne çevirir.
 *
 * ⚠️ **Hiç olay yoksa bu bir başarı DEĞİLDİR:** "kuyruk temiz" ile "hiçbir
 * şey tetiklenmedi" farklı şeylerdir ve ikincisi bir arıza işareti olabilir.
 * Bu yüzden olay yokken kart gösterilmez, gerekçe yazılır.
 */
export function buildReasoningQueueView(
  row: ReasoningQueueRow | null | undefined,
): ReasoningQueueView {
  if (row === null || row === undefined) return EMPTY_QUEUE_VIEW;

  const total = num(row.event_total) ?? 0;
  const pending = num(row.pending_count) ?? 0;
  const running = num(row.running_count) ?? 0;
  const retry = num(row.retry_pending_count) ?? 0;
  const completed = num(row.completed_count) ?? 0;
  const failed = num(row.failed_count) ?? 0;
  const rejected = num(row.rejected_count) ?? 0;
  const skipped = num(row.skipped_count) ?? 0;
  const deduped = num(row.deduped_count) ?? 0;
  const suppressed = num(row.suppressed_total) ?? 0;
  const avgQueue = num(row.avg_queue_ms);
  const avgDecision = num(row.avg_decision_ms);
  const maxDecision = num(row.max_decision_ms);
  const oldestPending = num(row.oldest_pending_age_seconds);
  const lastEvent = num(row.last_event_age_seconds);
  const healthy = typeof row.queue_healthy === 'boolean' ? row.queue_healthy : null;

  const open = pending + running + retry;

  if (total === 0) {
    return {
      ...EMPTY_QUEUE_VIEW,
      healthy,
      absentReason: 'NO_EVENT',
    };
  }

  const cards: QueueCard[] = [
    {
      key: 'QUEUE', label: 'Karar kuyruğu',
      value: open, unit: 'COUNT',
      detail: `${pending} bekliyor · ${running} çalışıyor · ${retry} yeniden denenecek`,
      known: true, attention: retry > 0,
    },
    {
      key: 'LATENCY', label: 'Karar gecikmesi',
      value: avgDecision === null ? null : Math.round(avgDecision), unit: 'MS',
      /* Hiç iş bitmediyse ortalama BİLİNMEZ — "0 ms" demek yanlış olurdu. */
      detail: avgDecision === null
        ? 'Henüz tamamlanan iş yok — ölçüm bilinmiyor'
        : `kuyrukta ort. ${avgQueue === null ? '—' : Math.round(avgQueue)} ms`
          + ` · en yavaş karar ${maxDecision === null ? '—' : Math.round(maxDecision)} ms`,
      known: avgDecision !== null, attention: false,
    },
    {
      key: 'SUPPRESSED', label: 'Bastırılan tekrar',
      value: suppressed, unit: 'COUNT',
      /* Bastırma bir kayıp değil, tasarımdır — ama görünür kalır. */
      detail: `${deduped} olay tekrar sayıldı · ${skipped} olay öznesiz atlandı`
        + (rejected > 0 ? ` · ${rejected} reddedildi` : ''),
      known: true, attention: false,
    },
    {
      key: 'FAILED', label: 'Düşen olay',
      value: failed, unit: 'COUNT',
      detail: failed === 0
        ? `${completed} olay karara bağlandı`
        : 'Karar üretilemedi — hata sessizce yutulmadı',
      known: true, attention: failed > 0,
    },
  ];

  return {
    present: true, cards,
    openCount: open, failedCount: failed, suppressedTotal: suppressed,
    avgQueueMs: avgQueue, avgDecisionMs: avgDecision, maxDecisionMs: maxDecision,
    oldestPendingAgeSeconds: oldestPending, lastEventAgeSeconds: lastEvent,
    healthy, absentReason: null,
  };
}

/**
 * Kuyruk boşsa dürüst açıklama.
 *
 * ⚠️ "Hiç olay yok" cümlesi bilinçli olarak bir UYARI tonundadır: üretim
 * akışı bağlıyken hiç olay üretilmemesi, tetikleyicilerin çalışmadığı
 * anlamına gelebilir.
 */
export function queueAbsenceExplanation(v: ReasoningQueueView): string | null {
  if (v.present) return null;
  if (v.absentReason === 'NO_EVENT') {
    return 'Hiç karar olayı üretilmedi. Bu "kuyruk temiz" demek DEĞİLDİR: '
         + 'gerçek bir yolculuk, kanıt veya sürücü olayı henüz oluşmamış '
         + 'olabilir ya da tetikleyiciler çalışmıyor olabilir.';
  }
  return 'Karar kuyruğu okunamadı.';
}

/* ── Kuyruk zamanlayıcısı (059) ────────────────────────────────────────── */

/** `get_reasoning_scheduler_health()` satırı. */
export interface SchedulerHealthRow {
  readonly scheduler_installed?: boolean | null;
  readonly job_scheduled?: boolean | null;
  readonly schedule_expression?: string | null;
  readonly interval_seconds?: number | null;
  readonly run_total?: number | null;
  readonly last_run_age_seconds?: number | null;
  readonly last_run_outcome?: string | null;
  readonly last_run_duration_ms?: number | string | null;
  readonly last_processed?: number | null;
  readonly last_expired?: number | null;
  readonly consecutive_failure_count?: number | null;
  readonly overdue?: boolean | null;
  readonly healthy?: boolean | null;
}

/**
 * Zamanlayıcının tek kelimelik durumu — cihazdaki `SchedulerStatus` ile
 * AYNI bounded küme. İki yüzey aynı kuyruk için farklı sözcük kullanamaz.
 */
export type SchedulerStatusCode =
  | 'NOT_READ' | 'NOT_INSTALLED' | 'NOT_SCHEDULED' | 'NEVER_RUN'
  | 'FAILING' | 'OVERDUE' | 'INTERVAL_UNKNOWN' | 'HEALTHY';

export interface SchedulerView {
  readonly present: boolean;
  readonly status: SchedulerStatusCode;
  readonly label: string;
  /** Kullanıcıya gösterilecek gerekçe — bounded koddan sabit karşılık. */
  readonly detail: string;
  readonly attention: boolean;
  readonly scheduleExpression: string | null;
  readonly intervalSeconds: number | null;
  /** `null` = hiç koşmadı ("0 sn" DEĞİL). */
  readonly lastRunAgeSeconds: number | null;
  readonly lastRunDurationMs: number | null;
  readonly lastProcessed: number | null;
  readonly lastExpired: number | null;
  readonly consecutiveFailureCount: number;
  readonly runTotal: number;
  readonly healthy: boolean | null;
}

export const EMPTY_SCHEDULER_VIEW: SchedulerView = Object.freeze({
  present: false,
  status: 'NOT_READ',
  label: 'Zamanlayıcı okunmadı',
  detail: 'Kuyruk koşucusunun durumu sunucudan okunamadı — bu bir sağlık '
        + 'raporu DEĞİLDİR.',
  attention: false,
  scheduleExpression: null, intervalSeconds: null,
  lastRunAgeSeconds: null, lastRunDurationMs: null,
  lastProcessed: null, lastExpired: null,
  consecutiveFailureCount: 0, runTotal: 0, healthy: null,
});

/**
 * Zamanlayıcı satırını kart görünümüne çevirir.
 *
 * ⚠️ **Durumu sunucu söyler, panel yeniden hesaplamaz.** Buradaki sıra
 * migration 059'daki `CASE` ile aynıdır; ayrışsalardı aynı kuyruk için iki
 * farklı hüküm doğardı (ikinci otorite).
 *
 * ⚠️ "Zamanlanmamış" bir arızadır ve YUMUŞATILMAZ: koşucu yoksa kuyruğa
 * alınan her olay sonsuza kadar bekler.
 */
export function buildSchedulerView(
  row: SchedulerHealthRow | null | undefined,
): SchedulerView {
  if (row === null || row === undefined) return EMPTY_SCHEDULER_VIEW;

  const installed = row.scheduler_installed === true;
  const scheduled = row.job_scheduled === true;
  const expr = typeof row.schedule_expression === 'string'
    ? row.schedule_expression : null;
  const interval = num(row.interval_seconds);
  const age = num(row.last_run_age_seconds);
  const duration = num(row.last_run_duration_ms);
  const processed = num(row.last_processed);
  const expired = num(row.last_expired);
  const fails = num(row.consecutive_failure_count) ?? 0;
  const runTotal = num(row.run_total) ?? 0;
  const healthy = typeof row.healthy === 'boolean' ? row.healthy : null;

  let status: SchedulerStatusCode;
  if (!installed) status = 'NOT_INSTALLED';
  else if (!scheduled) status = 'NOT_SCHEDULED';
  else if (age === null) status = 'NEVER_RUN';
  else if (fails > 0) status = 'FAILING';
  else if (interval === null) status = 'INTERVAL_UNKNOWN';
  else if (age > interval * 3) status = 'OVERDUE';
  else status = 'HEALTHY';

  return {
    present: true,
    status,
    label: schedulerStatusText(status),
    detail: schedulerStatusDetail(status, { age, interval, fails, processed }),
    /* Bilinmezlik uyarı DEĞİLDİR — yalnız gerçek arıza dikkat çeker. */
    attention: status === 'NOT_INSTALLED' || status === 'NOT_SCHEDULED'
      || status === 'FAILING' || status === 'OVERDUE',
    scheduleExpression: expr, intervalSeconds: interval,
    lastRunAgeSeconds: age, lastRunDurationMs: duration,
    lastProcessed: processed, lastExpired: expired,
    consecutiveFailureCount: fails, runTotal, healthy,
  };
}

function schedulerStatusText(s: SchedulerStatusCode): string {
  switch (s) {
    case 'NOT_READ':         return 'Zamanlayıcı okunmadı';
    case 'NOT_INSTALLED':    return 'Zamanlayıcı kurulu değil';
    case 'NOT_SCHEDULED':    return 'Koşum zamanlanmamış';
    case 'NEVER_RUN':        return 'Henüz hiç koşmadı';
    case 'FAILING':          return 'Koşum düşüyor';
    case 'OVERDUE':          return 'Koşum gecikti';
    case 'INTERVAL_UNKNOWN': return 'Aralık bilinmiyor';
    case 'HEALTHY':          return 'Zamanında koşuyor';
  }
}

function schedulerStatusDetail(
  s: SchedulerStatusCode,
  m: {
    readonly age: number | null; readonly interval: number | null;
    readonly fails: number; readonly processed: number | null;
  },
): string {
  switch (s) {
    case 'NOT_READ':
      return 'Kuyruk koşucusunun durumu sunucudan okunamadı.';
    case 'NOT_INSTALLED':
      return 'Zamanlama eklentisi kurulu değil — kuyruğa alınan olaylar '
           + 'işlenmeyecek.';
    case 'NOT_SCHEDULED':
      return 'Koşucu zamanlanmamış: bağlantı ve konum olayları ile yeniden '
           + 'denenecek işler kuyrukta bekler.';
    case 'NEVER_RUN':
      return 'Zamanlama kurulu ama koşucu henüz hiç tetiklenmedi — durum '
           + 'BİLİNMİYOR.';
    case 'FAILING':
      return `Son ${m.fails} koşum düştü — hata sessizce yutulmadı.`;
    case 'INTERVAL_UNKNOWN':
      return 'Zamanlama ifadesi tanınmadı; gecikme ÖLÇÜLEMEZ, bu yüzden '
           + '"sağlıklı" denmiyor.';
    case 'OVERDUE':
      return `Son koşumun üzerinden ${m.age ?? 0} sn geçti `
           + `(beklenen aralık ${m.interval ?? 0} sn).`;
    case 'HEALTHY':
      return m.processed === null
        ? 'Koşucu zamanında çalışıyor.'
        : `Son koşumda ${m.processed} iş işlendi.`;
  }
}

/** Zamanlayıcı okunamadıysa dürüst açıklama. */
export function schedulerAbsenceExplanation(v: SchedulerView): string | null {
  return v.present ? null : v.detail;
}

/** Karar yoksa kullanıcıya dürüst açıklama (boş kart YOK). */
export function reasoningAbsenceExplanation(v: ReasoningView): string | null {
  if (v.present) return null;
  if (v.absentReason === 'NO_DECISION') {
    return 'Henüz hiç karar üretilmedi. Karar kanıta dayanır; kanıt '
         + 'birikmeden hiçbir iddia üretilmez — bu yüzden kartlar boş.';
  }
  return 'Bu şirket için karar kaydı bulunamadı.';
}

/**
 * Kararın neden sonuçlandırıcı OLMADIĞI — bounded koddan Türkçe etiket.
 *
 * ⚠️ Bu bir AI açıklaması DEĞİLDİR: sunucunun verdiği bounded kodun sabit
 * karşılığıdır. Yeni bir cümle ÜRETİLMEZ.
 */
export function reasoningDecisionExplanation(decision: string): string {
  switch (decision) {
    case 'SUPPORTED':             return 'Kanıtlar bu alanda sorun göstermiyor';
    case 'UNSUPPORTED':           return 'Olumsuz kanıt var';
    case 'INSUFFICIENT_EVIDENCE': return 'Kanıt yetersiz — karar üretilmedi';
    case 'CONFLICTED_EVIDENCE':   return 'Kaynaklar çelişiyor — karar üretilmedi';
    case 'EXPIRED_EVIDENCE':      return 'Kanıtların süresi dolmuş — karar üretilmedi';
    case 'REJECTED':              return 'Özne uyuşmadı — karar üretilemez';
    default:                      return 'Bilinmiyor';
  }
}
